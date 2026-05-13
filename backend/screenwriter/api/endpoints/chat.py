import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.db import SessionLocal
from screenwriter.models import schemas
from screenwriter.models.database import (
    Agent, Project, Section, ChatSession, ChatMessage,
)
from screenwriter.services.agent_service import agent_service
from screenwriter.services.ai_provider import chat_completion_stream
from screenwriter.api.dependencies import get_db, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/sessions", response_model=schemas.ChatSessionResponse)
async def create_chat_session(
    data: schemas.ChatSessionCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new chat session with an agent for a project."""
    # Validate agent exists and is accessible
    agent = (
        db.query(Agent)
        .filter(
            Agent.id == data.agent_id,
            Agent.is_active == True,
            (Agent.owner_id == current_user.id) | (Agent.is_default == True),
        )
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Validate project exists and belongs to user
    project = (
        db.query(Project)
        .filter(Project.id == data.project_id, Project.owner_id == current_user.id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check for existing session with same agent+project
    existing = (
        db.query(ChatSession)
        .filter(
            ChatSession.user_id == current_user.id,
            ChatSession.agent_id == data.agent_id,
            ChatSession.project_id == data.project_id,
        )
        .first()
    )
    if existing:
        return existing

    session = ChatSession(
        user_id=current_user.id,
        agent_id=data.agent_id,
        project_id=data.project_id,
        title=data.title or f"Chat with {agent.name}",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions")
async def list_chat_sessions(
    project_id: UUID = None,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List chat sessions for the current user."""
    query = db.query(ChatSession).filter(ChatSession.user_id == current_user.id)
    if project_id:
        query = query.filter(ChatSession.project_id == project_id)
    sessions = query.order_by(ChatSession.updated_at.desc()).all()

    return [
        {
            "id": str(s.id),
            "agent_id": str(s.agent_id),
            "project_id": str(s.project_id),
            "title": s.title,
            "agent_name": s.agent.name if s.agent else None,
            "agent_color": s.agent.color if s.agent else None,
            "agent_icon": s.agent.icon if s.agent else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in sessions
    ]


@router.get("/sessions/{session_id}/messages")
async def get_chat_messages(
    session_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get message history for a chat session."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .all()
    )

    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "message_type": m.message_type,
            "book_references": m.book_references or [],
            "consulted_agents": m.consulted_agents or [],
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]


@router.post("/sessions/{session_id}/messages")
async def send_chat_message(
    session_id: UUID,
    data: schemas.ChatMessageCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a message and get an agent response."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await agent_service.chat(
        session=session,
        user_message=data.content,
        db=db,
        field_context=data.field_context,
        session_factory=SessionLocal,
    )

    return result


@router.post("/sessions/{session_id}/messages/stream")
async def send_chat_message_stream(
    session_id: UUID,
    data: schemas.ChatMessageCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a message and stream the agent response via SSE."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    prepared = await agent_service.chat_stream_prepare(
        session=session,
        user_message=data.content,
        db=db,
        field_context=data.field_context,
        session_factory=SessionLocal,
    )

    # Capture values before the generator runs (db session will be closed by then)
    chat_session_id = prepared["session_id"]
    stream_messages = prepared["messages"]
    stream_concepts = prepared["concepts"]
    stream_consulted = prepared["consulted_agents"]
    stream_list_item_config = prepared.get("list_item_config")
    stream_project_id = session.project_id

    async def event_stream():
        full_text = ""
        try:
            async for chunk in chat_completion_stream(
                messages=stream_messages,
                temperature=0.7,
                max_tokens=settings.MAX_TOKENS,
            ):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except Exception as e:
            logger.error(f"Agent streaming error: {e}", exc_info=True)
            if not full_text:
                full_text = "I had trouble generating a response."
                yield f"data: {json.dumps({'chunk': full_text})}\n\n"

        # Use a fresh DB session for finalization (original is closed)
        finalize_db = SessionLocal()
        try:
            metadata = await agent_service.chat_stream_finalize(
                session_id=chat_session_id,
                full_text=full_text,
                concepts=stream_concepts,
                consulted_agents=stream_consulted,
                db=finalize_db,
                project_id=stream_project_id,
                list_item_config=stream_list_item_config,
            )
            yield f"data: {json.dumps({'book_references': metadata['book_references'], 'consulted_agents': metadata['consulted_agents'], 'field_updates': metadata['field_updates'], 'list_items_created': metadata.get('list_items_created', 0), 'done': True, 'id': metadata['message_id']})}\n\n"
        except Exception as e:
            logger.error(f"Agent finalize error: {e}", exc_info=True)
            yield f"data: {json.dumps({'done': True})}\n\n"
        finally:
            finalize_db.close()

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/sessions/{session_id}/review")
async def trigger_review(
    session_id: UUID,
    data: schemas.ChatReviewRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Trigger an automatic structured review of a section."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get the section
    section = db.query(Section).filter(Section.id == data.section_id).first()
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    # Verify section belongs to the session's project
    if section.project_id != session.project_id:
        raise HTTPException(status_code=400, detail="Section does not belong to this project")

    project = session.project
    agent = session.agent

    # Run structured review
    review_result = await agent_service.review_section(
        agent=agent,
        section=section,
        project=project,
        db=db,
    )

    # Store review as a message in the chat
    review_content = "## Review: " + (section.type.value.replace("_", " ").title()) + "\n\n"
    if review_result.get("issues"):
        review_content += "### Issues\n"
        for issue in review_result["issues"]:
            review_content += f"- {issue}\n"
        review_content += "\n"
    if review_result.get("suggestions"):
        review_content += "### Suggestions\n"
        for suggestion in review_result["suggestions"]:
            review_content += f"- {suggestion}\n"

    assistant_msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=review_content,
        message_type="review",
        book_references=review_result.get("book_references", []),
    )
    db.add(assistant_msg)
    db.commit()

    return {
        "review": review_result,
        "message_id": str(assistant_msg.id),
    }


@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a chat session and all its messages."""
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(session)
    db.commit()
    return {"message": "Session deleted"}
