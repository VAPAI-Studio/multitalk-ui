"""
Phase 6 — Wizard Injection integration tests.

Tests the middleware injection into run_wizard(), WizardRunResponse schema
extraction of agents_consulted, and zero-agent pass-through behavior.
"""

import json
import uuid
from datetime import datetime

import pytest
from unittest.mock import AsyncMock, patch

from screenwriter.models.database import Agent, AgentPipelineMap, AgentType
from screenwriter.models.schemas import WizardRunResponse
from screenwriter.services.agent_review_middleware import agent_review_middleware


@pytest.fixture
def owner_id():
    return str(uuid.uuid4())


@pytest.fixture
def make_agent(db_session, owner_id):
    """Factory fixture to create Agent ORM instances in the test DB."""
    def _make(
        name="Test Agent",
        system_prompt_template="You are a helpful screenwriting assistant.",
        description="A test agent",
        agent_type=AgentType.BOOK_BASED,
    ):
        agent = Agent(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            name=name,
            system_prompt_template=system_prompt_template,
            description=description,
            agent_type=agent_type,
            is_active=True,
            is_default=False,
        )
        db_session.add(agent)
        db_session.flush()
        return agent
    return _make


def _make_pipeline_map(db_session, owner_id, agent_id, phase="idea", subsection_key="idea_wizard"):
    """Helper to create an AgentPipelineMap row."""
    mapping = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        agent_id=str(agent_id),
        phase=phase,
        subsection_key=subsection_key,
        confidence=0.9,
        rationale="Test mapping",
        pipeline_dirty=False,
    )
    db_session.add(mapping)
    db_session.flush()
    return mapping


@pytest.mark.asyncio
async def test_wizard_injection_with_mapped_agents(db_session, owner_id, make_agent):
    """When agents are mapped to the wizard step via AgentPipelineMap,
    calling the middleware returns refined output with review_applied=True
    and agents_consulted populated with agent_id, name, and summary fields."""
    agent = make_agent(name="Story Expert")
    _make_pipeline_map(db_session, owner_id, agent.id)

    raw_output = {"fields": {"genre": "drama", "initial_idea": "A story", "tone": "neutral", "target_audience": "general"}}
    review_resp = json.dumps({"issues": [], "suggestions": ["add conflict"], "refined_fields": {}})
    merge_resp = json.dumps({"fields": {"genre": "thriller", "initial_idea": "refined story", "tone": "dark", "target_audience": "adults"}})

    def session_factory():
        return db_session

    # 1 review call + 1 merge call
    with patch("app.services.agent_review_middleware.chat_completion",
               new_callable=AsyncMock, side_effect=[review_resp, merge_resp]):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="idea_wizard",
        )

    assert result["review_applied"] is True
    assert len(result["agents_consulted"]) == 1
    assert result["agents_consulted"][0]["agent_id"] == str(agent.id)
    assert result["agents_consulted"][0]["name"] == "Story Expert"
    assert "summary" in result["agents_consulted"][0]
    assert result["output"]["fields"]["genre"] == "thriller"


@pytest.mark.asyncio
async def test_agents_consulted_in_response():
    """WizardRunResponse model_validator extracts agents_consulted from
    result['_meta']['agents_consulted'] into a top-level agents_consulted field.
    Responses without _meta return empty list."""
    # Case 1: result with _meta.agents_consulted
    agents_data = [
        {"agent_id": str(uuid.uuid4()), "name": "Expert A", "summary": "Reviewed content."},
        {"agent_id": str(uuid.uuid4()), "name": "Expert B", "summary": "Flagged issues."},
    ]
    response_with_meta = WizardRunResponse(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        wizard_type="idea_wizard",
        phase="idea",
        status="completed",
        config={},
        result={
            "fields": {"genre": "drama"},
            "_meta": {
                "agents_consulted": agents_data,
                "review_applied": True,
            },
        },
        created_at=datetime.utcnow(),
    )

    assert response_with_meta.agents_consulted == agents_data
    assert len(response_with_meta.agents_consulted) == 2
    assert response_with_meta.agents_consulted[0]["name"] == "Expert A"

    # Case 2: result without _meta
    response_no_meta = WizardRunResponse(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        wizard_type="idea_wizard",
        phase="idea",
        status="completed",
        config={},
        result={"fields": {"genre": "comedy"}},
        created_at=datetime.utcnow(),
    )

    assert response_no_meta.agents_consulted == []

    # Case 3: empty result
    response_empty = WizardRunResponse(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        wizard_type="idea_wizard",
        phase="idea",
        status="completed",
        config={},
        result={},
        created_at=datetime.utcnow(),
    )

    assert response_empty.agents_consulted == []


@pytest.mark.asyncio
async def test_wizard_passthrough_no_agents(db_session, owner_id):
    """When zero agents are mapped, the middleware returns raw_output unchanged
    with review_applied=False, agents_consulted=[], and zero additional LLM calls."""
    raw_output = {"fields": {"genre": "drama", "initial_idea": "A story"}}

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion",
               new_callable=AsyncMock) as mock_chat:
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="idea_wizard",
        )

    assert result["output"] == raw_output
    assert result["agents_consulted"] == []
    assert result["review_applied"] is False
    mock_chat.assert_not_called()
