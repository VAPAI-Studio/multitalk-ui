import uuid

import pytest
from uuid import UUID

from screenwriter.models.database import (
    Project, PhaseData, ListItem, ScreenplayContent,
    ProjectSnapshot, SnapshotTriggerType,
)
from screenwriter.services.snapshot_service import create_snapshot, deserialize_snapshot


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

    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Snapshot Test Film")
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


def test_create_snapshot_manual(db_session):
    """Snapshot saved with trigger_type='manual', correct label, correct metadata counts."""
    project_id, *_ = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL, label="My backup"
    )

    assert snapshot.label == "My backup"
    assert snapshot.trigger_type in ("manual", SnapshotTriggerType.MANUAL)
    assert snapshot.data["version"] == 1
    assert len(snapshot.data["phase_data"]) == 2
    assert len(snapshot.data["screenplay_content"]) == 2
    assert snapshot.metadata_["phase_data_count"] == 2
    assert snapshot.metadata_["list_item_count"] == 3
    assert snapshot.metadata_["screenplay_count"] == 2
    assert snapshot.metadata_["blob_bytes"] > 0


def test_create_snapshot_auto_wizard(db_session):
    """AUTO_WIZARD trigger type stored correctly, label is None."""
    project_id, *_ = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.AUTO_WIZARD
    )

    assert snapshot.trigger_type in ("auto_wizard", SnapshotTriggerType.AUTO_WIZARD)
    assert snapshot.label is None


def test_create_snapshot_auto_yolo(db_session):
    """AUTO_YOLO trigger type stored correctly."""
    project_id, *_ = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.AUTO_YOLO
    )

    assert snapshot.trigger_type in ("auto_yolo", SnapshotTriggerType.AUTO_YOLO)


def test_round_trip_fidelity(db_session):
    """Every field matches after serialize->deserialize cycle."""
    (project_id, pd1_id, pd2_id, li1_id, li2_id, li3_id,
     sc1_id, sc2_id) = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL, label="Fidelity test"
    )
    deserialized = deserialize_snapshot(snapshot)

    assert deserialized["version"] == 1

    # Sort phase_data by sort_order for predictable comparison
    pd_entries = sorted(deserialized["phase_data"], key=lambda x: x["sort_order"])
    assert len(pd_entries) == 2

    # First PhaseData (scenes)
    assert pd_entries[0]["id"] == UUID(pd1_id)
    assert pd_entries[0]["project_id"] == UUID(project_id)
    assert pd_entries[0]["phase"] == "scenes"
    assert pd_entries[0]["subsection_key"] == "scene_list"
    assert pd_entries[0]["content"] == {"title": "Act 1"}
    assert pd_entries[0]["ai_suggestions"] == {}
    assert pd_entries[0]["sort_order"] == 0

    # ListItems for first PhaseData
    lis = sorted(pd_entries[0]["list_items"], key=lambda x: x["sort_order"])
    assert len(lis) == 2
    assert lis[0]["id"] == UUID(li1_id)
    assert lis[0]["phase_data_id"] == UUID(pd1_id)
    assert lis[0]["item_type"] == "scene"
    assert lis[0]["content"] == {"heading": "INT. CASTLE - NIGHT"}
    assert lis[0]["status"] == "draft"
    assert lis[1]["id"] == UUID(li2_id)
    assert lis[1]["content"] == {"heading": "EXT. FOREST - DAY"}
    assert lis[1]["status"] == "complete"

    # Second PhaseData (write/script)
    assert pd_entries[1]["id"] == UUID(pd2_id)
    assert pd_entries[1]["phase"] == "write"
    assert pd_entries[1]["subsection_key"] == "script"

    # ListItems for second PhaseData
    lis2 = pd_entries[1]["list_items"]
    assert len(lis2) == 1
    assert lis2[0]["id"] == UUID(li3_id)
    assert lis2[0]["item_type"] == "section"
    assert lis2[0]["content"] == {"heading": "Opening"}

    # ScreenplayContent
    sc_entries = sorted(deserialized["screenplay_content"], key=lambda x: x["content"])
    assert len(sc_entries) == 2

    # "FADE IN:" entry (list_item_id=None)
    fade_in = sc_entries[0]
    assert fade_in["id"] == UUID(sc2_id)
    assert fade_in["project_id"] == UUID(project_id)
    assert fade_in["list_item_id"] is None
    assert fade_in["content"] == "FADE IN:"
    assert fade_in["formatted_content"] == {}
    assert fade_in["version"] == 1

    # "The knight draws the sword." entry
    knight = sc_entries[1]
    assert knight["id"] == UUID(sc1_id)
    assert knight["project_id"] == UUID(project_id)
    assert knight["list_item_id"] == UUID(li1_id)
    assert knight["content"] == "The knight draws the sword."
    assert knight["formatted_content"] == {"blocks": [{"type": "action"}]}
    assert knight["version"] == 1


def test_round_trip_preserves_uuids(db_session):
    """Deserialized IDs are UUID objects, not strings."""
    project_id, *_ = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL
    )
    deserialized = deserialize_snapshot(snapshot)

    assert isinstance(deserialized["phase_data"][0]["id"], UUID)
    assert isinstance(deserialized["phase_data"][0]["project_id"], UUID)
    assert isinstance(deserialized["phase_data"][0]["list_items"][0]["id"], UUID)
    assert isinstance(deserialized["phase_data"][0]["list_items"][0]["phase_data_id"], UUID)
    assert isinstance(deserialized["screenplay_content"][0]["id"], UUID)
    assert isinstance(deserialized["screenplay_content"][0]["project_id"], UUID)


def test_snapshot_with_null_list_item_id(db_session):
    """None preserved through round-trip, not 'None' string."""
    project_id, *_ = _setup_project_with_data(db_session)

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL
    )
    deserialized = deserialize_snapshot(snapshot)

    # Find the ScreenplayContent with content="FADE IN:" which has list_item_id=None
    fade_in = next(
        sc for sc in deserialized["screenplay_content"]
        if sc["content"] == "FADE IN:"
    )
    assert fade_in["list_item_id"] is None


def test_empty_project_snapshot(db_session):
    """Empty project produces valid snapshot with zero counts."""
    project_id = str(uuid.uuid4())
    project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Empty Project")
    db_session.add(project)
    db_session.flush()

    snapshot = create_snapshot(
        db_session, project_id, SnapshotTriggerType.MANUAL, label="Empty"
    )

    assert snapshot.metadata_["phase_data_count"] == 0
    assert snapshot.metadata_["list_item_count"] == 0
    assert snapshot.metadata_["screenplay_count"] == 0
    assert snapshot.data["phase_data"] == []
    assert snapshot.data["screenplay_content"] == []
    assert snapshot.data["version"] == 1
