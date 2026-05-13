"""
Pipeline Composer Service.

Analyzes user agents and maps them to template pipeline steps via AI.
Produces AgentPipelineMap rows for each agent-to-step pairing with confidence
scores, using hash-based caching at temperature=0 for deterministic output.

Usage:
    from screenwriter.services.pipeline_composer import pipeline_composer
    mappings = await pipeline_composer.compose_pipeline(owner_id, db)

Note: compose_pipeline accepts an explicit Session parameter. When called from
a BackgroundTask (Phase 3), pass a fresh session via SessionLocal() -- do NOT
reuse the request session, as it closes after the response is sent.
"""

import hashlib
import json
import logging
import uuid as uuid_mod
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models.database import Agent, AgentPipelineMap, AgentType
from screenwriter.templates import get_template
from .ai_provider import chat_completion

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

COMPOSITION_SYSTEM_PROMPT = """You are a pipeline composition engine for a screenwriting assistant.

Your task: analyze the user's AI agents and map each agent to the pipeline steps where it would be most relevant and helpful.

## Pipeline Steps (target steps for agent mapping)
{steps_section}

## Rules
- Map each agent to EVERY step where it has meaningful relevance (an agent CAN map to multiple steps)
- Assign a confidence score (0.0-1.0) for each mapping based on how relevant the agent is to that step
- Provide a brief rationale for each mapping
- Agent type is a hint, not a binding constraint -- judge by the agent's system prompt and description
- Return ALL plausible mappings; downstream consumers will filter by confidence threshold

## Required Output Format
Return a JSON object with a single key "mappings" containing a list of objects:
{{"mappings": [
  {{"agent_id": "<uuid>", "phase": "<phase_id>", "subsection_key": "<key>", "confidence": 0.85, "rationale": "Brief explanation"}}
]}}
"""

COMPOSITION_USER_PROMPT = """Map these agents to the pipeline steps:

## Agents
{agents_section}

Return the mappings JSON."""


# Semantic fields that, when changed, should trigger pipeline re-composition
SEMANTIC_FIELDS = {"system_prompt_template", "description", "agent_type"}


class PipelineComposer:
    """Analyzes user agents and maps them to template pipeline steps via AI."""

    def __init__(self):
        self._cache: Dict[str, List[Dict]] = {}

    async def compose_pipeline(
        self, owner_id: UUID, db: Session
    ) -> List[AgentPipelineMap]:
        """Compose agent-to-pipeline-step mappings for an owner.

        1. Fetches all active agents for the owner
        2. If zero agents: deletes existing mappings, returns []
        3. Calls AI (with batch splitting if >PIPELINE_BATCH_SIZE agents)
        4. Full-replaces existing mappings with fresh results
        5. Returns created AgentPipelineMap instances

        Args:
            owner_id: The owner's UUID
            db: SQLAlchemy session (must be a live session, not closed)

        Returns:
            List of newly created AgentPipelineMap instances
        """
        # 1. Fetch all active agents for this owner
        agents = (
            db.query(Agent)
            .filter(Agent.owner_id == owner_id, Agent.is_active == True)
            .all()
        )

        # 2. Zero-agent early return
        if len(agents) == 0:
            logger.info("No active agents for owner %s; clearing mappings", owner_id)
            db.query(AgentPipelineMap).filter(
                AgentPipelineMap.owner_id == owner_id
            ).delete(synchronize_session="fetch")
            db.commit()
            return []

        # 3. Discover wizard targets from template
        targets = self._get_wizard_targets()

        # 4. Check cache
        cache_key = self._compute_cache_key(agents)
        if cache_key in self._cache:
            logger.info("Cache hit for owner %s (key=%s...)", owner_id, cache_key[:12])
            ai_results = self._cache[cache_key]
        else:
            logger.info(
                "Cache miss for owner %s; composing %d agents across %d targets",
                owner_id,
                len(agents),
                len(targets),
            )
            ai_results = await self._compose_batched(agents, targets)
            self._cache[cache_key] = ai_results

        # 5. Full-replace write: delete existing mappings, flush, then insert
        db.query(AgentPipelineMap).filter(
            AgentPipelineMap.owner_id == owner_id
        ).delete(synchronize_session="fetch")
        db.flush()

        # 6. Create new AgentPipelineMap instances
        created = []
        for entry in ai_results:
            mapping = AgentPipelineMap(
                id=str(uuid_mod.uuid4()),
                owner_id=str(owner_id),
                agent_id=str(entry["agent_id"]),
                phase=entry["phase"],
                subsection_key=entry["subsection_key"],
                confidence=entry["confidence"],
                rationale=entry["rationale"],
                pipeline_dirty=False,
            )
            db.add(mapping)
            created.append(mapping)

        db.commit()
        logger.info(
            "Composed %d mappings for owner %s", len(created), owner_id
        )
        return created

    def _get_wizard_targets(self, template_id: str = "short_movie") -> List[Dict]:
        """Extract generation-capable subsections from template.

        Filters for subsections with ui_pattern containing 'wizard',
        but explicitly excludes import_project (utility step, not creative).

        Returns:
            List of dicts with phase, subsection_key, name, description
        """
        template = get_template(template_id)
        targets = []
        for phase in template.get("phases", []):
            for sub in phase.get("subsections", []):
                ui_pattern = sub.get("ui_pattern", "")
                if "wizard" in ui_pattern and sub["key"] != "import_project":
                    targets.append(
                        {
                            "phase": phase["id"],
                            "subsection_key": sub["key"],
                            "name": sub["name"],
                            "description": sub.get("description", ""),
                        }
                    )
        return targets

    def _compute_cache_key(self, agents: List[Agent]) -> str:
        """Deterministic hash of all agents' semantic fields.

        Sorted by agent ID for determinism. Uses SHA-256 for collision
        resistance across multi-field concatenation.
        """
        sorted_agents = sorted(agents, key=lambda a: str(a.id))
        parts = []
        for agent in sorted_agents:
            parts.append(
                f"{agent.id}:{agent.system_prompt_template}"
                f":{agent.description or ''}"
                f":{agent.agent_type.value if hasattr(agent.agent_type, 'value') else agent.agent_type}"
            )
        combined = "|".join(parts)
        return hashlib.sha256(combined.encode()).hexdigest()

    async def _compose_batched(
        self, agents: List[Agent], targets: List[Dict]
    ) -> List[Dict]:
        """Split agents into batches and compose each batch separately.

        Batches are capped at PIPELINE_BATCH_SIZE (default 5). Results
        from all batches are concatenated (agents are different across
        batches, so results are naturally non-overlapping).
        """
        batch_size = settings.PIPELINE_BATCH_SIZE
        all_results: List[Dict] = []
        for i in range(0, len(agents), batch_size):
            batch = agents[i : i + batch_size]
            logger.debug(
                "Composing batch %d/%d (%d agents)",
                i // batch_size + 1,
                (len(agents) + batch_size - 1) // batch_size,
                len(batch),
            )
            results = await self._call_ai_composition(batch, targets)
            all_results.extend(results)
        return all_results

    async def _call_ai_composition(
        self, agents: List[Agent], targets: List[Dict]
    ) -> List[Dict]:
        """Call AI to produce agent-to-step mappings for a batch of agents.

        Builds structured prompts with agent details and target step
        descriptions, calls chat_completion at temperature=0 with
        json_mode=True, and validates the response.
        """
        # Build the steps section for the system prompt
        steps_lines = []
        for t in targets:
            steps_lines.append(
                f"- **{t['name']}** (phase: `{t['phase']}`, key: `{t['subsection_key']}`): "
                f"{t['description']}"
            )
        steps_section = "\n".join(steps_lines)

        # Build the agents section for the user prompt
        agents_lines = []
        for agent in agents:
            agent_type_val = (
                agent.agent_type.value
                if hasattr(agent.agent_type, "value")
                else agent.agent_type
            )
            agents_lines.append(
                f"- **Agent ID:** `{agent.id}`\n"
                f"  **Type:** {agent_type_val}\n"
                f"  **Description:** {agent.description or 'No description'}\n"
                f"  **System Prompt:** {agent.system_prompt_template}"
            )
        agents_section = "\n\n".join(agents_lines)

        system_msg = COMPOSITION_SYSTEM_PROMPT.format(steps_section=steps_section)
        user_msg = COMPOSITION_USER_PROMPT.format(agents_section=agents_section)

        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ]

        text = await chat_completion(
            messages=messages,
            temperature=0,
            max_tokens=settings.PIPELINE_COMPOSITION_MAX_TOKENS,
            json_mode=True,
        )

        return self._parse_ai_response(text, agents)

    def _parse_ai_response(
        self, text: str, agents: List[Agent]
    ) -> List[Dict]:
        """Parse and validate the AI JSON response.

        Validates that each returned agent_id exists in the actual agent set.
        Discards any mappings with unknown/hallucinated agent IDs.
        Converts agent_id strings to UUID objects.
        """
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.error("AI returned invalid JSON: %s", text[:200])
            return []

        raw_mappings = data.get("mappings", [])
        if not isinstance(raw_mappings, list):
            logger.error("AI returned non-list mappings: %s", type(raw_mappings))
            return []

        # Build set of valid agent IDs for validation
        valid_ids = {str(a.id) for a in agents}

        validated = []
        for m in raw_mappings:
            agent_id_str = str(m.get("agent_id", ""))
            if agent_id_str not in valid_ids:
                logger.warning(
                    "Discarding mapping with unknown agent_id: %s", agent_id_str
                )
                continue

            try:
                # Validate it's a proper UUID format, but store as string
                # for compatibility with both PostgreSQL (auto-casts) and
                # SQLite (String(36) columns in test environments).
                UUID(agent_id_str)  # validates format
                validated.append(
                    {
                        "agent_id": agent_id_str,
                        "phase": str(m["phase"]),
                        "subsection_key": str(m["subsection_key"]),
                        "confidence": float(m.get("confidence", 0.0)),
                        "rationale": str(m.get("rationale", "")),
                    }
                )
            except (KeyError, ValueError, TypeError) as e:
                logger.warning("Skipping malformed mapping entry: %s (%s)", m, e)
                continue

        logger.info(
            "Parsed %d valid mappings from %d raw entries",
            len(validated),
            len(raw_mappings),
        )
        return validated

    def is_semantic_change(self, update_fields: Dict) -> bool:
        """Check if any updated fields are semantic (trigger recomposition).

        Semantic fields: system_prompt_template, description, agent_type.
        Cosmetic fields (name, color, icon) do NOT trigger recomposition.
        """
        return bool(set(update_fields.keys()) & SEMANTIC_FIELDS)


# Module-level singleton (follows existing project convention)
pipeline_composer = PipelineComposer()
