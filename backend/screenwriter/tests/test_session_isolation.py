"""Tests for session-per-task isolation in agent_service.py.

Verifies that all asyncio.gather sites in AgentService create and close
separate DB sessions via a session_factory callable, preventing
DetachedInstanceError and MissingGreenlet under concurrency (REVW-05).
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from uuid import uuid4

import pytest

from screenwriter.services.agent_service import AgentService
from screenwriter.models.database import AgentType


def _make_mock_agent(name="TestAgent", agent_type=AgentType.BOOK_BASED):
    """Create a mock Agent with realistic attributes."""
    agent = MagicMock()
    agent.id = uuid4()
    agent.name = name
    agent.color = "#FF0000"
    agent.icon = "book"
    agent.agent_type = agent_type
    agent.is_active = True
    agent.tags_filter = []
    agent.system_prompt_template = "You are {concept_cards} {concept_relationships} {book_chunks} {framework} {section_type} {project_context}"
    agent.personality = "Helpful and direct."
    agent.description = f"A test agent named {name}"
    agent.is_default = False
    return agent


def _make_mock_session():
    """Create a mock DB session with a close method."""
    session = MagicMock()
    session.close = MagicMock()
    return session


def _make_review_result(agent):
    """Create a valid review result dict for a given agent."""
    return {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "agent_color": agent.color,
        "agent_icon": agent.icon,
        "issues": [],
        "suggestions": ["Good work!"],
        "book_references": [],
        "status": "completed",
    }


def _make_specialist_context_result():
    """Create a valid specialist context result."""
    return {
        "concepts": [{"id": str(uuid4()), "name": "Test Concept", "definition": "A test"}],
        "chunks": [{"content": "Test chunk", "book_title": "Test Book"}],
    }


@pytest.mark.asyncio
async def test_session_factory_creates_separate_sessions():
    """Given 3 mock agents, when run_multi_agent_review is called with a
    session_factory mock, then factory is called 3 times and each resulting
    session has .close() called once."""
    agents = [_make_mock_agent(f"Agent{i}") for i in range(3)]
    section = MagicMock()
    project = MagicMock()

    mock_sessions = [_make_mock_session() for _ in range(3)]
    session_factory = MagicMock(side_effect=mock_sessions)

    service = AgentService()

    with patch.object(service, "review_section", new_callable=AsyncMock) as mock_review:
        mock_review.side_effect = [_make_review_result(a) for a in agents]

        results = await service.run_multi_agent_review(
            agents=agents,
            section=section,
            project=project,
            session_factory=session_factory,
        )

    # Factory called once per agent
    assert session_factory.call_count == 3
    # Each session was closed
    for s in mock_sessions:
        s.close.assert_called_once()
    # All results returned
    assert len(results) == 3


@pytest.mark.asyncio
async def test_concurrent_review_no_detached_error():
    """Given 3 mock agents and a session_factory, when run_multi_agent_review
    completes, then all 3 results are returned with status 'completed' and no
    exceptions propagate."""
    agents = [_make_mock_agent(f"Agent{i}") for i in range(3)]
    section = MagicMock()
    project = MagicMock()

    mock_sessions = [_make_mock_session() for _ in range(3)]
    session_factory = MagicMock(side_effect=mock_sessions)

    service = AgentService()

    with patch.object(service, "review_section", new_callable=AsyncMock) as mock_review:
        mock_review.side_effect = [_make_review_result(a) for a in agents]

        results = await service.run_multi_agent_review(
            agents=agents,
            section=section,
            project=project,
            session_factory=session_factory,
        )

    # All 3 results returned with status completed
    assert len(results) == 3
    for r in results:
        assert r["status"] == "completed"
        assert not isinstance(r, Exception)


@pytest.mark.asyncio
async def test_session_closed_on_task_failure():
    """Given 3 agents where one raises an exception during review, when
    run_multi_agent_review completes, then all 3 sessions are still closed
    (try/finally pattern works)."""
    agents = [_make_mock_agent(f"Agent{i}") for i in range(3)]
    section = MagicMock()
    project = MagicMock()

    mock_sessions = [_make_mock_session() for _ in range(3)]
    session_factory = MagicMock(side_effect=mock_sessions)

    service = AgentService()

    with patch.object(service, "review_section", new_callable=AsyncMock) as mock_review:
        # Agent 1 succeeds, Agent 2 raises, Agent 3 succeeds
        mock_review.side_effect = [
            _make_review_result(agents[0]),
            RuntimeError("Simulated DB error"),
            _make_review_result(agents[2]),
        ]

        results = await service.run_multi_agent_review(
            agents=agents,
            section=section,
            project=project,
            session_factory=session_factory,
        )

    # All 3 sessions must be closed even when one task fails
    for s in mock_sessions:
        s.close.assert_called_once()

    # 3 results returned (one will be an error result from gather's return_exceptions)
    assert len(results) == 3


@pytest.mark.asyncio
async def test_orchestrate_uses_session_factory():
    """Given an orchestrator agent, when chat() is called with session_factory,
    then _get_specialist_context wrapper creates per-task sessions for each
    selected agent."""
    orchestrator = _make_mock_agent("Orchestrator", AgentType.ORCHESTRATOR)
    specialist_agents = [_make_mock_agent(f"Spec{i}") for i in range(2)]

    mock_sessions = [_make_mock_session() for _ in range(2)]
    session_factory = MagicMock(side_effect=mock_sessions)

    # Build a mock ChatSession
    mock_session = MagicMock()
    mock_session.agent = orchestrator
    mock_session.user_id = "test-user"
    mock_session.id = uuid4()
    mock_session.project = MagicMock()
    mock_session.project.title = "Test Project"
    mock_session.project.sections = []
    mock_session.messages = []

    # Build a mock db for the initial specialist query (not concurrent)
    mock_db = MagicMock()
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.all.return_value = specialist_agents

    service = AgentService()

    with patch.object(service, "_select_relevant_agents", new_callable=AsyncMock) as mock_select, \
         patch.object(service, "_get_specialist_context", new_callable=AsyncMock) as mock_get_ctx, \
         patch("app.services.agent_service.chat_completion", new_callable=AsyncMock) as mock_chat:

        mock_select.return_value = specialist_agents
        mock_get_ctx.return_value = _make_specialist_context_result()
        mock_chat.return_value = '{"book_references": []}'

        # Mock db.add and db.commit for message saving
        mock_db.add = MagicMock()
        mock_db.commit = MagicMock()

        result = await service.chat(
            session=mock_session,
            user_message="Test question",
            db=mock_db,
            session_factory=session_factory,
        )

    # session_factory should have been called for each specialist (2)
    assert session_factory.call_count == 2
    # Each session should be closed
    for s in mock_sessions:
        s.close.assert_called_once()


@pytest.mark.asyncio
async def test_orchestrate_stream_uses_session_factory():
    """Same as Test 4 but for chat_stream_prepare path."""
    orchestrator = _make_mock_agent("Orchestrator", AgentType.ORCHESTRATOR)
    specialist_agents = [_make_mock_agent(f"Spec{i}") for i in range(2)]

    mock_sessions = [_make_mock_session() for _ in range(2)]
    session_factory = MagicMock(side_effect=mock_sessions)

    # Build a mock ChatSession
    mock_session = MagicMock()
    mock_session.agent = orchestrator
    mock_session.user_id = "test-user"
    mock_session.id = uuid4()
    mock_session.project = MagicMock()
    mock_session.project.title = "Test Project"
    mock_session.project.sections = []
    mock_session.project.template = "short_movie"
    mock_session.messages = []

    # Build a mock db for the initial specialist query
    mock_db = MagicMock()
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.all.return_value = specialist_agents

    service = AgentService()

    with patch.object(service, "_select_relevant_agents", new_callable=AsyncMock) as mock_select, \
         patch.object(service, "_get_specialist_context", new_callable=AsyncMock) as mock_get_ctx:

        mock_select.return_value = specialist_agents
        mock_get_ctx.return_value = _make_specialist_context_result()

        # Mock db.add and db.commit for message saving
        mock_db.add = MagicMock()
        mock_db.commit = MagicMock()

        result = await service.chat_stream_prepare(
            session=mock_session,
            user_message="Test question",
            db=mock_db,
            session_factory=session_factory,
        )

    # session_factory should have been called for each specialist (2)
    assert session_factory.call_count == 2
    # Each session should be closed
    for s in mock_sessions:
        s.close.assert_called_once()
