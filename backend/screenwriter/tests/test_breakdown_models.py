"""Tests for BreakdownElement, ElementSceneLink, BreakdownRun ORM models.
Covers BKDN-01 through BKDN-04: breakdown data layer.
"""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from screenwriter.models.database import (
    Base,
    BreakdownElement,
    ElementSceneLink,
    BreakdownRun,
    Project,
    PhaseData,
    ListItem,
)


# ============================================================
# Model importability and metadata tests
# ============================================================

def test_breakdown_element_importable():
    """BreakdownElement ORM model is importable and mapped to correct table."""
    assert BreakdownElement.__tablename__ == "breakdown_elements"


def test_element_scene_link_importable():
    """ElementSceneLink ORM model is importable and mapped to correct table."""
    assert ElementSceneLink.__tablename__ == "element_scene_links"


def test_breakdown_run_importable():
    """BreakdownRun ORM model is importable and mapped to correct table."""
    assert BreakdownRun.__tablename__ == "breakdown_runs"


def test_tables_in_metadata():
    """All 3 new tables appear in Base.metadata.tables."""
    tables = Base.metadata.tables
    assert "breakdown_elements" in tables
    assert "element_scene_links" in tables
    assert "breakdown_runs" in tables


# ============================================================
# Project model updates
# ============================================================

def test_project_breakdown_stale(db_session):
    """New Project instance has breakdown_stale defaulting to False."""
    project = Project(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        title="Test Stale Flag",
    )
    db_session.add(project)
    db_session.flush()
    db_session.refresh(project)

    assert project.breakdown_stale is False


# ============================================================
# ORM round-trip and relationship tests
# ============================================================

def test_element_orm_roundtrip(db_session):
    """Create Project + BreakdownElement, flush, verify fields survive round-trip."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Roundtrip Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="prop",
        name="Revolver",
        description="Smith & Wesson .38",
        source="ai",
    )
    db_session.add(elem)
    db_session.commit()
    db_session.refresh(elem)

    assert elem.name == "Revolver"
    assert elem.category == "prop"
    assert elem.description == "Smith & Wesson .38"
    assert elem.source == "ai"
    assert elem.user_modified is False
    assert elem.is_deleted is False
    assert elem.sort_order == 0


def test_element_unique_constraint(db_session):
    """Two elements with same (project_id, category, name) raise IntegrityError."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Unique Test")
    db_session.add(project)
    db_session.flush()

    elem1 = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="character",
        name="John Doe",
    )
    db_session.add(elem1)
    db_session.flush()

    elem2 = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="character",
        name="John Doe",
    )
    db_session.add(elem2)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_scene_link_creation(db_session):
    """Create BreakdownElement + ListItem (via PhaseData) + ElementSceneLink, verify link persists."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Link Test")
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

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="location",
        name="Diner",
    )
    db_session.add(elem)
    db_session.flush()

    link = ElementSceneLink(
        id=uuid.uuid4(),
        element_id=elem.id,
        scene_item_id=list_item.id,
        context="Interior, night scene",
        source="ai",
    )
    db_session.add(link)
    db_session.commit()
    db_session.refresh(link)

    assert link.context == "Interior, night scene"
    assert link.source == "ai"
    assert len(elem.scene_links) == 1
    assert elem.scene_links[0].scene_item_id == list_item.id


def test_element_cascade_delete(db_session):
    """Deleting a Project cascades to delete its BreakdownElements."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Cascade Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="wardrobe",
        name="Red Dress",
    )
    db_session.add(elem)
    db_session.commit()

    # Verify element exists
    assert db_session.query(BreakdownElement).filter_by(project_id=project.id).count() == 1

    # Delete project -- cascade should remove elements
    db_session.delete(project)
    db_session.commit()

    assert db_session.query(BreakdownElement).filter_by(project_id=project.id).count() == 0


def test_breakdown_run_creation(db_session):
    """Create BreakdownRun with status/counts, verify fields."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Run Test")
    db_session.add(project)
    db_session.flush()

    run = BreakdownRun(
        id=uuid.uuid4(),
        project_id=project.id,
        status="completed",
        elements_created=15,
        elements_updated=3,
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    assert run.status == "completed"
    assert run.elements_created == 15
    assert run.elements_updated == 3
    assert run.error_message is None


def test_element_soft_delete(db_session):
    """Set is_deleted=True on element, verify user_modified flag works independently."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Soft Delete Test")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="vehicle",
        name="1967 Impala",
    )
    db_session.add(elem)
    db_session.commit()

    # Initially neither flag is set
    assert elem.is_deleted is False
    assert elem.user_modified is False

    # Set soft delete independently
    elem.is_deleted = True
    db_session.commit()
    db_session.refresh(elem)
    assert elem.is_deleted is True
    assert elem.user_modified is False

    # Set user_modified independently
    elem.user_modified = True
    db_session.commit()
    db_session.refresh(elem)
    assert elem.is_deleted is True
    assert elem.user_modified is True


# ============================================================
# Pydantic schema validation tests
# ============================================================

from pydantic import ValidationError
from screenwriter.models.schemas import (
    BreakdownElementCreate,
    BreakdownElementUpdate,
    BreakdownElementResponse,
    BreakdownRunResponse,
    BreakdownSummaryResponse,
    SceneLinkCreate,
)


def test_element_create_valid_category():
    """BreakdownElementCreate accepts all 5 valid categories."""
    for cat in ["character", "location", "prop", "wardrobe", "vehicle"]:
        schema = BreakdownElementCreate(category=cat, name="Test Item")
        assert schema.category == cat


def test_element_create_invalid_category():
    """BreakdownElementCreate rejects invalid category with ValidationError."""
    with pytest.raises(ValidationError):
        BreakdownElementCreate(category="invalid_category", name="Test Item")


def test_element_create_name_required():
    """BreakdownElementCreate rejects empty name."""
    with pytest.raises(ValidationError):
        BreakdownElementCreate(category="character", name="")


def test_element_update_partial():
    """BreakdownElementUpdate accepts partial fields (only name, only description)."""
    update_name = BreakdownElementUpdate(name="New Name")
    assert update_name.name == "New Name"
    assert update_name.description is None

    update_desc = BreakdownElementUpdate(description="New description")
    assert update_desc.description == "New description"
    assert update_desc.name is None

    update_empty = BreakdownElementUpdate()
    assert update_empty.name is None
    assert update_empty.description is None
    assert update_empty.metadata is None


def test_element_response_from_orm(db_session):
    """BreakdownElementResponse.model_validate(orm_element) produces correct fields including metadata alias."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Schema Roundtrip")
    db_session.add(project)
    db_session.flush()

    elem = BreakdownElement(
        id=uuid.uuid4(),
        project_id=project.id,
        category="prop",
        name="Revolver",
        description="Smith & Wesson .38",
        source="ai",
    )
    db_session.add(elem)
    db_session.commit()
    db_session.refresh(elem)

    response = BreakdownElementResponse.model_validate(elem)
    assert response.name == "Revolver"
    assert response.category == "prop"
    assert response.user_modified is False
    assert response.is_deleted is False
    assert isinstance(response.metadata, dict)
    assert response.sort_order == 0


def test_run_response_from_orm(db_session):
    """BreakdownRunResponse.model_validate(orm_run) produces correct fields."""
    project = Project(id=uuid.uuid4(), owner_id=uuid.uuid4(), title="Run Schema Test")
    db_session.add(project)
    db_session.flush()

    run = BreakdownRun(
        id=uuid.uuid4(),
        project_id=project.id,
        status="completed",
        elements_created=10,
        elements_updated=2,
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)

    response = BreakdownRunResponse.model_validate(run)
    assert response.status == "completed"
    assert response.elements_created == 10
    assert response.elements_updated == 2
    assert response.error_message is None


def test_summary_response():
    """BreakdownSummaryResponse validates with counts_by_category dict."""
    summary = BreakdownSummaryResponse(
        project_id=uuid.uuid4(),
        is_stale=True,
        total_elements=25,
        counts_by_category={"character": 10, "location": 8, "prop": 7},
    )
    assert summary.is_stale is True
    assert summary.total_elements == 25
    assert summary.counts_by_category["character"] == 10
    assert summary.last_run is None


def test_scene_link_create():
    """SceneLinkCreate accepts UUID scene_item_id and optional context."""
    link = SceneLinkCreate(scene_item_id=uuid.uuid4())
    assert link.context == ""

    link_with_context = SceneLinkCreate(
        scene_item_id=uuid.uuid4(),
        context="Interior, night",
    )
    assert link_with_context.context == "Interior, night"
