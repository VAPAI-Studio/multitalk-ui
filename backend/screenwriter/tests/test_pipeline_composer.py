"""
COMP-01 and COMP-03 unit tests for PipelineComposer service.

Tests composition of agent-to-pipeline-step mappings via mocked AI calls.
COMP-03 tests cover cache determinism and semantic change detection.
"""

import json
import uuid

import pytest
from unittest.mock import AsyncMock, patch

from screenwriter.models.database import Agent, AgentPipelineMap, AgentType


# Import will fail until pipeline_composer.py is created (RED state)
from screenwriter.services.pipeline_composer import PipelineComposer, SEMANTIC_FIELDS


@pytest.fixture
def owner_id():
    """Return a string UUID for the owner.

    SQLite test engine patches UUID columns to String(36), so we must use
    string UUIDs for queries to match stored values.
    """
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


@pytest.mark.asyncio
async def test_compose_produces_mappings(db_session, owner_id, make_agent):
    """Given 2 agents and mocked AI returning valid JSON mappings,
    compose_pipeline() writes AgentPipelineMap rows to DB with correct
    agent_id, phase, subsection_key, confidence, rationale."""
    agent1 = make_agent(
        name="Story Expert",
        system_prompt_template="You specialize in story structure and narrative arcs.",
        description="Expert in narrative structure",
    )
    agent2 = make_agent(
        name="Dialogue Coach",
        system_prompt_template="You focus on dialogue craft and character voice.",
        description="Specialist in realistic dialogue",
    )

    mock_response = json.dumps({"mappings": [
        {"agent_id": str(agent1.id), "phase": "idea", "subsection_key": "idea_wizard", "confidence": 0.9, "rationale": "Agent specializes in idea development"},
        {"agent_id": str(agent1.id), "phase": "scenes", "subsection_key": "scene_wizard", "confidence": 0.85, "rationale": "Strong narrative structure knowledge"},
        {"agent_id": str(agent2.id), "phase": "write", "subsection_key": "script_writer_wizard", "confidence": 0.95, "rationale": "Dialogue expertise directly relevant"},
        {"agent_id": str(agent2.id), "phase": "scenes", "subsection_key": "scene_wizard", "confidence": 0.7, "rationale": "Some scene construction ability"},
    ]})

    with patch("app.services.pipeline_composer.chat_completion", new_callable=AsyncMock, return_value=mock_response):
        composer = PipelineComposer()
        result = await composer.compose_pipeline(owner_id, db_session)

    assert len(result) == 4
    db_maps = db_session.query(AgentPipelineMap).filter(
        AgentPipelineMap.owner_id == owner_id
    ).all()
    assert len(db_maps) == 4

    for m in db_maps:
        assert m.confidence > 0
        assert m.rationale is not None and len(m.rationale) > 0


@pytest.mark.asyncio
async def test_compose_zero_agents(db_session, owner_id):
    """Given zero agents for the owner, compose_pipeline() returns empty list
    and makes zero AI calls. Any existing mappings for that owner are deleted."""
    # Pre-insert a stale mapping to confirm deletion
    stale_map = AgentPipelineMap(
        id=str(uuid.uuid4()),
        owner_id=owner_id,
        agent_id=str(uuid.uuid4()),
        phase="idea",
        subsection_key="idea_wizard",
        confidence=0.5,
        rationale="stale",
        pipeline_dirty=False,
    )
    db_session.add(stale_map)
    db_session.flush()

    with patch("app.services.pipeline_composer.chat_completion", new_callable=AsyncMock) as mock_chat:
        composer = PipelineComposer()
        result = await composer.compose_pipeline(owner_id, db_session)

    assert result == []
    mock_chat.assert_not_called()

    remaining = db_session.query(AgentPipelineMap).filter(
        AgentPipelineMap.owner_id == owner_id
    ).all()
    assert len(remaining) == 0


@pytest.mark.asyncio
async def test_prompt_includes_all_wizard_targets(db_session, owner_id, make_agent):
    """The prompt passed to chat_completion includes all 3 wizard subsection
    keys (idea_wizard, scene_wizard, script_writer_wizard) and does NOT include
    import_project."""
    agent = make_agent(
        name="General Agent",
        system_prompt_template="You are a general screenwriting assistant.",
        description="General purpose agent",
    )

    mock_response = json.dumps({"mappings": [
        {"agent_id": str(agent.id), "phase": "idea", "subsection_key": "idea_wizard", "confidence": 0.8, "rationale": "Relevant to idea generation"},
    ]})

    with patch("app.services.pipeline_composer.chat_completion", new_callable=AsyncMock, return_value=mock_response) as mock_chat:
        composer = PipelineComposer()
        await composer.compose_pipeline(owner_id, db_session)

    mock_chat.assert_called_once()
    call_args = mock_chat.call_args
    messages = call_args.kwargs.get("messages") or call_args[0][0]

    # Concatenate all message content for checking
    all_content = " ".join(msg["content"] for msg in messages)

    assert "idea_wizard" in all_content
    assert "scene_wizard" in all_content
    assert "script_writer_wizard" in all_content
    assert "import_project" not in all_content


@pytest.mark.asyncio
async def test_batch_splitting(db_session, owner_id, make_agent):
    """Given 7 agents (>5 batch cap), compose_pipeline() makes 2 AI calls
    (batch of 5 + batch of 2) and merges results by concatenation."""
    agents = []
    for i in range(7):
        agent = make_agent(
            name=f"Agent {i}",
            system_prompt_template=f"You are agent number {i} with unique expertise.",
            description=f"Agent {i} description",
        )
        agents.append(agent)

    def make_mock_response(call_count_ref):
        """Return a side_effect function that builds per-batch responses."""
        async def _side_effect(*args, **kwargs):
            # Determine which agents are in this batch by inspecting the prompt
            messages = kwargs.get("messages") or args[0]
            all_content = " ".join(msg["content"] for msg in messages)
            mappings = []
            for agent in agents:
                if str(agent.id) in all_content:
                    mappings.append({
                        "agent_id": str(agent.id),
                        "phase": "idea",
                        "subsection_key": "idea_wizard",
                        "confidence": 0.8,
                        "rationale": f"Agent {agent.name} relevant to idea",
                    })
            call_count_ref["count"] += 1
            return json.dumps({"mappings": mappings})
        return _side_effect

    call_counter = {"count": 0}

    with patch(
        "app.services.pipeline_composer.chat_completion",
        new_callable=AsyncMock,
        side_effect=make_mock_response(call_counter),
    ) as mock_chat:
        composer = PipelineComposer()
        result = await composer.compose_pipeline(owner_id, db_session)

    # Should have made exactly 2 AI calls (ceil(7/5) = 2 batches)
    assert mock_chat.call_count == 2

    # All 7 agents should appear in the resulting mappings
    result_agent_ids = {str(m.agent_id) for m in result}
    expected_agent_ids = {str(a.id) for a in agents}
    assert result_agent_ids == expected_agent_ids


# ---------------------------------------------------------------------------
# COMP-03: Cache determinism and semantic change detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_hit_deterministic(db_session, owner_id, make_agent):
    """Two calls to compose_pipeline with identical agents hit cache on second
    call -- chat_completion called exactly once, both calls return same mappings."""
    agent1 = make_agent(
        name="Cache Test Agent 1",
        system_prompt_template="You are an expert in plot structure.",
        description="Plot structure specialist",
    )
    agent2 = make_agent(
        name="Cache Test Agent 2",
        system_prompt_template="You are an expert in character arcs.",
        description="Character arc specialist",
    )

    mock_response = json.dumps({"mappings": [
        {
            "agent_id": str(agent1.id),
            "phase": "idea",
            "subsection_key": "idea_wizard",
            "confidence": 0.9,
            "rationale": "Strong plot structure knowledge",
        },
        {
            "agent_id": str(agent2.id),
            "phase": "scenes",
            "subsection_key": "scene_wizard",
            "confidence": 0.85,
            "rationale": "Character arc expertise for scene building",
        },
    ]})

    with patch(
        "app.services.pipeline_composer.chat_completion",
        new_callable=AsyncMock,
        return_value=mock_response,
    ) as mock_chat:
        composer = PipelineComposer()

        # First call -- should call AI
        result1 = await composer.compose_pipeline(owner_id, db_session)

        # Capture result1 identifying data immediately (before second call's
        # full-replace write expires these ORM instances via db.commit())
        result1_keys = {
            (str(m.agent_id), m.phase, m.subsection_key) for m in result1
        }

        # Second call with same agents -- should hit cache
        result2 = await composer.compose_pipeline(owner_id, db_session)

    # AI should have been called exactly once (cache hit on second call)
    assert mock_chat.call_count == 1

    # Both calls should produce mappings with the same agent_ids and structure
    result2_keys = {
        (str(m.agent_id), m.phase, m.subsection_key) for m in result2
    }
    assert result1_keys == result2_keys
    assert len(result2) == 2


def test_cosmetic_change_no_recompose():
    """is_semantic_change returns False for cosmetic-only field updates
    (name, color, icon). These should NOT trigger pipeline re-composition."""
    composer = PipelineComposer()

    # Individual cosmetic fields
    assert composer.is_semantic_change({"name": "New Name"}) is False
    assert composer.is_semantic_change({"color": "#ff0000"}) is False
    assert composer.is_semantic_change({"icon": "star"}) is False

    # Combined cosmetic fields
    assert composer.is_semantic_change({"name": "X", "color": "#Y", "icon": "Z"}) is False

    # Empty update should also be False
    assert composer.is_semantic_change({}) is False


def test_semantic_change_invalidates_cache(db_session, owner_id, make_agent):
    """is_semantic_change returns True for semantic field updates. Cache key
    differs when semantic fields change on an agent."""
    composer = PipelineComposer()

    # Individual semantic fields
    assert composer.is_semantic_change({"description": "new desc"}) is True
    assert composer.is_semantic_change({"system_prompt_template": "new prompt"}) is True
    assert composer.is_semantic_change({"agent_type": "orchestrator"}) is True

    # Mixed cosmetic + semantic = semantic (True)
    assert composer.is_semantic_change({"name": "X", "description": "Y"}) is True

    # Verify cache key changes when semantic fields change
    agent = make_agent(
        name="Key Test Agent",
        system_prompt_template="Original prompt",
        description="Original description",
    )
    key_before = composer._compute_cache_key([agent])

    # Mutate a semantic field in-place
    agent.system_prompt_template = "Changed prompt"
    key_after = composer._compute_cache_key([agent])

    assert key_before != key_after, (
        "Cache key must differ when system_prompt_template changes"
    )

    # Also verify SEMANTIC_FIELDS constant is correct
    assert SEMANTIC_FIELDS == {"system_prompt_template", "description", "agent_type"}
