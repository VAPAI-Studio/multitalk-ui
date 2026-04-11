# backend/app/api/endpoints/breakdown_chat.py

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.services.ai_provider import chat_completion, chat_completion_stream

logger = logging.getLogger(__name__)

router = APIRouter()


def _verify_project_ownership(db: Session, project_id: UUID, user_id: UUID) -> database.Project:
    """Verify user owns the project. Returns project or raises 404."""
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _build_breakdown_system_prompt(
    shots: list[schemas.BreakdownChatShotContext],
    elements: list[schemas.BreakdownChatElementContext],
) -> str:
    """Build a system prompt with injected shots and breakdown elements context."""
    prompt_parts = [
        "You are a filmmaking and breakdown assistant. You help users plan their "
        "shots, manage breakdown elements, and make production decisions. You have "
        "full context about the current project's shotlist and breakdown elements.",
        "",
        "When discussing shots, reference them by their shot number (e.g., Shot #1). "
        "When discussing breakdown elements, reference them by name and category.",
        "",
        "When the user asks you to create a new shot, describe what you would create "
        "in your response. When the user asks you to modify an existing shot, describe "
        "the changes in your response. Include shot numbers, scene associations, and "
        "field values in your description.",
        "",
    ]

    # Add shots context
    if shots:
        prompt_parts.append("## Current Shotlist")
        prompt_parts.append("")
        for shot in shots:
            scene_info = f" (Scene: {shot.scene_item_id})" if shot.scene_item_id else " (Unassigned)"
            fields_str = ", ".join(f"{k}: {v}" for k, v in shot.fields.items()) if shot.fields else "No fields set"
            prompt_parts.append(f"- Shot #{shot.shot_number}{scene_info} [{shot.source}]: {fields_str}")
        prompt_parts.append("")
    else:
        prompt_parts.append("## Current Shotlist")
        prompt_parts.append("No shots created yet.")
        prompt_parts.append("")

    # Add breakdown elements context grouped by category
    if elements:
        prompt_parts.append("## Breakdown Elements")
        prompt_parts.append("")
        categories: dict[str, list[schemas.BreakdownChatElementContext]] = {}
        for elem in elements:
            categories.setdefault(elem.category, []).append(elem)
        for category, items in sorted(categories.items()):
            prompt_parts.append(f"### {category.title()}")
            for item in items:
                desc = f" - {item.description}" if item.description else ""
                prompt_parts.append(f"- {item.name}{desc}")
            prompt_parts.append("")
    else:
        prompt_parts.append("## Breakdown Elements")
        prompt_parts.append("No breakdown elements created yet.")
        prompt_parts.append("")

    prompt_parts.append(
        "Provide helpful, specific advice based on the project context above. "
        "Be concise and actionable."
    )

    return "\n".join(prompt_parts)


async def _extract_shot_action(
    user_message: str,
    assistant_response: str,
    shots_context: list,
    elements_context: list,
) -> dict | None:
    """
    Two-phase extraction: After the AI streams a conversational response,
    make a second JSON-mode call to extract any shot create/modify action.
    Returns None if no action implied, or a dict with type/data.
    """
    extraction_prompt = """You are analyzing a conversation between a user and an AI filmmaking assistant.

Given the user's message and the AI's response, determine if the AI is proposing to CREATE a new shot or MODIFY an existing shot.

CURRENT SHOTS:
{shots}

CURRENT BREAKDOWN ELEMENTS:
{elements}

USER MESSAGE: {user_message}

AI RESPONSE: {assistant_response}

Respond with ONLY valid JSON. If no shot action is implied, return:
{{"action": null}}

If a NEW shot should be created, return:
{{"action": {{"type": "create", "data": {{"scene_item_id": null, "shot_number": <next_available_number>, "fields": {{"shot_size": "<value_or_empty>", "camera_angle": "<value_or_empty>", "camera_movement": "<value_or_empty>", "lens": "<value_or_empty>", "description": "<value_or_empty>", "action": "<value_or_empty>", "dialogue": "<value_or_empty>", "sound": "<value_or_empty>", "characters": "<value_or_empty>", "environment": "<value_or_empty>", "props": "<value_or_empty>", "equipment": "<value_or_empty>", "notes": "<value_or_empty>"}}}}}}}}

If an EXISTING shot should be modified, return:
{{"action": {{"type": "modify", "shot_id": "<existing_shot_id>", "data": {{"fields": {{<only_changed_fields>}}}}}}}}

Rules:
- Only return an action if the AI explicitly describes creating or changing a shot
- For create: populate fields from the AI's description, leave unmentioned fields as empty strings
- For modify: only include fields that are being changed
- shot_number for new shots should be max(existing shot numbers) + 1, or 1 if no shots exist
- If the AI is just discussing shots without proposing changes, return {{"action": null}}
"""

    # Format shots and elements for the extraction prompt
    shots_text = "\n".join(
        f"Shot #{s.shot_number} (id: {s.id}): {json.dumps(s.fields)}"
        if hasattr(s, "shot_number")
        else f"Shot #{s.get('shot_number', '?')} (id: {s.get('id', '?')}): {json.dumps(s.get('fields', {}))}"
        for s in (shots_context if shots_context else [])
    ) or "No shots yet."

    elements_text = "\n".join(
        f"[{e.category}] {e.name}: {e.description}"
        if hasattr(e, "category")
        else f"[{e.get('category', '?')}] {e.get('name', '?')}: {e.get('description', '')}"
        for e in (elements_context if elements_context else [])
    ) or "No elements yet."

    filled_prompt = extraction_prompt.format(
        shots=shots_text,
        elements=elements_text,
        user_message=user_message,
        assistant_response=assistant_response,
    )

    try:
        result_text = await chat_completion(
            messages=[{"role": "user", "content": filled_prompt}],
            temperature=0.1,
            max_tokens=1000,
            json_mode=True,
        )
        result = json.loads(result_text)
        action = result.get("action")
        if action and isinstance(action, dict) and action.get("type") in ("create", "modify"):
            return action
        return None
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(f"Shot action extraction failed to parse: {e}")
        return None


@router.post("/{project_id}/stream")
async def breakdown_chat_stream(
    project_id: UUID,
    body: schemas.BreakdownChatRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream a breakdown-aware AI response."""
    _verify_project_ownership(db, project_id, current_user.id)

    system_prompt = _build_breakdown_system_prompt(body.shots_context, body.elements_context)

    messages = (
        [{"role": "system", "content": system_prompt}]
        + [{"role": m.role, "content": m.content} for m in body.message_history]
        + [{"role": "user", "content": body.content}]
    )

    async def generate():
        full_text = ""
        try:
            async for chunk in chat_completion_stream(
                messages=messages,
                temperature=0.7,
                max_tokens=2000,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except Exception as e:
            logger.error(f"Breakdown chat streaming error: {e}")
            full_text = full_text or "I had trouble generating a response."

        # Two-phase extraction: extract shot action from the AI response
        shot_action = None
        try:
            shot_action = await _extract_shot_action(
                body.content, full_text, body.shots_context, body.elements_context
            )
        except Exception as e:
            logger.error(f"Shot action extraction error: {e}")

        yield f"data: {json.dumps({'done': True, 'full_text': full_text, 'shot_action': shot_action})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
