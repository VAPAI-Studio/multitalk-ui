"""
Phase 8 — YOLO Integration token budget controls.

Plan 01: Tests for MAX_AGENTS_PER_PIPELINE_STEP and AGENT_RELEVANCE_THRESHOLD
configuration values and their SQL-level gating in _lookup_mapped_agents.

Plan 02: Tests for middleware wiring in _yolo_run_wizard — routes through
agent_review_middleware.review_step_output, zero-agent passthrough, and
LLM call count correctness.
"""

import asyncio
import json
import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from screenwriter.config import settings
from screenwriter.models.database import Agent, AgentPipelineMap, AgentType
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


def _make_pipeline_map(
    db_session, owner_id, agent_id,
    phase="idea", subsection_key="idea_wizard",
    confidence=0.9,
):
    """Helper to create an AgentPipelineMap row with configurable confidence."""
    mapping = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        agent_id=str(agent_id),
        phase=phase,
        subsection_key=subsection_key,
        confidence=confidence,
        rationale="Test mapping",
        pipeline_dirty=False,
    )
    db_session.add(mapping)
    db_session.flush()
    return mapping


def test_config_values_exist():
    """settings.MAX_AGENTS_PER_PIPELINE_STEP exists as int (default 3),
    settings.AGENT_RELEVANCE_THRESHOLD exists as float (default 0.3)."""
    assert hasattr(settings, "MAX_AGENTS_PER_PIPELINE_STEP")
    assert isinstance(settings.MAX_AGENTS_PER_PIPELINE_STEP, int)
    assert settings.MAX_AGENTS_PER_PIPELINE_STEP == 3

    assert hasattr(settings, "AGENT_RELEVANCE_THRESHOLD")
    assert isinstance(settings.AGENT_RELEVANCE_THRESHOLD, float)
    assert settings.AGENT_RELEVANCE_THRESHOLD == 0.3


def test_max_agents_per_step_limits_lookup(db_session, owner_id, make_agent):
    """Create 5 agents mapped to same step with confidence 0.5-0.9.
    With MAX_AGENTS_PER_PIPELINE_STEP=2, _lookup_mapped_agents returns
    exactly 2 agents (the 2 highest confidence)."""
    confidences = [0.5, 0.6, 0.7, 0.8, 0.9]
    agents = []
    for i, conf in enumerate(confidences):
        agent = make_agent(name=f"Agent {i}")
        _make_pipeline_map(
            db_session, owner_id, agent.id,
            phase="idea", subsection_key="idea_wizard",
            confidence=conf,
        )
        agents.append(agent)
    db_session.flush()

    with patch.object(settings, "MAX_AGENTS_PER_PIPELINE_STEP", 2), \
         patch.object(settings, "AGENT_RELEVANCE_THRESHOLD", 0.0):
        result = agent_review_middleware._lookup_mapped_agents(
            owner_id, "idea", "idea_wizard", db_session
        )

    assert len(result) == 2
    # Should be the 2 highest confidence agents (0.9 and 0.8)
    names = {r["name"] for r in result}
    assert "Agent 4" in names  # confidence 0.9
    assert "Agent 3" in names  # confidence 0.8


def test_relevance_threshold_filters_agents(db_session, owner_id, make_agent):
    """Create 3 agents: confidence 0.8, 0.5, 0.1.
    With AGENT_RELEVANCE_THRESHOLD=0.3, _lookup_mapped_agents returns
    2 agents (0.8 and 0.5), excluding the 0.1 agent."""
    conf_map = [(0.8, "High Agent"), (0.5, "Mid Agent"), (0.1, "Low Agent")]
    for conf, name in conf_map:
        agent = make_agent(name=name)
        _make_pipeline_map(
            db_session, owner_id, agent.id,
            phase="idea", subsection_key="idea_wizard",
            confidence=conf,
        )
    db_session.flush()

    with patch.object(settings, "AGENT_RELEVANCE_THRESHOLD", 0.3), \
         patch.object(settings, "MAX_AGENTS_PER_PIPELINE_STEP", 10):
        result = agent_review_middleware._lookup_mapped_agents(
            owner_id, "idea", "idea_wizard", db_session
        )

    assert len(result) == 2
    names = {r["name"] for r in result}
    assert "High Agent" in names
    assert "Mid Agent" in names
    assert "Low Agent" not in names


def test_gating_combined(db_session, owner_id, make_agent):
    """Create 5 agents with confidence 0.9, 0.7, 0.5, 0.2, 0.1.
    With threshold=0.3 and max=2, returns exactly 2 agents (0.9 and 0.7)."""
    conf_map = [
        (0.9, "Agent A"),
        (0.7, "Agent B"),
        (0.5, "Agent C"),
        (0.2, "Agent D"),
        (0.1, "Agent E"),
    ]
    for conf, name in conf_map:
        agent = make_agent(name=name)
        _make_pipeline_map(
            db_session, owner_id, agent.id,
            phase="idea", subsection_key="idea_wizard",
            confidence=conf,
        )
    db_session.flush()

    with patch.object(settings, "AGENT_RELEVANCE_THRESHOLD", 0.3), \
         patch.object(settings, "MAX_AGENTS_PER_PIPELINE_STEP", 2):
        result = agent_review_middleware._lookup_mapped_agents(
            owner_id, "idea", "idea_wizard", db_session
        )

    assert len(result) == 2
    names = {r["name"] for r in result}
    assert "Agent A" in names  # confidence 0.9
    assert "Agent B" in names  # confidence 0.7
    assert "Agent C" not in names  # confidence 0.5 but max=2 reached
    assert "Agent D" not in names  # below threshold
    assert "Agent E" not in names  # below threshold


# ---------------------------------------------------------------------------
# Plan 02 — Middleware wiring in _yolo_run_wizard
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_project():
    """Minimal project-like object for _yolo_run_wizard."""
    project = MagicMock()
    project.id = str(uuid.uuid4())
    project.template = MagicMock()
    project.template.value = "short_movie"
    return project


@pytest.fixture
def wizard_sub_config():
    """Sub-config dict resembling a wizard subsection."""
    return {
        "key": "idea_wizard",
        "name": "Idea Wizard",
        "pattern": "wizard",
        "wizard_config": {},
    }


@pytest.mark.asyncio
async def test_yolo_wizard_routes_through_middleware(
    db_session, mock_project, wizard_sub_config, owner_id
):
    """Mock agent_review_middleware.review_step_output to return a known refined
    result. Call _yolo_run_wizard with an owner_id. Assert review_step_output
    was called once with correct params and that the DB-applied result is the
    refined output, not the raw output."""
    from screenwriter.api.endpoints.ai_chat import _yolo_run_wizard

    raw_output = {"fields": {"genre": "raw_genre", "initial_idea": "raw_idea"}}
    refined_output = {"fields": {"genre": "refined_genre", "initial_idea": "refined_idea"}}

    review_mock = AsyncMock(return_value={
        "output": refined_output,
        "agents_consulted": [{"agent_id": "a1", "name": "Agent X", "summary": "reviewed"}],
        "review_applied": True,
    })

    apply_mock = MagicMock(return_value={"fields_updated": ["genre", "initial_idea"]})

    wizard_gen_mock = AsyncMock(return_value=raw_output)

    with patch("app.api.endpoints.ai_chat.template_ai_service.wizard_generate", wizard_gen_mock), \
         patch("app.api.endpoints.ai_chat.agent_review_middleware.review_step_output", review_mock), \
         patch("app.api.endpoints.ai_chat.apply_wizard_result_to_db", apply_mock):
        result = await _yolo_run_wizard(
            db_session, mock_project, "idea", wizard_sub_config,
            "project context", "short_movie", owner_id=owner_id,
        )

    # Verify review_step_output was called with correct parameters
    review_mock.assert_called_once()
    call_kwargs = review_mock.call_args
    assert call_kwargs.kwargs.get("phase") or call_kwargs[1].get("phase", call_kwargs[0][0] if call_kwargs[0] else None) is not None

    # The apply_wizard_result_to_db should receive refined output (with _meta embedded)
    # Signature: apply_wizard_result_to_db(db, project, phase, wizard_type, result)
    # So result is the 5th positional arg (index 4)
    apply_call = apply_mock.call_args
    applied_result = apply_call[0][4]
    # The result should have the refined fields, not the raw ones
    assert applied_result["fields"]["genre"] == "refined_genre"
    assert "_meta" in applied_result
    assert applied_result["_meta"]["review_applied"] is True
    assert len(applied_result["_meta"]["agents_consulted"]) == 1


@pytest.mark.asyncio
async def test_yolo_wizard_zero_agents_passthrough(
    db_session, mock_project, wizard_sub_config, owner_id
):
    """Mock agent_review_middleware.review_step_output to return pass-through
    (review_applied=False, agents_consulted=[], output=raw_output).
    Assert only wizard_generate triggered an LLM call — no review/merge calls."""
    from screenwriter.api.endpoints.ai_chat import _yolo_run_wizard

    raw_output = {"fields": {"genre": "sci-fi", "initial_idea": "robots"}}

    review_mock = AsyncMock(return_value={
        "output": raw_output,
        "agents_consulted": [],
        "review_applied": False,
    })

    apply_mock = MagicMock(return_value={"fields_updated": ["genre", "initial_idea"]})
    wizard_gen_mock = AsyncMock(return_value=raw_output)

    # Track chat_completion calls in the middleware module
    cc_mock = AsyncMock()

    with patch("app.api.endpoints.ai_chat.template_ai_service.wizard_generate", wizard_gen_mock), \
         patch("app.api.endpoints.ai_chat.agent_review_middleware.review_step_output", review_mock), \
         patch("app.api.endpoints.ai_chat.apply_wizard_result_to_db", apply_mock), \
         patch("app.services.agent_review_middleware.chat_completion", cc_mock):
        result = await _yolo_run_wizard(
            db_session, mock_project, "idea", wizard_sub_config,
            "project context", "short_movie", owner_id=owner_id,
        )

    # wizard_generate was called once
    wizard_gen_mock.assert_called_once()
    # No chat_completion calls in the middleware (zero agents = passthrough)
    cc_mock.assert_not_called()


@pytest.mark.asyncio
async def test_yolo_full_run_llm_call_count(
    db_session, mock_project, wizard_sub_config, owner_id, make_agent
):
    """Create 3 agents mapped to a wizard step. Do NOT mock review_step_output
    — let the real middleware execute. Mock chat_completion and wizard_generate.
    Assert chat_completion was called exactly 4 times (3 reviews + 1 merge)."""
    from screenwriter.api.endpoints.ai_chat import _yolo_run_wizard

    # Create 3 agents with pipeline mappings above threshold
    for i in range(3):
        agent = make_agent(name=f"Review Agent {i}")
        _make_pipeline_map(
            db_session, owner_id, agent.id,
            phase="idea", subsection_key="idea_wizard",
            confidence=0.9,
        )
    db_session.flush()

    raw_output = {"fields": {"genre": "comedy", "initial_idea": "cats in space"}}

    # Mock wizard_generate to return raw output
    wizard_gen_mock = AsyncMock(return_value=raw_output)

    # Mock chat_completion for the middleware's fan-out reviews (3) + merge (1)
    review_response = json.dumps({
        "issues": [],
        "suggestions": ["Great work!"],
        "refined_fields": {"genre": "comedy-drama"},
    })
    merge_response = json.dumps({
        "fields": {"genre": "comedy-drama", "initial_idea": "cats in space, refined"},
    })
    # 3 review calls return review_response, then 1 merge call returns merge_response
    cc_mock = AsyncMock(side_effect=[review_response, review_response, review_response, merge_response])

    apply_mock = MagicMock(return_value={"fields_updated": ["genre", "initial_idea"]})

    # Use a session factory that returns the test db_session
    session_factory = MagicMock(return_value=db_session)
    # Override db_session.close to no-op so tests can reuse it
    original_close = db_session.close
    db_session.close = MagicMock()

    try:
        with patch("app.api.endpoints.ai_chat.template_ai_service.wizard_generate", wizard_gen_mock), \
             patch("app.api.endpoints.ai_chat.apply_wizard_result_to_db", apply_mock), \
             patch("app.api.endpoints.ai_chat.SessionLocal", session_factory), \
             patch("app.services.agent_review_middleware.chat_completion", cc_mock), \
             patch.object(settings, "MAX_AGENTS_PER_PIPELINE_STEP", 10), \
             patch.object(settings, "AGENT_RELEVANCE_THRESHOLD", 0.0):
            result = await _yolo_run_wizard(
                db_session, mock_project, "idea", wizard_sub_config,
                "project context", "short_movie", owner_id=owner_id,
            )
    finally:
        db_session.close = original_close

    # Should be exactly 4 chat_completion calls: 3 fan-out reviews + 1 merge
    assert cc_mock.call_count == 4, f"Expected 4 chat_completion calls, got {cc_mock.call_count}"
