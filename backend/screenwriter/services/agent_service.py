import asyncio
import json
import logging
import re
from typing import Callable, List, Dict, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models.database import (
    Agent, AgentType, Section, Project, Framework, SectionType,
    ChatSession, ChatMessage, PhaseData, ListItem,
)
from .rag_service import rag_service
from .ai_provider import chat_completion, chat_completion_stream
from .template_ai_service import template_ai_service
from screenwriter.templates import get_template

logger = logging.getLogger(__name__)

# Type alias for session factory callable (e.g. SessionLocal from screenwriter.db)
SessionFactory = Callable[[], Session]

# Human-readable names for section types and frameworks
SECTION_DESCRIPTIONS = {
    SectionType.INCITING_INCIDENT: "Inciting Incident",
    SectionType.PLOT_POINT_1: "Plot Point 1 (End of Act 1)",
    SectionType.MIDPOINT: "Midpoint",
    SectionType.PLOT_POINT_2: "Plot Point 2 (End of Act 2)",
    SectionType.CLIMAX: "Climax",
    SectionType.RESOLUTION: "Resolution",
}

FRAMEWORK_NAMES = {
    Framework.THREE_ACT: "Three-Act Structure",
    Framework.SAVE_THE_CAT: "Save the Cat (Blake Snyder)",
    Framework.HERO_JOURNEY: "Hero's Journey (Joseph Campbell)",
}


class AgentService:

    # ──────────────────────────────────────────────
    # Prompt building helpers
    # ──────────────────────────────────────────────

    def _format_concept_cards(self, concepts: List[Dict]) -> str:
        """Format concepts into readable cards for the system prompt."""
        if not concepts:
            return "No specific concepts available for this section."

        cards = []
        for c in concepts:
            card = f"### {c['name']}"
            card += f"\n**Definition:** {c['definition']}"
            if c.get("page_range"):
                card += f"\n**Source:** {c.get('chapter_source', 'Unknown')}, pages {c['page_range']}"
            if c.get("examples"):
                examples = "; ".join(
                    f"{ex.get('film', '?')}: {ex.get('description', '')}"
                    for ex in c["examples"][:3]
                )
                card += f"\n**Examples:** {examples}"
            if c.get("actionable_questions"):
                questions = "\n".join(f"  - {q}" for q in c["actionable_questions"][:4])
                card += f"\n**Evaluate against:**\n{questions}"
            cards.append(card)

        return "\n\n".join(cards)

    def _format_relationships(self, relationships: List[Dict]) -> str:
        if not relationships:
            return "No concept relationships available."
        lines = []
        for r in relationships:
            lines.append(f"- {r['source']} → {r['relationship']} → {r['target']}: {r.get('description', '')}")
        return "\n".join(lines)

    def _format_chunks(self, chunks: List[Dict]) -> str:
        if not chunks:
            return "No supporting book excerpts available."
        parts = []
        for i, chunk in enumerate(chunks, 1):
            source = f"[{chunk.get('book_title', 'Unknown')}"
            if chunk.get("chapter_title"):
                source += f", Ch: {chunk['chapter_title']}"
            if chunk.get("page_number"):
                source += f", p.{chunk['page_number']}"
            source += "]"
            parts.append(f"--- Excerpt {i} {source} ---\n{chunk['content'][:800]}")
        return "\n\n".join(parts)

    def _extract_field_updates(self, text: str):
        """Extract and strip the trailing JSON field_updates block from AI output.

        Returns (cleaned_text, field_updates_dict).
        """
        match = re.search(
            r'\{[^{}]*"field_updates"\s*:\s*\{.*?\}\s*\}',
            text,
            re.DOTALL,
        )
        if not match:
            return text.strip(), {}
        try:
            parsed = json.loads(match.group(0))
            updates = parsed.get("field_updates", {})
            cleaned = (text[: match.start()] + text[match.end() :]).strip()
            return cleaned, updates
        except (json.JSONDecodeError, ValueError):
            return text.strip(), {}

    def _build_list_creates_prompt(self, field_context: Optional[dict], session) -> tuple:
        """Returns (prompt_addition: str, list_item_config: dict|None) from field_context."""
        if not field_context or not field_context.get("list_config"):
            return "", None
        list_cfg = field_context["list_config"]
        item_type = list_cfg.get("item_type", "item")
        item_label = item_type.replace("_", " ")
        list_item_config = {
            "item_type": item_type,
            "phase": list_cfg.get("phase"),
            "subsection_key": list_cfg.get("subsection_key"),
        }
        # Look up field definitions from the adjacent _detail subsection in the template
        template_id = session.project.template.value if hasattr(session.project.template, "value") else session.project.template
        template = get_template(template_id)
        detail_key = f"{item_type}_detail"
        item_field_defs = []
        for p in template.get("phases", []):
            for sub in p.get("subsections", []):
                if sub["key"] == detail_key:
                    editor_config = sub.get("editor_config", {})
                    item_field_defs = editor_config.get("fields", [])
                    break

        if item_field_defs:
            item_fields_desc = "\n".join(
                f"- {f.get('key')}: {f.get('label', f.get('key'))}"
                for f in item_field_defs
            )
            # Build a JSON example that shows all field keys
            example_obj = "{" + ", ".join(
                f'"{f.get("key")}": "..."'
                for f in item_field_defs
            ) + "}"
        else:
            item_fields_desc = f"- summary: Brief description of the {item_label}"
            example_obj = '{"summary": "..."}'

        prompt_addition = f"""

## HOW TO CREATE NEW {item_label.upper()}S — CRITICAL INSTRUCTIONS
When the writer asks you to create, generate, apply, or add a {item_label} (including when they say "yes", "apply it", "apply", "create it", or confirm a {item_label} you described), you MUST include a JSON block at the VERY END of your response with ALL fields populated:
{{"list_item_creates": [{example_obj}]}}

This JSON block is the ONLY mechanism that actually saves the {item_label} to the project. Without it, NOTHING is saved, no matter what you say. Do NOT say you "applied", "created", or "saved" a {item_label} unless you include this JSON block.

CRITICAL: Do NOT output an empty object {{}}. Every field listed below MUST have real content based on what the writer described. The JSON block goes AFTER your conversational response.

Available {item_label} fields — populate ALL of them:
{item_fields_desc}"""

        return prompt_addition, list_item_config

    def _extract_list_item_creates(self, text: str):
        """Extract and strip the trailing JSON list_item_creates block from AI output.

        Returns (cleaned_text, list_item_creates_list).
        """
        match = re.search(
            r'\{[^{}]*"list_item_creates"\s*:\s*\[.*?\]\s*\}',
            text,
            re.DOTALL,
        )
        if not match:
            return text.strip(), []
        try:
            parsed = json.loads(match.group(0))
            items = parsed.get("list_item_creates", [])
            cleaned = (text[: match.start()] + text[match.end() :]).strip()
            return cleaned, items
        except (json.JSONDecodeError, ValueError):
            return text.strip(), []

    def _extract_book_refs(self, text: str):
        """Extract and strip the trailing JSON book_references block from AI output.

        Returns (cleaned_text, book_refs_list).
        Uses a regex so trailing newlines/text after the closing brace don't break parsing.
        """
        match = re.search(
            r'\{[^{}]*"book_references"\s*:\s*\[.*?\]\s*\}',
            text,
            re.DOTALL,
        )
        if not match:
            return text.strip(), []
        try:
            parsed = json.loads(match.group(0))
            refs = parsed.get("book_references", [])
            cleaned = (text[: match.start()] + text[match.end() :]).strip()
            return cleaned, refs
        except (json.JSONDecodeError, ValueError):
            return text.strip(), []

    def _format_project_context(self, project: Project, db: Optional[Session] = None) -> str:
        # Template-based PhaseData (new system)
        if db is not None and hasattr(project, 'template') and project.template:
            phase_data_records = (
                db.query(PhaseData)
                .filter(PhaseData.project_id == project.id)
                .all()
            )
            if phase_data_records:
                project_data: Dict = {}
                list_items_map: Dict = {}
                for pd in phase_data_records:
                    phase_key = pd.phase.value if hasattr(pd.phase, 'value') else pd.phase
                    if phase_key not in project_data:
                        project_data[phase_key] = {}
                    project_data[phase_key][pd.subsection_key] = pd.content or {}
                    if pd.list_items:
                        items = [
                            {"item_type": li.item_type, **(li.content or {})}
                            for li in sorted(pd.list_items, key=lambda x: x.sort_order)
                        ]
                        if items:
                            list_items_map[f"{phase_key}.{pd.subsection_key}"] = items
                template_id = project.template.value if hasattr(project.template, 'value') else project.template
                return template_ai_service._build_project_context(
                    project_data, template_id,
                    list_items=list_items_map,
                    project_title=project.title,
                )

        # Legacy fallback: old Section model
        lines = [f"**Project:** {project.title}"]
        for section in sorted(project.sections, key=lambda s: s.type.value):
            section_name = SECTION_DESCRIPTIONS.get(section.type, section.type.value)
            notes = (section.user_notes or "").strip()
            lines.append(f"\n### {section_name}\n{notes[:500] if notes else '(No content yet)'}")
        return "\n".join(lines)

    def _build_system_prompt(
        self,
        agent: Agent,
        concepts: List[Dict],
        relationships: List[Dict],
        chunks: List[Dict],
        framework: Framework,
        section_type: SectionType,
        project: Project,
        db: Optional[Session] = None,
    ) -> str:
        """Build a complete system prompt grounded in KG data."""
        prompt = agent.system_prompt_template.format(
            concept_cards=self._format_concept_cards(concepts),
            concept_relationships=self._format_relationships(relationships),
            book_chunks=self._format_chunks(chunks),
            framework=FRAMEWORK_NAMES.get(framework, framework.value),
            section_type=SECTION_DESCRIPTIONS.get(section_type, section_type.value),
            project_context=self._format_project_context(project, db=db),
        )

        if agent.personality:
            prompt += f"\n\nYour communication style: {agent.personality}"

        return prompt

    # ──────────────────────────────────────────────
    # Review mode
    # ──────────────────────────────────────────────

    async def review_section(
        self,
        agent: Agent,
        section: Section,
        project: Project,
        db: Session,
    ) -> Dict:
        """Structured review of a section using KG-grounded knowledge."""
        try:
            # Step 1: Get relevant concepts — route by agent type
            concepts = []
            chunks = []

            if agent.agent_type == AgentType.TAG_BASED:
                concepts = rag_service.get_concepts_by_tags(
                    tags=agent.tags_filter or [],
                    owner_id=project.owner_id,
                    db=db,
                )
                # Filter and sort by section relevance
                section_key = section.type.value.upper()
                concepts = sorted(
                    [c for c in concepts if (c.get("section_relevance") or {}).get(section_key, 0) > 0.2],
                    key=lambda c: (c.get("section_relevance") or {}).get(section_key, 0),
                    reverse=True,
                )[:settings.MAX_CONCEPTS_PER_REVIEW]
            elif agent.agent_type == AgentType.ORCHESTRATOR:
                # Orchestrators don't do structured reviews — return empty
                pass
            else:
                concepts = rag_service.get_relevant_concepts(
                    section_type=section.type.value,
                    agent_id=agent.id,
                    db=db,
                )

            # Step 2: Get concept relationships
            concept_ids = [c["id"] for c in concepts]
            relationships = rag_service.get_concept_relationships(concept_ids, db)

            # Step 3: Get supporting chunks (book-based only)
            if agent.agent_type == AgentType.BOOK_BASED:
                chunks = rag_service.get_supporting_chunks(concept_ids, agent.id, db)

            # Step 4: Build system prompt
            system_prompt = self._build_system_prompt(
                agent=agent,
                concepts=concepts,
                relationships=relationships,
                chunks=chunks,
                framework=project.framework,
                section_type=section.type,
                project=project,
                db=db,
            )

            # Step 5: Call AI
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Analyze this screenplay section:\n\n{section.user_notes or '(empty)'}"},
                ],
                temperature=0.7,
                max_tokens=settings.MAX_TOKENS,
                json_mode=True,
            )

            result = json.loads(text)

            # Build book references from concepts used
            book_refs = []
            for c in concepts[:5]:
                ref = {"concept_name": c["name"]}
                if c.get("chapter_source"):
                    ref["chapter"] = c["chapter_source"]
                if c.get("page_range"):
                    ref["page"] = c["page_range"]
                book_refs.append(ref)

            return {
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "agent_color": agent.color,
                "agent_icon": agent.icon,
                "issues": result.get("issues", []),
                "suggestions": result.get("suggestions", []),
                "book_references": book_refs,
                "status": "completed",
            }

        except Exception as e:
            logger.error(f"Agent {agent.name} review failed: {e}", exc_info=True)
            return {
                "agent_id": str(agent.id),
                "agent_name": agent.name,
                "agent_color": agent.color,
                "agent_icon": agent.icon,
                "issues": [],
                "suggestions": [],
                "book_references": [],
                "status": "error",
                "error": str(e),
            }

    # ──────────────────────────────────────────────
    # Chat mode
    # ──────────────────────────────────────────────

    async def chat(
        self,
        session: ChatSession,
        user_message: str,
        db: Session,
        field_context: Optional[dict] = None,
        session_factory: Optional[SessionFactory] = None,
    ) -> Dict:
        """Conversational follow-up — routes by agent_type."""
        agent = session.agent
        owner_id = session.user_id

        if agent.agent_type == AgentType.ORCHESTRATOR:
            return await self._orchestrate(session, user_message, db, session_factory=session_factory)

        if agent.agent_type == AgentType.TAG_BASED:
            search_results = await rag_service.semantic_search(
                query_text=user_message,
                owner_id=owner_id,
                tags_filter=agent.tags_filter or [],
                db=db,
            )
        else:
            # BOOK_BASED: existing behavior
            search_results = await rag_service.semantic_search(
                query_text=user_message,
                agent_id=agent.id,
                db=db,
            )

        concepts = search_results.get("concepts", [])
        chunks = search_results.get("chunks", [])

        concept_context = self._format_concept_cards(concepts)
        chunk_context = self._format_chunks(chunks)
        project_context = self._format_project_context(session.project, db=db)

        system_prompt = f"""You are {agent.name}, a screenwriting consultant.
{agent.description or ''}

Your personality: {agent.personality or 'Helpful and knowledgeable.'}

You have deep knowledge from your reference books. Use the following knowledge to inform your responses:

## Relevant Concepts
{concept_context}

## Supporting Book Excerpts
{chunk_context}

## Writer's Project
{project_context}

## Instructions
- Answer the writer's question using your book knowledge
- Always cite specific concepts and book references when relevant
- Be conversational but substantive
- If the writer asks about their screenplay, reference specific sections from their project
- Include book references in your response naturally (e.g., "As McKee discusses in Chapter X...")
- End your response with a JSON block containing book references used:
  {{"book_references": [{{"concept_name": "...", "chapter": "...", "page": "..."}}]}}"""

        # Inject field context if the frontend passed it
        if field_context and field_context.get("field_definitions"):
            field_defs = field_context["field_definitions"]
            current = field_context.get("current_content", {})
            fields_desc = "\n".join(
                f"- {f['key']}: {f.get('label', f['key'])}"
                for f in field_defs
            )
            current_desc = json.dumps(
                {k: v for k, v in current.items() if v}, indent=2
            ) if current else "{}"
            system_prompt += f"""

## Current Section Fields
{fields_desc}

## Current Field Values
{current_desc}

## CRITICAL INSTRUCTIONS — Saving Field Updates
When the writer asks you to complete, fill, or update any fields, you MUST output a JSON block at the very end of your response.
This JSON block is the ONLY mechanism that actually saves the content. Without it, NOTHING is saved, no matter what you say.
Do NOT say you "updated", "filled", or "applied" fields unless you include this JSON block.

Format (append after any book_references block):
{{"field_updates": {{"field_key": "full content here"}}}}

Include ALL fields the writer asked you to fill. Use the exact field keys listed above."""

        history_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in session.messages[-20:]
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_message},
        ]

        assistant_content = await chat_completion(
            messages=messages,
            temperature=0.7,
            max_tokens=settings.MAX_TOKENS,
        )

        assistant_content, book_refs = self._extract_book_refs(assistant_content)
        assistant_content, field_updates = self._extract_field_updates(assistant_content)

        user_msg = ChatMessage(
            session_id=session.id,
            role="user",
            content=user_message,
            message_type="chat",
        )
        db.add(user_msg)

        assistant_msg = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=assistant_content,
            message_type="chat",
            book_references=book_refs,
            concepts_used=[c["id"] for c in concepts[:5]],
            consulted_agents=[],
        )
        db.add(assistant_msg)
        db.commit()

        return {
            "content": assistant_content,
            "book_references": book_refs,
            "field_updates": field_updates,
            "message_id": str(assistant_msg.id),
            "consulted_agents": [],
        }

    # ──────────────────────────────────────────────
    # Streaming chat mode
    # ──────────────────────────────────────────────

    async def chat_stream_prepare(
        self,
        session: ChatSession,
        user_message: str,
        db: Session,
        field_context: Optional[dict] = None,
        session_factory: Optional[SessionFactory] = None,
    ) -> Dict:
        """Prepare context for streaming chat. Saves user msg, returns streaming params."""
        agent = session.agent
        owner_id = session.user_id

        if agent.agent_type == AgentType.ORCHESTRATOR:
            return await self._orchestrate_stream_prepare(session, user_message, db, field_context=field_context, session_factory=session_factory)

        if agent.agent_type == AgentType.TAG_BASED:
            search_results = await rag_service.semantic_search(
                query_text=user_message,
                owner_id=owner_id,
                tags_filter=agent.tags_filter or [],
                db=db,
            )
        else:
            search_results = await rag_service.semantic_search(
                query_text=user_message,
                agent_id=agent.id,
                db=db,
            )

        concepts = search_results.get("concepts", [])
        chunks = search_results.get("chunks", [])

        concept_context = self._format_concept_cards(concepts)
        chunk_context = self._format_chunks(chunks)
        project_context = self._format_project_context(session.project, db=db)

        system_prompt = f"""You are {agent.name}, a screenwriting consultant.
{agent.description or ''}

Your personality: {agent.personality or 'Helpful and knowledgeable.'}

You have deep knowledge from your reference books. Use the following knowledge to inform your responses:

## Relevant Concepts
{concept_context}

## Supporting Book Excerpts
{chunk_context}

## Writer's Project
{project_context}

## Instructions
- Answer the writer's question using your book knowledge
- Always cite specific concepts and book references when relevant
- Be conversational but substantive
- If the writer asks about their screenplay, reference specific sections from their project
- Include book references in your response naturally (e.g., "As McKee discusses in Chapter X...")
- End your response with a JSON block containing book references used:
  {{"book_references": [{{"concept_name": "...", "chapter": "...", "page": "..."}}]}}"""

        if field_context and field_context.get("field_definitions"):
            field_defs = field_context["field_definitions"]
            current = field_context.get("current_content", {})
            fields_desc = "\n".join(
                f"- {f['key']}: {f.get('label', f['key'])}"
                for f in field_defs
            )
            current_desc = json.dumps(
                {k: v for k, v in current.items() if v}, indent=2
            ) if current else "{}"
            system_prompt += f"""

## Current Section Fields
{fields_desc}

## Current Field Values
{current_desc}

## CRITICAL INSTRUCTIONS — Saving Field Updates
When the writer asks you to complete, fill, or update any fields, you MUST output a JSON block at the very end of your response.
This JSON block is the ONLY mechanism that actually saves the content. Without it, NOTHING is saved, no matter what you say.
Do NOT say you "updated", "filled", or "applied" fields unless you include this JSON block.

Format (append after any book_references block):
{{"field_updates": {{"field_key": "full content here"}}}}

Include ALL fields the writer asked you to fill. Use the exact field keys listed above."""

        # Add scene-creation capability for ordered_list subsections
        list_creates_prompt, _list_item_config = self._build_list_creates_prompt(field_context, session)
        system_prompt += list_creates_prompt

        history_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in session.messages[-20:]
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_message},
        ]

        # Capture session.id before commit (commit expires ORM attributes)
        sid = session.id

        user_msg = ChatMessage(
            session_id=sid,
            role="user",
            content=user_message,
            message_type="chat",
        )
        db.add(user_msg)
        db.commit()

        return {
            "session_id": sid,
            "messages": messages,
            "concepts": concepts,
            "consulted_agents": [],
            "list_item_config": _list_item_config,
        }

    async def _orchestrate_stream_prepare(
        self,
        session: ChatSession,
        user_message: str,
        db: Session,
        field_context: Optional[dict] = None,
        session_factory: Optional[SessionFactory] = None,
    ) -> Dict:
        """Prepare orchestrator context for streaming."""
        orchestrator = session.agent
        owner_id = session.user_id

        specialist_agents = (
            db.query(Agent)
            .filter(
                (Agent.owner_id == owner_id) | (Agent.is_default == True),
                Agent.is_active == True,
                Agent.agent_type.in_([AgentType.BOOK_BASED, AgentType.TAG_BASED]),
            )
            .all()
        )

        consulted_agents_meta: List[Dict] = []
        all_concepts: List[Dict] = []
        all_chunks: List[Dict] = []

        if specialist_agents:
            selected = await self._select_relevant_agents(
                user_message=user_message,
                agents=specialist_agents,
                owner_id=owner_id,
                db=db,
            )

            if session_factory:
                tasks = [
                    self._get_specialist_context_with_session(agent, user_message, owner_id, session_factory)
                    for agent in selected
                ]
            else:
                tasks = [
                    self._get_specialist_context(agent, user_message, owner_id, db)
                    for agent in selected
                ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for agent, result in zip(selected, results):
                if isinstance(result, Exception):
                    logger.warning(f"Specialist {agent.name} failed in orchestrator: {result}")
                    continue
                all_concepts.extend(result.get("concepts", [])[:3])
                all_chunks.extend(result.get("chunks", [])[:2])
                consulted_agents_meta.append({
                    "agent_id": str(agent.id),
                    "name": agent.name,
                    "color": agent.color,
                })

        concept_context = self._format_concept_cards(all_concepts)
        chunk_context = self._format_chunks(all_chunks)
        project_context = self._format_project_context(session.project, db=db)

        list_creates_prompt, _list_item_config = self._build_list_creates_prompt(field_context, session)

        consulted_names = ", ".join(a["name"] for a in consulted_agents_meta) or "no specialists"
        system_prompt = f"""You are {orchestrator.name}, a master screenwriting consultant who synthesizes multiple specialist perspectives.

For this query, you drew from the knowledge of: {consulted_names}.

## Synthesized Knowledge
{concept_context}

## Supporting Book Excerpts
{chunk_context}

## Writer's Project
{project_context}

## Instructions
- Open your response by briefly noting which specialists' perspectives informed your answer (e.g., "Drawing on McKee's structural analysis and Snyder's beat methodology...")
- Synthesize insights holistically — make connections between different frameworks
- Be specific and actionable
- End your response with a JSON block: {{"book_references": [{{"concept_name": "...", "chapter": "...", "page": "..."}}]}}"""

        system_prompt += list_creates_prompt

        history_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in session.messages[-20:]
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_message},
        ]

        # Capture session.id before commit (commit expires ORM attributes)
        sid = session.id

        user_msg = ChatMessage(
            session_id=sid,
            role="user",
            content=user_message,
            message_type="chat",
        )
        db.add(user_msg)
        db.commit()

        return {
            "session_id": sid,
            "messages": messages,
            "concepts": all_concepts,
            "consulted_agents": consulted_agents_meta,
            "list_item_config": _list_item_config,
        }

    async def chat_stream_finalize(
        self,
        session_id,
        full_text: str,
        concepts: List[Dict],
        consulted_agents: List[Dict],
        db: Session,
        project_id=None,
        list_item_config: Optional[Dict] = None,
    ) -> Dict:
        """Post-process streamed text, save assistant message, return metadata."""
        clean_text, book_refs = self._extract_book_refs(full_text)
        clean_text, list_item_creates = self._extract_list_item_creates(clean_text)
        clean_text, field_updates = self._extract_field_updates(clean_text)

        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=clean_text,
            message_type="chat",
            book_references=book_refs,
            concepts_used=[c["id"] for c in concepts[:5]],
            consulted_agents=consulted_agents,
        )
        db.add(assistant_msg)
        db.commit()

        # Create new list items if the agent described them
        items_created = 0
        if list_item_creates and list_item_config and project_id:
            from sqlalchemy import func as sqlfunc
            item_type = list_item_config.get("item_type", "item")
            phase = list_item_config.get("phase")
            subsection_key = list_item_config.get("subsection_key")
            if phase and subsection_key:
                pd = db.query(PhaseData).filter(
                    PhaseData.project_id == project_id,
                    PhaseData.phase == phase,
                    PhaseData.subsection_key == subsection_key,
                ).first()
                if not pd:
                    pd = PhaseData(
                        project_id=project_id,
                        phase=phase,
                        subsection_key=subsection_key,
                        content={},
                    )
                    db.add(pd)
                    db.flush()

                max_order = db.query(sqlfunc.max(ListItem.sort_order)).filter(
                    ListItem.phase_data_id == pd.id
                ).scalar()
                next_order = (max_order + 1) if max_order is not None else 0

                for item_content in list_item_creates:
                    if isinstance(item_content, dict) and item_content:
                        db.add(ListItem(
                            phase_data_id=pd.id,
                            item_type=item_type,
                            content=item_content,
                            sort_order=next_order,
                            status="draft",
                        ))
                        next_order += 1
                        items_created += 1

                if items_created:
                    db.commit()
                    logger.info(f"Agent created {items_created} list items of type '{item_type}'")

        return {
            "content": clean_text,
            "book_references": book_refs,
            "field_updates": field_updates,
            "message_id": str(assistant_msg.id),
            "consulted_agents": consulted_agents,
            "list_items_created": items_created,
        }

    # ──────────────────────────────────────────────
    # Orchestrator pattern
    # ──────────────────────────────────────────────

    async def _orchestrate(
        self,
        session: ChatSession,
        user_message: str,
        db: Session,
        session_factory: Optional[SessionFactory] = None,
    ) -> Dict:
        """Route query to relevant specialist agents, aggregate with attribution."""
        orchestrator = session.agent
        owner_id = session.user_id

        # Fetch all active specialist agents for this user
        specialist_agents = (
            db.query(Agent)
            .filter(
                (Agent.owner_id == owner_id) | (Agent.is_default == True),
                Agent.is_active == True,
                Agent.agent_type.in_([AgentType.BOOK_BASED, AgentType.TAG_BASED]),
            )
            .all()
        )

        consulted_agents_meta: List[Dict] = []
        all_concepts: List[Dict] = []
        all_chunks: List[Dict] = []

        if specialist_agents:
            selected = await self._select_relevant_agents(
                user_message=user_message,
                agents=specialist_agents,
                owner_id=owner_id,
                db=db,
            )

            if session_factory:
                tasks = [
                    self._get_specialist_context_with_session(agent, user_message, owner_id, session_factory)
                    for agent in selected
                ]
            else:
                tasks = [
                    self._get_specialist_context(agent, user_message, owner_id, db)
                    for agent in selected
                ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for agent, result in zip(selected, results):
                if isinstance(result, Exception):
                    logger.warning(f"Specialist {agent.name} failed in orchestrator: {result}")
                    continue
                all_concepts.extend(result.get("concepts", [])[:3])
                all_chunks.extend(result.get("chunks", [])[:2])
                consulted_agents_meta.append({
                    "agent_id": str(agent.id),
                    "name": agent.name,
                    "color": agent.color,
                })

        concept_context = self._format_concept_cards(all_concepts)
        chunk_context = self._format_chunks(all_chunks)
        project_context = self._format_project_context(session.project, db=db)

        consulted_names = ", ".join(a["name"] for a in consulted_agents_meta) or "no specialists"
        system_prompt = f"""You are {orchestrator.name}, a master screenwriting consultant who synthesizes multiple specialist perspectives.

For this query, you drew from the knowledge of: {consulted_names}.

## Synthesized Knowledge
{concept_context}

## Supporting Book Excerpts
{chunk_context}

## Writer's Project
{project_context}

## Instructions
- Open your response by briefly noting which specialists' perspectives informed your answer (e.g., "Drawing on McKee's structural analysis and Snyder's beat methodology...")
- Synthesize insights holistically — make connections between different frameworks
- Be specific and actionable
- End your response with a JSON block: {{"book_references": [{{"concept_name": "...", "chapter": "...", "page": "..."}}]}}"""

        history_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in session.messages[-20:]
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": user_message},
        ]

        assistant_content = await chat_completion(
            messages=messages,
            temperature=0.7,
            max_tokens=settings.MAX_TOKENS,
        )

        assistant_content, book_refs = self._extract_book_refs(assistant_content)

        user_msg = ChatMessage(
            session_id=session.id,
            role="user",
            content=user_message,
            message_type="chat",
        )
        db.add(user_msg)

        assistant_msg = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=assistant_content,
            message_type="chat",
            book_references=book_refs,
            concepts_used=[c["id"] for c in all_concepts[:5]],
            consulted_agents=consulted_agents_meta,
        )
        db.add(assistant_msg)
        db.commit()

        return {
            "content": assistant_content,
            "book_references": book_refs,
            "message_id": str(assistant_msg.id),
            "consulted_agents": consulted_agents_meta,
        }

    async def _get_specialist_context(
        self,
        agent: Agent,
        query_text: str,
        owner_id,
        db: Session,
    ) -> Dict:
        """Get relevant concepts + chunks from a single specialist agent."""
        if agent.agent_type == AgentType.TAG_BASED:
            return await rag_service.semantic_search(
                query_text=query_text,
                owner_id=owner_id,
                tags_filter=agent.tags_filter or [],
                db=db,
                top_k_concepts=4,
                top_k_chunks=2,
            )
        return await rag_service.semantic_search(
            query_text=query_text,
            agent_id=agent.id,
            db=db,
            top_k_concepts=4,
            top_k_chunks=2,
        )

    async def _select_relevant_agents(
        self,
        user_message: str,
        agents: List[Agent],
        owner_id,
        db: Session,
        max_agents: int = 3,
    ) -> List[Agent]:
        """Pick the most relevant specialist agents for a query via embedding similarity."""
        from .embedding_service import embedding_service as emb_svc
        try:
            query_embedding = await emb_svc.embed_text(user_message)

            scored = []
            for agent in agents:
                try:
                    if agent.agent_type == AgentType.TAG_BASED:
                        score = await self._score_agent_tag_based(agent, query_embedding, owner_id, db)
                    else:
                        score = await self._score_agent_book_based(agent, query_embedding, db)
                    scored.append((agent, score))
                except Exception:
                    scored.append((agent, 0.0))

            scored.sort(key=lambda x: x[1], reverse=True)
            return [a for a, score in scored[:max_agents] if score >= 0.0]
        except Exception as e:
            logger.warning(f"Agent scoring failed, using first {max_agents}: {e}")
            return agents[:max_agents]

    async def _score_agent_book_based(self, agent: Agent, query_embedding, db: Session) -> float:
        """Score a book-based agent's relevance by max concept similarity."""
        from sqlalchemy import text as sql_text
        result = db.execute(
            sql_text("""
                SELECT MAX(1 - (c.embedding <=> :embedding::vector)) as max_sim
                FROM concepts c
                JOIN agent_books ab ON c.book_id = ab.book_id
                WHERE ab.agent_id = :agent_id
                  AND c.embedding IS NOT NULL
            """),
            {"embedding": str(query_embedding), "agent_id": str(agent.id)},
        ).fetchone()
        return float(result.max_sim or 0.0)

    async def _score_agent_tag_based(self, agent: Agent, query_embedding, owner_id, db: Session) -> float:
        """Score a tag-based agent's relevance by max concept similarity within its tags."""
        from sqlalchemy import text as sql_text
        if not agent.tags_filter:
            return 0.0
        result = db.execute(
            sql_text("""
                SELECT MAX(1 - (c.embedding <=> :embedding::vector)) as max_sim
                FROM concepts c
                JOIN books b ON c.book_id = b.id
                WHERE b.owner_id = :owner_id
                  AND c.tags ?| :tags
                  AND c.embedding IS NOT NULL
            """),
            {
                "embedding": str(query_embedding),
                "owner_id": str(owner_id),
                "tags": agent.tags_filter,
            },
        ).fetchone()
        return float(result.max_sim or 0.0)

    # ──────────────────────────────────────────────
    # Session-per-task wrappers for asyncio.gather
    # ──────────────────────────────────────────────

    async def _review_with_session(
        self,
        agent: Agent,
        section: Section,
        project: Project,
        session_factory: SessionFactory,
    ) -> Dict:
        """Per-task session wrapper for review_section."""
        db = session_factory()
        try:
            return await self.review_section(agent, section, project, db)
        finally:
            db.close()

    async def _get_specialist_context_with_session(
        self,
        agent: Agent,
        query_text: str,
        owner_id,
        session_factory: SessionFactory,
    ) -> Dict:
        """Per-task session wrapper for _get_specialist_context."""
        db = session_factory()
        try:
            return await self._get_specialist_context(agent, query_text, owner_id, db)
        finally:
            db.close()

    # ──────────────────────────────────────────────
    # Multi-agent parallel review
    # ──────────────────────────────────────────────

    async def run_multi_agent_review(
        self,
        agents: List[Agent],
        section: Section,
        project: Project,
        session_factory: SessionFactory,
    ) -> List[Dict]:
        """Run all agents in parallel on a section.

        Each agent review task gets its own DB session via session_factory
        to avoid DetachedInstanceError under concurrent asyncio.gather.
        """
        tasks = [
            asyncio.wait_for(
                self._review_with_session(agent, section, project, session_factory),
                timeout=settings.AGENT_REVIEW_TIMEOUT,
            )
            for agent in agents
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        agent_results = []
        for agent, result in zip(agents, results):
            if isinstance(result, Exception):
                logger.error(f"Agent {agent.name} failed: {result}")
                agent_results.append({
                    "agent_id": str(agent.id),
                    "agent_name": agent.name,
                    "agent_color": agent.color,
                    "agent_icon": agent.icon,
                    "issues": [],
                    "suggestions": [],
                    "book_references": [],
                    "status": "error",
                    "error": "Agent timed out or encountered an error",
                })
            else:
                agent_results.append(result)

        return agent_results


agent_service = AgentService()
