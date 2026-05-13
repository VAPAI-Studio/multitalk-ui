"""Tests for snapshot restore service and API endpoint (Phase 47)."""

import uuid

import pytest
from uuid import UUID

from screenwriter.models.database import (
    Project, PhaseData, ListItem, ScreenplayContent,
    ProjectSnapshot, SnapshotTriggerType, Shot,
)
from screenwriter.services.snapshot_service import create_snapshot, restore_from_snapshot


MOCK_USER_ID = str(uuid.uuid4())


def _setup_project_with_data(db_session):
    """Create a project with PhaseData, ListItems, and ScreenplayContent for testing."""
    project_id = str(uuid.uuid4())
    pd1_id = str(uuid.uuid4())
    pd2_id = str(uuid.uuid4())
    li1_id = str(uuid.uuid4())
    li2_id = str(uuid.uuid4())
    li3_id = str(uuid.uuid4())
    sc1_id = str(uuid.uuid4())
    sc2_id = str(uuid.uuid4())

    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Restore Test Film")
    db_session.add(project)

    pd1 = PhaseData(
        id=pd1_id, project_id=project_id, phase="scenes",
        subsection_key="scene_list", content={"title": "Act 1"}, sort_order=0,
    )
    pd2 = PhaseData(
        id=pd2_id, project_id=project_id, phase="write",
        subsection_key="script", content={"title": "Script"}, sort_order=1,
    )
    db_session.add_all([pd1, pd2])

    li1 = ListItem(
        id=li1_id, phase_data_id=pd1_id, item_type="scene",
        content={"heading": "INT. CASTLE - NIGHT"}, status="draft", sort_order=0,
    )
    li2 = ListItem(
        id=li2_id, phase_data_id=pd1_id, item_type="scene",
        content={"heading": "EXT. FOREST - DAY"}, status="complete", sort_order=1,
    )
    li3 = ListItem(
        id=li3_id, phase_data_id=pd2_id, item_type="section",
        content={"heading": "Opening"}, status="draft", sort_order=0,
    )
    db_session.add_all([li1, li2, li3])

    sc1 = ScreenplayContent(
        id=sc1_id, project_id=project_id, list_item_id=li1_id,
        content="The knight draws the sword.",
        formatted_content={"blocks": [{"type": "action"}]}, version=1,
    )
    sc2 = ScreenplayContent(
        id=sc2_id, project_id=project_id, list_item_id=None,
        content="FADE IN:", formatted_content={}, version=1,
    )
    db_session.add_all([sc1, sc2])
    db_session.flush()

    return (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id, sc1_id, sc2_id)


class TestRestoreService:
    """Unit tests for restore_from_snapshot() service function."""

    def test_restore_replaces_data(self, db_session):
        """Create project, snapshot, modify content, restore, verify rows match original."""
        (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
         sc1_id, sc2_id) = _setup_project_with_data(db_session)

        # Snapshot the original state
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify content after snapshot
        pd1 = db_session.query(PhaseData).filter(PhaseData.id == pd1_id).first()
        pd1.content = {"title": "MODIFIED Act 1"}
        li1 = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        li1.content = {"heading": "MODIFIED SCENE"}
        sc1 = db_session.query(ScreenplayContent).filter(ScreenplayContent.id == sc1_id).first()
        sc1.content = "MODIFIED screenplay text"
        db_session.flush()

        # Restore from snapshot
        result = restore_from_snapshot(db_session, project_id, snapshot)

        # Verify data restored to original
        pd1_restored = db_session.query(PhaseData).filter(PhaseData.id == pd1_id).first()
        assert pd1_restored.content == {"title": "Act 1"}

        li1_restored = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        assert li1_restored.content == {"heading": "INT. CASTLE - NIGHT"}

        sc1_restored = db_session.query(ScreenplayContent).filter(ScreenplayContent.id == sc1_id).first()
        assert sc1_restored.content == "The knight draws the sword."

        # Verify counts in result
        assert result["phase_data_count"] == 2
        assert result["list_item_count"] == 3
        assert result["screenplay_count"] == 2

    def test_restore_preserves_uuids(self, db_session):
        """After restore, ListItem IDs are identical to snapshot IDs (not new UUIDs)."""
        (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
         sc1_id, sc2_id) = _setup_project_with_data(db_session)

        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify some content
        li1 = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        li1.content = {"heading": "CHANGED"}
        db_session.flush()

        # Restore
        restore_from_snapshot(db_session, project_id, snapshot)

        # Verify UUIDs are the same
        li1_restored = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        assert li1_restored is not None
        assert str(li1_restored.id) == li1_id

        li2_restored = db_session.query(ListItem).filter(ListItem.id == li2_id).first()
        assert li2_restored is not None
        assert str(li2_restored.id) == li2_id

        li3_restored = db_session.query(ListItem).filter(ListItem.id == li3_id).first()
        assert li3_restored is not None
        assert str(li3_restored.id) == li3_id

    def test_safety_snapshot_created(self, db_session):
        """restore_from_snapshot() creates a ProjectSnapshot with trigger_type=pre_restore."""
        (project_id, *_) = _setup_project_with_data(db_session)

        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Count snapshots before restore
        before_count = db_session.query(ProjectSnapshot).filter(
            ProjectSnapshot.project_id == str(project_id)
        ).count()

        result = restore_from_snapshot(db_session, project_id, snapshot)

        # Count snapshots after restore
        after_count = db_session.query(ProjectSnapshot).filter(
            ProjectSnapshot.project_id == str(project_id)
        ).count()
        assert after_count == before_count + 1

        # Verify safety snapshot exists with correct trigger type
        safety = db_session.query(ProjectSnapshot).filter(
            ProjectSnapshot.id == str(result["safety_snapshot_id"])
        ).first()
        assert safety is not None
        assert safety.trigger_type in ("pre_restore", SnapshotTriggerType.PRE_RESTORE)
        assert safety.label == "Before restore"

    def test_restore_sets_staleness_flags(self, db_session):
        """After restore, project.breakdown_stale == True and project.shotlist_stale == True."""
        (project_id, *_) = _setup_project_with_data(db_session)

        # Ensure flags are initially false
        project = db_session.query(Project).filter(Project.id == project_id).first()
        project.breakdown_stale = False
        project.shotlist_stale = False
        db_session.flush()

        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)
        restore_from_snapshot(db_session, project_id, snapshot)

        # Refresh from DB
        db_session.expire(project)
        project = db_session.query(Project).filter(Project.id == project_id).first()
        assert project.breakdown_stale is True
        assert project.shotlist_stale is True

    def test_shot_survives_restore(self, db_session):
        """Shot with scene_item_id pointing to a ListItem survives restore cycle."""
        (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
         sc1_id, sc2_id) = _setup_project_with_data(db_session)

        # Create a Shot referencing li1
        shot_id = str(uuid.uuid4())
        shot = Shot(
            id=shot_id, project_id=project_id, scene_item_id=li1_id,
            shot_number=1, script_text="knight scene",
        )
        db_session.add(shot)
        db_session.flush()

        # Snapshot (includes the ListItem the shot references)
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify the ListItem content
        li1 = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        li1.content = {"heading": "MODIFIED SCENE HEADING"}
        db_session.flush()

        # Restore
        restore_from_snapshot(db_session, project_id, snapshot)

        # Shot still references the same ListItem
        shot_restored = db_session.query(Shot).filter(Shot.id == shot_id).first()
        assert shot_restored is not None
        assert str(shot_restored.scene_item_id) == li1_id

        # ListItem content is restored
        li1_restored = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        assert li1_restored.content == {"heading": "INT. CASTLE - NIGHT"}

    def test_restore_handles_added_and_removed_items(self, db_session):
        """Snapshot has 2 ListItems per phase; after adding extra, restore removes extras."""
        (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
         sc1_id, sc2_id) = _setup_project_with_data(db_session)

        # Snapshot original state (3 list items total)
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Add an extra ListItem after snapshot
        extra_li_id = str(uuid.uuid4())
        extra_li = ListItem(
            id=extra_li_id, phase_data_id=pd1_id, item_type="scene",
            content={"heading": "EXTRA SCENE"}, status="draft", sort_order=99,
        )
        db_session.add(extra_li)
        db_session.flush()

        # Verify we now have 4 list items
        current_count = db_session.query(ListItem).join(PhaseData).filter(
            PhaseData.project_id == project_id
        ).count()
        assert current_count == 4

        # Restore
        restore_from_snapshot(db_session, project_id, snapshot)

        # After restore, only 3 list items (the extra is deleted)
        restored_count = db_session.query(ListItem).join(PhaseData).filter(
            PhaseData.project_id == project_id
        ).count()
        assert restored_count == 3

        # The extra ListItem should not exist
        extra = db_session.query(ListItem).filter(ListItem.id == extra_li_id).first()
        assert extra is None

    def test_partial_restore_preserves_unselected_phases(self, db_session):
        """Partial restore with phase_ids=["scenes"] only restores scenes, leaves write untouched."""
        (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
         sc1_id, sc2_id) = _setup_project_with_data(db_session)

        # Snapshot original state
        snapshot = create_snapshot(db_session, project_id, SnapshotTriggerType.MANUAL)

        # Modify both phases after snapshot
        pd1 = db_session.query(PhaseData).filter(PhaseData.id == pd1_id).first()
        pd1.content = {"title": "MODIFIED Act 1"}
        li1 = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        li1.content = {"heading": "MODIFIED SCENE"}

        pd2 = db_session.query(PhaseData).filter(PhaseData.id == pd2_id).first()
        pd2.content = {"title": "MODIFIED Script"}
        li3 = db_session.query(ListItem).filter(ListItem.id == li3_id).first()
        li3.content = {"heading": "MODIFIED Opening"}
        db_session.flush()

        # Partial restore: only "scenes" phase
        result = restore_from_snapshot(
            db_session, project_id, snapshot, phase_ids=["scenes"]
        )

        # "scenes" phase should be restored
        pd1_restored = db_session.query(PhaseData).filter(PhaseData.id == pd1_id).first()
        assert pd1_restored.content == {"title": "Act 1"}
        li1_restored = db_session.query(ListItem).filter(ListItem.id == li1_id).first()
        assert li1_restored.content == {"heading": "INT. CASTLE - NIGHT"}

        # "write" phase should NOT be restored (still modified)
        pd2_after = db_session.query(PhaseData).filter(PhaseData.id == pd2_id).first()
        assert pd2_after.content == {"title": "MODIFIED Script"}
        li3_after = db_session.query(ListItem).filter(ListItem.id == li3_id).first()
        assert li3_after.content == {"heading": "MODIFIED Opening"}

        # Safety snapshot should still be created (full)
        assert "safety_snapshot_id" in result

        # Result counts reflect only the restored phase
        assert result["phase_data_count"] == 1


# Use the same MOCK_USER_ID as the mock auth service returns
API_MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_api_project(db_session):
    """Create a project owned by the mock auth user, with data for API tests."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=API_MOCK_USER_ID, title="API Restore Test")
    db_session.add(project)

    pd = PhaseData(
        project_id=project_id, phase="scenes",
        subsection_key="scene_list", content={"title": "Original"}, sort_order=0,
    )
    db_session.add(pd)
    db_session.flush()

    li = ListItem(
        phase_data_id=str(pd.id), item_type="scene",
        content={"heading": "INT. OFFICE - DAY"}, status="draft", sort_order=0,
    )
    db_session.add(li)
    db_session.flush()

    return project_id


class TestRestoreAPI:
    """API-level integration tests for POST /{snapshot_id}/restore endpoint."""

    def test_restore_api_endpoint(self, client, db_session, mock_auth_headers):
        """POST restore returns 200 with safety_snapshot_id and counts."""
        project_id = _setup_api_project(db_session)

        # Create snapshot via API
        resp = client.post(
            f"/api/projects/{project_id}/snapshots",
            json={"label": "Before changes"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201, resp.text
        snapshot_id = resp.json()["id"]

        # Modify data after snapshot
        pd = db_session.query(PhaseData).filter(PhaseData.project_id == project_id).first()
        pd.content = {"title": "MODIFIED"}
        db_session.flush()

        # Restore via API
        resp = client.post(
            f"/api/projects/{project_id}/snapshots/{snapshot_id}/restore",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert "safety_snapshot_id" in body
        assert body["restored_snapshot_id"] == snapshot_id
        assert body["phase_data_count"] == 1
        assert body["list_item_count"] == 1
        assert body["screenplay_count"] == 0

        # Verify data was actually restored
        db_session.expire_all()
        pd_restored = db_session.query(PhaseData).filter(PhaseData.project_id == project_id).first()
        assert pd_restored.content == {"title": "Original"}

    def test_restore_api_404_snapshot(self, client, db_session, mock_auth_headers):
        """POST restore with non-existent snapshot_id returns 404."""
        project_id = _setup_api_project(db_session)
        fake_snapshot_id = str(uuid.uuid4())

        resp = client.post(
            f"/api/projects/{project_id}/snapshots/{fake_snapshot_id}/restore",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_restore_api_404_project(self, client, db_session, mock_auth_headers):
        """POST restore with non-existent project_id returns 404."""
        fake_project_id = str(uuid.uuid4())
        fake_snapshot_id = str(uuid.uuid4())

        resp = client.post(
            f"/api/projects/{fake_project_id}/snapshots/{fake_snapshot_id}/restore",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404
