"""Tests for AgentPipelineMap ORM model and PipelineMapEntry/PipelineMapResponse schemas.
Covers COMP-02: pipeline mappings stored in dedicated agent_pipeline_maps table.
"""
import uuid
import pytest

from screenwriter.models.database import AgentPipelineMap, Agent, Base
from screenwriter.models.schemas import PipelineMapEntry, PipelineMapResponse


def test_model_importable():
    """AgentPipelineMap ORM model is importable and mapped to correct table."""
    assert AgentPipelineMap.__tablename__ == "agent_pipeline_maps"


def test_model_in_metadata():
    """AgentPipelineMap is registered in Base.metadata (so create_all picks it up)."""
    assert "agent_pipeline_maps" in Base.metadata.tables


def test_pipeline_map_entry_roundtrip(db_session):
    """PipelineMapEntry validates and round-trips from an ORM instance."""
    # Create a minimal Agent first (agent_id FK is NOT NULL)
    agent = Agent(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        name="Test Agent",
        system_prompt_template="You are a test agent.",
    )
    db_session.add(agent)
    db_session.flush()

    mapping = AgentPipelineMap(
        id=uuid.uuid4(),
        owner_id=agent.owner_id,
        agent_id=agent.id,
        phase="story",
        subsection_key="protagonist",
        confidence=0.85,
        rationale="Agent specializes in character development.",
        pipeline_dirty=False,
    )
    db_session.add(mapping)
    db_session.commit()

    db_session.refresh(mapping)
    entry = PipelineMapEntry.model_validate(mapping)

    assert str(entry.id) == str(mapping.id)
    assert entry.phase == "story"
    assert entry.confidence == pytest.approx(0.85)
    assert entry.pipeline_dirty is False
    assert entry.rationale == "Agent specializes in character development."


def test_pipeline_map_response_empty():
    """PipelineMapResponse instantiates with empty entries list."""
    owner = uuid.uuid4()
    response = PipelineMapResponse(owner_id=owner, entries=[], total_mappings=0)

    assert response.total_mappings == 0
    assert response.entries == []
    assert str(response.owner_id) == str(owner)
