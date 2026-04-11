# backend/app/tests/test_bible_injection.py

"""
Tests for bible context injection into AI generation prompts.

BIBL-04: When a project is an episode (has show_id), all AI calls receive
series bible context. Standalone projects (show_id=NULL) are unaffected.

Test classes:
  - TestBuildBibleContext: unit tests for the build_bible_context helper
  - TestTemplateAIBibleInjection: _build_project_context prepends bible when provided
  - TestOpenAIBibleInjection: _get_system_prompt / review_section with bible context
  - TestBreakdownBibleInjection: _call_ai_extraction / extract with bible context
"""

import uuid

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from screenwriter.models.database import Project, Show
from screenwriter.services.template_ai_service import template_ai_service
from screenwriter.services.openai_service import OpenAIService
from screenwriter.services.breakdown_service import (
    breakdown_service,
    ExtractionContext,
    ExtractionResponse,
    ExtractedElement,
    ExtractedSceneAppearance,
)
from screenwriter.models.database import Framework, SectionType


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _create_show(db_session, **overrides):
    """Create a Show record with optional overrides."""
    defaults = {
        "id": str(uuid.uuid4()),
        "owner_id": MOCK_USER_ID,
        "title": "Breaking Bad",
        "description": "A chemistry teacher turns to meth cooking",
        "bible_characters": "Walter White - chemistry teacher turned drug lord",
        "bible_world_setting": "Albuquerque, New Mexico",
        "bible_season_arc": "Walter's descent from teacher to Heisenberg",
        "bible_tone_style": "Dark, tense, morally complex",
        "episode_duration_minutes": 47,
    }
    defaults.update(overrides)
    show = Show(**defaults)
    db_session.add(show)
    db_session.flush()
    return show


def _create_project(db_session, show=None, **overrides):
    """Create a Project record, optionally linked to a show."""
    defaults = {
        "id": str(uuid.uuid4()),
        "owner_id": MOCK_USER_ID,
        "title": "Pilot Episode",
    }
    if show:
        defaults["show_id"] = str(show.id)
        defaults["episode_number"] = 1
    defaults.update(overrides)
    project = Project(**defaults)
    db_session.add(project)
    db_session.flush()
    return project


# ===========================================================================
# TestBuildBibleContext
# ===========================================================================


class TestBuildBibleContext:
    """Unit tests for build_bible_context helper function."""

    def test_standalone_project_returns_none(self, db_session):
        """Standalone project (no show_id) returns None."""
        from screenwriter.utils.bible_context import build_bible_context

        project = _create_project(db_session)
        result = build_bible_context(db_session, project)
        assert result is None

    def test_empty_bible_returns_none(self, db_session):
        """Show with all empty bible fields and no duration returns None."""
        from screenwriter.utils.bible_context import build_bible_context

        show = _create_show(
            db_session,
            bible_characters="",
            bible_world_setting="",
            bible_season_arc="",
            bible_tone_style="",
            episode_duration_minutes=None,
        )
        project = _create_project(db_session, show=show)
        result = build_bible_context(db_session, project)
        assert result is None

    def test_full_bible_returns_formatted_string(self, db_session):
        """Show with all bible fields returns formatted context string."""
        from screenwriter.utils.bible_context import build_bible_context

        show = _create_show(db_session)
        project = _create_project(db_session, show=show)
        result = build_bible_context(db_session, project)

        assert result is not None
        assert "## Series Bible Context" in result
        assert "Breaking Bad" in result
        assert "47 minutes" in result
        assert "### Characters" in result
        assert "Walter White" in result
        assert "### World & Setting" in result
        assert "Albuquerque" in result
        assert "### Season Arc" in result
        assert "### Tone & Style" in result

    def test_partial_bible_omits_empty_sections(self, db_session):
        """Only non-empty bible sections are included in the output."""
        from screenwriter.utils.bible_context import build_bible_context

        show = _create_show(
            db_session,
            bible_characters="Jesse Pinkman",
            bible_world_setting="",
            bible_season_arc="",
            bible_tone_style="",
            episode_duration_minutes=22,
        )
        project = _create_project(db_session, show=show)
        result = build_bible_context(db_session, project)

        assert result is not None
        assert "### Characters" in result
        assert "Jesse Pinkman" in result
        assert "### World & Setting" not in result
        assert "### Season Arc" not in result
        assert "### Tone & Style" not in result
        assert "22 minutes" in result

    def test_missing_show_returns_none(self, db_session):
        """Project with show_id pointing to non-existent show returns None."""
        from screenwriter.utils.bible_context import build_bible_context

        project = _create_project(
            db_session, show_id=str(uuid.uuid4()), episode_number=1
        )
        result = build_bible_context(db_session, project)
        assert result is None


# ===========================================================================
# TestTemplateAIBibleInjection
# ===========================================================================


class TestTemplateAIBibleInjection:
    """Tests for bible context injection in template_ai_service._build_project_context."""

    @patch("app.services.template_ai_service.get_template")
    def test_prepends_bible_context(self, mock_get_template):
        """When bible_context is provided, it appears before the project context."""
        mock_get_template.return_value = {"name": "Short Movie"}

        bible = "## Series Bible Context\n**Show:** Test Show\n### Characters\nHero - the main character"
        result = template_ai_service._build_project_context(
            project_data={},
            template_id="short_movie",
            project_title="My Film",
            bible_context=bible,
        )

        assert result.startswith("## Series Bible Context")
        assert "---" in result
        # Project title should come after
        idx_bible = result.index("## Series Bible Context")
        idx_project = result.index("Project: My Film")
        assert idx_bible < idx_project

    @patch("app.services.template_ai_service.get_template")
    def test_unchanged_when_none(self, mock_get_template):
        """When bible_context is None, output is unchanged."""
        mock_get_template.return_value = {"name": "Short Movie"}

        result_with_none = template_ai_service._build_project_context(
            project_data={},
            template_id="short_movie",
            project_title="My Film",
            bible_context=None,
        )
        result_without = template_ai_service._build_project_context(
            project_data={},
            template_id="short_movie",
            project_title="My Film",
        )

        assert result_with_none == result_without
        assert "Series Bible" not in result_with_none


# ===========================================================================
# TestOpenAIBibleInjection
# ===========================================================================


class TestOpenAIBibleInjection:
    """Tests for bible context injection in openai_service."""

    def test_get_system_prompt_prepends_bible_context(self):
        """_get_system_prompt prepends bible_context when provided."""
        service = OpenAIService()
        bible = "## Series Bible Context\n**Show:** Test Show"

        result = service._get_system_prompt(
            Framework.THREE_ACT, SectionType.CLIMAX, bible_context=bible
        )

        assert result.startswith("## Series Bible Context")
        assert "---" in result
        assert "Three-Act" in result

    def test_get_system_prompt_unchanged_without_bible(self):
        """_get_system_prompt unchanged when bible_context is None."""
        service = OpenAIService()

        result_none = service._get_system_prompt(
            Framework.THREE_ACT, SectionType.CLIMAX, bible_context=None
        )
        result_default = service._get_system_prompt(
            Framework.THREE_ACT, SectionType.CLIMAX
        )

        assert result_none == result_default
        assert "Series Bible" not in result_none

    @patch("app.services.openai_service.chat_completion", new_callable=AsyncMock)
    async def test_review_section_accepts_bible_context(self, mock_ai):
        """review_section passes bible_context through to _get_system_prompt."""
        mock_ai.return_value = '{"issues": [], "suggestions": []}'
        service = OpenAIService()
        bible = "## Series Bible Context\n**Show:** Test Show"

        await service.review_section(
            section_id="test-id",
            text="Test text",
            framework=Framework.THREE_ACT,
            section_type=SectionType.CLIMAX,
            bible_context=bible,
        )

        # Check the system message includes bible context
        call_args = mock_ai.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        system_msg = messages[0]["content"]
        assert "## Series Bible Context" in system_msg


# ===========================================================================
# TestBreakdownBibleInjection
# ===========================================================================


class TestBreakdownBibleInjection:
    """Tests for bible context injection in breakdown_service."""

    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_call_ai_extraction_prepends_bible_context(self, mock_ai):
        """_call_ai_extraction prepends bible_context to user prompt when provided."""
        mock_ai.return_value = ExtractionResponse(elements=[])
        bible = "## Series Bible Context\n**Show:** Test Show"

        ctx = ExtractionContext(
            screenplay_texts=["INT. ROOM - DAY\nAction."],
            character_names=["Hero"],
            scene_summaries=[{"id": "s1", "summary": "Scene 1", "sort_order": 0}],
            project_title="Test Film",
        )

        await breakdown_service._call_ai_extraction(ctx, bible_context=bible)

        call_args = mock_ai.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        user_msg = messages[1]["content"]
        assert user_msg.startswith("## Series Bible Context")
        assert "---" in user_msg

    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_call_ai_extraction_unchanged_without_bible(self, mock_ai):
        """_call_ai_extraction user prompt unchanged when bible_context is None."""
        mock_ai.return_value = ExtractionResponse(elements=[])

        ctx = ExtractionContext(
            screenplay_texts=["INT. ROOM - DAY\nAction."],
            character_names=["Hero"],
            scene_summaries=[{"id": "s1", "summary": "Scene 1", "sort_order": 0}],
            project_title="Test Film",
        )

        await breakdown_service._call_ai_extraction(ctx)

        call_args = mock_ai.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        user_msg = messages[1]["content"]
        assert user_msg.startswith("# Screenplay: Test Film")

    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    async def test_extract_accepts_bible_context(self, mock_ai, db_session):
        """extract() passes bible_context through to _call_ai_extraction."""
        from screenwriter.models.database import ScreenplayContent, PhaseData, ListItem

        project_id = str(uuid.uuid4())
        project = Project(id=project_id, owner_id=MOCK_USER_ID, title="Test")
        db_session.add(project)
        db_session.flush()

        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. ROOM - DAY\nAction.",
        )
        db_session.add(sc)
        db_session.flush()
        db_session.commit()

        mock_ai.return_value = ExtractionResponse(elements=[])

        bible = "## Series Bible Context\n**Show:** Test Show"
        await breakdown_service.extract(db_session, project_id, bible_context=bible)

        # Verify the AI was called with bible context in user prompt
        call_args = mock_ai.call_args
        messages = call_args.kwargs.get("messages", call_args[1].get("messages", []))
        user_msg = messages[1]["content"]
        assert "## Series Bible Context" in user_msg
