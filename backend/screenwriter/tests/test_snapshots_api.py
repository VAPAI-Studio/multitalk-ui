"""Integration tests for snapshot CRUD API endpoints."""

import uuid
import time

import pytest

from screenwriter.models.database import (
    Project, PhaseData, ListItem, ScreenplayContent,
    ProjectSnapshot, SnapshotTriggerType,
)
from screenwriter.services.snapshot_service import create_snapshot, restore_from_snapshot


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_project(db_session):
    """Create a minimal project with one PhaseData row for snapshot serialization."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Snapshot API Test")
    db_session.add(project)
    pd = PhaseData(
        project_id=project_id, phase="scenes",
        subsection_key="scene_list", content={"title": "Act 1"},
    )
    db_session.add(pd)
    db_session.flush()
    return project_id


def _create_snapshot_via_db(db_session, project_id, label=None):
    """Directly insert a snapshot row for test setup (bypasses API)."""
    from screenwriter.services.snapshot_service import create_snapshot
    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL, label=label,
    )
    db_session.flush()
    return snapshot


class TestSnapshotCRUD:
    """Tests for POST/GET/DELETE /api/projects/{project_id}/snapshots."""

    def test_create_manual_snapshot(self, client, db_session, mock_auth_headers):
        """POST with label returns 201, has metadata key, no data key."""
        project_id = _setup_project(db_session)
        resp = client.post(
            f"/api/projects/{project_id}/snapshots",
            json={"label": "My backup"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["label"] == "My backup"
        assert body["trigger_type"] == "manual"
        assert "metadata" in body
        assert "data" not in body

    def test_create_manual_snapshot_no_label(self, client, db_session, mock_auth_headers):
        """POST with empty body returns 201, label is None."""
        project_id = _setup_project(db_session)
        resp = client.post(
            f"/api/projects/{project_id}/snapshots",
            json={},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["label"] is None

    def test_create_snapshot_wrong_project(self, client, db_session, mock_auth_headers):
        """POST with non-existent project returns 404."""
        fake_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/projects/{fake_id}/snapshots",
            json={"label": "test"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_list_snapshots_paginated(self, client, db_session, mock_auth_headers):
        """Create 3 snapshots, page=1&per_page=2 returns total=3, 2 items, pages=2."""
        project_id = _setup_project(db_session)
        for i in range(3):
            _create_snapshot_via_db(db_session, project_id, label=f"snap-{i}")
        db_session.commit()

        resp = client.get(
            f"/api/projects/{project_id}/snapshots?page=1&per_page=2",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 3
        assert len(body["items"]) == 2
        assert body["pages"] == 2

    def test_list_snapshots_empty(self, client, db_session, mock_auth_headers):
        """GET on project with no snapshots returns 200, total=0, items=[]."""
        project_id = _setup_project(db_session)
        resp = client.get(
            f"/api/projects/{project_id}/snapshots",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 0
        assert body["items"] == []

    def test_list_snapshots_order(self, client, db_session, mock_auth_headers):
        """Create A then B; GET returns B first (desc by created_at)."""
        from datetime import datetime, timedelta
        project_id = _setup_project(db_session)
        snap_a = _create_snapshot_via_db(db_session, project_id, label="A")
        snap_a.created_at = datetime(2025, 1, 1, 0, 0, 0)
        snap_b = _create_snapshot_via_db(db_session, project_id, label="B")
        snap_b.created_at = datetime(2025, 1, 2, 0, 0, 0)
        db_session.commit()

        resp = client.get(
            f"/api/projects/{project_id}/snapshots",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert len(items) == 2
        assert items[0]["label"] == "B"
        assert items[1]["label"] == "A"

    def test_delete_snapshot(self, client, db_session, mock_auth_headers):
        """DELETE returns 204, subsequent list shows total=0."""
        project_id = _setup_project(db_session)
        snapshot = _create_snapshot_via_db(db_session, project_id, label="to-delete")
        db_session.commit()
        snapshot_id = str(snapshot.id)

        resp = client.delete(
            f"/api/projects/{project_id}/snapshots/{snapshot_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 204

        # Verify it's gone
        list_resp = client.get(
            f"/api/projects/{project_id}/snapshots",
            headers=mock_auth_headers,
        )
        assert list_resp.json()["total"] == 0

    def test_delete_snapshot_not_found(self, client, db_session, mock_auth_headers):
        """DELETE with non-existent snapshot_id returns 404."""
        project_id = _setup_project(db_session)
        fake_id = str(uuid.uuid4())
        resp = client.delete(
            f"/api/projects/{project_id}/snapshots/{fake_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_delete_snapshot_wrong_project(self, client, db_session, mock_auth_headers):
        """DELETE with mismatched project_id returns 404."""
        project_id = _setup_project(db_session)
        snapshot = _create_snapshot_via_db(db_session, project_id, label="owned")
        db_session.commit()
        snapshot_id = str(snapshot.id)

        # Different project
        other_project_id = str(uuid.uuid4())
        other_project = Project(
            id=other_project_id, owner_id=MOCK_USER_ID, title="Other"
        )
        db_session.add(other_project)
        db_session.flush()

        resp = client.delete(
            f"/api/projects/{other_project_id}/snapshots/{snapshot_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


def _setup_project_with_phases(db_session):
    """Create a project with two phases (idea and story) each having a ListItem."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Multi-phase Test")
    db_session.add(project)

    pd_idea_id = str(uuid.uuid4())
    pd_story_id = str(uuid.uuid4())
    li_idea_id = str(uuid.uuid4())
    li_story_id = str(uuid.uuid4())

    pd_idea = PhaseData(
        id=pd_idea_id, project_id=project_id, phase="idea",
        subsection_key="concept", content={"text": "Original idea"}, sort_order=0,
    )
    pd_story = PhaseData(
        id=pd_story_id, project_id=project_id, phase="story",
        subsection_key="outline", content={"text": "Original story"}, sort_order=1,
    )
    db_session.add_all([pd_idea, pd_story])

    li_idea = ListItem(
        id=li_idea_id, phase_data_id=pd_idea_id, item_type="item",
        content={"heading": "Idea item"}, status="draft", sort_order=0,
    )
    li_story = ListItem(
        id=li_story_id, phase_data_id=pd_story_id, item_type="item",
        content={"heading": "Story item"}, status="draft", sort_order=0,
    )
    db_session.add_all([li_idea, li_story])
    db_session.flush()
    return project_id, pd_idea_id, pd_story_id, li_idea_id, li_story_id


class TestGetSnapshot:
    """Tests for GET single snapshot endpoint (HIST-02)."""

    def test_get_snapshot_returns_data_blob(self, db_session):
        """GET snapshot returns full snapshot with data blob containing version and phase_data."""
        project_id = _setup_project(db_session)
        snapshot = _create_snapshot_via_db(db_session, project_id, label="preview-test")
        db_session.flush()

        # Verify the snapshot has data with version and phase_data keys
        from sqlalchemy.orm import undefer
        loaded = db_session.query(ProjectSnapshot).options(
            undefer(ProjectSnapshot.data)
        ).filter(ProjectSnapshot.id == str(snapshot.id)).first()

        assert loaded is not None
        assert loaded.data is not None
        assert "version" in loaded.data
        assert "phase_data" in loaded.data
        assert loaded.data["version"] == 1
        assert len(loaded.data["phase_data"]) == 1  # one PhaseData row from _setup_project

        # Validate via SnapshotDetailResponse schema
        from screenwriter.models.schemas import SnapshotDetailResponse
        detail = SnapshotDetailResponse.model_validate(loaded)
        assert detail.id is not None
        assert detail.label == "preview-test"
        assert detail.trigger_type in ("manual", "SnapshotTriggerType.MANUAL")
        assert detail.data is not None
        assert detail.data["version"] == 1
        assert "phase_data" in detail.data

    def test_get_snapshot_not_found(self, db_session):
        """Query for non-existent snapshot returns None."""
        fake_id = str(uuid.uuid4())
        result = db_session.query(ProjectSnapshot).filter(
            ProjectSnapshot.id == fake_id
        ).first()
        assert result is None


class TestPartialRestore:
    """Tests for partial restore with phase_ids (REST-04)."""

    def test_restore_with_phase_ids_partial(self, db_session):
        """Partial restore only affects the selected phase, leaves other untouched."""
        (project_id, pd_idea_id, pd_story_id,
         li_idea_id, li_story_id) = _setup_project_with_phases(db_session)

        # Snapshot the original state
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify both phases after snapshot
        pd_idea = db_session.query(PhaseData).filter(PhaseData.id == pd_idea_id).first()
        pd_idea.content = {"text": "MODIFIED idea"}
        pd_story = db_session.query(PhaseData).filter(PhaseData.id == pd_story_id).first()
        pd_story.content = {"text": "MODIFIED story"}
        db_session.flush()

        # Restore ONLY the "idea" phase
        result = restore_from_snapshot(db_session, project_id, snapshot, phase_ids=["idea"])

        # "idea" phase should be restored to original
        pd_idea_restored = db_session.query(PhaseData).filter(PhaseData.id == pd_idea_id).first()
        assert pd_idea_restored.content == {"text": "Original idea"}

        # "story" phase should still have the modified data
        pd_story_after = db_session.query(PhaseData).filter(PhaseData.id == pd_story_id).first()
        assert pd_story_after.content == {"text": "MODIFIED story"}

        # Result should reflect only the restored phase counts
        assert result["phase_data_count"] == 1

    def test_restore_without_phase_ids_full(self, db_session):
        """Full restore (no body/no phase_ids) still works -- backward compatible."""
        (project_id, pd_idea_id, pd_story_id,
         li_idea_id, li_story_id) = _setup_project_with_phases(db_session)

        # Snapshot the original state
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify both phases
        pd_idea = db_session.query(PhaseData).filter(PhaseData.id == pd_idea_id).first()
        pd_idea.content = {"text": "MODIFIED idea"}
        pd_story = db_session.query(PhaseData).filter(PhaseData.id == pd_story_id).first()
        pd_story.content = {"text": "MODIFIED story"}
        db_session.flush()

        # Full restore (no phase_ids)
        result = restore_from_snapshot(db_session, project_id, snapshot)

        # Both phases should be restored
        pd_idea_restored = db_session.query(PhaseData).filter(PhaseData.id == pd_idea_id).first()
        assert pd_idea_restored.content == {"text": "Original idea"}

        pd_story_restored = db_session.query(PhaseData).filter(PhaseData.id == pd_story_id).first()
        assert pd_story_restored.content == {"text": "Original story"}

        # Full restore returns both phases
        assert result["phase_data_count"] == 2


def _setup_project_with_screenplay(db_session):
    """Create project with PhaseData, ListItems, and ScreenplayContent for API tests."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Current State Test")
    db_session.add(project)

    pd_scenes = PhaseData(
        project_id=project_id, phase="scenes",
        subsection_key="scene_list", content={"title": "Act 1"},
    )
    db_session.add(pd_scenes)
    db_session.flush()

    li = ListItem(
        phase_data_id=str(pd_scenes.id), item_type="scene",
        content={"heading": "INT. OFFICE"},
    )
    db_session.add(li)
    db_session.flush()

    sc = ScreenplayContent(
        project_id=project_id, list_item_id=str(li.id),
        content="INT. OFFICE - DAY",
    )
    db_session.add(sc)
    db_session.flush()
    return project_id


class TestCurrentState:
    """Tests for current-state serialization logic (COMP-01).

    Uses db_session directly (same pattern as TestGetSnapshot/TestPartialRestore)
    to avoid startup event requiring PostgreSQL connection.
    """

    def test_current_state_returns_snapshot_format(self, db_session):
        """Current state serialization produces version, phase_data list, screenplay_content list."""
        from sqlalchemy.orm import joinedload
        from screenwriter.services.snapshot_service import _serialize_phase_data, _serialize_screenplay_content

        project_id = _setup_project_with_screenplay(db_session)

        phase_data_rows = (
            db_session.query(PhaseData)
            .options(joinedload(PhaseData.list_items))
            .filter(PhaseData.project_id == project_id)
            .all()
        )
        screenplay_rows = (
            db_session.query(ScreenplayContent)
            .filter(ScreenplayContent.project_id == project_id)
            .all()
        )
        data = {
            "version": 1,
            "phase_data": [_serialize_phase_data(pd) for pd in phase_data_rows],
            "screenplay_content": [_serialize_screenplay_content(sc) for sc in screenplay_rows],
        }

        assert data["version"] == 1
        assert isinstance(data["phase_data"], list)
        assert isinstance(data["screenplay_content"], list)
        assert len(data["phase_data"]) >= 1
        assert len(data["screenplay_content"]) >= 1

    def test_current_state_matches_snapshot_data(self, db_session):
        """Current state data structure matches what create_snapshot produces."""
        from sqlalchemy.orm import joinedload
        from screenwriter.services.snapshot_service import _serialize_phase_data, _serialize_screenplay_content

        project_id = _setup_project_with_screenplay(db_session)

        # Create a snapshot for comparison
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)
        db_session.flush()

        # Serialize current state the same way the endpoint does
        phase_data_rows = (
            db_session.query(PhaseData)
            .options(joinedload(PhaseData.list_items))
            .filter(PhaseData.project_id == project_id)
            .all()
        )
        screenplay_rows = (
            db_session.query(ScreenplayContent)
            .filter(ScreenplayContent.project_id == project_id)
            .all()
        )
        current = {
            "version": 1,
            "phase_data": [_serialize_phase_data(pd) for pd in phase_data_rows],
            "screenplay_content": [_serialize_screenplay_content(sc) for sc in screenplay_rows],
        }

        # Both should have the same number of entries
        assert len(current["phase_data"]) == len(snapshot.data["phase_data"])
        assert len(current["screenplay_content"]) == len(snapshot.data["screenplay_content"])
        assert current["version"] == snapshot.data["version"]

    def test_current_state_empty_project(self, db_session):
        """Current state for project with no data returns empty lists."""
        from sqlalchemy.orm import joinedload
        from screenwriter.services.snapshot_service import _serialize_phase_data, _serialize_screenplay_content

        project_id = str(uuid.uuid4())
        project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Empty")
        db_session.add(project)
        db_session.flush()

        phase_data_rows = (
            db_session.query(PhaseData)
            .options(joinedload(PhaseData.list_items))
            .filter(PhaseData.project_id == project_id)
            .all()
        )
        screenplay_rows = (
            db_session.query(ScreenplayContent)
            .filter(ScreenplayContent.project_id == project_id)
            .all()
        )
        data = {
            "version": 1,
            "phase_data": [_serialize_phase_data(pd) for pd in phase_data_rows],
            "screenplay_content": [_serialize_screenplay_content(sc) for sc in screenplay_rows],
        }

        assert data["phase_data"] == []
        assert data["screenplay_content"] == []


class TestRemoveScreenplay:
    """Tests for remove-screenplay service logic (SCRP-01).

    Uses db_session directly to test the service function that the endpoint calls.
    """

    def test_remove_screenplay_via_service(self, db_session):
        """remove_screenplay_content returns safety_snapshot_id and correct counts."""
        from screenwriter.services.snapshot_service import remove_screenplay_content

        project_id = _setup_project_with_screenplay(db_session)

        result = remove_screenplay_content(db_session, project_id)

        assert "safety_snapshot_id" in result
        assert result["removed_screenplay_count"] >= 1
        assert "cleared_phase_data_count" in result

        # Verify ScreenplayContent actually deleted
        sc_count = db_session.query(ScreenplayContent).filter(
            ScreenplayContent.project_id == project_id,
        ).count()
        assert sc_count == 0

    def test_remove_screenplay_nonexistent_project(self, db_session):
        """remove_screenplay_content on non-existent project returns 0 counts (no crash)."""
        from screenwriter.services.snapshot_service import remove_screenplay_content

        fake_id = str(uuid.uuid4())
        # Service won't find any rows but shouldn't crash
        # Note: The endpoint layer handles 404 via _verify_project_ownership
        result = remove_screenplay_content(db_session, fake_id)
        assert result["removed_screenplay_count"] == 0
        assert result["cleared_phase_data_count"] == 0
