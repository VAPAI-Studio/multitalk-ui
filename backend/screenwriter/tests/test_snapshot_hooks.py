"""Integration tests for auto-snapshot hooks on wizard apply and YOLO fill."""

import uuid
from unittest.mock import patch, AsyncMock

import pytest

from screenwriter.models.database import (
    Project, PhaseData, WizardRun, ProjectSnapshot, SnapshotTriggerType,
)

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _setup_project_with_wizard(db_session):
    """Create a project with PhaseData and a completed WizardRun for testing wizard apply."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Wizard Hook Test")
    db_session.add(project)

    pd = PhaseData(
        project_id=project_id, phase="scenes",
        subsection_key="scene_list", content={"title": "Act 1"},
    )
    db_session.add(pd)

    run_id = str(uuid.uuid4())
    wizard_run = WizardRun(
        id=run_id,
        project_id=project_id,
        phase="scenes",
        wizard_type="scene_wizard",
        status="completed",
        result={"scenes": [{"heading": "INT. OFFICE - DAY", "description": "A test scene"}]},
    )
    db_session.add(wizard_run)
    db_session.flush()

    return project_id, run_id


def test_wizard_apply_creates_auto_snapshot(client, db_session, mock_auth_headers):
    """Wizard apply should create an auto_wizard snapshot before writing changes."""
    project_id, run_id = _setup_project_with_wizard(db_session)

    resp = client.post(f"/api/wizards/{run_id}/apply", headers=mock_auth_headers)
    assert resp.status_code == 200, resp.text

    snapshots = db_session.query(ProjectSnapshot).filter(
        ProjectSnapshot.project_id == project_id,
        ProjectSnapshot.trigger_type == "auto_wizard",
    ).all()
    assert len(snapshots) == 1, f"Expected 1 auto_wizard snapshot, got {len(snapshots)}"


def test_wizard_apply_snapshot_has_correct_project(client, db_session, mock_auth_headers):
    """After wizard apply, the auto_wizard snapshot's project_id matches the wizard run's project."""
    project_id, run_id = _setup_project_with_wizard(db_session)

    client.post(f"/api/wizards/{run_id}/apply", headers=mock_auth_headers)

    snapshot = db_session.query(ProjectSnapshot).filter(
        ProjectSnapshot.project_id == project_id,
        ProjectSnapshot.trigger_type == "auto_wizard",
    ).first()
    assert snapshot is not None
    assert snapshot.project_id == project_id


def _setup_project_with_template(db_session):
    """Create a project with a template assigned for YOLO fill testing."""
    project_id = str(uuid.uuid4())
    project = Project(
        id=project_id, owner_id=MOCK_USER_ID,
        title="YOLO Hook Test", template="short_movie",
    )
    db_session.add(project)

    pd = PhaseData(
        project_id=project_id, phase="idea",
        subsection_key="idea_wizard", content={"genre": "drama"},
    )
    db_session.add(pd)
    db_session.flush()

    return project_id


def test_yolo_creates_single_snapshot(client, db_session, mock_auth_headers):
    """YOLO fill should create exactly 1 auto_yolo snapshot before streaming."""
    project_id = _setup_project_with_template(db_session)

    # Mock the AI service methods to avoid real AI calls during streaming.
    # The snapshot is created before streaming starts; we just need the
    # stream to complete quickly without hanging on network calls.
    with patch(
        "app.api.endpoints.ai_chat.template_ai_service.fill_blanks",
        new_callable=AsyncMock,
        return_value={"content": {}},
    ), patch(
        "app.api.endpoints.ai_chat.template_ai_service.wizard_generate",
        new_callable=AsyncMock,
        return_value={"scenes": []},
    ):
        resp = client.post(
            "/api/ai/yolo-fill",
            json={"project_id": project_id},
            headers=mock_auth_headers,
        )
        # StreamingResponse returns 200 even if individual AI steps fail
        assert resp.status_code == 200, resp.text

    snapshots = db_session.query(ProjectSnapshot).filter(
        ProjectSnapshot.project_id == project_id,
        ProjectSnapshot.trigger_type == "auto_yolo",
    ).all()
    assert len(snapshots) == 1, f"Expected 1 auto_yolo snapshot, got {len(snapshots)}"
