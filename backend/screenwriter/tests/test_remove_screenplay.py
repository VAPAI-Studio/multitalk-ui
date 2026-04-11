"""Integration tests for remove-screenplay functionality (SCRP-01)."""

import uuid

import pytest

from screenwriter.models.database import (
    Project, PhaseData, ListItem, ScreenplayContent, ProjectSnapshot,
)
from screenwriter.services.snapshot_service import remove_screenplay_content


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_project_with_screenplay(db_session):
    """Create project with PhaseData, ListItems, and ScreenplayContent."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Remove Test")
    db_session.add(project)

    # Add scenes phase with list items
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

    # Add write phase with content
    pd_write = PhaseData(
        project_id=project_id, phase="write",
        subsection_key="screenplay", content={"text": "FADE IN..."},
    )
    db_session.add(pd_write)
    db_session.flush()

    # Add ScreenplayContent
    sc = ScreenplayContent(
        project_id=project_id, list_item_id=str(li.id),
        content="INT. OFFICE - DAY",
    )
    db_session.add(sc)
    db_session.flush()

    return project_id


def _setup_empty_project(db_session):
    """Create project with no ScreenplayContent."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Empty Test")
    db_session.add(project)
    db_session.flush()
    return project_id


class TestRemoveScreenplay:
    """Tests for remove_screenplay_content service function."""

    def test_remove_screenplay_creates_safety_snapshot(self, db_session):
        """Verify a safety snapshot with correct label is created before removal."""
        project_id = _setup_project_with_screenplay(db_session)

        result = remove_screenplay_content(db_session, project_id)

        # Check that a snapshot exists with the expected label
        snapshots = db_session.query(ProjectSnapshot).filter(
            ProjectSnapshot.project_id == project_id,
        ).all()
        assert len(snapshots) >= 1
        labels = [s.label for s in snapshots]
        assert "Before screenplay removal" in labels

        # Result should contain the snapshot ID
        assert result["safety_snapshot_id"] is not None

    def test_remove_screenplay_deletes_content(self, db_session):
        """Verify all ScreenplayContent rows are deleted."""
        project_id = _setup_project_with_screenplay(db_session)

        # Confirm ScreenplayContent exists before
        sc_before = db_session.query(ScreenplayContent).filter(
            ScreenplayContent.project_id == project_id,
        ).count()
        assert sc_before > 0

        result = remove_screenplay_content(db_session, project_id)

        # After removal, count should be 0
        sc_after = db_session.query(ScreenplayContent).filter(
            ScreenplayContent.project_id == project_id,
        ).count()
        assert sc_after == 0
        assert result["removed_screenplay_count"] == sc_before

    def test_remove_screenplay_clears_write_phase(self, db_session):
        """Verify write-phase PhaseData.content is cleared to empty dict."""
        project_id = _setup_project_with_screenplay(db_session)

        # Confirm write phase has content before
        pd_write_before = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "write",
        ).first()
        assert pd_write_before is not None
        assert pd_write_before.content != {}

        remove_screenplay_content(db_session, project_id)

        # Refresh to get updated values
        db_session.expire_all()
        pd_write_after = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "write",
        ).first()
        assert pd_write_after is not None
        assert pd_write_after.content == {}
        assert pd_write_after.ai_suggestions == {}

    def test_remove_screenplay_preserves_scene_list_items(self, db_session):
        """Verify scenes-phase ListItems survive the removal."""
        project_id = _setup_project_with_screenplay(db_session)

        # Count ListItems before
        scenes_pd = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "scenes",
        ).first()
        li_before = db_session.query(ListItem).filter(
            ListItem.phase_data_id == str(scenes_pd.id),
        ).count()
        assert li_before > 0

        remove_screenplay_content(db_session, project_id)

        # ListItems should still exist
        li_after = db_session.query(ListItem).filter(
            ListItem.phase_data_id == str(scenes_pd.id),
        ).count()
        assert li_after == li_before

    def test_remove_screenplay_sets_staleness(self, db_session):
        """Verify breakdown_stale and shotlist_stale are set to True."""
        project_id = _setup_project_with_screenplay(db_session)

        # Ensure flags start as False
        project = db_session.query(Project).filter(Project.id == project_id).first()
        project.breakdown_stale = False
        project.shotlist_stale = False
        db_session.flush()

        remove_screenplay_content(db_session, project_id)

        db_session.expire_all()
        project = db_session.query(Project).filter(Project.id == project_id).first()
        assert project.breakdown_stale is True
        assert project.shotlist_stale is True

    def test_remove_screenplay_empty_project(self, db_session):
        """Verify 200-equivalent with removed_count=0 on empty project."""
        project_id = _setup_empty_project(db_session)

        result = remove_screenplay_content(db_session, project_id)

        assert result["removed_screenplay_count"] == 0
        assert result["cleared_phase_data_count"] == 0
        # Safety snapshot should still be created
        assert result["safety_snapshot_id"] is not None
