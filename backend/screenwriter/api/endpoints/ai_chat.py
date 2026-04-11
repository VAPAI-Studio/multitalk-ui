# backend/app/api/endpoints/ai_chat.py

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.services.template_ai_service import template_ai_service
from screenwriter.services.agent_review_middleware import agent_review_middleware
from screenwriter.db import SessionLocal
from screenwriter.templates import get_template
from screenwriter.utils.bible_context import build_bible_context
from screenwriter.services.snapshot_service import create_snapshot
from screenwriter.models.database import SnapshotTriggerType
from .wizards import apply_wizard_result_to_db

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_project_context(db: Session, project: database.Project, bible_context: Optional[str] = None) -> str:
    """Build project context from all phase data, including list items."""
    phase_data_records = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project.id
    ).all()
    project_data = {}
    list_items_map = {}
    for pd in phase_data_records:
        phase_key = pd.phase.value if hasattr(pd.phase, 'value') else pd.phase
        if phase_key not in project_data:
            project_data[phase_key] = {}
        project_data[phase_key][pd.subsection_key] = pd.content or {}

        # Include list items (characters, scenes, etc.)
        if pd.list_items:
            items = [{"item_type": li.item_type, **(li.content or {})} for li in pd.list_items]
            if items:
                list_items_map[f"{phase_key}.{pd.subsection_key}"] = items

    template_id = project.template.value if hasattr(project.template, 'value') else project.template
    return template_ai_service._build_project_context(project_data, template_id, list_items=list_items_map, project_title=project.title, bible_context=bible_context)


def _get_subsection_config(template_id: str, phase: str, subsection_key: str) -> dict:
    """Get subsection config from template."""
    template = get_template(template_id)
    for p in template.get("phases", []):
        if p["id"] == phase:
            for sub in p.get("subsections", []):
                if sub["key"] == subsection_key:
                    return sub
    return {}


@router.post("/sessions", response_model=schemas.AISessionResponse)
async def create_ai_session(
    request: schemas.AISessionCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a contextual AI chat session."""
    project = db.query(database.Project).filter(
        database.Project.id == request.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    session = database.AISession(
        project_id=project.id,
        phase=request.phase,
        subsection_key=request.subsection_key,
        context_item_id=request.context_item_id,
        user_id=current_user.id
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/lookup", response_model=schemas.AISessionResponse)
async def lookup_ai_session(
    project_id: UUID,
    phase: str,
    subsection_key: str,
    context_item_id: Optional[UUID] = None,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Find the most recent existing session for a given context."""
    query = db.query(database.AISession).filter(
        database.AISession.project_id == project_id,
        database.AISession.user_id == current_user.id,
        database.AISession.phase == phase,
        database.AISession.subsection_key == subsection_key,
    )
    if context_item_id:
        query = query.filter(database.AISession.context_item_id == context_item_id)
    else:
        query = query.filter(database.AISession.context_item_id.is_(None))

    session = query.order_by(database.AISession.created_at.desc()).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existing session")
    return session


@router.get("/sessions/{session_id}/messages", response_model=List[schemas.AIMessageResponse])
async def get_ai_messages(
    session_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat message history."""
    session = db.query(database.AISession).filter(
        database.AISession.id == session_id,
        database.AISession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    messages = db.query(database.AIMessage).filter(
        database.AIMessage.session_id == session_id
    ).order_by(database.AIMessage.created_at).all()

    return messages


@router.post("/sessions/{session_id}/messages", response_model=schemas.AIMessageResponse)
async def send_ai_message(
    session_id: UUID,
    message: schemas.AIMessageCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message and get an AI response."""
    session = db.query(database.AISession).filter(
        database.AISession.id == session_id,
        database.AISession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Get project
    project = db.query(database.Project).filter(
        database.Project.id == session.project_id
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found or has no template")

    # Save user message
    user_msg = database.AIMessage(
        session_id=session_id,
        role="user",
        content=message.content,
        message_type="chat"
    )
    db.add(user_msg)
    db.commit()

    # Build context and get AI response
    bible_context = build_bible_context(db, project)
    project_context = _get_project_context(db, project, bible_context=bible_context)
    template_id = project.template.value

    # Get system prompt and subsection config
    sub_config = _get_subsection_config(template_id, session.phase, session.subsection_key)
    system_prompt = sub_config.get(
        "chat_system_prompt",
        "You are a helpful screenwriting assistant. Help the user develop their story."
    )

    # Get chat history
    history = db.query(database.AIMessage).filter(
        database.AIMessage.session_id == session_id
    ).order_by(database.AIMessage.created_at).all()
    chat_history = [{"role": m.role, "content": m.content} for m in history]

    mode = getattr(message, "mode", "brainstorm")

    if mode == "action":
        # Action mode: AI can modify fields
        # Gather field definitions from subsection config (handles all template patterns)
        field_defs = []
        if "fields" in sub_config:
            field_defs = sub_config["fields"]
        elif "field_groups" in sub_config:
            for group in sub_config.get("field_groups", []):
                field_defs.extend(group.get("fields", []))
        elif "cards" in sub_config:
            field_defs = sub_config["cards"]
        elif "card_groups" in sub_config:
            for group in sub_config.get("card_groups", []):
                field_defs.extend(group.get("fields", []))

        # Fallback: check editor_config (used by individual_editor / ordered_list patterns)
        if not field_defs:
            editor_config = sub_config.get("editor_config", {})
            if editor_config.get("fields"):
                field_defs = editor_config["fields"]

        logger.info(f"Action mode: phase={session.phase}, subsection={session.subsection_key}, field_defs_count={len(field_defs)}")

        # Get current content
        current_content = {}
        if session.context_item_id:
            item = db.query(database.ListItem).filter(
                database.ListItem.id == session.context_item_id
            ).first()
            if item:
                current_content = item.content or {}
                # Use editor_config fields for items
                editor_config = sub_config.get("editor_config", {})
                if editor_config.get("fields"):
                    field_defs = editor_config["fields"]
        else:
            phase_data = db.query(database.PhaseData).filter(
                database.PhaseData.project_id == project.id,
                database.PhaseData.phase == session.phase,
                database.PhaseData.subsection_key == session.subsection_key,
            ).first()
            if phase_data:
                current_content = phase_data.content or {}

        result = await template_ai_service.chat_with_action(
            user_message=message.content,
            chat_history=chat_history[:-1],
            system_prompt=system_prompt,
            project_context=project_context,
            field_definitions=field_defs,
            current_content=current_content,
        )

        ai_text = result.get("message", "")
        field_updates = result.get("field_updates", {})
        applied = False

        logger.info(f"Action mode AI result: field_updates keys={list(field_updates.keys()) if field_updates else 'none'}")

        # Apply field updates if any
        if field_updates:
            if session.context_item_id:
                item = db.query(database.ListItem).filter(
                    database.ListItem.id == session.context_item_id
                ).first()
                if item:
                    existing = dict(item.content or {})
                    existing.update(field_updates)
                    item.content = existing
                    flag_modified(item, "content")
                    db.commit()
                    applied = True
                    logger.info(f"Action mode: updated ListItem {item.id}, keys={list(field_updates.keys())}")
                else:
                    logger.warning(f"Action mode: ListItem {session.context_item_id} not found")
            else:
                phase_data = db.query(database.PhaseData).filter(
                    database.PhaseData.project_id == project.id,
                    database.PhaseData.phase == session.phase,
                    database.PhaseData.subsection_key == session.subsection_key,
                ).first()
                if not phase_data:
                    # Create PhaseData if it doesn't exist
                    logger.warning(f"Action mode: PhaseData not found, creating for phase={session.phase}, key={session.subsection_key}")
                    phase_data = database.PhaseData(
                        project_id=project.id,
                        phase=session.phase,
                        subsection_key=session.subsection_key,
                        content={},
                    )
                    db.add(phase_data)
                    db.flush()

                existing = dict(phase_data.content or {})
                existing.update(field_updates)
                phase_data.content = existing
                flag_modified(phase_data, "content")
                db.commit()
                applied = True
                logger.info(f"Action mode: updated PhaseData {phase_data.id}, keys={list(field_updates.keys())}")

        ai_msg = database.AIMessage(
            session_id=session_id,
            role="assistant",
            content=ai_text,
            message_type="action",
            metadata_={"field_updates": field_updates, "applied": applied},
        )
    else:
        # Brainstorm mode: plain conversational response
        ai_response = await template_ai_service.chat_respond(
            user_message=message.content,
            chat_history=chat_history[:-1],
            system_prompt=system_prompt,
            project_context=project_context,
        )

        ai_msg = database.AIMessage(
            session_id=session_id,
            role="assistant",
            content=ai_response,
            message_type="chat",
        )

    try:
        db.add(ai_msg)
        db.commit()
        db.refresh(ai_msg)
    except IntegrityError:
        # Session was deleted while the AI was generating a response (race condition)
        db.rollback()
        logger.warning(f"Session {session_id} was deleted during AI response generation")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Chat session was closed while generating response"
        )
    return ai_msg


@router.post("/sessions/{session_id}/messages/stream")
async def send_ai_message_stream(
    session_id: UUID,
    message: schemas.AIMessageCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a message and stream the AI response via SSE."""
    session = db.query(database.AISession).filter(
        database.AISession.id == session_id,
        database.AISession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    project = db.query(database.Project).filter(
        database.Project.id == session.project_id
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found or has no template")

    # Save user message
    user_msg = database.AIMessage(
        session_id=session_id,
        role="user",
        content=message.content,
        message_type="chat"
    )
    db.add(user_msg)
    db.commit()

    # Build context
    bible_context = build_bible_context(db, project)
    project_context = _get_project_context(db, project, bible_context=bible_context)
    template_id = project.template.value
    sub_config = _get_subsection_config(template_id, session.phase, session.subsection_key)
    system_prompt = sub_config.get(
        "chat_system_prompt",
        "You are a helpful screenwriting assistant. Help the user develop their story."
    )

    # Get chat history
    history = db.query(database.AIMessage).filter(
        database.AIMessage.session_id == session_id
    ).order_by(database.AIMessage.created_at).all()
    chat_history = [{"role": m.role, "content": m.content} for m in history]

    mode = getattr(message, "mode", "brainstorm")

    if mode == "action":
        # Action mode: two-phase streaming
        # Phase 1: stream conversational message, Phase 2: extract field updates via JSON
        field_defs = []
        if "fields" in sub_config:
            field_defs = sub_config["fields"]
        elif "field_groups" in sub_config:
            for group in sub_config.get("field_groups", []):
                field_defs.extend(group.get("fields", []))
        elif "cards" in sub_config:
            field_defs = sub_config["cards"]
        elif "card_groups" in sub_config:
            for group in sub_config.get("card_groups", []):
                field_defs.extend(group.get("fields", []))

        # Fallback: check editor_config (used by individual_editor / ordered_list patterns)
        if not field_defs:
            editor_config = sub_config.get("editor_config", {})
            if editor_config.get("fields"):
                field_defs = editor_config["fields"]

        current_content = {}
        if session.context_item_id:
            item = db.query(database.ListItem).filter(
                database.ListItem.id == session.context_item_id
            ).first()
            if item:
                current_content = item.content or {}
                editor_config = sub_config.get("editor_config", {})
                if editor_config.get("fields"):
                    field_defs = editor_config["fields"]
        else:
            phase_data = db.query(database.PhaseData).filter(
                database.PhaseData.project_id == project.id,
                database.PhaseData.phase == session.phase,
                database.PhaseData.subsection_key == session.subsection_key,
            ).first()
            if phase_data:
                current_content = phase_data.content or {}

        # Detect ordered_list subsection → enable list item creation by AI
        is_list_subsection = bool(sub_config.get("list_config")) and not session.context_item_id
        item_type = sub_config.get("list_config", {}).get("item_type") if is_list_subsection else None

        async def action_stream():
            full_text = ""
            try:
                # Phase 1: Stream conversational message
                async for chunk in template_ai_service.chat_action_stream_message(
                    user_message=message.content,
                    chat_history=chat_history[:-1],
                    system_prompt=system_prompt,
                    project_context=project_context,
                    field_definitions=field_defs,
                    current_content=current_content,
                    item_type=item_type,
                ):
                    full_text += chunk
                    yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            except Exception as e:
                logger.error(f"Action streaming error: {e}", exc_info=True)
                full_text = full_text or "I had trouble generating a response."

            # Phase 2: Extract field updates (and optionally list_item_creates) via JSON-mode call
            field_updates = {}
            list_item_creates = []
            applied = False
            try:
                extraction_result = await template_ai_service.chat_action_extract_updates(
                    user_message=message.content,
                    assistant_message=full_text,
                    field_definitions=field_defs,
                    current_content=current_content,
                    item_type=item_type,
                )
                field_updates = extraction_result.get("field_updates", {})
                list_item_creates = extraction_result.get("list_item_creates", []) if is_list_subsection else []
                logger.info(f"Action mode extracted field_updates keys={list(field_updates.keys()) if field_updates else 'none'}, list_item_creates={len(list_item_creates)}")
            except Exception as e:
                logger.error(f"Action field extraction error: {e}", exc_info=True)

            # Apply field updates to database
            if field_updates:
                if session.context_item_id:
                    item = db.query(database.ListItem).filter(
                        database.ListItem.id == session.context_item_id
                    ).first()
                    if item:
                        existing = dict(item.content or {})
                        existing.update(field_updates)
                        item.content = existing
                        flag_modified(item, "content")
                        db.commit()
                        applied = True
                else:
                    pd = db.query(database.PhaseData).filter(
                        database.PhaseData.project_id == project.id,
                        database.PhaseData.phase == session.phase,
                        database.PhaseData.subsection_key == session.subsection_key,
                    ).first()
                    if not pd:
                        pd = database.PhaseData(
                            project_id=project.id,
                            phase=session.phase,
                            subsection_key=session.subsection_key,
                            content={},
                        )
                        db.add(pd)
                        db.flush()
                    existing = dict(pd.content or {})
                    existing.update(field_updates)
                    pd.content = existing
                    flag_modified(pd, "content")
                    db.commit()
                    applied = True

            # Create new list items described by the AI (ordered_list subsections only)
            items_created = 0
            if list_item_creates:
                from sqlalchemy import func as sqlfunc
                pd = db.query(database.PhaseData).filter(
                    database.PhaseData.project_id == project.id,
                    database.PhaseData.phase == session.phase,
                    database.PhaseData.subsection_key == session.subsection_key,
                ).first()
                if not pd:
                    pd = database.PhaseData(
                        project_id=project.id,
                        phase=session.phase,
                        subsection_key=session.subsection_key,
                        content={},
                    )
                    db.add(pd)
                    db.flush()

                max_order = db.query(sqlfunc.max(database.ListItem.sort_order)).filter(
                    database.ListItem.phase_data_id == pd.id
                ).scalar()
                next_order = (max_order + 1) if max_order is not None else 0

                for item_content in list_item_creates:
                    if isinstance(item_content, dict) and item_content:
                        db.add(database.ListItem(
                            phase_data_id=pd.id,
                            item_type=item_type or "item",
                            content=item_content,
                            sort_order=next_order,
                            status="draft",
                        ))
                        next_order += 1
                        items_created += 1

                if items_created:
                    db.commit()
                    applied = True
                    logger.info(f"Action mode: created {items_created} list items of type '{item_type}'")

            # Save AI message to database
            ai_msg = database.AIMessage(
                session_id=session_id,
                role="assistant",
                content=full_text,
                message_type="action",
                metadata_={"field_updates": field_updates, "applied": applied},
            )
            try:
                db.add(ai_msg)
                db.commit()
                db.refresh(ai_msg)
                yield f"data: {json.dumps({'field_updates': field_updates, 'applied': applied, 'list_items_created': items_created, 'done': True, 'id': str(ai_msg.id)})}\n\n"
            except IntegrityError:
                db.rollback()
                logger.warning(f"Session {session_id} deleted during action streaming")

            yield "data: [DONE]\n\n"

        return StreamingResponse(action_stream(), media_type="text/event-stream")

    # Brainstorm mode: stream the response
    allow_field_suggestions = getattr(message, "allow_field_suggestions", False)

    # Gather field defs + current content for brainstorm-with-suggestions path
    brainstorm_field_defs = []
    brainstorm_current_content = {}
    if allow_field_suggestions:
        if "fields" in sub_config:
            brainstorm_field_defs = sub_config["fields"]
        elif "field_groups" in sub_config:
            for group in sub_config.get("field_groups", []):
                brainstorm_field_defs.extend(group.get("fields", []))
        elif "cards" in sub_config:
            brainstorm_field_defs = sub_config["cards"]
        elif "card_groups" in sub_config:
            for group in sub_config.get("card_groups", []):
                brainstorm_field_defs.extend(group.get("fields", []))
        if not brainstorm_field_defs:
            editor_config = sub_config.get("editor_config", {})
            if editor_config.get("fields"):
                brainstorm_field_defs = editor_config["fields"]

        if session.context_item_id:
            item = db.query(database.ListItem).filter(
                database.ListItem.id == session.context_item_id
            ).first()
            if item:
                brainstorm_current_content = item.content or {}
                editor_config = sub_config.get("editor_config", {})
                if editor_config.get("fields"):
                    brainstorm_field_defs = editor_config["fields"]
        else:
            phase_data = db.query(database.PhaseData).filter(
                database.PhaseData.project_id == project.id,
                database.PhaseData.phase == session.phase,
                database.PhaseData.subsection_key == session.subsection_key,
            ).first()
            if phase_data:
                brainstorm_current_content = phase_data.content or {}

    async def brainstorm_stream():
        full_text = ""
        try:
            async for chunk in template_ai_service.chat_respond_stream(
                user_message=message.content,
                chat_history=chat_history[:-1],
                system_prompt=system_prompt,
                project_context=project_context,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            full_text = full_text or "I'm having trouble generating a response right now."

        # If field suggestions enabled, extract proposed updates (no DB write)
        field_updates = {}
        if allow_field_suggestions and brainstorm_field_defs:
            try:
                extraction_result = await template_ai_service.chat_action_extract_updates(
                    user_message=message.content,
                    assistant_message=full_text,
                    field_definitions=brainstorm_field_defs,
                    current_content=brainstorm_current_content,
                )
                field_updates = extraction_result.get("field_updates", {})
                logger.info(f"Brainstorm suggestions extracted keys={list(field_updates.keys()) if field_updates else 'none'}")
            except Exception as e:
                logger.error(f"Brainstorm field extraction error: {e}", exc_info=True)

        # Save the complete AI message to the database
        ai_msg = database.AIMessage(
            session_id=session_id,
            role="assistant",
            content=full_text,
            message_type="chat",
            metadata_={"field_updates": field_updates, "applied": False} if field_updates else {},
        )
        try:
            db.add(ai_msg)
            db.commit()
            db.refresh(ai_msg)
            if field_updates:
                # Send field_updates to frontend for confirmation (applied=False)
                yield f"data: {json.dumps({'field_updates': field_updates, 'applied': False, 'done': True, 'id': str(ai_msg.id)})}\n\n"
            else:
                yield f"data: {json.dumps({'done': True, 'id': str(ai_msg.id)})}\n\n"
        except IntegrityError:
            db.rollback()
            logger.warning(f"Session {session_id} deleted during streaming")
        yield "data: [DONE]\n\n"

    return StreamingResponse(brainstorm_stream(), media_type="text/event-stream")


@router.delete("/sessions/{session_id}")
async def delete_ai_session(
    session_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a chat session."""
    session = db.query(database.AISession).filter(
        database.AISession.id == session_id,
        database.AISession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    db.delete(session)
    db.commit()
    return {"status": "success"}


@router.post("/fill-blanks", response_model=schemas.AIActionResponse)
async def fill_blanks(
    request: schemas.FillBlanksRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """AI fills empty fields for a subsection or item."""
    project = db.query(database.Project).filter(
        database.Project.id == request.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    template_id = project.template.value
    sub_config = _get_subsection_config(template_id, request.phase, request.subsection_key)

    if request.item_id:
        # Fill blanks for a specific item
        item = db.query(database.ListItem).filter(database.ListItem.id == request.item_id).first()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        current_content = item.content or {}
        # Resolve field definitions: editor_config (individual_editor) or card_groups (repeatable_cards)
        editor_config = sub_config.get("editor_config", {})
        if editor_config.get("fields"):
            field_config = {"fields": editor_config["fields"]}
        elif "card_groups" in sub_config:
            group = next((g for g in sub_config["card_groups"] if g["item_type"] == item.item_type), None)
            field_config = {"fields": group["fields"]} if group else {"fields": []}
        else:
            field_config = {"fields": []}
    else:
        # Fill blanks for a subsection
        phase_data = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == request.phase,
            database.PhaseData.subsection_key == request.subsection_key
        ).first()
        if not phase_data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")
        current_content = phase_data.content or {}
        field_config = sub_config

    # If field_key specified, filter to just that field
    if request.field_key:
        all_fields = field_config.get("fields", []) or field_config.get("cards", []) or []
        matched = [f for f in all_fields if f.get("key") == request.field_key]
        if matched:
            field_config = {"fields": matched}

    bible_context = build_bible_context(db, project)
    project_context = _get_project_context(db, project, bible_context=bible_context)
    result = await template_ai_service.fill_blanks(
        current_content=current_content,
        subsection_config=field_config,
        project_context=project_context
    )

    # Apply results
    if request.item_id and "content" in result:
        item = db.query(database.ListItem).filter(database.ListItem.id == request.item_id).first()
        existing = dict(item.content or {})
        existing.update(result["content"])
        item.content = existing
        flag_modified(item, "content")
        db.commit()
    elif "content" in result:
        phase_data = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == request.phase,
            database.PhaseData.subsection_key == request.subsection_key
        ).first()
        if phase_data:
            existing = dict(phase_data.content or {})
            existing.update(result["content"])
            phase_data.content = existing
            flag_modified(phase_data, "content")
            db.commit()

    return result


@router.post("/give-notes", response_model=schemas.AIActionResponse)
async def give_notes(
    request: schemas.GiveNotesRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """AI gives feedback on content."""
    project = db.query(database.Project).filter(
        database.Project.id == request.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    template_id = project.template.value
    sub_config = _get_subsection_config(template_id, request.phase, request.subsection_key)

    if request.item_id:
        item = db.query(database.ListItem).filter(database.ListItem.id == request.item_id).first()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
        current_content = item.content or {}
    else:
        phase_data = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == request.phase,
            database.PhaseData.subsection_key == request.subsection_key
        ).first()
        if not phase_data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")
        current_content = phase_data.content or {}

    bible_context = build_bible_context(db, project)
    project_context = _get_project_context(db, project, bible_context=bible_context)
    result = await template_ai_service.give_notes(
        current_content=current_content,
        subsection_config=sub_config,
        project_context=project_context
    )

    return result


@router.post("/analyze-structure")
async def analyze_structure(
    request: schemas.AnalyzeStructureRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """AI analyzes episode/scene list structure."""
    project = db.query(database.Project).filter(
        database.Project.id == request.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Get the list items for the subsection
    phase_data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project.id,
        database.PhaseData.phase == request.phase,
        database.PhaseData.subsection_key == request.subsection_key
    ).first()
    if not phase_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")

    items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == phase_data.id
    ).order_by(database.ListItem.sort_order).all()

    items_data = [{"sort_order": i.sort_order, **i.content} for i in items]

    bible_context = build_bible_context(db, project)
    project_context = _get_project_context(db, project, bible_context=bible_context)
    template_id = project.template.value

    result = await template_ai_service.analyze_structure(
        items=items_data,
        template_id=template_id,
        project_context=project_context
    )

    return result


# ── YOLO auto-fill ────────────────────────────────────────────

def _determine_yolo_strategy(sub_config: dict) -> str:
    """Pick the generation strategy for a subsection based on its ui_pattern."""
    pattern = sub_config.get("ui_pattern", "")
    if pattern in ("structured_form", "card_grid"):
        return "fill_blanks"
    if pattern in ("wizard", "wizard_with_chat"):
        return "wizard"
    if pattern == "individual_editor":
        return "fill_items"
    if pattern == "repeatable_cards":
        return "fill_repeatable"
    # ordered_list, screenplay_editor, import_wizard, analyzer — populated by paired wizards
    return "skip"


def _get_or_create_phase_data(db: Session, project_id, phase: str, subsection_key: str):
    """Get or create a PhaseData record."""
    pd = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project_id,
        database.PhaseData.phase == phase,
        database.PhaseData.subsection_key == subsection_key,
    ).first()
    if not pd:
        pd = database.PhaseData(
            project_id=project_id,
            phase=phase,
            subsection_key=subsection_key,
            content={},
        )
        db.add(pd)
        db.flush()
    return pd


async def _yolo_fill_blanks(db: Session, project, phase: str, sub_config: dict, project_context: str):
    """Fill blanks for a structured_form / card_grid subsection."""
    pd = _get_or_create_phase_data(db, project.id, phase, sub_config["key"])
    current_content = pd.content or {}

    result = await template_ai_service.fill_blanks(
        current_content=current_content,
        subsection_config=sub_config,
        project_context=project_context,
    )
    if result.get("content"):
        existing = dict(pd.content or {})
        existing.update(result["content"])
        pd.content = existing
        flag_modified(pd, "content")
        db.commit()
    return "filled"


async def _yolo_run_wizard(db: Session, project, phase: str, sub_config: dict, project_context: str, template_id: str, owner_id: str = ""):
    """Run a wizard with default config, route through agent review middleware, and apply results."""
    wizard_type = sub_config["key"]
    wizard_config = sub_config.get("wizard_config", {})

    config = {}
    if wizard_config.get("default_count"):
        config["count"] = wizard_config["default_count"]

    # For idea_wizard: seed with existing field data
    if wizard_type == "idea_wizard":
        pd = _get_or_create_phase_data(db, project.id, phase, sub_config["key"])
        config.update(pd.content or {})

    # For scene_wizard: inject character data
    if wizard_type == "scene_wizard":
        characters_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "story",
            database.PhaseData.subsection_key == "characters",
        ).first()
        if characters_pd:
            char_items = db.query(database.ListItem).filter(
                database.ListItem.phase_data_id == characters_pd.id
            ).order_by(database.ListItem.sort_order).all()
            config["_characters"] = [{"item_type": li.item_type, **(li.content or {})} for li in char_items]

    # For script_writer_wizard: pull existing list items as episodes
    if wizard_type == "script_writer_wizard":
        # Find episode/scene list items in the same phase
        for list_key in ("episode_list", "scene_list"):
            list_pd = db.query(database.PhaseData).filter(
                database.PhaseData.project_id == project.id,
                database.PhaseData.subsection_key == list_key,
            ).first()
            if list_pd:
                items = db.query(database.ListItem).filter(
                    database.ListItem.phase_data_id == list_pd.id
                ).order_by(database.ListItem.sort_order).all()
                if items:
                    config["episodes"] = [item.content for item in items]
                    break
        if not config.get("episodes"):
            return "skipped (no episodes/scenes to write)"

    result = await template_ai_service.wizard_generate(
        wizard_type=wizard_type,
        config=config,
        project_context=project_context,
        template_id=template_id,
    )

    # YOLO-01: Route through agent review middleware (same path as manual wizard)
    review_result = await agent_review_middleware.review_step_output(
        phase=phase,
        subsection_key=wizard_type,
        raw_output=result,
        owner_id=owner_id,
        session_factory=SessionLocal,
        wizard_type=wizard_type,
    )
    result = review_result["output"]

    # Embed review metadata in result JSON
    if isinstance(result, dict):
        if "_meta" not in result:
            result["_meta"] = {}
        result["_meta"]["agents_consulted"] = review_result["agents_consulted"]
        result["_meta"]["review_applied"] = review_result["review_applied"]

    apply_result = apply_wizard_result_to_db(db, project, phase, wizard_type, result)
    detail = apply_result.get("items_created") or apply_result.get("fields_updated") or ""
    if isinstance(detail, list):
        detail = f"{len(detail)} fields"
    elif isinstance(detail, int):
        detail = f"{detail} items"
    return f"generated ({detail})" if detail else "generated"


async def _yolo_fill_items(db: Session, project, phase: str, sub_config: dict, project_context: str):
    """Fill blanks for each ListItem in an individual_editor subsection."""
    editor_config = sub_config.get("editor_config", {})
    # Find the ordered_list PhaseData that holds the items
    source_key = sub_config.get("source_subsection", sub_config["key"].replace("_editor", "_list"))
    list_pd = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project.id,
        database.PhaseData.phase == phase,
        database.PhaseData.subsection_key == source_key,
    ).first()
    if not list_pd:
        return "skipped (no items)"

    items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == list_pd.id
    ).order_by(database.ListItem.sort_order).all()
    if not items:
        return "skipped (no items)"

    field_config = {"fields": editor_config.get("fields", [])}
    filled = 0
    for item in items:
        current = item.content or {}
        result = await template_ai_service.fill_blanks(
            current_content=current,
            subsection_config=field_config,
            project_context=project_context,
        )
        if result.get("content"):
            existing = dict(item.content or {})
            existing.update(result["content"])
            item.content = existing
            flag_modified(item, "content")
            filled += 1
    if filled:
        db.commit()
    return f"filled {filled} items"


async def _yolo_fill_repeatable(db: Session, project, phase: str, sub_config: dict, project_context: str):
    """Fill blanks for each ListItem in a repeatable_cards subsection."""
    pd = _get_or_create_phase_data(db, project.id, phase, sub_config["key"])
    card_groups = sub_config.get("card_groups", [])
    if not card_groups:
        return "skipped (no card groups)"

    filled = 0
    for group in card_groups:
        item_type = group.get("item_type", group.get("key", ""))
        min_items = group.get("min_items", 0)
        fields = group.get("fields", [])
        if not fields:
            continue

        # Get existing items for this group
        group_items = db.query(database.ListItem).filter(
            database.ListItem.phase_data_id == pd.id,
            database.ListItem.item_type == item_type,
        ).order_by(database.ListItem.sort_order).all()

        # Auto-create minimum required items if none exist
        if not group_items and min_items >= 1:
            max_order = db.query(database.ListItem).filter(
                database.ListItem.phase_data_id == pd.id
            ).count()
            new_item = database.ListItem(
                phase_data_id=pd.id,
                item_type=item_type,
                content={},
                sort_order=max_order,
            )
            db.add(new_item)
            db.flush()
            group_items = [new_item]

        field_config = {"fields": fields}
        for item in group_items:
            current = item.content or {}
            result = await template_ai_service.fill_blanks(
                current_content=current,
                subsection_config=field_config,
                project_context=project_context,
            )
            if result.get("content"):
                existing = dict(item.content or {})
                existing.update(result["content"])
                item.content = existing
                flag_modified(item, "content")
                filled += 1

    if filled:
        db.commit()
    return f"filled {filled} items"


@router.post("/yolo-fill")
async def yolo_fill(
    request: schemas.YoloFillRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Auto-fill ALL phases by iterating every subsection and generating content."""
    project = db.query(database.Project).filter(
        database.Project.id == str(request.project_id),
        database.Project.owner_id == str(current_user.id),
    ).first()
    if not project or not project.template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    template_id = project.template.value if hasattr(project.template, 'value') else project.template
    template = get_template(template_id)
    all_phases = template.get("phases", [])

    # Build flat list of (phase_id, subsection_config) pairs across all phases
    all_steps = []
    for phase_config in all_phases:
        phase_id = phase_config["id"]
        for sub_config in phase_config.get("subsections", []):
            all_steps.append((phase_id, phase_config.get("name", phase_id), sub_config))

    create_snapshot(db, project.id, SnapshotTriggerType.AUTO_YOLO)
    db.commit()  # Must commit before streaming starts

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'total': len(all_steps)})}\n\n"

        completed = 0
        skipped = 0
        errors = 0

        for i, (phase_id, phase_name, sub_config) in enumerate(all_steps):
            strategy = _determine_yolo_strategy(sub_config)
            step_name = f"{phase_name} / {sub_config.get('name', sub_config['key'])}"

            if strategy == "skip":
                yield f"data: {json.dumps({'type': 'progress', 'key': sub_config['key'], 'name': step_name, 'index': i, 'phase': phase_id, 'status': 'skipped'})}\n\n"
                skipped += 1
                continue

            yield f"data: {json.dumps({'type': 'progress', 'key': sub_config['key'], 'name': step_name, 'index': i, 'phase': phase_id, 'strategy': strategy, 'status': 'running'})}\n\n"

            try:
                # Re-read project context so earlier fills feed into later ones
                bible_context = build_bible_context(db, project)
                project_context = _get_project_context(db, project, bible_context=bible_context)

                if strategy == "fill_blanks":
                    detail = await _yolo_fill_blanks(db, project, phase_id, sub_config, project_context)
                elif strategy == "wizard":
                    detail = await _yolo_run_wizard(db, project, phase_id, sub_config, project_context, template_id, owner_id=str(current_user.id))
                elif strategy == "fill_items":
                    detail = await _yolo_fill_items(db, project, phase_id, sub_config, project_context)
                elif strategy == "fill_repeatable":
                    detail = await _yolo_fill_repeatable(db, project, phase_id, sub_config, project_context)
                else:
                    detail = "unknown strategy"

                yield f"data: {json.dumps({'type': 'progress', 'key': sub_config['key'], 'index': i, 'phase': phase_id, 'status': 'done', 'detail': detail})}\n\n"
                completed += 1

            except Exception as e:
                logger.error(f"YOLO fill error for {phase_id}/{sub_config['key']}: {e}", exc_info=True)
                yield f"data: {json.dumps({'type': 'progress', 'key': sub_config['key'], 'index': i, 'phase': phase_id, 'status': 'error', 'detail': str(e)})}\n\n"
                errors += 1

        yield f"data: {json.dumps({'type': 'done', 'completed': completed, 'skipped': skipped, 'errors': errors})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
