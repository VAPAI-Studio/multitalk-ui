"""Integration tests for Pipeline Map API and CRUD wiring (Phase 3).

Tests cover:
- COMP-04: GET /api/agents/pipeline-map returns entries and handles empty state
- COMP-01: create/delete always trigger background re-composition
- COMP-03: semantic update triggers re-composition, cosmetic update does not

Note: The test suite uses a shared SQLite in-memory DB (StaticPool).
Since committed data persists across function-scoped sessions, each test
that asserts a specific count cleans its own preconditions explicitly.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from screenwriter.models.database import Agent, AgentPipelineMap, AgentType


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"  # Matches MockAuthService
MOCK_RECOMPOSE_PATH = "app.api.endpoints.agents._recompose_pipeline_background"


def _clean_pipeline_maps(db_session):
    """Remove all AgentPipelineMap rows for the mock user to ensure test isolation."""
    db_session.query(AgentPipelineMap).filter(
        AgentPipelineMap.owner_id == MOCK_USER_ID
    ).delete(synchronize_session="fetch")
    db_session.commit()


def _make_agent(db_session, name="Test Agent"):
    """Create and flush a minimal Agent, returning its string ID."""
    agent_id = str(uuid.uuid4())
    agent = Agent(
        id=agent_id,
        owner_id=MOCK_USER_ID,
        name=name,
        system_prompt_template="A" * 50,
        is_active=True,
        agent_type=AgentType.BOOK_BASED,
    )
    db_session.add(agent)
    db_session.flush()
    return agent_id


# ---------------------------------------------------------------------------
# COMP-04: GET /api/agents/pipeline-map
# ---------------------------------------------------------------------------


def test_get_pipeline_map_returns_entries(client, db_session, mock_auth_headers):
    """GET /pipeline-map returns entries when mappings exist for the user."""
    _clean_pipeline_maps(db_session)

    agent_id = _make_agent(db_session, "Pipeline Agent")

    # Insert two pipeline map rows
    map1 = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=MOCK_USER_ID,
        agent_id=agent_id,
        phase="idea",
        subsection_key="genre_themes",
        confidence=0.9,
        rationale="Good match",
    )
    map2 = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=MOCK_USER_ID,
        agent_id=agent_id,
        phase="story",
        subsection_key="characters",
        confidence=0.75,
        rationale="Decent match",
    )
    db_session.add_all([map1, map2])
    db_session.commit()

    response = client.get("/api/agents/pipeline-map", headers=mock_auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["total_mappings"] == 2
    assert len(data["entries"]) == 2


def test_get_pipeline_map_empty(client, db_session, mock_auth_headers):
    """GET /pipeline-map returns empty entries array when no mappings exist."""
    _clean_pipeline_maps(db_session)

    response = client.get("/api/agents/pipeline-map", headers=mock_auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["total_mappings"] == 0
    assert data["entries"] == []


# ---------------------------------------------------------------------------
# COMP-01: Create and delete trigger background re-composition
# ---------------------------------------------------------------------------


@patch(MOCK_RECOMPOSE_PATH, new_callable=AsyncMock)
def test_create_agent_triggers_recomposition(mock_recompose, client, mock_auth_headers):
    """POST /api/agents/ triggers _recompose_pipeline_background call."""
    payload = {
        "name": "Test Agent",
        "system_prompt_template": "A" * 50,
        "description": "test",
    }
    response = client.post("/api/agents/", json=payload, headers=mock_auth_headers)

    assert response.status_code == 200
    mock_recompose.assert_called_once_with(MOCK_USER_ID)


@patch(MOCK_RECOMPOSE_PATH, new_callable=AsyncMock)
def test_delete_agent_cascades_and_recomposes(
    mock_recompose, client, db_session, mock_auth_headers
):
    """DELETE /api/agents/{id} removes cascade rows and triggers recomposition."""
    agent_id = _make_agent(db_session, "Doomed Agent")

    # Insert a pipeline map row for it
    pipeline_map = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=MOCK_USER_ID,
        agent_id=agent_id,
        phase="idea",
        subsection_key="genre_themes",
        confidence=0.8,
        rationale="Will be deleted",
    )
    db_session.add(pipeline_map)
    db_session.commit()

    response = client.delete(f"/api/agents/{agent_id}", headers=mock_auth_headers)

    assert response.status_code == 200
    mock_recompose.assert_called_once_with(MOCK_USER_ID)

    # Verify cascade delete removed pipeline map rows
    remaining = (
        db_session.query(AgentPipelineMap)
        .filter(AgentPipelineMap.agent_id == agent_id)
        .count()
    )
    assert remaining == 0


# ---------------------------------------------------------------------------
# COMP-03: Semantic vs cosmetic update gating
# ---------------------------------------------------------------------------


@patch(MOCK_RECOMPOSE_PATH, new_callable=AsyncMock)
def test_update_semantic_field_triggers_recomposition(
    mock_recompose, client, db_session, mock_auth_headers
):
    """PATCH with system_prompt_template triggers _recompose_pipeline_background."""
    agent_id = _make_agent(db_session, "Semantic Agent")
    db_session.commit()

    response = client.patch(
        f"/api/agents/{agent_id}",
        json={"system_prompt_template": "B" * 50},
        headers=mock_auth_headers,
    )

    assert response.status_code == 200
    mock_recompose.assert_called_once_with(MOCK_USER_ID)


@patch(MOCK_RECOMPOSE_PATH, new_callable=AsyncMock)
def test_update_cosmetic_field_no_recomposition(
    mock_recompose, client, db_session, mock_auth_headers
):
    """PATCH with only name does NOT trigger _recompose_pipeline_background."""
    agent_id = _make_agent(db_session, "Cosmetic Agent")
    db_session.commit()

    response = client.patch(
        f"/api/agents/{agent_id}",
        json={"name": "Renamed Agent"},
        headers=mock_auth_headers,
    )

    assert response.status_code == 200
    mock_recompose.assert_not_called()
