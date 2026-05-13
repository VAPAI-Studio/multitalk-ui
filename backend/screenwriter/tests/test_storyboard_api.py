# backend/app/tests/test_storyboard_api.py

import io
import uuid

import pytest
from screenwriter.models.database import Shot, StoryboardFrame, Project

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _create_project_via_api(client, mock_auth_headers, title="Test Storyboard Project"):
    """Create a project through the API so owner_id is stored correctly for SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


def _make_shot(db_session, project_id):
    """Create a Shot directly in the DB with minimal fields."""
    shot = Shot(
        id=str(uuid.uuid4()),
        project_id=project_id,
        shot_number=1,
        fields={},
        sort_order=0,
        source="user",
    )
    db_session.add(shot)
    db_session.flush()
    return shot


def _make_frame(db_session, shot_id, file_path="/media/test/frame.png", is_selected=False):
    """Create a StoryboardFrame directly in the DB."""
    frame = StoryboardFrame(
        id=str(uuid.uuid4()),
        shot_id=str(shot_id),
        file_path=file_path,
        thumbnail_path=file_path,
        file_type="image",
        is_selected=is_selected,
        generation_source="user",
        generation_style=None,
    )
    db_session.add(frame)
    db_session.flush()
    return frame


class TestStoryboardAPI:

    def test_create_frame(self, client, db_session, mock_auth_headers):
        """POST multipart to /api/storyboard/{project_id}/shots/{shot_id}/frames creates a frame."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)

        fake_file = io.BytesIO(b"fakepng")
        resp = client.post(
            f"/api/storyboard/{project_id}/shots/{shot.id}/frames",
            files={"file": ("test.png", fake_file, "image/png")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"
        data = resp.json()
        assert "id" in data
        assert data["shot_id"] == str(shot.id)
        assert data["file_type"] == "image"
        assert data["is_selected"] is False
        assert data["generation_source"] == "user"

    def test_list_frames(self, client, db_session, mock_auth_headers):
        """GET /api/storyboard/{project_id}/shots/{shot_id}/frames returns all frames."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        _make_frame(db_session, shot.id, file_path="/media/test/frame1.png")
        _make_frame(db_session, shot.id, file_path="/media/test/frame2.png")
        db_session.commit()

        resp = client.get(
            f"/api/storyboard/{project_id}/shots/{shot.id}/frames",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.json()}"
        data = resp.json()
        assert len(data) == 2

    def test_update_selected(self, client, db_session, mock_auth_headers):
        """PATCH sets is_selected on target frame and deselects others."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        frame_a = _make_frame(db_session, shot.id, file_path="/media/test/a.png", is_selected=True)
        frame_b = _make_frame(db_session, shot.id, file_path="/media/test/b.png", is_selected=False)
        db_session.commit()

        resp = client.patch(
            f"/api/storyboard/{project_id}/frames/{frame_b.id}",
            json={"is_selected": True},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.json()}"
        assert resp.json()["is_selected"] is True

        # Verify frame_a is now deselected
        list_resp = client.get(
            f"/api/storyboard/{project_id}/shots/{shot.id}/frames",
            headers=mock_auth_headers,
        )
        frames = {f["id"]: f for f in list_resp.json()}
        assert frames[str(frame_a.id)]["is_selected"] is False
        assert frames[str(frame_b.id)]["is_selected"] is True

    def test_delete_frame(self, client, db_session, mock_auth_headers):
        """DELETE removes the frame from DB."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        frame = _make_frame(db_session, shot.id)
        db_session.commit()

        resp = client.delete(
            f"/api/storyboard/{project_id}/frames/{frame.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 204, f"Expected 204, got {resp.status_code}"

        # Frame is gone
        list_resp = client.get(
            f"/api/storyboard/{project_id}/shots/{shot.id}/frames",
            headers=mock_auth_headers,
        )
        assert list_resp.json() == []

    def test_selected_exclusivity(self, client, db_session, mock_auth_headers):
        """Setting is_selected on one frame deselects all others for the same shot."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        frame1 = _make_frame(db_session, shot.id, file_path="/media/test/f1.png")
        frame2 = _make_frame(db_session, shot.id, file_path="/media/test/f2.png")
        frame3 = _make_frame(db_session, shot.id, file_path="/media/test/f3.png")
        db_session.commit()

        # Select frame1
        client.patch(
            f"/api/storyboard/{project_id}/frames/{frame1.id}",
            json={"is_selected": True},
            headers=mock_auth_headers,
        )
        # Select frame2
        client.patch(
            f"/api/storyboard/{project_id}/frames/{frame2.id}",
            json={"is_selected": True},
            headers=mock_auth_headers,
        )

        list_resp = client.get(
            f"/api/storyboard/{project_id}/shots/{shot.id}/frames",
            headers=mock_auth_headers,
        )
        frames = {f["id"]: f for f in list_resp.json()}
        assert frames[str(frame1.id)]["is_selected"] is False
        assert frames[str(frame2.id)]["is_selected"] is True
        assert frames[str(frame3.id)]["is_selected"] is False

    def test_project_style(self, client, db_session, mock_auth_headers):
        """Project has storyboard_style column that can be set."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        project = db_session.query(Project).filter(Project.id == project_id).first()
        project.storyboard_style = "cinematic"
        db_session.flush()
        db_session.refresh(project)

        assert project.storyboard_style == "cinematic"

    def test_create_frame_wrong_project(self, client, db_session, mock_auth_headers):
        """POST frame referencing a shot from a different project returns 404."""
        project1_id = _create_project_via_api(client, mock_auth_headers, title="Project 1")
        project2_id = _create_project_via_api(client, mock_auth_headers, title="Project 2")
        shot = _make_shot(db_session, project1_id)
        db_session.commit()

        fake_file = io.BytesIO(b"fakepng")
        resp = client.post(
            f"/api/storyboard/{project2_id}/shots/{shot.id}/frames",
            files={"file": ("test.png", fake_file, "image/png")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.json()}"

    def test_generate_frame(self, client, db_session, mock_auth_headers, monkeypatch):
        """POST to generate endpoint creates an AI frame with auto-selection."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)

        # Set up shot and project for generation
        project = db_session.query(Project).filter(Project.id == project_id).first()
        project.storyboard_style = "cinematic"
        shot.fields = {
            "description": "A dark alley at night",
            "camera_angle": "Low Angle",
            "shot_size": "Wide",
        }
        shot.script_text = "INT. ALLEY - NIGHT. Rain pours down on the empty street."
        db_session.flush()

        # Monkeypatch to avoid real API call
        monkeypatch.setattr(
            "app.api.endpoints.storyboard.ImagenService.generate_image",
            lambda self, prompt: b"fake-png-bytes",
        )

        resp = client.post(
            f"/api/storyboard/{project_id}/shots/{shot.id}/generate",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"
        data = resp.json()
        assert data["generation_source"] == "ai"
        assert data["generation_style"] == "cinematic"
        assert data["is_selected"] is True  # Auto-selected: no prior frames
        assert "/storyboard/" in data["file_path"]
        assert data["file_path"].endswith(".png")

    def test_generate_frame_auto_select_false_when_existing(
        self, client, db_session, mock_auth_headers, monkeypatch
    ):
        """Generated frame is NOT auto-selected when an existing selected frame exists."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        shot = _make_shot(db_session, project_id)
        _make_frame(db_session, shot.id, file_path="/media/test/existing.png", is_selected=True)
        db_session.commit()

        monkeypatch.setattr(
            "app.api.endpoints.storyboard.ImagenService.generate_image",
            lambda self, prompt: b"fake-png-bytes",
        )

        resp = client.post(
            f"/api/storyboard/{project_id}/shots/{shot.id}/generate",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"
        assert resp.json()["is_selected"] is False  # Existing selected frame: no auto-select
