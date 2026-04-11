# backend/app/services/screenplay_import_service.py

"""
Screenplay import service. Parses a pasted screenplay and extracts
structured data to populate all wizard phases:
- Characters → story.characters ListItems
- Story beats → story.story PhaseData fields
- Scene breakdowns → scenes.scene_list ListItems
- Screenplay text → write.screenplay_editor ScreenplayContent records
"""

import json
import logging
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from .ai_provider import chat_completion, chat_completion_structured

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models for structured AI output
# ---------------------------------------------------------------------------

class ImportedCharacter(BaseModel):
    """A character extracted from the screenplay."""
    name: str = Field(description="Character name as it appears in the screenplay (CAPS)")
    item_type: str = Field(description="One of: protagonist, antagonist, supporting")
    core_trait: str = Field(default="", description="The defining quality that drives their actions")
    fatal_flaw: str = Field(default="", description="The weakness that creates internal conflict")
    want_vs_need: str = Field(default="", description="What they pursue vs what they actually need")
    dialogue_style: str = Field(default="", description="How they speak — rhythm, vocabulary, verbal habits")
    visual_description_prompt: str = Field(
        default="",
        description="Physical appearance for image generation — age, build, hair, clothing, distinguishing features"
    )


class ImportedScene(BaseModel):
    """A scene extracted from the screenplay."""
    summary: str = Field(description="1-2 sentence scene summary")
    arena: str = Field(default="", description="Where and when this scene takes place")
    inciting_incident: str = Field(default="", description="What triggers the scene's conflict")
    goal: str = Field(default="", description="What the protagonist wants in this scene")
    subtext: str = Field(default="", description="What characters are really feeling beneath the surface")
    turning_point: str = Field(default="", description="The moment the scene shifts direction")
    crisis: str = Field(default="", description="The critical decision point")
    climax: str = Field(default="", description="The scene's peak moment")
    fallout: str = Field(default="", description="Immediate consequences")
    push_forward: str = Field(default="", description="How this scene propels into the next")
    screenplay_text: str = Field(description="The raw screenplay text for this scene")


class ImportedStoryBeats(BaseModel):
    """Story structure beats extracted from the screenplay."""
    hook_opening_image: str = Field(default="", description="The opening image or hook")
    status_quo: str = Field(default="", description="The world before change")
    inciting_incident: str = Field(default="", description="The event that disrupts the status quo")
    point_of_no_return: str = Field(default="", description="When the protagonist is committed")
    rising_complications: str = Field(default="", description="Escalating obstacles")
    twist_revelation: str = Field(default="", description="A major reveal or reversal")
    climax: str = Field(default="", description="The final confrontation")
    resolution_closing_image: str = Field(default="", description="The new world after change")


class ImportResult(BaseModel):
    """Complete import result from AI."""
    characters: List[ImportedCharacter] = Field(description="All characters found in the screenplay")
    story_beats: ImportedStoryBeats = Field(description="Story structure beats mapped from the screenplay")
    scenes: List[ImportedScene] = Field(description="Scene-by-scene breakdown with screenplay text")
    logline: str = Field(default="", description="One-sentence summary of the entire story")
    theme: str = Field(default="", description="The central theme or message")
    genre: str = Field(default="", description="Genre classification")
    tone: str = Field(default="", description="Overall tone")


# ---------------------------------------------------------------------------
# Import service
# ---------------------------------------------------------------------------

IMPORT_SYSTEM_PROMPT = """You are an expert script analyst performing a comprehensive screenplay import.

You will receive a complete screenplay (or partial screenplay). Your job is to extract ALL structured data needed to populate a screenwriting assistant's project phases.

RULES:
1. CHARACTERS: Identify all speaking characters. The first/most prominent is the protagonist. Classify each as protagonist, antagonist, or supporting. Extract personality traits and visual descriptions from context clues in the screenplay (action lines describing them, their dialogue patterns, wardrobe mentions).

2. STORY BEATS: Map the screenplay's narrative to the 8-beat structure (hook, status quo, inciting incident, point of no return, rising complications, twist/revelation, climax, resolution). Every beat should reference specific moments from the screenplay.

3. SCENES: Split the screenplay by scene headings (INT./EXT. lines). Each scene gets a structured breakdown. Include the EXACT screenplay text for each scene in the screenplay_text field — copy it verbatim, do not summarize.

4. If the screenplay is incomplete or unconventional, do your best to extract what's there. Fill in reasonable inferences for missing beats.

5. For visual_description_prompt on characters: describe physical appearance based on any clues in the screenplay (action lines, wardrobe notes, age references). If no clues, write a reasonable default based on the character's role and story context."""


async def import_screenplay(screenplay_text: str, guidance: str = "") -> Dict:
    """
    Parse a pasted screenplay and return structured data for all wizard phases.

    Returns a dict with keys matching what apply_import_to_db expects:
    - characters: list of character dicts
    - story_beats: dict of beat fields
    - scenes: list of scene dicts
    - screenplays: list of screenplay content dicts
    - logline, theme, genre, tone: top-level fields
    """
    user_prompt = f"""## Screenplay to Import

{screenplay_text}

{f'## Additional Guidance\n{guidance}' if guidance else ''}

Analyze this screenplay and extract all structured data."""

    try:
        result = await chat_completion_structured(
            messages=[
                {"role": "system", "content": IMPORT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_model=ImportResult,
            temperature=0.2,
            max_tokens=12000,
        )

        # Convert to the dict format that apply_import_to_db expects
        characters = [c.model_dump() for c in result.characters]
        scenes = [s.model_dump() for s in result.scenes]
        story_beats = result.story_beats.model_dump()

        # Build screenplay content entries (matching script_writer_wizard output format)
        screenplays = []
        for i, scene in enumerate(result.scenes):
            screenplays.append({
                "episode_index": i,
                "title": scene.summary[:80],
                "content": scene.screenplay_text,
            })

        return {
            "characters": characters,
            "story_beats": story_beats,
            "scenes": scenes,
            "screenplays": screenplays,
            "fields": {
                "logline": result.logline,
                "theme": result.theme,
                "genre": result.genre,
                "tone": result.tone,
            },
        }

    except Exception as e:
        logger.error(f"Screenplay import failed: {e}")
        raise
