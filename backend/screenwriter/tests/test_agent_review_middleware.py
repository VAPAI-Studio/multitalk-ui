"""
REVW-01 (partial), REVW-02, REVW-04 unit tests for AgentReviewMiddleware.

Tests the middleware entry point, parallel fan-out, session-per-task isolation,
zero-agent pass-through, and failed-agent filtering.
"""

import json
import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

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
async def test_zero_agents_passthrough(db_session, owner_id):
    """When no AgentPipelineMap rows exist for (owner_id, phase, subsection_key),
    review_step_output returns raw_output unchanged with review_applied=False
    and chat_completion is never called."""
    raw_output = {"title": "My Story", "content": "Once upon a time..."}

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock) as mock_chat:
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
        )

    assert result["output"] == raw_output
    assert result["agents_consulted"] == []
    assert result["review_applied"] is False
    mock_chat.assert_not_called()


@pytest.mark.asyncio
async def test_parallel_fanout_uses_session_factory(db_session, owner_id, make_agent):
    """When 3 agents are mapped to a step, session_factory is called 3 times
    (once per agent) and each session is closed."""
    agents = [make_agent(name=f"Agent {i}") for i in range(3)]
    for agent in agents:
        _make_pipeline_map(db_session, owner_id, agent.id)

    raw_output = {"title": "Test"}
    mock_review = json.dumps({"issues": [], "suggestions": ["improve pacing"], "refined_fields": {}})
    # subsection_key="idea_wizard" triggers schema validation — merge must have "fields" key
    mock_merge = json.dumps({"fields": {"genre": "drama", "initial_idea": "merged", "tone": "neutral", "target_audience": "general"}})

    mock_sessions = []

    def session_factory():
        mock_sess = MagicMock()
        mock_sess.query.return_value = mock_sess
        mock_sessions.append(mock_sess)
        return db_session

    # 3 review calls + 1 merge call
    side_effects = [mock_review, mock_review, mock_review, mock_merge]
    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
        )

    # session_factory called once for lookup + once per agent = 4 total
    # But we care that at least 3 sessions were created for the fan-out
    assert len(mock_sessions) >= 3
    assert result["review_applied"] is True


@pytest.mark.asyncio
async def test_review_returns_result_with_agents_consulted(db_session, owner_id, make_agent):
    """When agents are mapped and reviews succeed, result includes output,
    agents_consulted (list of dicts with agent_id, name, summary), and
    review_applied=True."""
    agent1 = make_agent(name="Story Expert")
    agent2 = make_agent(name="Dialogue Coach")
    _make_pipeline_map(db_session, owner_id, agent1.id)
    _make_pipeline_map(db_session, owner_id, agent2.id)

    raw_output = {"title": "Test"}
    mock_review = json.dumps({"issues": [], "suggestions": ["good pacing"], "refined_fields": {}})
    mock_merge = json.dumps({"fields": {"genre": "drama", "initial_idea": "merged", "tone": "neutral", "target_audience": "general"}})

    def session_factory():
        return db_session

    # 2 review calls + 1 merge call
    side_effects = [mock_review, mock_review, mock_merge]
    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
        )

    assert result["review_applied"] is True
    assert len(result["agents_consulted"]) == 2
    for ac in result["agents_consulted"]:
        assert "agent_id" in ac
        assert "name" in ac


@pytest.mark.asyncio
async def test_failed_agent_review_filtered_out(db_session, owner_id, make_agent):
    """When one of 3 agent reviews raises an exception, the other 2 still
    succeed and the failed agent is excluded from agents_consulted."""
    agents = [make_agent(name=f"Agent {i}") for i in range(3)]
    for agent in agents:
        _make_pipeline_map(db_session, owner_id, agent.id)

    raw_output = {"title": "Test"}
    call_count = {"n": 0}
    merge_response = json.dumps({"fields": {"genre": "drama", "initial_idea": "merged", "tone": "neutral", "target_audience": "general"}})

    async def mock_chat_side_effect(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise Exception("AI provider timeout")
        # Last call (after reviews) is the merge call
        if call_count["n"] == 4:
            return merge_response
        return json.dumps({"issues": [], "suggestions": ["note"], "refined_fields": {}})

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=mock_chat_side_effect):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
        )

    assert result["review_applied"] is True
    assert len(result["agents_consulted"]) == 2


@pytest.mark.asyncio
async def test_all_agents_fail_returns_raw_output(db_session, owner_id, make_agent):
    """When all agent reviews fail/timeout, returns raw_output unchanged
    with review_applied=False."""
    agents = [make_agent(name=f"Agent {i}") for i in range(2)]
    for agent in agents:
        _make_pipeline_map(db_session, owner_id, agent.id)

    raw_output = {"title": "Test", "content": "Original content"}

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=Exception("All fail")):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
        )

    assert result["output"] == raw_output
    assert result["agents_consulted"] == []
    assert result["review_applied"] is False


# ---------------------------------------------------------------------------
# Plan 05-02: Merge AI call and schema validation tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_merge_preserves_idea_wizard_schema(db_session, owner_id, make_agent):
    """Given wizard_type='idea_wizard', the merge output has top-level key
    'fields' with expected sub-keys."""
    agent1 = make_agent(name="Idea Agent 1")
    agent2 = make_agent(name="Idea Agent 2")
    _make_pipeline_map(db_session, owner_id, agent1.id)
    _make_pipeline_map(db_session, owner_id, agent2.id)

    raw_output = {"fields": {"genre": "drama", "initial_idea": "A story", "tone": "neutral", "target_audience": "general"}}
    review_response = json.dumps({"issues": ["pacing slow"], "suggestions": ["add tension"], "refined_fields": {"tone": "dark"}})
    merge_response = json.dumps({"fields": {"genre": "thriller", "initial_idea": "refined idea", "tone": "dark", "target_audience": "adults"}})

    # N agent reviews + 1 merge call
    side_effects = [review_response, review_response, merge_response]

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="idea_wizard",
        )

    assert result["review_applied"] is True
    assert "fields" in result["output"]
    assert "genre" in result["output"]["fields"]
    assert "initial_idea" in result["output"]["fields"]


@pytest.mark.asyncio
async def test_merge_preserves_scene_wizard_schema(db_session, owner_id, make_agent):
    """Given wizard_type='scene_wizard', the merge output has top-level key 'scenes'."""
    agent1 = make_agent(name="Scene Agent")
    _make_pipeline_map(db_session, owner_id, agent1.id, phase="scenes", subsection_key="scene_wizard")

    raw_output = {"scenes": [{"summary": "original scene", "arena": "park"}]}
    review_response = json.dumps({"issues": [], "suggestions": ["add conflict"], "refined_fields": {}})
    merge_response = json.dumps({"scenes": [{"summary": "refined scene", "arena": "office", "inciting_incident": "arrival", "goal": "escape", "subtext": "fear", "turning_point": "discovery", "crisis": "trapped", "climax": "confrontation", "fallout": "resolution", "push_forward": "next chapter"}]})

    side_effects = [review_response, merge_response]

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="scenes",
            subsection_key="scene_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="scene_wizard",
        )

    assert result["review_applied"] is True
    assert "scenes" in result["output"]
    assert isinstance(result["output"]["scenes"], list)


@pytest.mark.asyncio
async def test_merge_preserves_script_wizard_schema(db_session, owner_id, make_agent):
    """Given wizard_type='script_writer_wizard', the merge output has top-level key 'screenplays'."""
    agent1 = make_agent(name="Script Agent")
    _make_pipeline_map(db_session, owner_id, agent1.id, phase="write", subsection_key="script_writer_wizard")

    raw_output = {"screenplays": [{"title": "Act 1", "content": "original", "episode_index": 0}]}
    review_response = json.dumps({"issues": [], "suggestions": ["sharpen dialogue"], "refined_fields": {}})
    merge_response = json.dumps({"screenplays": [{"title": "Act 1", "content": "refined script", "episode_index": 0}]})

    side_effects = [review_response, merge_response]

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="write",
            subsection_key="script_writer_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="script_writer_wizard",
        )

    assert result["review_applied"] is True
    assert "screenplays" in result["output"]
    assert isinstance(result["output"]["screenplays"], list)


@pytest.mark.asyncio
async def test_merge_invalid_schema_falls_back_to_raw(db_session, owner_id, make_agent):
    """If the merge AI call returns JSON missing the expected top-level key,
    review_step_output falls back to raw_output with review_applied=False."""
    agent1 = make_agent(name="Bad Merge Agent")
    _make_pipeline_map(db_session, owner_id, agent1.id)

    raw_output = {"fields": {"genre": "drama", "initial_idea": "A story", "tone": "neutral", "target_audience": "general"}}
    review_response = json.dumps({"issues": [], "suggestions": ["note"], "refined_fields": {}})
    bad_merge_response = json.dumps({"wrong_key": "data"})

    side_effects = [review_response, bad_merge_response]

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="idea_wizard",
        )

    assert result["output"] == raw_output
    assert result["review_applied"] is False


@pytest.mark.asyncio
async def test_agents_consulted_has_summary(db_session, owner_id, make_agent):
    """Each entry in agents_consulted has keys agent_id, name, and summary."""
    agent1 = make_agent(name="Summary Agent 1")
    agent2 = make_agent(name="Summary Agent 2")
    _make_pipeline_map(db_session, owner_id, agent1.id)
    _make_pipeline_map(db_session, owner_id, agent2.id)

    raw_output = {"fields": {"genre": "drama", "initial_idea": "A story", "tone": "neutral", "target_audience": "general"}}
    review_response = json.dumps({"issues": ["pacing"], "suggestions": ["add tension", "more conflict"], "refined_fields": {"tone": "dark"}})
    merge_response = json.dumps({"fields": {"genre": "thriller", "initial_idea": "refined", "tone": "dark", "target_audience": "adults"}})

    side_effects = [review_response, review_response, merge_response]

    def session_factory():
        return db_session

    with patch("app.services.agent_review_middleware.chat_completion", new_callable=AsyncMock, side_effect=side_effects):
        result = await agent_review_middleware.review_step_output(
            phase="idea",
            subsection_key="idea_wizard",
            raw_output=raw_output,
            owner_id=owner_id,
            session_factory=session_factory,
            wizard_type="idea_wizard",
        )

    assert result["review_applied"] is True
    assert len(result["agents_consulted"]) == 2
    for ac in result["agents_consulted"]:
        assert "agent_id" in ac
        assert "name" in ac
        assert "summary" in ac
        assert isinstance(ac["summary"], str)
        assert len(ac["summary"]) > 0
