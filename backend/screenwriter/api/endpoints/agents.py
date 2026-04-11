import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from screenwriter.db import SessionLocal
from screenwriter.models import schemas
from screenwriter.models.database import Agent, AgentPipelineMap, Book, AgentBook
from screenwriter.models.schemas import PipelineMapEntry, PipelineMapResponse
from screenwriter.services.agent_templates import AGENT_TEMPLATES
from screenwriter.services.pipeline_composer import pipeline_composer
from screenwriter.services.rag_service import rag_service
from screenwriter.api.dependencies import get_db, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _agent_type_value(agent_type) -> str:
    """Safely extract agent_type string value.

    SQLite test fixtures patch Enum columns to String, so agent_type may
    already be a plain string instead of an AgentType enum instance.
    """
    if agent_type is None:
        return "book_based"
    return agent_type.value if hasattr(agent_type, "value") else str(agent_type)


async def _recompose_pipeline_background(owner_id_str: str):
    """Recompose pipeline mappings in a background task.

    Creates its own database session (BackgroundTasks run after the response
    is sent, so the request session is already closed).
    """
    db = SessionLocal()
    try:
        await pipeline_composer.compose_pipeline(owner_id_str, db)
    except Exception as e:
        logger.error(
            "Background pipeline recomposition failed for owner %s: %s",
            owner_id_str,
            e,
        )
    finally:
        db.close()


@router.get("/")
async def list_agents(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all agents (user-owned + defaults)."""
    agents = (
        db.query(Agent)
        .filter(
            (Agent.owner_id == current_user.id) | (Agent.is_default == True)
        )
        .all()
    )
    return [
        {
            "id": str(a.id),
            "name": a.name,
            "description": a.description,
            "personality": a.personality,
            "color": a.color,
            "icon": a.icon,
            "is_active": a.is_active,
            "is_default": a.is_default,
            "agent_type": _agent_type_value(a.agent_type),
            "tags_filter": a.tags_filter or [],
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "book_count": len(a.books),
        }
        for a in agents
    ]


@router.post("/")
async def create_agent(
    agent_data: schemas.AgentCreate,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a custom agent."""
    agent = Agent(
        owner_id=current_user.id,
        name=agent_data.name,
        description=agent_data.description,
        system_prompt_template=agent_data.system_prompt_template,
        personality=agent_data.personality,
        color=agent_data.color,
        icon=agent_data.icon,
        agent_type=agent_data.agent_type,
        tags_filter=agent_data.tags_filter or [],
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    background_tasks.add_task(_recompose_pipeline_background, str(current_user.id))
    return {
        "id": str(agent.id),
        "name": agent.name,
        "description": agent.description,
        "color": agent.color,
        "icon": agent.icon,
        "is_active": agent.is_active,
        "is_default": agent.is_default,
        "agent_type": _agent_type_value(agent.agent_type),
        "tags_filter": agent.tags_filter or [],
    }


@router.get("/tags")
async def get_all_concept_tags(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all unique concept tags from the user's processed books."""
    tags = rag_service.get_all_tags(owner_id=current_user.id, db=db)
    return {"tags": tags}


@router.get("/pipeline-map")
async def get_pipeline_map(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the current agent-to-pipeline-step mappings for this user."""
    maps = (
        db.query(AgentPipelineMap)
        .filter(AgentPipelineMap.owner_id == str(current_user.id))
        .all()
    )
    entries = [PipelineMapEntry.model_validate(m) for m in maps]
    return PipelineMapResponse(
        owner_id=current_user.id,
        entries=entries,
        total_mappings=len(entries),
    )


@router.patch("/{agent_id}")
async def update_agent(
    agent_id: UUID,
    agent_data: schemas.AgentUpdate,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an agent's properties."""
    agent = (
        db.query(Agent)
        .filter(Agent.id == str(agent_id), Agent.owner_id == str(current_user.id))
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    update_data = agent_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(agent, field, value)

    db.commit()
    db.refresh(agent)
    if pipeline_composer.is_semantic_change(update_data):
        background_tasks.add_task(_recompose_pipeline_background, str(current_user.id))
    return agent


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an agent."""
    agent = (
        db.query(Agent)
        .filter(Agent.id == str(agent_id), Agent.owner_id == str(current_user.id))
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    db.delete(agent)
    db.commit()
    background_tasks.add_task(_recompose_pipeline_background, str(current_user.id))
    return {"message": "Agent deleted"}


@router.post("/{agent_id}/books/{book_id}")
async def link_book_to_agent(
    agent_id: UUID,
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Link a book to an agent for RAG retrieval."""
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.owner_id == current_user.id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    existing = (
        db.query(AgentBook)
        .filter(AgentBook.agent_id == agent_id, AgentBook.book_id == book_id)
        .first()
    )
    if not existing:
        link = AgentBook(agent_id=agent_id, book_id=book_id)
        db.add(link)
        db.commit()

    return {"message": "Book linked to agent"}


@router.delete("/{agent_id}/books/{book_id}")
async def unlink_book_from_agent(
    agent_id: UUID,
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Unlink a book from an agent."""
    link = (
        db.query(AgentBook)
        .filter(AgentBook.agent_id == agent_id, AgentBook.book_id == book_id)
        .first()
    )
    if link:
        db.delete(link)
        db.commit()
    return {"message": "Book unlinked from agent"}


@router.post("/seed-defaults")
async def seed_default_agents(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Seed default agent templates (idempotent)."""
    created = 0
    for template in AGENT_TEMPLATES:
        existing = (
            db.query(Agent)
            .filter(Agent.name == template["name"], Agent.is_default == True)
            .first()
        )
        if not existing:
            agent = Agent(
                owner_id=current_user.id,
                name=template["name"],
                description=template["description"],
                system_prompt_template=template["system_prompt_template"],
                personality=template["personality"],
                color=template["color"],
                icon=template["icon"],
                is_default=True,
                is_active=True,
            )
            db.add(agent)
            created += 1

    db.commit()
    return {"message": f"Seeded {created} default agents", "total_defaults": len(AGENT_TEMPLATES)}
