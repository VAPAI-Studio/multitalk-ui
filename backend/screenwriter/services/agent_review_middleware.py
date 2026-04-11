# backend/app/services/agent_review_middleware.py

"""
Agent Review Middleware — intercepts wizard generation output and routes
it through mapped agents for parallel review.

REVW-01 (partial): Entry point and metadata — injection into wizards.py deferred to Phase 6
REVW-02: Parallel fan-out via asyncio.gather with session-per-task
REVW-03: AI merge with conflict-resolution and schema validation
REVW-04: Zero-agent pass-through bypass
"""

import asyncio
import collections
import json
import logging
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models.database import Agent, AgentPipelineMap
from .ai_provider import chat_completion

logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]

WIZARD_RESULT_SCHEMAS = {
    "idea_wizard": {
        "top_key": "fields",
        "description": '{"fields": {"genre": "...", "initial_idea": "...", "tone": "...", "target_audience": "..."}}',
    },
    "scene_wizard": {
        "top_key": "scenes",
        "description": '{"scenes": [{"summary": "...", "arena": "...", "inciting_incident": "...", "goal": "...", "subtext": "...", "turning_point": "...", "crisis": "...", "climax": "...", "fallout": "...", "push_forward": "..."}]}',
    },
    "script_writer_wizard": {
        "top_key": "screenplays",
        "description": '{"screenplays": [{"title": "...", "content": "...", "episode_index": 0}]}',
    },
}

MERGE_SYSTEM_PROMPT = """You are a screenplay development AI that synthesizes feedback from multiple expert agents into a single refined output.

CONFLICT RESOLUTION RULES:
- When agents disagree, the MOST SPECIFIC and ACTIONABLE suggestion wins. Do NOT blend conflicting feedback into vague compromises.
- If one agent provides a concrete improvement and another is generic, use the concrete one.
- Preserve the original structure and intent of the content while applying improvements.

You are merging {agent_count} agent reviews for the {wizard_type} step.

The output MUST match this JSON schema exactly:
{schema_description}

Return ONLY the refined output as valid JSON matching the schema above. No explanations, no markdown."""


def _summarize_feedback(feedback: Dict[str, Any]) -> str:
    """Build a concise summary string from agent feedback."""
    parts = []
    issues = feedback.get("issues", [])
    if issues:
        parts.append(f"Flagged: {len(issues)} issues.")
    suggestions = feedback.get("suggestions", [])
    if suggestions:
        parts.append(" ".join(suggestions[:2]))
    refined = feedback.get("refined_fields", {})
    if refined:
        parts.append(f"Refined {len(refined)} fields.")
    summary = " ".join(parts) if parts else "Reviewed content."
    if len(summary) > 200:
        summary = summary[:197] + "..."
    return summary


class AgentReviewMiddleware:

    async def review_step_output(
        self,
        phase: str,
        subsection_key: str,
        raw_output: Any,
        owner_id: str,
        session_factory: SessionFactory,
        wizard_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Main entry point: look up mapped agents, fan out reviews, merge results."""
        # Lookup agents using a dedicated session
        db = session_factory()
        try:
            agents_data = self._lookup_mapped_agents(owner_id, phase, subsection_key, db)
        finally:
            db.close()

        # REVW-04: Zero-agent pass-through
        if not agents_data:
            return {
                "output": raw_output,
                "agents_consulted": [],
                "review_applied": False,
            }

        # REVW-02: Parallel fan-out
        reviews = await self._fan_out_reviews(
            agents_data, raw_output, phase, subsection_key, session_factory
        )

        # Filter successful reviews
        successful = [r for r in reviews if r is not None]

        if not successful:
            return {
                "output": raw_output,
                "agents_consulted": [],
                "review_applied": False,
            }

        # REVW-03: AI merge with schema validation
        merge_type = wizard_type or subsection_key
        refined_output = await self._merge_reviews(raw_output, successful, merge_type)

        # Build agents_consulted metadata with summaries
        agents_consulted = [
            {
                "agent_id": r["agent_id"],
                "name": r["agent_name"],
                "summary": _summarize_feedback(r["feedback"]),
            }
            for r in successful
        ]

        if refined_output is None:
            # Schema validation failed — fall back to raw_output
            return {
                "output": raw_output,
                "agents_consulted": agents_consulted,
                "review_applied": False,
            }

        return {
            "output": refined_output,
            "agents_consulted": agents_consulted,
            "review_applied": True,
        }

    def _lookup_mapped_agents(
        self,
        owner_id: str,
        phase: str,
        subsection_key: str,
        db: Session,
    ) -> List[Dict[str, Any]]:
        """Query AgentPipelineMap for active agents mapped to this step.

        Applies relevance-score gating (AGENT_RELEVANCE_THRESHOLD) and
        count cap (MAX_AGENTS_PER_PIPELINE_STEP) at SQL query level to
        control token budget before any AI calls are made.
        """
        mappings = (
            db.query(AgentPipelineMap)
            .filter(
                AgentPipelineMap.owner_id == str(owner_id),
                AgentPipelineMap.phase == phase,
                AgentPipelineMap.subsection_key == subsection_key,
                AgentPipelineMap.confidence >= settings.AGENT_RELEVANCE_THRESHOLD,
            )
            .order_by(AgentPipelineMap.confidence.desc())
            .limit(settings.MAX_AGENTS_PER_PIPELINE_STEP)
            .all()
        )

        if not mappings:
            return []

        agent_ids = [str(m.agent_id) for m in mappings]
        agents = (
            db.query(Agent)
            .filter(
                Agent.id.in_(agent_ids),
                Agent.is_active == True,
            )
            .all()
        )

        # Capture ORM attributes into plain dicts before async work
        # to avoid DetachedInstanceError (Phase 2/4 pattern)
        agents_data = []
        for agent in agents:
            agent_type_val = agent.agent_type
            if hasattr(agent_type_val, "value"):
                agent_type_val = agent_type_val.value
            agents_data.append({
                "id": str(agent.id),
                "name": agent.name,
                "system_prompt_template": agent.system_prompt_template,
                "personality": agent.personality,
                "agent_type": str(agent_type_val) if agent_type_val else "book_based",
            })

        return agents_data

    async def _merge_reviews(
        self,
        raw_output: Any,
        reviews: List[Dict[str, Any]],
        wizard_type: str,
    ) -> Optional[Dict[str, Any]]:
        """Merge multiple agent reviews into refined output via AI call."""
        schema_info = WIZARD_RESULT_SCHEMAS.get(wizard_type)
        schema_description = schema_info["description"] if schema_info else "Same schema as the input"

        # Format reviews for the merge prompt
        review_sections = []
        for r in reviews:
            review_sections.append(
                f"### Agent: {r['agent_name']}\n{json.dumps(r['feedback'], indent=2)}"
            )

        system_prompt = MERGE_SYSTEM_PROMPT.format(
            agent_count=len(reviews),
            wizard_type=wizard_type,
            schema_description=schema_description,
        )

        raw_json = json.dumps(raw_output) if not isinstance(raw_output, str) else raw_output
        user_content = (
            f"Original output:\n{raw_json}\n\n"
            f"Agent reviews:\n{''.join(review_sections)}"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        response = await chat_completion(
            messages=messages,
            temperature=0.3,
            max_tokens=settings.MAX_TOKENS,
            json_mode=True,
        )

        try:
            parsed = json.loads(response)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Merge AI returned non-JSON response, falling back to raw_output")
            return None

        # Schema validation: check expected top-level key
        if schema_info and schema_info["top_key"] not in parsed:
            logger.warning(
                "Merge output missing expected key '%s' for %s, falling back to raw_output",
                schema_info["top_key"],
                wizard_type,
            )
            return None

        return parsed

    async def _fan_out_reviews(
        self,
        agents_data: List[Dict[str, Any]],
        raw_output: Any,
        phase: str,
        subsection_key: str,
        session_factory: SessionFactory,
    ) -> List[Optional[Dict[str, Any]]]:
        """Fan out reviews to N agents concurrently, each with its own session."""
        tasks = []
        for agent_data in agents_data:
            task = asyncio.wait_for(
                self._review_agent_with_session(
                    agent_data, raw_output, phase, subsection_key, session_factory
                ),
                timeout=settings.AGENT_REVIEW_TIMEOUT,
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions
        filtered = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(
                    "Agent review failed for %s: %s",
                    agents_data[i]["name"],
                    str(result),
                )
                filtered.append(None)
            else:
                filtered.append(result)

        return filtered

    async def _review_agent_with_session(
        self,
        agent_data: Dict[str, Any],
        raw_output: Any,
        phase: str,
        subsection_key: str,
        session_factory: SessionFactory,
    ) -> Dict[str, Any]:
        """Session-per-task wrapper for individual agent review."""
        db = session_factory()
        try:
            feedback = await self._single_agent_review(
                agent_name=agent_data["name"],
                agent_prompt=agent_data["system_prompt_template"],
                agent_personality=agent_data.get("personality"),
                agent_type=agent_data.get("agent_type", "book_based"),
                raw_output=raw_output,
                phase=phase,
                subsection_key=subsection_key,
            )
            return {
                "agent_id": agent_data["id"],
                "agent_name": agent_data["name"],
                "feedback": feedback,
            }
        finally:
            db.close()

    async def _single_agent_review(
        self,
        agent_name: str,
        agent_prompt: str,
        agent_personality: Optional[str],
        agent_type: str,
        raw_output: Any,
        phase: str,
        subsection_key: str,
    ) -> Dict[str, Any]:
        """Call chat_completion with agent-specific system prompt and raw_output."""
        system_prompt = self._build_pipeline_system_prompt(
            agent_name=agent_name,
            agent_template=agent_prompt,
            agent_personality=agent_personality,
            agent_type=agent_type,
            phase=phase,
            subsection_key=subsection_key,
        )

        raw_json = json.dumps(raw_output) if not isinstance(raw_output, str) else raw_output

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Review this AI-generated output and provide structured feedback:\n\n{raw_json}"},
        ]

        response = await chat_completion(
            messages=messages,
            temperature=0.7,
            max_tokens=settings.MAX_TOKENS,
            json_mode=True,
        )

        try:
            return json.loads(response)
        except (json.JSONDecodeError, TypeError):
            return {"issues": [], "suggestions": [response], "refined_fields": {}}

    def _build_pipeline_system_prompt(
        self,
        agent_name: str,
        agent_template: str,
        agent_personality: Optional[str],
        agent_type: str,
        phase: str,
        subsection_key: str,
    ) -> str:
        """Build system prompt for pipeline review context."""
        # Safe format_map with defaultdict for missing template variables
        safe_vars = collections.defaultdict(str, {
            "phase": phase,
            "subsection_key": subsection_key,
            "agent_type": agent_type,
        })

        try:
            personalized_template = agent_template.format_map(safe_vars)
        except (KeyError, ValueError):
            personalized_template = agent_template

        parts = [personalized_template]

        if agent_personality:
            parts.append(f"\nPersonality: {agent_personality}")

        parts.append(
            f"\n\nYou are reviewing AI-generated output for the {phase}/{subsection_key} step. "
            "Provide structured feedback as JSON with keys: issues, suggestions, refined_fields."
        )

        return "\n".join(parts)


# Module singleton
agent_review_middleware = AgentReviewMiddleware()
