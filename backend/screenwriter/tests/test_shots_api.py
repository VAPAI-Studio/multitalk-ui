# backend/app/tests/test_shots_api.py

import uuid

import pytest
from screenwriter.models.database import Shot, PhaseData, ListItem

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"

ALL_STANDARD_FIELDS = {
    "shot_size": "Wide",
    "camera_angle": "Low",
    "camera_movement": "Dolly In",
    "lens": "35mm",
    "description": "Hero enters the room",
    "action": "Walking slowly",
    "dialogue": "Hello world",
    "sound": "Ambient wind",
    "characters": "Hero, Villain",
    "environment": "Dark alley",
    "props": "Flashlight, Badge",
    "equipment": "Steadicam",
    "notes": "Shoot at golden hour",
}


def _create_project_via_api(client, mock_auth_headers, title="Test Project"):
    """Create a project through the API so owner_id is stored correctly for SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


def _make_shot(db_session, project_id, shot_number=1, fields=None, scene_item_id=None, sort_order=0, source="user"):
    """Create a shot directly in the DB."""
    shot = Shot(
        id=str(uuid.uuid4()),
        project_id=project_id,
        scene_item_id=str(scene_item_id) if scene_item_id else None,
        shot_number=shot_number,
        fields=fields or {},
        sort_order=sort_order,
        source=source,
    )
    db_session.add(shot)
    db_session.flush()
    return shot


def _make_phase_data(db_session, project_id, phase="write", subsection_key="scenes"):
    """Create a PhaseData record to parent ListItems."""
    pd = PhaseData(
        id=str(uuid.uuid4()),
        project_id=project_id,
        phase=phase,
        subsection_key=subsection_key,
        content={},
    )
    db_session.add(pd)
    db_session.flush()
    return pd


def _make_list_item(db_session, phase_data_id):
    """Create a ListItem to use as a scene for linking."""
    item = ListItem(
        id=str(uuid.uuid4()),
        phase_data_id=phase_data_id,
        item_type="scene",
        content={"title": "Scene 1"},
    )
    db_session.add(item)
    db_session.flush()
    return item


# ============================================================
# TestCreateShot
# ============================================================

class TestCreateShot:
    def test_create_shot_minimal(self, client, mock_auth_headers):
        """POST with minimal body returns 201 with defaults."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.post(
            f"/api/shots/{project_id}",
            json={},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert data["project_id"] == project_id
        assert data["shot_number"] == 1
        assert data["source"] == "user"
        assert data["fields"] == {}

    def test_create_shot_with_fields(self, client, mock_auth_headers):
        """POST with fields stores and returns those fields."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.post(
            f"/api/shots/{project_id}",
            json={"fields": {"shot_size": "Wide", "camera_angle": "Low", "description": "Hero entrance"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["fields"]["shot_size"] == "Wide"
        assert data["fields"]["camera_angle"] == "Low"
        assert data["fields"]["description"] == "Hero entrance"

    def test_create_shot_all_standard_fields(self, client, mock_auth_headers):
        """POST with all 13 standard fields returns all 13 in response.fields."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.post(
            f"/api/shots/{project_id}",
            json={"fields": ALL_STANDARD_FIELDS},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        for key, value in ALL_STANDARD_FIELDS.items():
            assert data["fields"][key] == value, f"Field {key} mismatch"

    def test_create_shot_with_scene_item_id(self, client, db_session, mock_auth_headers):
        """POST with valid scene_item_id links shot to scene."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        pd = _make_phase_data(db_session, project_id)
        item = _make_list_item(db_session, pd.id)
        db_session.commit()

        resp = client.post(
            f"/api/shots/{project_id}",
            json={"scene_item_id": str(item.id)},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["scene_item_id"] == str(item.id)


# ============================================================
# TestListShots
# ============================================================

class TestListShots:
    def test_list_shots_empty(self, client, mock_auth_headers):
        """GET returns empty list for project with no shots."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.get(
            f"/api/shots/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0

    def test_list_shots_returns_all(self, client, db_session, mock_auth_headers):
        """GET returns all shots for project."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_shot(db_session, project_id, shot_number=1)
        _make_shot(db_session, project_id, shot_number=2)
        db_session.commit()

        resp = client.get(
            f"/api/shots/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_list_shots_sorted(self, client, db_session, mock_auth_headers):
        """GET returns shots sorted by scene_item_id + sort_order."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_shot(db_session, project_id, shot_number=1, sort_order=1)
        _make_shot(db_session, project_id, shot_number=2, sort_order=0)
        db_session.commit()

        resp = client.get(
            f"/api/shots/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["sort_order"] == 0
        assert data[1]["sort_order"] == 1

    def test_list_shots_filter_by_scene(self, client, db_session, mock_auth_headers):
        """GET ?scene_item_id=UUID filters correctly."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        pd = _make_phase_data(db_session, project_id)
        scene1 = _make_list_item(db_session, pd.id)
        scene2 = _make_list_item(db_session, pd.id)
        _make_shot(db_session, project_id, scene_item_id=scene1.id)
        _make_shot(db_session, project_id, scene_item_id=scene2.id)
        db_session.commit()

        resp = client.get(
            f"/api/shots/{project_id}",
            params={"scene_item_id": str(scene1.id)},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["scene_item_id"] == str(scene1.id)


# ============================================================
# TestGetShot
# ============================================================

class TestGetShot:
    def test_get_shot(self, client, db_session, mock_auth_headers):
        """GET /{project_id}/{shot_id} returns correct shot."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        db_session.commit()

        resp = client.get(
            f"/api/shots/{project_id}/{shot.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(shot.id)

    def test_get_shot_not_found(self, client, mock_auth_headers):
        """GET with fake shot_id returns 404."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        fake_id = str(uuid.uuid4())

        resp = client.get(
            f"/api/shots/{project_id}/{fake_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# TestUpdateShot
# ============================================================

class TestUpdateShot:
    def test_update_shot_partial(self, client, db_session, mock_auth_headers):
        """PUT with partial body updates only sent fields."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id, shot_number=1)
        db_session.commit()

        resp = client.put(
            f"/api/shots/{project_id}/{shot.id}",
            json={"fields": {"shot_size": "Close-Up"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fields"]["shot_size"] == "Close-Up"
        assert data["shot_number"] == 1  # unchanged

    def test_update_shot_fields_replaced(self, client, db_session, mock_auth_headers):
        """PUT with fields replaces entire fields dict."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id, fields={"shot_size": "Wide", "lens": "50mm"})
        db_session.commit()

        resp = client.put(
            f"/api/shots/{project_id}/{shot.id}",
            json={"fields": {"camera_angle": "High"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["fields"] == {"camera_angle": "High"}


# ============================================================
# TestDeleteShot
# ============================================================

class TestDeleteShot:
    def test_delete_shot(self, client, db_session, mock_auth_headers):
        """DELETE returns 204, shot no longer in list."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        db_session.commit()

        resp = client.delete(
            f"/api/shots/{project_id}/{shot.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 204

        # Verify shot is gone
        list_resp = client.get(
            f"/api/shots/{project_id}",
            headers=mock_auth_headers,
        )
        assert len(list_resp.json()) == 0

    def test_delete_shot_not_found(self, client, mock_auth_headers):
        """DELETE fake shot returns 404."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        fake_id = str(uuid.uuid4())

        resp = client.delete(
            f"/api/shots/{project_id}/{fake_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# TestReorderShots
# ============================================================

class TestReorderShots:
    def test_reorder_shots(self, client, db_session, mock_auth_headers):
        """POST reorder with valid IDs updates sort_order."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot1 = _make_shot(db_session, project_id, sort_order=0)
        shot2 = _make_shot(db_session, project_id, sort_order=1)
        db_session.commit()

        resp = client.post(
            f"/api/shots/{project_id}/reorder",
            json={"items": [
                {"id": str(shot2.id), "sort_order": 0},
                {"id": str(shot1.id), "sort_order": 1},
            ]},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"

        # Verify new order
        list_resp = client.get(
            f"/api/shots/{project_id}",
            headers=mock_auth_headers,
        )
        shots = list_resp.json()
        assert shots[0]["id"] == str(shot2.id)
        assert shots[0]["sort_order"] == 0
        assert shots[1]["id"] == str(shot1.id)
        assert shots[1]["sort_order"] == 1

    def test_reorder_foreign_shot_403(self, client, db_session, mock_auth_headers):
        """POST reorder with shot from another project returns 403."""
        project1_id = _create_project_via_api(client, mock_auth_headers, title="Project 1")
        project2_id = _create_project_via_api(client, mock_auth_headers, title="Project 2")
        shot1 = _make_shot(db_session, project1_id)
        shot2 = _make_shot(db_session, project2_id)
        db_session.commit()

        resp = client.post(
            f"/api/shots/{project1_id}/reorder",
            json={"items": [
                {"id": str(shot1.id), "sort_order": 0},
                {"id": str(shot2.id), "sort_order": 1},  # foreign shot
            ]},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 403


# ============================================================
# TestCrossCutting
# ============================================================

class TestCrossCutting:
    def test_no_auth(self, client):
        """Request without auth header returns 401 or 403."""
        fake_uuid = str(uuid.uuid4())

        resp = client.get(f"/api/shots/{fake_uuid}")
        assert resp.status_code in (401, 403)

    def test_wrong_project_404(self, client, mock_auth_headers):
        """Request to nonexistent project returns 404."""
        fake_uuid = str(uuid.uuid4())

        resp = client.get(
            f"/api/shots/{fake_uuid}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# TestShotAIColumns
# ============================================================

class TestShotAIColumns:
    def test_create_shot_defaults_flags_false(self, client, mock_auth_headers):
        """New shot has user_modified=False and ai_generated=False by default."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        resp = client.post(f"/api/shots/{project_id}", json={}, headers=mock_auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["user_modified"] is False
        assert data["ai_generated"] is False

    def test_create_shot_ai_generated_flag(self, client, mock_auth_headers):
        """Creating a shot with ai_generated=True stores and returns True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        resp = client.post(
            f"/api/shots/{project_id}",
            json={"source": "ai", "ai_generated": True},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["ai_generated"] is True
        assert data["user_modified"] is False


# ============================================================
# TestUpdateShotUserModified
# ============================================================

class TestUpdateShotUserModified:
    def test_update_sets_user_modified(self, client, db_session, mock_auth_headers):
        """PUT update on a shot sets user_modified=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id, shot_number=1)
        db_session.commit()

        resp = client.put(
            f"/api/shots/{project_id}/{shot.id}",
            json={"fields": {"shot_size": "Close-Up"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_modified"] is True

    def test_update_ai_shot_sets_user_modified(self, client, db_session, mock_auth_headers):
        """PUT update on an AI-generated shot sets user_modified=True."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id, shot_number=1, source="ai")
        shot.ai_generated = True
        db_session.commit()

        resp = client.put(
            f"/api/shots/{project_id}/{shot.id}",
            json={"fields": {"description": "User edit"}},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_modified"] is True
        assert data["ai_generated"] is True

    def test_create_then_update_lifecycle(self, client, mock_auth_headers):
        """Full lifecycle: create AI shot (user_modified=False), update it (user_modified=True)."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        # Create AI shot
        create_resp = client.post(
            f"/api/shots/{project_id}",
            json={"source": "ai", "ai_generated": True},
            headers=mock_auth_headers,
        )
        assert create_resp.status_code == 201
        shot_id = create_resp.json()["id"]
        assert create_resp.json()["user_modified"] is False

        # Update it
        update_resp = client.put(
            f"/api/shots/{project_id}/{shot_id}",
            json={"fields": {"shot_size": "Medium"}},
            headers=mock_auth_headers,
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["user_modified"] is True
