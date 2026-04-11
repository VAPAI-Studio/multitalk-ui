# backend/app/tests/test_shotlist_generation.py

"""
Tests for ShotlistGenerationService covering all Phase 26 requirements:
  AISG-01: POST /generate endpoint returns generated shots
  AISG-02: AI populates all standard shot fields
  AISG-03: Shots assigned to correct scene via scene_index mapping
  AISG-04: Shots ordered logically within each scene
  AISG-05: script_text populated from AI script_excerpt
  AISG-06: Regeneration preserves user_modified shots
"""

import uuid

import pytest
from unittest.mock import patch, AsyncMock
from screenwriter.models.database import Shot, PhaseData, ListItem, Project, ScreenplayContent
from screenwriter.services.shotlist_generation_service import (
    shotlist_generation_service,
    ShotlistGenerationResponse,
    GeneratedShot,
)


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_project_with_screenplay(db_session):
    """Create a project with screenplay content and 3 scenes.

    Returns (project_id, [scene_id_1, scene_id_2, scene_id_3]).
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

    # Create per-scene screenplay content with episode_index mapping
    scene_texts = [
        ("INT. CASTLE - NIGHT\nThe KNIGHT draws a MAGIC SWORD from the stone.", 0),
        ("EXT. FOREST - DAY\nThe KNIGHT rides through on a HORSE.", 1),
        ("INT. THRONE ROOM - DAY\nThe KNIGHT presents the MAGIC SWORD to the KING.", 2),
    ]
    for text, idx in scene_texts:
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content=text,
            formatted_content={"episode_index": idx, "title": f"Scene {idx + 1}", "content": text},
        )
        db_session.add(sc)
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

    scene_data = [
        {"summary": "Knight draws the magic sword", "arena": "INT. CASTLE - NIGHT", "goal": "Retrieve the sword"},
        {"summary": "Knight rides through the forest", "arena": "EXT. FOREST - DAY", "goal": "Reach the kingdom"},
        {"summary": "Knight presents sword to king", "arena": "INT. THRONE ROOM - DAY", "goal": "Gain the king's trust"},
    ]
    scene_item_ids = []
    for i, data in enumerate(scene_data):
        scene_id = str(uuid.uuid4())
        li = ListItem(
            id=scene_id,
            phase_data_id=str(scenes_pd.id),
            item_type="scene",
            content=data,
            sort_order=i,
        )
        db_session.add(li)
        scene_item_ids.append(scene_id)
    db_session.flush()

    db_session.commit()
    return project_id, scene_item_ids


def _create_project_via_api(client, mock_auth_headers, title="Test Project"):
    """Create a project through the API so owner_id is stored correctly for SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


# ============================================================
# TestGenerateEndpoint — AISG-01
# ============================================================

class TestGenerateEndpoint:
    """AISG-01: POST /generate endpoint returns generated shots."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_generate_returns_success(self, mock_ai, client, db_session, mock_auth_headers):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Castle exterior",
                action="Knight approaches", script_excerpt="The KNIGHT draws",
            ),
        ])
        resp = client.post(f"/api/shots/{project_id}/generate", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["shots_created"] == 1

    def test_generate_no_screenplay_returns_error(self, client, db_session, mock_auth_headers):
        """Project with no screenplay content returns error status."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        resp = client.post(f"/api/shots/{project_id}/generate", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "error"

    def test_generate_no_scenes_returns_error(self, client, db_session, mock_auth_headers):
        """Project with screenplay but no scenes returns error status."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        # Add screenplay content but no scenes
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. CASTLE - NIGHT\nSome screenplay content.",
        )
        db_session.add(sc)
        db_session.commit()

        resp = client.post(f"/api/shots/{project_id}/generate", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "error"
        assert "scenes" in data["message"].lower()

    def test_generate_nonexistent_project_404(self, client, mock_auth_headers):
        fake_id = str(uuid.uuid4())
        resp = client.post(f"/api/shots/{fake_id}/generate", headers=mock_auth_headers)
        assert resp.status_code == 404


# ============================================================
# TestFieldPopulation — AISG-02
# ============================================================

class TestFieldPopulation:
    """AISG-02: AI populates all standard shot fields."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_all_fields_populated(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Low Angle",
                camera_movement="Dolly In", description="Castle in moonlight",
                action="Knight enters frame",
                script_excerpt="The KNIGHT draws a MAGIC SWORD",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        assert result["status"] == "success"
        shot = db_session.query(Shot).filter(Shot.project_id == project_id).first()
        assert shot is not None
        assert shot.fields["shot_size"] == "Wide"
        assert shot.fields["camera_angle"] == "Low Angle"
        assert shot.fields["camera_movement"] == "Dolly In"
        assert shot.fields["description"] == "Castle in moonlight"
        assert shot.fields["action"] == "Knight enters frame"


# ============================================================
# TestSceneAssignment — AISG-03
# ============================================================

class TestSceneAssignment:
    """AISG-03: Shots assigned to correct scene via scene_index mapping."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_scene_assignment_correct(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Scene 1 shot",
                action="Action 1", script_excerpt="Excerpt 1",
            ),
            GeneratedShot(
                scene_index=3, shot_size="Close-Up", camera_angle="Eye Level",
                camera_movement="Static", description="Scene 3 shot",
                action="Action 3", script_excerpt="Excerpt 3",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        shots = db_session.query(Shot).filter(
            Shot.project_id == project_id
        ).all()
        scene_id_set = {s.scene_item_id for s in shots}
        assert scene_ids[0] in scene_id_set  # scene_index=1 -> scene_ids[0]
        assert scene_ids[2] in scene_id_set  # scene_index=3 -> scene_ids[2]

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_invalid_scene_index_skipped(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=99, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Bad index",
                action="Action", script_excerpt="Excerpt",
            ),
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Good index",
                action="Action", script_excerpt="Excerpt",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        shots = db_session.query(Shot).filter(Shot.project_id == project_id).all()
        assert len(shots) == 1  # Only the valid scene_index=1 shot was created


# ============================================================
# TestShotOrdering — AISG-04
# ============================================================

class TestShotOrdering:
    """AISG-04: Shots ordered logically within each scene."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_sort_order_sequential(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Establishing",
                action="Action 1", script_excerpt="Excerpt 1",
            ),
            GeneratedShot(
                scene_index=1, shot_size="Medium", camera_angle="Eye Level",
                camera_movement="Pan", description="Medium shot",
                action="Action 2", script_excerpt="Excerpt 2",
            ),
            GeneratedShot(
                scene_index=1, shot_size="Close-Up", camera_angle="Eye Level",
                camera_movement="Static", description="Detail",
                action="Action 3", script_excerpt="Excerpt 3",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        shots = db_session.query(Shot).filter(
            Shot.project_id == project_id,
            Shot.scene_item_id == scene_ids[0],
        ).order_by(Shot.sort_order).all()
        assert len(shots) == 3
        assert shots[0].sort_order == 0
        assert shots[1].sort_order == 1
        assert shots[2].sort_order == 2


# ============================================================
# TestScriptText — AISG-05
# ============================================================

class TestScriptText:
    """AISG-05: script_text populated from AI script_excerpt."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_script_text_from_excerpt(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="Castle",
                action="Knight enters",
                script_excerpt="The KNIGHT draws a MAGIC SWORD from the stone.",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        shot = db_session.query(Shot).filter(Shot.project_id == project_id).first()
        assert shot.script_text == "The KNIGHT draws a MAGIC SWORD from the stone."


# ============================================================
# TestSmartMerge — AISG-06
# ============================================================

class TestSmartMerge:
    """AISG-06: Regeneration preserves user_modified shots."""

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_regenerate_preserves_user_modified(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        # Pre-create a user-modified shot
        user_shot = Shot(
            id=str(uuid.uuid4()),
            project_id=project_id,
            scene_item_id=scene_ids[0],
            shot_number=1,
            fields={"description": "User's custom shot"},
            source="ai",
            ai_generated=True,
            user_modified=True,
            sort_order=0,
        )
        db_session.add(user_shot)
        # Pre-create an AI shot that should be deleted
        ai_shot = Shot(
            id=str(uuid.uuid4()),
            project_id=project_id,
            scene_item_id=scene_ids[0],
            shot_number=2,
            fields={"description": "Old AI shot"},
            source="ai",
            ai_generated=True,
            user_modified=False,
            sort_order=1,
        )
        db_session.add(ai_shot)
        db_session.commit()

        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="New AI shot",
                action="New action", script_excerpt="New excerpt",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )
        assert result["shots_preserved"] >= 1
        assert result["shots_deleted"] >= 1

        # Verify user_modified shot still exists
        remaining = db_session.query(Shot).filter(Shot.project_id == project_id).all()
        user_shots = [s for s in remaining if s.user_modified]
        assert len(user_shots) == 1
        assert user_shots[0].fields["description"] == "User's custom shot"

        # Verify old AI shot was deleted and new one created
        ai_shots = [s for s in remaining if s.ai_generated and not s.user_modified]
        assert len(ai_shots) == 1
        assert ai_shots[0].fields["description"] == "New AI shot"

    @patch("app.services.shotlist_generation_service.chat_completion_structured", new_callable=AsyncMock)
    def test_regenerate_preserves_manual_user_shots(self, mock_ai, db_session):
        project_id, scene_ids = _setup_project_with_screenplay(db_session)
        # Pre-create a manual user-created shot (not AI generated)
        manual_shot = Shot(
            id=str(uuid.uuid4()),
            project_id=project_id,
            scene_item_id=scene_ids[0],
            shot_number=1,
            fields={"description": "Manually created shot"},
            source="user",
            ai_generated=False,
            user_modified=False,
            sort_order=0,
        )
        db_session.add(manual_shot)
        db_session.commit()

        mock_ai.return_value = ShotlistGenerationResponse(shots=[
            GeneratedShot(
                scene_index=1, shot_size="Wide", camera_angle="Eye Level",
                camera_movement="Static", description="AI shot",
                action="Action", script_excerpt="Excerpt",
            ),
        ])
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            shotlist_generation_service.generate(db_session, project_id)
        )

        # Manual user shot should be preserved
        remaining = db_session.query(Shot).filter(Shot.project_id == project_id).all()
        manual_shots = [s for s in remaining if s.source == "user" and not s.ai_generated]
        assert len(manual_shots) == 1
        assert manual_shots[0].fields["description"] == "Manually created shot"
