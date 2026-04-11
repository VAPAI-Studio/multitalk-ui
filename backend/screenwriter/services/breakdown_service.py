# backend/app/services/breakdown_service.py

"""
Breakdown extraction service. Gathers screenplay content, character names,
and scene data from the database, then uses structured AI output to extract
production elements (characters, locations, props, wardrobe, vehicles).

Plan 11-01 establishes the skeleton: Pydantic models, context builder, and
user prompt formatter. Plan 11-02 implements the full extraction pipeline.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models import database
from .ai_provider import chat_completion_structured

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic structured output models (passed to chat_completion_structured)
# ---------------------------------------------------------------------------

class ExtractedSceneAppearance(BaseModel):
    """A single scene where an element physically appears."""
    scene_index: int = Field(
        description="1-based index matching the scene list provided in the prompt"
    )
    context: str = Field(
        description="Brief description of how this element appears in the scene"
    )


class ExtractedElement(BaseModel):
    """A production element extracted from the screenplay."""
    category: str = Field(
        description="One of: character, location, prop, wardrobe, vehicle"
    )
    canonical_name: str = Field(
        description="The standard canonical name for this element, deduplicated across scenes"
    )
    description: str = Field(
        description="Brief description of the element as it appears in the screenplay"
    )
    scene_appearances: List[ExtractedSceneAppearance] = Field(
        description="Scenes where this element physically appears on screen"
    )


class SceneDurationEstimate(BaseModel):
    """Estimated runtime for a single scene."""
    scene_index: int = Field(
        description="1-based index matching the scene list provided in the prompt"
    )
    dialogue_word_count: int = Field(
        description="Total words of dialogue in this scene"
    )
    action_line_count: int = Field(
        description="Number of action/description lines in this scene"
    )
    estimated_seconds: float = Field(
        description="Estimated scene duration in seconds (dialogue at ~140 WPM + ~2 sec per action line)"
    )
    pacing_note: str = Field(
        description="Brief note: 'dialogue-heavy', 'action-heavy', 'balanced', or 'minimal'"
    )


class ExtractionResponse(BaseModel):
    """Complete extraction result from AI."""
    elements: List[ExtractedElement]
    scene_durations: List[SceneDurationEstimate] = Field(
        default_factory=list,
        description="Estimated runtime per scene based on dialogue word count and action lines"
    )


# ---------------------------------------------------------------------------
# Internal data-passing dataclass
# ---------------------------------------------------------------------------

@dataclass
class ExtractionContext:
    """All data needed for an extraction AI call."""
    screenplay_texts: List[str]        # From ScreenplayContent.content
    character_names: List[str]          # From story.characters ListItem names
    scene_summaries: List[dict]        # [{id: str, summary: str, sort_order: int}]
    project_title: str


# ---------------------------------------------------------------------------
# Extraction system prompt
# ---------------------------------------------------------------------------

EXTRACTION_SYSTEM_PROMPT = """You are a professional script supervisor performing a production breakdown.

Analyze the provided screenplay content and extract ALL production elements that are PHYSICALLY PRESENT ON SCREEN.

CRITICAL RULES:
1. Only extract elements that PHYSICALLY APPEAR in the scene -- visible to the camera
2. Do NOT extract elements merely mentioned in dialogue or backstory
3. Do NOT extract abstract concepts, emotions, or themes
4. Characters must actually appear in the scene (not just be talked about)
5. Props must be handled, seen, or interact with the scene (not just referenced)
6. Locations are the actual shooting locations where scenes take place

DEDUPLICATION:
- If the same element is described differently across scenes (e.g., "GUN", "revolver", ".38 Special"), use ONE canonical name
- Prefer the most specific common name (e.g., "Revolver" over "Gun")
- Characters should use their proper name, not descriptions like "the old man"

CATEGORIES:
- character: Named or significant unnamed characters who appear on screen
- location: Distinct shooting locations (INT./EXT. settings)
- prop: Physical objects handled or prominently featured
- wardrobe: Notable costume pieces or accessories
- vehicle: Cars, trucks, bikes, boats, aircraft

SCENE DURATION ESTIMATION:
For each scene, also estimate its runtime:
- Count dialogue words (all character dialogue in the scene)
- Count action/description lines
- Calculate: dialogue words ÷ 140 WPM (converted to seconds) + action lines × 2 seconds
- Classify pacing: 'dialogue-heavy' (>70% dialogue time), 'action-heavy' (>70% action time), 'balanced', or 'minimal' (<10 seconds total)"""


# ---------------------------------------------------------------------------
# BreakdownService
# ---------------------------------------------------------------------------

class BreakdownService:
    """Service for AI-driven screenplay breakdown extraction."""

    def _build_extraction_context(
        self, db: Session, project_id: UUID
    ) -> ExtractionContext:
        """
        Gather all data needed for extraction from the database.

        Queries:
        - ScreenplayContent records for screenplay text
        - PhaseData(phase=story, subsection_key=characters) -> ListItem names
        - PhaseData(phase=scenes, subsection_key=scene_list) -> ListItem summaries
        - Project for title
        """
        # 1. Fetch screenplay content
        screenplays = db.query(database.ScreenplayContent).filter(
            database.ScreenplayContent.project_id == str(project_id)
        ).all()

        # 2. Fetch character names from story.characters
        character_names = []
        chars_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == str(project_id),
            database.PhaseData.phase == "story",
            database.PhaseData.subsection_key == "characters",
        ).first()
        if chars_pd:
            char_items = db.query(database.ListItem).filter(
                database.ListItem.phase_data_id == str(chars_pd.id)
            ).all()
            character_names = [
                li.content.get("name", "")
                for li in char_items
                if li.content and li.content.get("name")
            ]

        # 3. Fetch scene summaries from scenes.scene_list
        scene_summaries = []
        scenes_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == str(project_id),
            database.PhaseData.phase == "scenes",
            database.PhaseData.subsection_key == "scene_list",
        ).first()
        if scenes_pd:
            scene_items = db.query(database.ListItem).filter(
                database.ListItem.phase_data_id == str(scenes_pd.id)
            ).order_by(database.ListItem.sort_order).all()
            scene_summaries = [
                {
                    "id": str(li.id),
                    "summary": li.content.get("summary", f"Scene {li.sort_order + 1}"),
                    "sort_order": li.sort_order,
                }
                for li in scene_items
            ]

        # 4. Fetch project title
        project = db.query(database.Project).filter(
            database.Project.id == str(project_id)
        ).first()

        return ExtractionContext(
            screenplay_texts=[sc.content for sc in screenplays if sc.content],
            character_names=character_names,
            scene_summaries=scene_summaries,
            project_title=project.title if project else "",
        )

    def _build_user_prompt(self, ctx: ExtractionContext) -> str:
        """
        Format extraction context into a user prompt for the AI.

        Scene indexing is 1-based (Scene 1, Scene 2, ...) so AI scene_index
        references in ExtractedSceneAppearance map directly to position.
        """
        parts = [f"# Screenplay: {ctx.project_title}\n"]

        # Known characters (helps AI match names consistently)
        if ctx.character_names:
            parts.append("## Known Characters")
            for name in ctx.character_names:
                parts.append(f"- {name}")
            parts.append("")

        # Scene list with indices for reliable matching
        parts.append("## Scenes")
        for i, scene in enumerate(ctx.scene_summaries):
            parts.append(f"Scene {i + 1}: {scene['summary']}")
        parts.append("")

        # Full screenplay text
        parts.append("## Screenplay Content")
        for text in ctx.screenplay_texts:
            parts.append(text)
            parts.append("---")

        parts.append("\nExtract all production elements from this screenplay.")
        return "\n".join(parts)

    async def _call_ai_extraction(self, ctx: ExtractionContext,
                                   bible_context: Optional[str] = None) -> ExtractionResponse:
        """Call AI with structured output to extract production elements."""
        user_prompt = self._build_user_prompt(ctx)
        if bible_context:
            user_prompt = f"{bible_context}\n---\n{user_prompt}"
        messages = [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        return await chat_completion_structured(
            messages=messages,
            response_model=ExtractionResponse,
            temperature=0.15,
            max_tokens=8000,
        )

    def _deduplicate_elements(self, elements: List[ExtractedElement]) -> List[ExtractedElement]:
        """Post-processing deduplication: merge elements with same category + case-insensitive name.

        The AI prompt instructs deduplication, but this catches any remaining duplicates.
        When duplicates found, merge scene_appearances and keep the first description.
        """
        seen: dict[tuple[str, str], ExtractedElement] = {}  # (category, name_lower) -> element
        for elem in elements:
            key = (elem.category, elem.canonical_name.lower())
            if key in seen:
                # Merge: combine scene appearances, keep first description
                existing = seen[key]
                merged_appearances = list(existing.scene_appearances)
                seen_indices = {a.scene_index for a in merged_appearances}
                for app in elem.scene_appearances:
                    if app.scene_index not in seen_indices:
                        merged_appearances.append(app)
                        seen_indices.add(app.scene_index)
                # Create new merged element
                seen[key] = ExtractedElement(
                    category=existing.category,
                    canonical_name=existing.canonical_name,
                    description=existing.description,
                    scene_appearances=merged_appearances,
                )
            else:
                seen[key] = elem
        return list(seen.values())

    def _upsert_elements(
        self, db: Session, project_id: UUID, extracted: List[ExtractedElement]
    ) -> Dict:
        """
        Upsert extracted elements into the database.

        Respects user-modified (SYNC-01) and soft-deleted (SYNC-02) elements:
        - is_deleted=True: SKIP entirely (do not resurrect)
        - user_modified=True: SKIP update but include in element_map for scene linking
        - Otherwise: UPDATE description and source
        - New elements: CREATE with source="ai"

        Returns dict with created/updated/skipped counts and element_map.
        """
        # Pre-load ALL existing elements for this project in a single query
        existing_elements = db.query(database.BreakdownElement).filter(
            database.BreakdownElement.project_id == str(project_id)
        ).all()

        # Build lookup map: (category, name_lower) -> element
        lookup: Dict[tuple, database.BreakdownElement] = {
            (el.category, el.name.lower()): el for el in existing_elements
        }

        created = 0
        updated = 0
        skipped = 0
        element_map: Dict[str, database.BreakdownElement] = {}

        for item in extracted:
            key = (item.category, item.canonical_name.lower())
            existing = lookup.get(key)

            if existing and existing.is_deleted:
                # SYNC-02: Do not resurrect soft-deleted elements
                skipped += 1
                continue

            if existing and existing.user_modified:
                # SYNC-01: Do not overwrite user-modified elements
                # But include in element_map for scene linking
                element_map[item.canonical_name] = existing
                skipped += 1
                continue

            if existing:
                # Update existing element
                existing.description = item.description
                existing.source = "ai"
                element_map[item.canonical_name] = existing
                updated += 1
            else:
                # Create new element
                new_el = database.BreakdownElement(
                    project_id=str(project_id),
                    category=item.category,
                    name=item.canonical_name,
                    description=item.description,
                    source="ai",
                )
                db.add(new_el)
                db.flush()  # Get the ID assigned
                element_map[item.canonical_name] = new_el
                created += 1

        return {
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "element_map": element_map,
        }

    def _reconcile_scene_links(
        self,
        db: Session,
        element: database.BreakdownElement,
        new_scene_ids: List[str],
    ) -> None:
        """
        Reconcile scene links for an element after extraction.

        - Delete ALL existing AI-sourced links for this element
        - Create new AI-sourced links for each scene_id
        - Preserve user-sourced links (never delete them)
        """
        # Delete all existing AI-sourced scene links for this element
        db.query(database.ElementSceneLink).filter(
            database.ElementSceneLink.element_id == str(element.id),
            database.ElementSceneLink.source == "ai",
        ).delete(synchronize_session="fetch")

        for scene_id in new_scene_ids:
            # Check if a user-sourced link already exists for this pair
            user_link = db.query(database.ElementSceneLink).filter(
                database.ElementSceneLink.element_id == str(element.id),
                database.ElementSceneLink.scene_item_id == str(scene_id),
                database.ElementSceneLink.source == "user",
            ).first()
            if user_link:
                continue

            link = database.ElementSceneLink(
                element_id=str(element.id),
                scene_item_id=str(scene_id),
                context="",
                source="ai",
            )
            db.add(link)

    def _map_scene_indices_to_ids(
        self,
        ctx: ExtractionContext,
        scene_appearances: List[ExtractedSceneAppearance],
    ) -> List[str]:
        """
        Convert 1-based scene_index values from AI response to ListItem IDs.

        AI returns 1-based indices; scene_summaries is 0-indexed.
        Invalid indices (out of range) are skipped with a warning.
        """
        scene_ids: List[str] = []
        for appearance in scene_appearances:
            zero_based = appearance.scene_index - 1
            if 0 <= zero_based < len(ctx.scene_summaries):
                scene_ids.append(ctx.scene_summaries[zero_based]["id"])
            else:
                logger.warning(
                    "Invalid scene_index %d (total scenes: %d) -- skipping",
                    appearance.scene_index,
                    len(ctx.scene_summaries),
                )
        return scene_ids

    def _record_run(
        self,
        db: Session,
        project_id: UUID,
        status: str,
        result: dict,
        error: str = None,
        created: int = 0,
        updated: int = 0,
    ) -> database.BreakdownRun:
        """Create a BreakdownRun audit record."""
        run = database.BreakdownRun(
            project_id=str(project_id),
            status=status,
            config={
                "temperature": 0.15,
                "provider": settings.AI_PROVIDER,
            },
            result_summary=result,
            error_message=error,
            elements_created=created,
            elements_updated=updated,
        )
        if status in ("completed", "failed"):
            run.completed_at = datetime.now(timezone.utc)
        db.add(run)
        return run

    async def extract(self, db: Session, project_id: UUID,
                       bible_context: Optional[str] = None) -> database.BreakdownRun:
        """
        Full extraction pipeline in a single transaction:

        1. Build context from database (screenplay text, characters, scenes)
        2. Validate context has screenplay content
        3. Call AI with structured output
        4. Upsert elements (respecting user_modified and is_deleted)
        5. Reconcile scene links for each element
        6. Record audit run
        7. Single commit for entire transaction
        """
        try:
            # 1. Build context
            ctx = self._build_extraction_context(db, project_id)

            # 2. Validate -- must have screenplay content
            if not ctx.screenplay_texts:
                run = self._record_run(
                    db, project_id, "failed",
                    result={"error": "No screenplay content found"},
                    error="No screenplay content found for project",
                )
                db.commit()
                return run

            # 3. Call AI
            response = await self._call_ai_extraction(ctx, bible_context=bible_context)

            # 3b. Post-processing deduplication
            deduplicated = self._deduplicate_elements(response.elements)

            # 4. Upsert elements
            result = self._upsert_elements(db, project_id, deduplicated)

            # 5. Reconcile scene links for each element in element_map
            for extracted_el in deduplicated:
                db_element = result["element_map"].get(extracted_el.canonical_name)
                if db_element is None:
                    continue  # Was skipped (deleted)
                scene_ids = self._map_scene_indices_to_ids(ctx, extracted_el.scene_appearances)
                self._reconcile_scene_links(db, db_element, scene_ids)

            # 5b. Compute total estimated runtime from scene durations
            scene_duration_data = [
                d.model_dump() for d in response.scene_durations
            ]
            total_estimated_seconds = sum(
                d.estimated_seconds for d in response.scene_durations
            )

            # 6. Record run
            run = self._record_run(
                db, project_id, "completed",
                result={
                    "elements_extracted": len(response.elements),
                    "created": result["created"],
                    "updated": result["updated"],
                    "skipped": result["skipped"],
                    "scene_durations": scene_duration_data,
                    "total_estimated_seconds": total_estimated_seconds,
                },
                created=result["created"],
                updated=result["updated"],
            )

            # 6b. Clear staleness flag (SYNC-04)
            stale_project = db.query(database.Project).filter(
                database.Project.id == str(project_id)
            ).first()
            if stale_project:
                stale_project.breakdown_stale = False

            # 7. Single commit
            db.commit()
            return run

        except Exception as e:
            db.rollback()
            logger.error("Extraction failed for project %s: %s", project_id, e)
            # Record a failed run in a new transaction
            run = self._record_run(
                db, project_id, "failed",
                result={"error": str(e)},
                error=str(e),
            )
            db.commit()
            raise


# Module-level singleton
breakdown_service = BreakdownService()
