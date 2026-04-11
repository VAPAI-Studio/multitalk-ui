# backend/app/tests/test_shotlist_staleness.py
"""
Integration tests for SYNC-01/SYNC-03/SYNC-04: Shotlist staleness hooks.

Tests verify that shotlist_stale=True is set on a Project when:
  - PATCH phase_data for a write or scenes phase (with shots present)
  - apply_wizard_result_to_db() for script_writer_wizard (with shots present)
  - apply_wizard_result_to_db() for scene_wizard (with shots present)
  - Creating, updating, or deleting a scene ListItem (with shots present)
  - Creating, updating, or deleting a character ListItem (with shots present)

And that shotlist_stale is NOT set when no Shot exists.

Also tests the status and acknowledge-stale endpoints.
"""

import uuid

import pytest
from screenwriter.models.database import (
    ListItem,
    PhaseData,
    Project,
    Shot,
)
from screenwriter.models import database
from screenwriter.api.endpoints.wizards import apply_wizard_result_to_db

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _create_project_via_api(client, mock_auth_headers, title="Shotlist Stale Test Project"):
    """Create a project through the API to ensure correct owner_id handling in SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


def _add_shot(db_session, project_id):
    """Add a Shot row to satisfy the _mark_shotlist_stale guard condition."""
    shot = database.Shot(
        id=str(uuid.uuid4()),
        project_id=project_id,
        shot_number=1,
        fields={},
        sort_order=0,
        source="user",
    )
    db_session.add(shot)
    db_session.commit()
    return shot


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


def _make_characters_phase_data(db_session, project_id):
    """Create story/characters PhaseData. Return phase_data."""
    return _make_phase_data(db_session, project_id, "story", "characters")


def _get_project(db_session, project_id):
    """Load a fresh Project object from db for assertion."""
    db_session.expire_all()
    return db_session.query(Project).filter(Project.id == project_id).first()


class TestShotlistStalenessHooks:
    """SYNC-01/SYNC-03/SYNC-04: Integration tests for shotlist staleness hook wiring."""

    # ----------------------------------------------------------------
    # 1. PATCH write phase sets shotlist_stale
    # ----------------------------------------------------------------
    def test_patch_write_phase_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """PATCH phase_data for a write phase sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_phase_data(db_session, project_id, "write", "screenplay_editor")

        resp = client.patch(
            f"/api/phase-data/{project_id}/write/{pd.subsection_key}",
            json={"content": {"draft": "Updated screenplay content"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 2. PATCH scenes phase sets shotlist_stale
    # ----------------------------------------------------------------
    def test_patch_scenes_phase_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """PATCH phase_data for a scenes phase sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_phase_data(db_session, project_id, "scenes", "scene_overview")

        resp = client.patch(
            f"/api/phase-data/{project_id}/scenes/{pd.subsection_key}",
            json={"content": {"overview": "Scene overview updated"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 3. script_writer_wizard sets shotlist_stale
    # ----------------------------------------------------------------
    def test_script_wizard_sets_shotlist_stale(self, db_session):
        """apply_wizard_result_to_db() for script_writer_wizard sets shotlist_stale=True when shots exist."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Script Wizard Shotlist Stale Test",
            shotlist_stale=False,
        )
        db_session.add(project)
        db_session.flush()

        _add_shot(db_session, project_id)

        result = {
            "screenplays": [
                {"content": "INT. ROOM - DAY\nTest screenplay content."}
            ]
        }
        apply_wizard_result_to_db(
            db_session, project, "write", "script_writer_wizard", result
        )

        db_session.refresh(project)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 4. scene_wizard sets shotlist_stale
    # ----------------------------------------------------------------
    def test_scene_wizard_sets_shotlist_stale(self, db_session):
        """apply_wizard_result_to_db() for scene_wizard sets shotlist_stale=True when shots exist."""
        project_id = str(uuid.uuid4())
        project = Project(
            id=project_id,
            owner_id=MOCK_USER_ID,
            title="Scene Wizard Shotlist Stale Test",
            shotlist_stale=False,
        )
        db_session.add(project)
        db_session.flush()

        # Pre-create PhaseData for scenes/scene_list
        phase_data = PhaseData(
            id=str(uuid.uuid4()),
            project_id=project_id,
            phase="scenes",
            subsection_key="scene_list",
            content={},
        )
        db_session.add(phase_data)

        _add_shot(db_session, project_id)

        result = {
            "scenes": [
                {"title": "Scene 1", "description": "Opening scene"}
            ]
        }
        apply_wizard_result_to_db(
            db_session, project, "scenes", "scene_wizard", result
        )

        db_session.refresh(project)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 5. No shots = no stale set
    # ----------------------------------------------------------------
    def test_no_stale_without_shots(self, client, db_session, mock_auth_headers):
        """PATCH write phase does NOT set shotlist_stale when no Shot exists."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        # Deliberately NOT adding a Shot
        pd = _make_phase_data(db_session, project_id, "write", "screenplay_editor")

        resp = client.patch(
            f"/api/phase-data/{project_id}/write/{pd.subsection_key}",
            json={"content": {"draft": "Some content"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is False

    # ----------------------------------------------------------------
    # 6. Creating a scene list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_create_scene_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """POST list item on scenes/scene_list sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_scene_list_phase_data(db_session, project_id)

        resp = client.post(
            f"/api/list-items/{pd.id}",
            json={"item_type": "scene", "content": {"title": "New Scene"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 7. Updating a scene list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_update_scene_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """PATCH list item in scenes/scene_list sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
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
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 8. Deleting a scene list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_delete_scene_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """DELETE list item in scenes/scene_list sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
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
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 9. Creating a character list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_create_character_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """POST list item on story/characters sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_characters_phase_data(db_session, project_id)

        resp = client.post(
            f"/api/list-items/{pd.id}",
            json={"item_type": "character", "content": {"name": "New Character"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 10. Updating a character list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_update_character_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """PATCH list item in story/characters sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_characters_phase_data(db_session, project_id)

        # Create a character item first
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=str(pd.id),
            item_type="character",
            content={"name": "Original Character"},
            sort_order=0,
        )
        db_session.add(item)
        db_session.commit()

        resp = client.patch(
            f"/api/list-items/item/{item.id}",
            json={"content": {"name": "Updated Character"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 11. Deleting a character list item sets shotlist_stale
    # ----------------------------------------------------------------
    def test_delete_character_sets_shotlist_stale(self, client, db_session, mock_auth_headers):
        """DELETE list item in story/characters sets shotlist_stale=True when shots exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)
        pd = _make_characters_phase_data(db_session, project_id)

        # Create a character item first
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=str(pd.id),
            item_type="character",
            content={"name": "Character to Delete"},
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
        assert project.shotlist_stale is True

    # ----------------------------------------------------------------
    # 12. GET status endpoint returns shotlist_stale and shot_count
    # ----------------------------------------------------------------
    def test_get_shotlist_status(self, client, db_session, mock_auth_headers):
        """GET /api/shots/{project_id}/status returns shotlist_stale and shot_count."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _add_shot(db_session, project_id)

        # Manually set shotlist_stale to True for the test
        project = _get_project(db_session, project_id)
        project.shotlist_stale = True
        db_session.commit()

        resp = client.get(
            f"/api/shots/{project_id}/status",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "shotlist_stale" in data
        assert "shot_count" in data
        assert data["shotlist_stale"] is True
        assert data["shot_count"] == 1

    # ----------------------------------------------------------------
    # 13. POST acknowledge-stale clears shotlist_stale
    # ----------------------------------------------------------------
    def test_acknowledge_clears_stale(self, client, db_session, mock_auth_headers):
        """POST /api/shots/{project_id}/acknowledge-stale sets shotlist_stale=False."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        # Set shotlist_stale to True
        project = _get_project(db_session, project_id)
        project.shotlist_stale = True
        db_session.commit()

        resp = client.post(
            f"/api/shots/{project_id}/acknowledge-stale",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text

        project = _get_project(db_session, project_id)
        assert project.shotlist_stale is False
