# backend/app/utils/bible_context.py

"""
Shared helper to build series bible context for AI prompt injection.

When a project is an episode (has show_id), this function fetches the
associated show's bible data and formats it as a context string for
AI generation prompts. Returns None for standalone film projects.
"""

from typing import Optional
from sqlalchemy.orm import Session
from screenwriter.models.database import Project, Show


def build_bible_context(db: Session, project: Project) -> Optional[str]:
    """Build bible context string for episode projects. Returns None for standalone films."""
    if not project.show_id:
        return None

    show = db.query(Show).filter(Show.id == str(project.show_id)).first()
    if not show:
        return None

    # Check if there's any actual bible content or duration
    has_bible_content = any([
        show.bible_characters, show.bible_world_setting,
        show.bible_season_arc, show.bible_tone_style
    ])
    if not has_bible_content and not show.episode_duration_minutes:
        return None

    parts = []
    parts.append("## Series Bible Context")
    parts.append(f"**Show:** {show.title}")

    if show.episode_duration_minutes:
        parts.append(f"**Target Episode Duration:** {show.episode_duration_minutes} minutes")

    if show.bible_characters:
        parts.append(f"\n### Characters\n{show.bible_characters}")

    if show.bible_world_setting:
        parts.append(f"\n### World & Setting\n{show.bible_world_setting}")

    if show.bible_season_arc:
        parts.append(f"\n### Season Arc\n{show.bible_season_arc}")

    if show.bible_tone_style:
        parts.append(f"\n### Tone & Style\n{show.bible_tone_style}")

    return "\n".join(parts)
