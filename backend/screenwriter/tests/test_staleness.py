# backend/app/tests/test_staleness.py
"""
Integration tests for SYNC-03: Staleness hooks.

Tests verify that breakdown_stale=True is set on a Project when:
  - PATCH phase_data for a write or scenes phase
  - apply_wizard_result_to_db() for script_writer_wizard
  - Creating, updating, or deleting a scene ListItem

And that breakdown_stale is NOT set when no BreakdownElement exists.
"""

import asyncio
import uuid

import pytest
from unittest.mock import patch, AsyncMock
from screenwriter.models.database import (
    BreakdownElement,
    BreakdownRun,
    ListItem,
    PhaseData,
    Project,
    ScreenplayContent,
)
from screenwriter.api.endpoints.wizards import apply_wizard_result_to_db
from screenwriter.services.breakdown_service import breakdown_service, ExtractionResponse

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _create_project_via_api(client, mock_auth_headers, title="Stale Test Project"):
    """Create a project through the API to ensure correct owner_id handling in SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


def _add_breakdown_element(db_session, project_id):
    """Add a non-deleted BreakdownElement to a project."""
    element = BreakdownElement(
        id=str(uuid.uuid4()),
        project_id=project_id,
        category="character",
        name="Test Character",
        description="A test character",
        is_deleted=False,
    )
    db_session.add(element)
    db_session.commit()
    return element


def _make_phase_data(db_session, project_id, phase, subsection_key="main_content"):
    """Create a PhaseData row. Return phase_data."""
    pd = PhaseData(
        id=str(uuid.uuid4()),
        project_id=project_id,
        phase=phase,
        subsection_key=subsection_key,
        content={"some": "data"},
    )
    db_session.add(pd)
    db_session.flush()
    db_session.commit()
    return pd


def _make_scene_list_phase_data(db_session, project_id):
    """Create scenes/scene_list PhaseData. Return phase_data."""
    return _make_phase_data(db_session, project_id, "scenes", "scene_list")


def _get_project(db_session, project_id):
    """Load a fresh Project object from db for assertion."""
    db_session.expire_all()
    return db_session.query(Project).filter(Project.id == project_id).first()


class TestStalenessHooks:
    """SYNC-03: Integration tests for staleness hook wiring."""

    # ----------------------------------------------------------------
    # 1. PATCH write phase sets stale
    # ----------------------------------------------------------------
    def test_patch_write_phase_sets_stale(self, client, db_session, mock_auth_headers):
        """PATCH phase_data for a write phase sets breakdown_stale=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_phase_data(db_session, project_id, "write", "screenplay_editor")

        resp = client.patch(
            f"/api/phase-data/{project_id}/write/{pd.subsection_key}",
            json={"content": {"draft": "Updated screenplay content"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 2. PATCH scenes phase sets stale
    # ----------------------------------------------------------------
    def test_patch_scenes_phase_sets_stale(self, client, db_session, mock_auth_headers):
        """PATCH phase_data for a scenes phase sets breakdown_stale=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_phase_data(db_session, project_id, "scenes", "scene_overview")

        resp = client.patch(
            f"/api/phase-data/{project_id}/scenes/{pd.subsection_key}",
            json={"content": {"overview": "Scene overview updated"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 3. PATCH non-write/scenes phase does NOT set stale
    # ----------------------------------------------------------------
    def test_patch_non_write_phase_no_stale(self, client, db_session, mock_auth_headers):
        """PATCH phase_data for idea or story phase does NOT set breakdown_stale."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_phase_data(db_session, project_id, "story", "premise")

        resp = client.patch(
            f"/api/phase-data/{project_id}/story/{pd.subsection_key}",
            json={"content": {"premise": "A story about something"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is False

    # ----------------------------------------------------------------
    # 4. script_writer_wizard sets stale
    # ----------------------------------------------------------------
    def test_script_wizard_sets_stale(self, db_session):
        """apply_wizard_result_to_db() for script_writer_wizard sets breakdown_stale=True."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Script Wizard Stale Test",
            breakdown_stale=False,
        )
        db_session.add(project)
        db_session.flush()

        element = BreakdownElement(
            id=str(uuid.uuid4()),
            project_id=project_id,
            category="character",
            name="Test Character",
            is_deleted=False,
        )
        db_session.add(element)
        db_session.commit()

        result = {
            "screenplays": [
                {"content": "INT. ROOM - DAY\nTest screenplay content."}
            ]
        }
        apply_wizard_result_to_db(
            db_session, project, "write", "script_writer_wizard", result
        )

        db_session.refresh(project)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 5-scene. scene_wizard sets stale
    # ----------------------------------------------------------------
    def test_scene_wizard_sets_stale(self, db_session):
        """apply_wizard_result_to_db() for scene_wizard sets breakdown_stale=True."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Scene Wizard Stale Test",
            breakdown_stale=False,
        )
        db_session.add(project)
        db_session.flush()

        # Pre-create PhaseData for scenes/scene_list to keep the test simple
        phase_data = PhaseData(
            id=str(uuid.uuid4()),
            project_id=project_id,
            phase="scenes",
            subsection_key="scene_list",
            content={},
        )
        db_session.add(phase_data)

        element = BreakdownElement(
            id=str(uuid.uuid4()),
            project_id=project_id,
            category="character",
            name="Test Character",
            is_deleted=False,
        )
        db_session.add(element)
        db_session.commit()

        result = {
            "scenes": [
                {"title": "Scene 1", "description": "Opening scene"}
            ]
        }
        apply_wizard_result_to_db(
            db_session, project, "scenes", "scene_wizard", result
        )

        db_session.refresh(project)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 5. Creating a scene list item sets stale
    # ----------------------------------------------------------------
    def test_create_scene_sets_stale(self, client, db_session, mock_auth_headers):
        """POST list item on scenes/scene_list phase_data sets breakdown_stale=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_scene_list_phase_data(db_session, project_id)

        resp = client.post(
            f"/api/list-items/{pd.id}",
            json={"item_type": "scene", "content": {"title": "New Scene"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 6. Updating a scene list item sets stale
    # ----------------------------------------------------------------
    def test_update_scene_sets_stale(self, client, db_session, mock_auth_headers):
        """PATCH list item in scenes/scene_list sets breakdown_stale=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_scene_list_phase_data(db_session, project_id)

        # Create a scene item first
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=str(pd.id),
            item_type="scene",
            content={"title": "Original Scene"},
            sort_order=0,
        )
        db_session.add(item)
        db_session.commit()

        resp = client.patch(
            f"/api/list-items/item/{item.id}",
            json={"content": {"title": "Updated Scene"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # 7. Deleting a scene list item sets stale
    # ----------------------------------------------------------------
    def test_delete_scene_sets_stale(self, client, db_session, mock_auth_headers):
        """DELETE list item in scenes/scene_list sets breakdown_stale=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_breakdown_element(db_session, project_id)
        pd = _make_scene_list_phase_data(db_session, project_id)

        # Create a scene item first
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=str(pd.id),
            item_type="scene",
            content={"title": "Scene to Delete"},
            sort_order=0,
        )
        db_session.add(item)
        db_session.commit()

        resp = client.delete(
            f"/api/list-items/item/{item.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is True

    # ----------------------------------------------------------------
    # SYNC-04: Extraction clears the stale flag atomically
    # ----------------------------------------------------------------
    def test_extraction_clears_stale(self, db_session):
        """Successful extraction clears breakdown_stale=False atomically with the extraction commit."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Stale Clear Test",
            breakdown_stale=True,
        )
        db_session.add(project)
        db_session.flush()

        # Add screenplay content so the extraction pipeline doesn't short-circuit
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. ROOM - DAY\nA character walks in.",
        )
        db_session.add(sc)
        db_session.commit()

        # Mock the AI call to return an empty extraction (sufficient for this test)
        with patch(
            "app.services.breakdown_service.breakdown_service._call_ai_extraction",
            new_callable=AsyncMock,
            return_value=ExtractionResponse(elements=[]),
        ):
            run = asyncio.run(breakdown_service.extract(db_session, project_id))

        # Re-query the project to see the committed state
        db_session.expire_all()
        refreshed = db_session.query(Project).filter(Project.id == project_id).first()
        assert refreshed.breakdown_stale is False

        # Confirm a BreakdownRun with status="completed" was recorded
        breakdown_run = db_session.query(BreakdownRun).filter(
            BreakdownRun.project_id == project_id,
            BreakdownRun.status == "completed",
        ).first()
        assert breakdown_run is not None

    def test_failed_extraction_does_not_clear_stale(self, db_session):
        """A failed extraction does NOT clear breakdown_stale; the flag remains True."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Stale Failure Test",
            breakdown_stale=True,
        )
        db_session.add(project)
        db_session.flush()

        # Add screenplay content so the pipeline reaches the AI call
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. ROOM - DAY\nSome content.",
        )
        db_session.add(sc)
        db_session.commit()

        # Mock the AI call to raise an error
        with patch(
            "app.services.breakdown_service.breakdown_service._call_ai_extraction",
            new_callable=AsyncMock,
            side_effect=RuntimeError("AI failed"),
        ):
            with pytest.raises(RuntimeError, match="AI failed"):
                asyncio.run(breakdown_service.extract(db_session, project_id))

        # Re-query the project; stale flag must still be True
        db_session.expire_all()
        refreshed = db_session.query(Project).filter(Project.id == project_id).first()
        assert refreshed.breakdown_stale is True

    # ----------------------------------------------------------------
    # 8. No breakdown element = no stale set
    # ----------------------------------------------------------------
    def test_no_stale_without_breakdown(self, client, db_session, mock_auth_headers):
        """PATCH write phase does NOT set breakdown_stale when no BreakdownElement exists."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        # Deliberately NOT adding a BreakdownElement
        pd = _make_phase_data(db_session, project_id, "write", "screenplay_editor")

        resp = client.patch(
            f"/api/phase-data/{project_id}/write/{pd.subsection_key}",
            json={"content": {"draft": "Some content"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.breakdown_stale is False
