# backend/app/tests/test_breakdown_service.py

"""
Integration and unit tests for BreakdownService covering all Phase 11 requirements:
  EXTR-01: Extraction produces elements
  EXTR-02: Structured output schema
  EXTR-03: Post-processing deduplication
  EXTR-04: Extraction temperature
  EXTR-05: Scene linking
  SYNC-01: User-modified elements preserved
  SYNC-02: Soft-deleted elements not resurrected
"""

import uuid

import pytest
from unittest.mock import patch, AsyncMock
from screenwriter.models.database import (
    BreakdownElement,
    BreakdownRun,
    ElementSceneLink,
    ListItem,
    PhaseData,
    Project,
    ScreenplayContent,
)
from screenwriter.services.breakdown_service import (
    breakdown_service,
    ExtractionResponse,
    ExtractedElement,
    ExtractedSceneAppearance,
    ExtractionContext,
)


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_project_with_screenplay(db_session):
    """Create a project with screenplay content, characters, and 3 scenes.

    Returns (project_id, scene_item_ids_list) where scene_item_ids_list is
    a list of 3 scene ListItem IDs in order.
    """
    project_id = str(uuid.uuid4())

    # Create project
    project = Project(
        id=project_id,
        owner_id=MOCK_USER_ID,
        title="Test Film",
    )
    db_session.add(project)
    db_session.flush()

    # Create screenplay content
    sc = ScreenplayContent(
        id=str(uuid.uuid4()),
        project_id=project_id,
        content="INT. CASTLE - NIGHT\nThe KNIGHT draws a MAGIC SWORD from the stone.\n\nEXT. FOREST - DAY\nThe KNIGHT rides through on a HORSE.\n\nINT. THRONE ROOM - DAY\nThe KNIGHT presents the MAGIC SWORD to the KING.",
    )
    db_session.add(sc)
    db_session.flush()

    # Create characters PhaseData + ListItems
    chars_pd = PhaseData(
        id=str(uuid.uuid4()),
        project_id=project_id,
        phase="story",
        subsection_key="characters",
        content={},
    )
    db_session.add(chars_pd)
    db_session.flush()

    for name in ["Knight", "King"]:
        li = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=str(chars_pd.id),
            item_type="character",
            content={"name": name},
            sort_order=0,
        )
        db_session.add(li)
    db_session.flush()

    # Create scenes PhaseData + 3 ListItems
    scenes_pd = PhaseData(
        id=str(uuid.uuid4()),
        project_id=project_id,
        phase="scenes",
        subsection_key="scene_list",
        content={},
    )
    db_session.add(scenes_pd)
    db_session.flush()

    scene_item_ids = []
    for i in range(3):
        scene_id = str(uuid.uuid4())
        li = ListItem(
            id=scene_id,
            phase_data_id=str(scenes_pd.id),
            item_type="scene",
            content={"summary": f"Scene {i + 1} summary"},
            sort_order=i,
        )
        db_session.add(li)
        scene_item_ids.append(scene_id)
    db_session.flush()

    db_session.commit()
    return project_id, scene_item_ids


def _mock_extraction_response(elements):
    """Wrap a list of ExtractedElement into an ExtractionResponse."""
    return ExtractionResponse(elements=elements)


class TestBreakdownService:
    """Integration and unit tests for BreakdownService."""

    # ----------------------------------------------------------------
    # EXTR-01: Extraction produces elements
    # ----------------------------------------------------------------
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_extraction_produces_elements(self, mock_ai, db_session):
        """extract() with mocked AI returning 3 elements creates 3 BreakdownElement rows."""
        project_id, scene_ids = _setup_project_with_screenplay(db_session)

        mock_ai.return_value = _mock_extraction_response([
            ExtractedElement(
                category="character",
                canonical_name="Knight",
                description="A brave knight",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=1, context="Draws sword"),
                ],
            ),
            ExtractedElement(
                category="prop",
                canonical_name="Magic Sword",
                description="An enchanted blade",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=1, context="Drawn from stone"),
                ],
            ),
            ExtractedElement(
                category="location",
                canonical_name="Castle",
                description="A medieval castle",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=1, context="Interior scene"),
                ],
            ),
        ])

        run = await breakdown_service.extract(db_session, project_id)

        # Assert run status
        assert run.status == "completed"
        assert run.elements_created == 3

        # Assert 3 elements in DB
        elements = db_session.query(BreakdownElement).filter(
            BreakdownElement.project_id == project_id
        ).all()
        assert len(elements) == 3
        categories = {e.category for e in elements}
        assert categories == {"character", "prop", "location"}

    # ----------------------------------------------------------------
    # EXTR-02: Structured output schema
    # ----------------------------------------------------------------
    def test_structured_output_schema(self):
        """ExtractionResponse model validates correctly with edge cases."""
        # Empty elements list is valid
        resp = ExtractionResponse(elements=[])
        assert len(resp.elements) == 0

        # Element with empty scene_appearances is valid
        elem = ExtractedElement(
            category="prop",
            canonical_name="Chair",
            description="A wooden chair",
            scene_appearances=[],
        )
        assert len(elem.scene_appearances) == 0

        # Full element is valid
        full_elem = ExtractedElement(
            category="character",
            canonical_name="Hero",
            description="The protagonist",
            scene_appearances=[
                ExtractedSceneAppearance(scene_index=1, context="Appears"),
            ],
        )
        resp2 = ExtractionResponse(elements=[full_elem])
        assert len(resp2.elements) == 1

        # model_json_schema() returns a valid dict (used by structured outputs)
        schema = ExtractionResponse.model_json_schema()
        assert isinstance(schema, dict)
        assert "properties" in schema

    # ----------------------------------------------------------------
    # EXTR-03: Post-processing deduplication
    # ----------------------------------------------------------------
    def test_deduplication(self):
        """_deduplicate_elements merges same-category case-insensitive duplicates."""
        elements = [
            ExtractedElement(
                category="prop",
                canonical_name="Gun",
                description="A revolver",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=1, context="Fired"),
                ],
            ),
            ExtractedElement(
                category="prop",
                canonical_name="gun",
                description="A pistol",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=2, context="Dropped"),
                ],
            ),
        ]

        result = breakdown_service._deduplicate_elements(elements)

        # Should merge into single element
        assert len(result) == 1
        merged = result[0]
        assert merged.canonical_name == "Gun"  # Keeps first name
        assert merged.description == "A revolver"  # Keeps first description
        assert len(merged.scene_appearances) == 2
        scene_indices = {a.scene_index for a in merged.scene_appearances}
        assert scene_indices == {1, 2}

    def test_deduplication_different_categories_not_merged(self):
        """Different categories with same name are NOT merged."""
        elements = [
            ExtractedElement(
                category="character",
                canonical_name="Gun",
                description="A character named Gun",
                scene_appearances=[],
            ),
            ExtractedElement(
                category="prop",
                canonical_name="Gun",
                description="A weapon",
                scene_appearances=[],
            ),
        ]

        result = breakdown_service._deduplicate_elements(elements)
        assert len(result) == 2

    # ----------------------------------------------------------------
    # EXTR-04: Extraction temperature
    # ----------------------------------------------------------------
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_extraction_temperature(self, mock_ai, db_session):
        """AI call uses temperature=0.15."""
        project_id, _ = _setup_project_with_screenplay(db_session)

        mock_ai.return_value = _mock_extraction_response([])

        await breakdown_service.extract(db_session, project_id)

        mock_ai.assert_called_once()
        call_kwargs = mock_ai.call_args.kwargs
        assert call_kwargs["temperature"] == 0.15

    # ----------------------------------------------------------------
    # EXTR-05: Scene linking
    # ----------------------------------------------------------------
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_scene_linking(self, mock_ai, db_session):
        """Scene links connect elements to correct ListItem IDs based on scene_index."""
        project_id, scene_ids = _setup_project_with_screenplay(db_session)

        mock_ai.return_value = _mock_extraction_response([
            ExtractedElement(
                category="character",
                canonical_name="Knight",
                description="A brave knight",
                scene_appearances=[
                    ExtractedSceneAppearance(scene_index=1, context="Draws sword"),
                    ExtractedSceneAppearance(scene_index=3, context="Presents sword"),
                ],
            ),
        ])

        await breakdown_service.extract(db_session, project_id)

        # Find the created element
        element = db_session.query(BreakdownElement).filter(
            BreakdownElement.project_id == project_id,
            BreakdownElement.name == "Knight",
        ).first()
        assert element is not None

        # Check scene links
        links = db_session.query(ElementSceneLink).filter(
            ElementSceneLink.element_id == str(element.id),
        ).all()
        assert len(links) == 2

        linked_scene_ids = {link.scene_item_id for link in links}
        # scene_index 1 -> scene_ids[0], scene_index 3 -> scene_ids[2]
        assert scene_ids[0] in linked_scene_ids
        assert scene_ids[2] in linked_scene_ids

    # ----------------------------------------------------------------
    # SYNC-01: User-modified elements preserved
    # ----------------------------------------------------------------
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_user_modified_preserved(self, mock_ai, db_session):
        """Pre-existing user_modified element retains its description after re-extraction."""
        project_id, _ = _setup_project_with_screenplay(db_session)

        # Pre-create a user-modified element
        existing = BreakdownElement(
            id=str(uuid.uuid4()),
            project_id=project_id,
            category="prop",
            name="Magic Sword",
            description="User's description",
            source="user",
            user_modified=True,
        )
        db_session.add(existing)
        db_session.commit()

        # Mock AI returns same element with different description
        mock_ai.return_value = _mock_extraction_response([
            ExtractedElement(
                category="prop",
                canonical_name="Magic Sword",
                description="AI description",
                scene_appearances=[],
            ),
        ])

        await breakdown_service.extract(db_session, project_id)

        # Refresh and verify
        db_session.refresh(existing)
        assert existing.description == "User's description"
        assert existing.user_modified is True

    # ----------------------------------------------------------------
    # SYNC-02: Soft-deleted elements not resurrected
    # ----------------------------------------------------------------
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_deleted_not_resurrected(self, mock_ai, db_session):
        """Pre-existing soft-deleted element remains is_deleted=True after re-extraction."""
        project_id, _ = _setup_project_with_screenplay(db_session)

        # Pre-create a soft-deleted element
        deleted_elem = BreakdownElement(
            id=str(uuid.uuid4()),
            project_id=project_id,
            category="prop",
            name="Broken Lamp",
            description="A broken lamp",
            source="ai",
            is_deleted=True,
        )
        db_session.add(deleted_elem)
        db_session.commit()

        # Mock AI returns same element
        mock_ai.return_value = _mock_extraction_response([
            ExtractedElement(
                category="prop",
                canonical_name="Broken Lamp",
                description="A lamp that is broken",
                scene_appearances=[],
            ),
        ])

        run = await breakdown_service.extract(db_session, project_id)

        # Refresh and verify still deleted
        db_session.refresh(deleted_elem)
        assert deleted_elem.is_deleted is True

        # Verify no new element with that name was created
        all_lamps = db_session.query(BreakdownElement).filter(
            BreakdownElement.project_id == project_id,
            BreakdownElement.name == "Broken Lamp",
        ).all()
        assert len(all_lamps) == 1  # Only the deleted one
        assert all_lamps[0].is_deleted is True
