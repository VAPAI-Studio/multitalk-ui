# backend/app/services/template_ai_service.py

import json
import logging
import re
from typing import Dict, List, Optional

from screenwriter.config import settings
from screenwriter.templates import get_template
from .ai_provider import chat_completion, chat_completion_stream

logger = logging.getLogger(__name__)


class TemplateAIService:

    def _build_project_context(
        self,
        project_data: Dict,
        template_id: str,
        list_items: Optional[Dict[str, list]] = None,
        project_title: Optional[str] = None,
        bible_context: Optional[str] = None,
    ) -> str:
        """Build comprehensive project context string from all phase data and list items."""
        template = get_template(template_id)
        context_parts = []
        if bible_context:
            context_parts.append(bible_context)
            context_parts.append("---")
        if project_title:
            context_parts.append(f"Project: {project_title}")
        context_parts.append(f"Template: {template['name']}")

        for phase_key, subsections in project_data.items():
            if isinstance(subsections, dict):
                for sub_key, content in subsections.items():
                    if content and isinstance(content, dict):
                        filled = {k: v for k, v in content.items() if v}
                        if filled:
                            context_parts.append(f"\n## {phase_key} > {sub_key}")
                            for field_key, value in filled.items():
                                context_parts.append(f"- {field_key}: {value}")

                    # Render list items for this subsection if any
                    items_key = f"{phase_key}.{sub_key}"
                    if list_items and items_key in list_items:
                        items = list_items[items_key]
                        if items:
                            context_parts.append(f"\n## {phase_key} > {sub_key} (items)")
                            for item in items:
                                item_type = item.get("item_type", "item")
                                name = item.get("name", f"{item_type}")
                                context_parts.append(f"\n### {item_type}: {name}")
                                for k, v in item.items():
                                    if v and k not in ("item_type",):
                                        context_parts.append(f"- {k}: {v}")

        return "\n".join(context_parts)

    async def wizard_generate(
        self,
        wizard_type: str,
        config: Dict,
        project_context: str,
        template_id: str
    ) -> Dict:
        """Run a wizard generation (beats, episodes, scenes, scripts)."""
        template = get_template(template_id)

        if wizard_type == "idea_wizard":
            return await self._generate_idea(config, project_context, template)
        elif wizard_type == "scene_wizard":
            return await self._generate_scenes(config, project_context, template)
        elif wizard_type == "script_writer_wizard":
            return await self._generate_scripts(config, project_context, template)
        elif wizard_type == "import_and_align":
            return await self._import_screenplay(config)
        else:
            raise ValueError(f"Unknown wizard type: {wizard_type}")

    async def _import_screenplay(self, config: Dict) -> Dict:
        """Import an existing screenplay and extract structured data for all phases."""
        from .screenplay_import_service import import_screenplay
        screenplay_text = config.get("screenplay_text", "")
        guidance = config.get("guidance", "")
        if not screenplay_text.strip():
            return {"error": "No screenplay text provided"}
        return await import_screenplay(screenplay_text, guidance)

    async def _generate_idea(self, config: Dict, project_context: str, template: Dict) -> Dict:
        """Take partial idea fields and generate a fully fleshed-out idea."""
        genre = config.get("genre", "")
        initial_idea = config.get("initial_idea", "")
        tone = config.get("tone", "")
        target_audience = config.get("target_audience", "")
        runtime_target = config.get("runtime_target", "")
        guidance = config.get("custom_guidance", "")

        current_values = {
            k: v for k, v in {
                "genre": genre, "initial_idea": initial_idea, "tone": tone,
                "target_audience": target_audience, "runtime_target": runtime_target,
            }.items() if v
        }

        prompt = f"""You are an expert screenwriting development partner.

## Project Context
{project_context}

## Current Idea Fields
{json.dumps(current_values, indent=2) if current_values else "No fields filled in yet."}

{f'Custom guidance: {guidance}' if guidance else ''}

## Task
Based on whatever the user has provided (even if it's very little), generate a fully developed story idea. Fill in or expand ALL of the following fields:

- genre: The genre(s) of the story
- initial_idea: A compelling 2-3 paragraph story concept that captures the core premise, central conflict, and what makes it unique
- tone: The overall tone and mood
- target_audience: Who this story is for and why it will appeal to them

If the user already provided values, enhance and expand them rather than replacing. If fields are empty, create compelling content that fits with whatever else has been provided.

Return a JSON object with exactly these keys: "genre", "initial_idea", "tone", "target_audience"."""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert screenwriting development partner. Return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.8,
                max_tokens=2000,
                json_mode=True,
            )
            result = json.loads(text)
            return {"fields": result}
        except Exception as e:
            logger.error(f"Idea generation error: {e}")
            return {"fields": {}, "error": str(e)}

    def _get_wizard_config(self, template: Dict, wizard_key: str) -> Dict:
        """Find wizard_config from template by subsection key."""
        for phase in template.get("phases", []):
            for sub in phase.get("subsections", []):
                if sub.get("key") == wizard_key:
                    return sub.get("wizard_config", {})
        return {}

    def _build_field_instructions(self, field_emphasis: Dict) -> str:
        """Build per-field instructions based on emphasis levels."""
        field_labels = {
            "summary": "One-line scene description",
            "arena": "The location/setting",
            "inciting_incident": "What triggers the scene's conflict",
            "goal": "What the character wants in this scene",
            "subtext": "The emotional undercurrent beneath words and actions",
            "turning_point": "The key moment of change",
            "crisis": "The worst moment / tightest pressure",
            "climax": "How the scene peaks",
            "fallout": "Immediate consequences",
            "push_forward": "How this connects to the next scene",
        }
        lines = []
        for key in ["summary", "arena", "inciting_incident", "goal", "subtext",
                     "turning_point", "crisis", "climax", "fallout", "push_forward"]:
            emphasis = field_emphasis.get(key, "essential").upper()
            desc = field_labels[key]
            lines.append(f"- {key}: {desc} ({emphasis})")
        return "\n".join(lines)

    def _build_character_section(self, characters: list) -> str:
        """Build a formatted character section for the prompt."""
        if not characters:
            return ""
        parts = ["\n## Characters"]
        for char in characters:
            item_type = char.get("item_type", "character")
            name = char.get("name", "Unnamed")
            parts.append(f"\n### {item_type.replace('_', ' ').title()}: {name}")
            for k, v in char.items():
                if v and k not in ("item_type", "name"):
                    parts.append(f"- {k.replace('_', ' ').title()}: {v}")
        return "\n".join(parts)

    async def _generate_scenes(self, config: Dict, project_context: str, template: Dict) -> Dict:
        count_pref = str(config.get("count", "auto"))
        guidance = config.get("custom_guidance", "")
        characters = config.get("_characters", [])
        runtime_target = config.get("runtime_target", "")

        # Get consolidated config from wizard_config
        wizard_config = self._get_wizard_config(template, "scene_wizard")
        template_guidance = wizard_config.get("guidance_default", "")
        beat_mapping = wizard_config.get("beat_mapping_strategy", "")

        # All fields essential
        field_emphasis = {k: "essential" for k in [
            "summary", "arena", "inciting_incident", "goal", "subtext",
            "turning_point", "crisis", "climax", "fallout", "push_forward"
        ]}
        field_instructions = self._build_field_instructions(field_emphasis)
        character_section = self._build_character_section(characters)

        # Parse runtime for scene count guidance
        runtime_minutes = 10
        if runtime_target:
            match = re.search(r'(\d+)', runtime_target)
            if match:
                runtime_minutes = int(match.group(1))

        # Build count instruction
        if count_pref == "auto" or not count_pref:
            count_instruction = (
                f"Determine the optimal number of scenes for a {runtime_minutes}-minute short film. "
                f"Use the story beats and runtime to decide — typically {max(3, runtime_minutes // 2)}-{runtime_minutes} scenes. "
                f"Not all scenes need equal length: mix short punchy scenes with longer dramatic ones. "
                f"Remember: 1 screenplay page = 1 minute."
            )
        else:
            count_instruction = f"Generate {count_pref} scenes."

        prompt = f"""You are an expert short film screenwriting assistant specializing in scene structure planning.

## Project Context
{project_context}
{character_section}

## Scene Generation Task

### Scene Count
{count_instruction}

{template_guidance}

{"### Beat-to-Scene Mapping Strategy" + chr(10) + beat_mapping if beat_mapping else ""}

{"### Target Runtime: " + runtime_target if runtime_target else ""}

{"### Additional Guidance" + chr(10) + guidance if guidance else ""}

### Scene Field Requirements
Each scene uses these 10 fields. All fields are essential:

{field_instructions}

### Important Guidelines
- Explicitly reference the story beats from the project context. Each scene should map to one or more specific beats.
- Reference characters BY NAME. Show which characters appear in each scene and what they want.
- Each scene's summary should be a clear, visual one-line description.
- The push_forward field should create clear causal or thematic connections between scenes.
- Ensure the overall scene sequence covers the complete story arc from opening hook through resolution.

Return a JSON object with key "scenes" containing an array of scene objects. Each scene object must
have all 10 field keys (summary, arena, inciting_incident, goal, subtext, turning_point, crisis,
climax, fallout, push_forward)."""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert short film scene structure planner. Return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.8,
                max_tokens=4000,
                json_mode=True,
            )
            result = json.loads(text)
            return {"scenes": result.get("scenes", [])}
        except Exception as e:
            logger.error(f"Scene generation error: {e}")
            return {"scenes": [], "error": str(e)}

    def _compute_page_budgets(self, episodes: list, runtime_minutes: int) -> list[float]:
        """Assign a page budget per scene with natural variation.

        Key dramatic scenes (climax, revelation, inciting incident) get more room.
        Opening/closing scenes are tighter. Total sums to runtime_minutes pages.
        """
        n = len(episodes)
        if n == 0:
            return []

        # Start with equal distribution
        base = runtime_minutes / n
        weights = []

        for i, ep in enumerate(episodes):
            summary_lower = (ep.get("summary", "") + " " + ep.get("climax", "")).lower()
            w = 1.0

            # Climax / revelation scenes get more weight
            if any(kw in summary_lower for kw in ("climax", "revelation", "confrontation", "expose", "fail", "broadcast")):
                w = 1.6
            # Opening scene — punchy hook
            elif i == 0:
                w = 0.6
            # Closing scene — can be brief and powerful
            elif i == n - 1:
                w = 0.5
            # Rising action / complications get slightly more
            elif any(kw in summary_lower for kw in ("complication", "rising", "build", "escalat")):
                w = 1.2
            # Transitional / setup scenes stay lean
            elif any(kw in summary_lower for kw in ("transition", "montage", "ritual", "routine")):
                w = 0.7

            weights.append(w)

        # Normalize so total = runtime_minutes
        total_w = sum(weights)
        budgets = [(w / total_w) * runtime_minutes for w in weights]

        # Enforce minimum of 0.3 pages
        budgets = [max(0.3, b) for b in budgets]

        return budgets

    async def _generate_scripts(self, config: Dict, project_context: str, template: Dict) -> Dict:
        episodes = config.get("episodes", [])
        runtime_target = config.get("runtime_target", "")
        guidance = config.get("custom_guidance", "")

        if not episodes:
            return {"screenplays": [], "error": "No episodes/scenes provided to write scripts for."}

        # Parse runtime target into page budget (1 page = 1 minute)
        runtime_minutes = 10  # default for short films
        if runtime_target:
            match = re.search(r'(\d+)', runtime_target)
            if match:
                runtime_minutes = int(match.group(1))

        page_budgets = self._compute_page_budgets(episodes, runtime_minutes)

        # Build a brief outline of ALL scenes with page targets
        scene_outline = "\n".join(
            f"  {i + 1}. [{page_budgets[i]:.1f} pg] {ep.get('summary', f'Scene {i + 1}')}"
            for i, ep in enumerate(episodes)
        )

        screenplays = []
        for i, ep in enumerate(episodes):
            summary = ep.get("summary", f"Scene {i + 1}")
            page_target = page_budgets[i]
            line_target = int(page_target * 55)
            max_tokens_for_scene = max(800, int(page_target * 600))

            # Pacing hint based on scene role
            pacing_hint = ""
            if i == 0:
                pacing_hint = "Opening scene — hook the audience fast. Be punchy and visual, minimal dialogue."
            elif i == len(episodes) - 1:
                pacing_hint = "Final scene — land the ending. Can be brief and powerful. Let the image do the work."
            elif page_target > 1.3:
                pacing_hint = "This is a key dramatic moment — give it room to breathe, but earn every line."
            elif page_target < 0.7:
                pacing_hint = "Keep this scene lean and propulsive — it's connective tissue, not a set piece."

            prompt = f"""You are an expert screenwriter writing a short film.

## Project Context
{project_context}

## STRICT PAGE BUDGET
- Total screenplay: {runtime_minutes} pages ({runtime_minutes} minutes)
- This scene's budget: **{page_target:.1f} page(s)** (~{line_target} lines, ~{page_target:.0f} minute(s) of screen time)
- 1 page = 55 lines = 1 minute of screen time (Hollywood standard)
- You MUST stay within this budget. Short films demand economy — every line must earn its place.
- Total scenes: {len(episodes)}

## Full scene outline with page budgets:
{scene_outline}

## YOUR TASK: Write scene {i + 1} of {len(episodes)}
Scene summary: "{summary}"
{f'Pacing note: {pacing_hint}' if pacing_hint else ''}

## Full scene data:
{json.dumps(ep, indent=2)}

{f'Custom guidance: {guidance}' if guidance else ''}

Write a proper screenplay for THIS scene with:
- Scene headings (INT./EXT. LOCATION - TIME)
- Action lines (visual, present tense, concise — 2-3 lines max per action block)
- Character dialogue with character names in CAPS
- Parentheticals only when essential
- STAY WITHIN {line_target} LINES. Count carefully. Do not exceed the page budget.

Return a JSON object with:
- "title": a short title for this scene
- "content": the full screenplay text"""

            try:
                logger.info(f"Generating script for scene {i + 1}/{len(episodes)} (budget: {page_target:.1f} pg): {summary}")
                text = await chat_completion(
                    messages=[
                        {"role": "system", "content": "You are an expert screenwriter. Return valid JSON only. Respect the page budget strictly."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7,
                    max_tokens=max_tokens_for_scene,
                    json_mode=True,
                )
                result = json.loads(text)
                result["episode_index"] = i
                screenplays.append(result)
            except Exception as e:
                logger.error(f"Script generation error for scene {i + 1}: {e}")
                screenplays.append({
                    "episode_index": i,
                    "title": summary,
                    "content": f"[Generation failed: {str(e)}]",
                    "error": str(e),
                })

        # --- Post-generation review passes ---
        # Combine all generated screenplay text for full-script analysis
        full_screenplay_parts = []
        for sp in screenplays:
            if sp.get("content") and not sp.get("error"):
                full_screenplay_parts.append(f"--- Scene {sp.get('episode_index', 0) + 1}: {sp.get('title', '')} ---\n{sp['content']}")

        script_review = None
        if len(full_screenplay_parts) >= 2:
            try:
                full_screenplay = "\n\n".join(full_screenplay_parts)
                review_prompt = f"""You are an expert script doctor reviewing a complete short film screenplay.

## Full Screenplay ({len(full_screenplay_parts)} scenes)
{full_screenplay}

Perform TWO analyses and return a JSON object:

1. **continuity_issues**: Array of factual inconsistencies across scenes. Check for:
   - Wardrobe/appearance changes without justification
   - Props appearing/disappearing between scenes
   - Timeline contradictions (day/night, before/after)
   - Location details that change inconsistently
   - Character names or descriptions that shift
   Each issue: {{"scene_numbers": [int], "issue": "description", "severity": "minor|major"}}

2. **holistic_notes**: Array of story craft observations. Check for:
   - Pacing problems (scenes that drag or rush)
   - Incomplete character arcs
   - Thematic inconsistencies
   - Tension curve issues (does it build properly?)
   - Dialogue that doesn't serve the story
   Each note: {{"area": "pacing|character|theme|tension|dialogue", "note": "description", "scene_numbers": [int]}}

3. **overall_score**: 1-10 rating of screenplay quality
4. **one_line_verdict**: Single sentence assessment

Return valid JSON only."""

                review_text = await chat_completion(
                    messages=[
                        {"role": "system", "content": "You are a professional script doctor. Return valid JSON only."},
                        {"role": "user", "content": review_prompt}
                    ],
                    temperature=0.3,
                    max_tokens=3000,
                    json_mode=True,
                )
                script_review = json.loads(review_text)
                logger.info(f"Script review complete: score={script_review.get('overall_score')}, "
                           f"continuity_issues={len(script_review.get('continuity_issues', []))}, "
                           f"holistic_notes={len(script_review.get('holistic_notes', []))}")
            except Exception as e:
                logger.warning(f"Script review failed (non-blocking): {e}")
                script_review = {"error": str(e)}

        result = {"screenplays": screenplays}
        if script_review:
            result["script_review"] = script_review
        return result

    async def fill_blanks(
        self,
        current_content: Dict,
        subsection_config: Dict,
        project_context: str
    ) -> Dict:
        """Fill empty fields in a subsection or item based on project context."""
        all_fields = []
        if "fields" in subsection_config:
            all_fields = subsection_config["fields"]
        elif "field_groups" in subsection_config:
            for group in subsection_config["field_groups"]:
                all_fields.extend(group.get("fields", []))
        elif "cards" in subsection_config:
            all_fields = subsection_config["cards"]

        empty_fields = [f for f in all_fields if not current_content.get(f.get("key", ""))]
        if not empty_fields:
            return {"content": current_content, "message": "All fields are already filled."}

        field_descriptions = "\n".join(
            f"- {f['key']} ({f['label']}): {f.get('placeholder', f['label'])}" for f in empty_fields
        )

        prompt = f"""You are an expert screenwriting assistant.

## Project Context
{project_context}

## Existing Content
{json.dumps({k: v for k, v in current_content.items() if v}, indent=2)}

## Task
Fill in the following empty fields based on the project context and existing content:
{field_descriptions}

Return a JSON object with the field keys as keys and the generated content as string values."""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert screenwriter. Return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=2000,
                json_mode=True,
            )
            result = json.loads(text)
            return {"content": result}
        except Exception as e:
            logger.error(f"Fill blanks error: {e}")
            return {"content": {}, "error": str(e)}

    async def give_notes(
        self,
        current_content: Dict,
        subsection_config: Dict,
        project_context: str
    ) -> Dict:
        """Provide AI feedback on filled content."""
        prompt = f"""You are an expert screenwriting coach.

## Project Context
{project_context}

## Content to Review
{json.dumps(current_content, indent=2)}

## Task
Review this content and provide specific, actionable notes. Focus on:
- Story structure and coherence
- Character depth and consistency
- Dramatic tension and stakes
- Pacing and engagement
- Any missing elements or weak points

Return a JSON object with key "notes" containing an array of note strings."""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert screenwriting coach. Return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=2000,
                json_mode=True,
            )
            result = json.loads(text)
            return {"notes": result.get("notes", [])}
        except Exception as e:
            logger.error(f"Give notes error: {e}")
            return {"notes": [], "error": str(e)}

    async def chat_respond(
        self,
        user_message: str,
        chat_history: List[Dict],
        system_prompt: str,
        project_context: str
    ) -> str:
        """Generate a contextual chat response."""
        messages = [
            {"role": "system", "content": f"{system_prompt}\n\n## Project Context\n{project_context}"}
        ]
        for msg in chat_history[-20:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        try:
            return await chat_completion(
                messages=messages,
                temperature=0.8,
                max_tokens=2000,
            )
        except Exception as e:
            logger.error(f"Chat error: {e}")
            return "I'm having trouble generating a response right now. Please try again."

    async def chat_respond_stream(
        self,
        user_message: str,
        chat_history: List[Dict],
        system_prompt: str,
        project_context: str
    ):
        """Generate a streaming contextual chat response. Yields text chunks."""
        messages = [
            {"role": "system", "content": f"{system_prompt}\n\n## Project Context\n{project_context}"}
        ]
        for msg in chat_history[-20:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        async for chunk in chat_completion_stream(
            messages=messages,
            temperature=0.8,
            max_tokens=2000,
        ):
            yield chunk

    async def chat_action_stream_message(
        self,
        user_message: str,
        chat_history: List[Dict],
        system_prompt: str,
        project_context: str,
        field_definitions: List[Dict],
        current_content: Dict,
        item_type: Optional[str] = None,
    ):
        """Phase 1: Stream conversational response for action mode. Yields text chunks."""
        fields_desc = "\n".join(
            f"- {f.get('key')}: {f.get('label', f.get('key'))} ({f.get('type', 'text')})"
            for f in field_definitions
        )
        current_desc = json.dumps(
            {k: v for k, v in current_content.items() if v}, indent=2
        ) if current_content else "{}"

        create_section = ""
        if item_type:
            create_section = f"""
## Creating New {item_type.replace('_', ' ').title()}s
You may also create new {item_type.replace('_', ' ')}s. For each new {item_type.replace('_', ' ')} you will create,
describe it conversationally using the available fields above. Be specific about the content of each field."""

        action_stream_prompt = f"""{system_prompt}

## Project Context
{project_context}

## Current Section Fields
Available fields you can modify:
{fields_desc}

## Current Values
{current_desc}
{create_section}
## Instructions
You are in ACTION mode. The user wants you to modify their story fields.
Explain conversationally what changes you will make and why. Be specific about
which fields you will update and what the new values will be.
Do NOT output JSON — respond naturally as a writing partner."""

        messages = [{"role": "system", "content": action_stream_prompt}]
        for msg in chat_history[-20:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        async for chunk in chat_completion_stream(
            messages=messages,
            temperature=0.7,
            max_tokens=2000,
        ):
            yield chunk

    async def chat_action_extract_updates(
        self,
        user_message: str,
        assistant_message: str,
        field_definitions: List[Dict],
        current_content: Dict,
        item_type: Optional[str] = None,
    ) -> Dict:
        """Phase 2: Extract field_updates (and optionally list_item_creates) via JSON-mode call."""
        fields_desc = "\n".join(
            f"- {f.get('key')}: {f.get('label', f.get('key'))} ({f.get('type', 'text')})"
            for f in field_definitions
        )
        current_desc = json.dumps(
            {k: v for k, v in current_content.items() if v}, indent=2
        ) if current_content else "{}"

        if item_type:
            item_label = item_type.replace('_', ' ')
            task_instructions = f"""Based on what the assistant described, return a JSON object with:
- "field_updates": an object mapping field keys to their new string values (for subsection-level edits). Use {{}} if none.
- "list_item_creates": an array of objects, each containing field keys mapped to string values for a NEW {item_label} to create. Use [] if none.

Only include items the assistant explicitly described creating."""
        else:
            task_instructions = """Based on what the assistant described, return a JSON object with exactly one key:
- "field_updates": an object mapping field keys to their new string values.
Use an empty object {} if no changes were described.
Only include fields that the assistant explicitly mentioned changing."""

        extraction_prompt = f"""Extract field updates from this conversation.

## Available fields:
{fields_desc}

## Current values:
{current_desc}

## User asked:
{user_message}

## Assistant responded:
{assistant_message}

## Task:
{task_instructions}"""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "Extract field updates as JSON. Return valid JSON only."},
                    {"role": "user", "content": extraction_prompt}
                ],
                temperature=0.3,
                max_tokens=2000,
                json_mode=True,
            )
            result = json.loads(text)
            return {
                "field_updates": result.get("field_updates", {}),
                "list_item_creates": result.get("list_item_creates", []),
            }
        except Exception as e:
            logger.error(f"Action extract updates error: {e}")
            return {"field_updates": {}, "list_item_creates": []}

    async def chat_with_action(
        self,
        user_message: str,
        chat_history: List[Dict],
        system_prompt: str,
        project_context: str,
        field_definitions: List[Dict],
        current_content: Dict,
    ) -> Dict:
        """Chat that can also modify fields. Returns message + field_updates."""
        fields_desc = "\n".join(
            f"- {f.get('key')}: {f.get('label', f.get('key'))} ({f.get('type', 'text')})"
            for f in field_definitions
        )
        current_desc = json.dumps(
            {k: v for k, v in current_content.items() if v}, indent=2
        ) if current_content else "{}"

        action_prompt = f"""{system_prompt}

## Project Context
{project_context}

## Current Section Fields
Available fields you can modify:
{fields_desc}

## Current Values
{current_desc}

## Instructions
You are in ACTION mode. Respond conversationally to the user AND update fields when appropriate.
You MUST return valid JSON with exactly two keys:
- "message": your conversational response (string)
- "field_updates": an object with field keys and new values to apply. Use an empty object {{}} if no changes are needed.

Only update fields the user asks about or that naturally follow from the conversation. Never overwrite fields the user didn't mention unless they ask you to fill everything."""

        messages = [{"role": "system", "content": action_prompt}]
        for msg in chat_history[-20:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        text = ""
        try:
            text = await chat_completion(
                messages=messages,
                temperature=0.7,
                max_tokens=3000,
                json_mode=True,
            )
            logger.info(f"Action mode raw response (first 500 chars): {text[:500]}")
            result = json.loads(text)
            return {
                "message": result.get("message", ""),
                "field_updates": result.get("field_updates", {}),
            }
        except json.JSONDecodeError as e:
            logger.error(f"Chat with action JSON parse error: {e}\nRaw text: {text[:1000]}")
            # Try to salvage the response as plain text
            return {
                "message": f"[JSON parse error — raw AI response]: {text[:500]}",
                "field_updates": {},
            }
        except Exception as e:
            logger.error(f"Chat with action error: {type(e).__name__}: {e}", exc_info=True)
            return {
                "message": f"[Error: {type(e).__name__}]: {str(e)}",
                "field_updates": {},
            }

    async def analyze_structure(
        self,
        items: List[Dict],
        template_id: str,
        project_context: str
    ) -> Dict:
        """Analyze episode/scene list structure."""
        prompt = f"""You are an expert screenwriting structure analyst.

## Project Context
{project_context}

## Items to Analyze
{json.dumps(items, indent=2)}

## Task
Analyze the structural integrity of this episode/scene list. Look for:
- Pacing issues (too fast, too slow, uneven)
- Missing story beats
- Narrative arc completeness
- Cliffhanger effectiveness (for series)
- Character development progression
- Tonal consistency

Return a JSON object with:
- "overall_score": 1-10 rating
- "strengths": array of strength observations
- "issues": array of structural issues found
- "suggestions": array of specific improvement suggestions"""

        try:
            text = await chat_completion(
                messages=[
                    {"role": "system", "content": "You are an expert screenwriting structure analyst. Return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=3000,
                json_mode=True,
            )
            return json.loads(text)
        except Exception as e:
            logger.error(f"Analyze structure error: {e}")
            return {"overall_score": 0, "strengths": [], "issues": [], "suggestions": [], "error": str(e)}


# Singleton
template_ai_service = TemplateAIService()
