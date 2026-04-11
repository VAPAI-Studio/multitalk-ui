"""Tests for Shot, ShotElement, AssetMedia ORM models and Pydantic schemas.
Covers DATA-01 through DATA-06: shotlist data layer.
"""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from screenwriter.models.database import (
    Base,
    Shot,
    ShotElement,
    AssetMedia,
    Project,
    PhaseData,
    ListItem,
    BreakdownElement,
)


# ============================================================
# Model importability and metadata tests
# ============================================================

def test_shot_importable():
    """Shot ORM model is importable and mapped to correct table."""
    assert Shot.__tablename__ == "shots"


def test_shot_element_importable():
    """ShotElement ORM model is importable and mapped to correct table."""
    assert ShotElement.__tablename__ == "shot_elements"


def test_asset_media_importable():
    """AssetMedia ORM model is importable and mapped to correct table."""
    assert AssetMedia.__tablename__ == "asset_media"


def test_tables_in_metadata():
    """All 3 new tables appear in Base.metadata.tables."""
    tables = Base.metadata.tables
    assert "shots" in tables
    assert "shot_elements" in tables
    assert "asset_media" in tables


# ============================================================
# Project model updates
# ============================================================

def test_project_shotlist_stale(db_session):
    """New Project instance has shotlist_stale defaulting to False."""
    project = Project(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        title="Test Shotlist Stale",
    )
    db_session.add(project)
    db_session.flush()
    db_session.refresh(project)

    assert project.shotlist_stale is False


# ============================================================
# ORM round-trip and relationship tests
# ============================================================

def test_shot_orm_roundtrip(db_session):
    """Create Shot with fields JSONB and script_range JSONB, verify all fields survive commit+refresh."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Shot Roundtrip")
    db_session.add(project)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=3,
        script_text="INT. DINER - NIGHT",
        script_range={"scene_index": 2, "start_offset": 100, "end_offset": 200},
        fields={"angle": "wide", "movement": "dolly", "lens": "35mm"},
        sort_order=5,
        source="ai",
    )
    db_session.add(shot)
    db_session.commit()
    db_session.refresh(shot)

    assert shot.shot_number == 3
    assert shot.script_text == "INT. DINER - NIGHT"
    assert shot.script_range["scene_index"] == 2
    assert shot.script_range["start_offset"] == 100
    assert shot.fields["angle"] == "wide"
    assert shot.fields["movement"] == "dolly"
    assert shot.sort_order == 5
    assert shot.source == "ai"


def test_shot_scene_set_null(db_session):
    """Delete a ListItem that a Shot references via scene_item_id, verify shot.scene_item_id becomes None.

    Note: SQLite doesn't enforce ON DELETE SET NULL natively, so this test uses
    raw SQL DELETE + PRAGMA foreign_keys=ON to simulate PostgreSQL behavior.
    The ORM model correctly specifies ondelete='SET NULL' for PostgreSQL.
    """
    from sqlalchemy import text

    # Enable foreign key enforcement for this test (SQLite requires explicit opt-in)
    db_session.execute(text("PRAGMA foreign_keys=ON"))

    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="SET NULL Test")
    db_session.add(project)
    db_session.flush()

    phase_data = PhaseData(
        id=uuid.uuid4(),
        project_id=project.id,
        phase="scenes",
        subsection_key="scene_list",
    )
    db_session.add(phase_data)
    db_session.flush()

    list_item = ListItem(
        id=uuid.uuid4(),
        phase_data_id=phase_data.id,
        item_type="scene",
    )
    db_session.add(list_item)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        scene_item_id=list_item.id,
        shot_number=1,
    )
    db_session.add(shot)
    db_session.commit()
    db_session.refresh(shot)

    shot_id = shot.id
    assert shot.scene_item_id == list_item.id

    # Use raw SQL to delete the list_item so SQLite enforces ON DELETE SET NULL
    # (ORM delete would not trigger database-level FK actions in SQLite)
    db_session.expunge(shot)
    db_session.execute(text("DELETE FROM list_items WHERE id = :id"), {"id": str(list_item.id)})
    db_session.commit()

    # Re-query the shot to see if scene_item_id was set to NULL
    reloaded_shot = db_session.query(Shot).filter_by(id=shot_id).one()
    assert reloaded_shot.scene_item_id is None


def test_shot_cascade_delete(db_session):
    """Delete a Shot, verify its ShotElement junction rows are also deleted."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Shot Cascade Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="prop",
        name="Revolver Shot Cascade",
    )
    db_session.add(elem)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=1,
    )
    db_session.add(shot)
    db_session.flush()

    se = ShotElement(
        id=uuid.uuid4(),
        shot_id=shot.id,
        element_id=elem.id,
    )
    db_session.add(se)
    db_session.commit()

    # Verify shot element exists
    assert db_session.query(ShotElement).filter_by(shot_id=shot.id).count() == 1

    # Delete shot -- cascade should remove shot_elements
    db_session.delete(shot)
    db_session.commit()

    assert db_session.query(ShotElement).filter_by(shot_id=shot.id).count() == 0


def test_shot_element_unique(db_session):
    """Two ShotElements with same (shot_id, element_id) raise IntegrityError."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="SE Unique Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="character",
        name="Jane Doe SE Unique",
    )
    db_session.add(elem)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=1,
    )
    db_session.add(shot)
    db_session.flush()

    se1 = ShotElement(id=uuid.uuid4(), shot_id=shot.id, element_id=elem.id)
    db_session.add(se1)
    db_session.flush()

    se2 = ShotElement(id=uuid.uuid4(), shot_id=shot.id, element_id=elem.id)
    db_session.add(se2)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_asset_media_orm_roundtrip(db_session):
    """Create AssetMedia with metadata_ alias, verify fields survive round-trip."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="AssetMedia Roundtrip")
    db_session.add(project)
    db_session.flush()

    media = AssetMedia(
        id=uuid.uuid4(),
        project_id=project.id,
        file_type="image",
        file_path="/media/test.jpg",
        original_filename="test.jpg",
        file_size_bytes=1024000,
        metadata_={"width": 1920, "height": 1080},
    )
    db_session.add(media)
    db_session.commit()
    db_session.refresh(media)

    assert media.file_type == "image"
    assert media.file_path == "/media/test.jpg"
    assert media.original_filename == "test.jpg"
    assert media.file_size_bytes == 1024000
    assert media.metadata_["width"] == 1920
    assert media.metadata_["height"] == 1080
    assert media.thumbnail_path is None


def test_asset_media_dual_fk(db_session):
    """AssetMedia can be created with element_id only, shot_id only, or both."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Dual FK Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="location",
        name="Beach Dual FK",
    )
    db_session.add(elem)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=1,
    )
    db_session.add(shot)
    db_session.flush()

    # element_id only
    m1 = AssetMedia(
        id=uuid.uuid4(),
        project_id=project.id,
        element_id=elem.id,
        file_type="image",
        file_path="/media/m1.jpg",
        original_filename="m1.jpg",
        file_size_bytes=500,
    )
    db_session.add(m1)
    db_session.flush()
    assert m1.element_id == elem.id
    assert m1.shot_id is None

    # shot_id only
    m2 = AssetMedia(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_id=shot.id,
        file_type="audio",
        file_path="/media/m2.wav",
        original_filename="m2.wav",
        file_size_bytes=800,
    )
    db_session.add(m2)
    db_session.flush()
    assert m2.shot_id == shot.id
    assert m2.element_id is None

    # both
    m3 = AssetMedia(
        id=uuid.uuid4(),
        project_id=project.id,
        element_id=elem.id,
        shot_id=shot.id,
        file_type="image",
        file_path="/media/m3.png",
        original_filename="m3.png",
        file_size_bytes=1200,
    )
    db_session.add(m3)
    db_session.commit()
    db_session.refresh(m3)
    assert m3.element_id == elem.id
    assert m3.shot_id == shot.id


def test_project_cascade_to_shots(db_session):
    """Delete Project, verify its Shots are deleted."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Project Cascade Shots")
    db_session.add(project)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=1,
    )
    db_session.add(shot)
    db_session.commit()

    assert db_session.query(Shot).filter_by(project_id=project.id).count() == 1

    db_session.delete(project)
    db_session.commit()

    assert db_session.query(Shot).filter_by(project_id=project.id).count() == 0


# ============================================================
# Pydantic schema validation tests
# ============================================================

from pydantic import ValidationError
from screenwriter.models.schemas import (
    ScriptRange,
    ShotCreate,
    ShotUpdate,
    ShotResponse,
    ShotElementCreate,
    ShotElementResponse,
    AssetMediaCreate,
    AssetMediaResponse,
)


def test_shot_create_valid():
    """ShotCreate accepts valid data with source='user'."""
    schema = ShotCreate(
        shot_number=2,
        script_text="EXT. BEACH - DAY",
        source="user",
        fields={"angle": "wide"},
    )
    assert schema.shot_number == 2
    assert schema.source == "user"
    assert schema.fields == {"angle": "wide"}


def test_shot_create_invalid_source():
    """ShotCreate rejects source not matching 'user' or 'ai'."""
    with pytest.raises(ValidationError):
        ShotCreate(source="manual")


def test_shot_update_partial():
    """ShotUpdate accepts partial fields (only shot_number, only fields)."""
    update_num = ShotUpdate(shot_number=5)
    assert update_num.shot_number == 5
    assert update_num.fields is None

    update_fields = ShotUpdate(fields={"angle": "close"})
    assert update_fields.fields == {"angle": "close"}
    assert update_fields.shot_number is None

    update_empty = ShotUpdate()
    assert update_empty.shot_number is None
    assert update_empty.fields is None
    assert update_empty.script_text is None


def test_shot_response_from_orm(db_session):
    """ShotResponse.model_validate(orm_shot) produces correct fields."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Shot Response Test")
    db_session.add(project)
    db_session.flush()

    shot = Shot(
        id=uuid.uuid4(),
        project_id=project.id,
        shot_number=2,
        script_text="INT. OFFICE - DAY",
        script_range={"scene_index": 1},
        fields={"angle": "medium"},
        sort_order=3,
        source="ai",
    )
    db_session.add(shot)
    db_session.commit()
    db_session.refresh(shot)

    response = ShotResponse.model_validate(shot)
    assert response.shot_number == 2
    assert response.script_text == "INT. OFFICE - DAY"
    assert response.script_range == {"scene_index": 1}
    assert response.fields == {"angle": "medium"}
    assert response.sort_order == 3
    assert response.source == "ai"
    assert response.scene_item_id is None


def test_asset_media_response_metadata_alias(db_session):
    """AssetMediaResponse.model_validate(orm_media) correctly maps metadata_ to metadata."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Media Alias Test")
    db_session.add(project)
    db_session.flush()

    media = AssetMedia(
        id=uuid.uuid4(),
        project_id=project.id,
        file_type="image",
        file_path="/media/alias_test.jpg",
        original_filename="alias_test.jpg",
        file_size_bytes=2048,
        metadata_={"resolution": "4K"},
    )
    db_session.add(media)
    db_session.commit()
    db_session.refresh(media)

    response = AssetMediaResponse.model_validate(media)
    assert response.metadata == {"resolution": "4K"}
    assert response.file_type == "image"
    assert response.original_filename == "alias_test.jpg"


def test_script_range_schema():
    """ScriptRange validates {scene_index, start_offset, end_offset, content_hash}."""
    sr = ScriptRange(scene_index=5, start_offset=100, end_offset=300, content_hash="abc123")
    assert sr.scene_index == 5
    assert sr.start_offset == 100
    assert sr.end_offset == 300
    assert sr.content_hash == "abc123"

    # Defaults
    sr_default = ScriptRange()
    assert sr_default.scene_index == 0
    assert sr_default.start_offset == 0
    assert sr_default.end_offset == 0
    assert sr_default.content_hash == ""
