# backend/app/api/endpoints/breakdown.py

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from screenwriter.models import schemas, database
from screenwriter.services.breakdown_service import breakdown_service
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.utils.bible_context import build_bible_context

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_synced_character_names(db: Session, project_id) -> set:
    """Return a set of lowercased character names already synced to story.characters ListItems.

    Returns an empty set if the story.characters PhaseData does not exist.
    Uses Python-side name extraction (not SQL JSON functions) for SQLite/PostgreSQL compat.
    """
    chars_pd = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == str(project_id),
        database.PhaseData.phase == "story",
        database.PhaseData.subsection_key == "characters",
    ).first()
    if not chars_pd:
        return set()

    items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == str(chars_pd.id)
    ).all()

    return {
        (item.content.get("name") or "").lower()
        for item in items
        if item.content.get("name")
    }


def _verify_project_ownership(db: Session, project_id: UUID, user_id: UUID) -> database.Project:
    """Verify user owns the project. Returns project or raises 404."""
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _verify_element_ownership(db: Session, element_id: UUID, user_id: UUID) -> database.BreakdownElement:
    """Verify user owns the project containing this breakdown element. Returns element or raises 404."""
    element = db.query(database.BreakdownElement).filter(
        database.BreakdownElement.id == str(element_id)
    ).first()
    if not element:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Element not found")

    _verify_project_ownership(db, element.project_id, user_id)
    return element


@router.get("/elements/{project_id}", response_model=List[schemas.BreakdownElementResponse])
async def list_elements(
    project_id: UUID,
    category: Optional[str] = None,
    include_deleted: bool = False,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List breakdown elements for a project, optionally filtered by category."""
    _verify_project_ownership(db, project_id, current_user.id)

    query = db.query(database.BreakdownElement).filter(
        database.BreakdownElement.project_id == str(project_id)
    )

    if not include_deleted:
        query = query.filter(database.BreakdownElement.is_deleted == False)

    if category:
        query = query.filter(database.BreakdownElement.category == category)

    query = query.order_by(
        database.BreakdownElement.sort_order,
        database.BreakdownElement.created_at
    )

    elements = query.options(selectinload(database.BreakdownElement.scene_links)).all()

    # Compute synced character names once (no N+1) — only needed for character category
    synced_names: set = set()
    if not category or category == "character":
        synced_names = _get_synced_character_names(db, project_id)

    result = []
    for elem in elements:
        resp = schemas.BreakdownElementResponse.model_validate(elem)
        resp.synced_to_characters = elem.name.lower() in synced_names
        result.append(resp)
    return result


@router.post("/elements/{project_id}", response_model=schemas.BreakdownElementResponse, status_code=status.HTTP_201_CREATED)
async def create_element(
    project_id: UUID,
    body: schemas.BreakdownElementCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new breakdown element. Restores soft-deleted duplicates; returns 409 for active duplicates."""
    _verify_project_ownership(db, project_id, current_user.id)

    # Check for existing element with same (project_id, category, name) -- including soft-deleted
    existing = db.query(database.BreakdownElement).filter(
        database.BreakdownElement.project_id == str(project_id),
        database.BreakdownElement.category == body.category,
        database.BreakdownElement.name == body.name
    ).first()

    if existing:
        if existing.is_deleted:
            # Restore soft-deleted element with updated fields
            existing.is_deleted = False
            existing.description = body.description
            existing.metadata_ = body.metadata
            existing.source = "user"
            existing.user_modified = True
            db.commit()
            db.refresh(existing)
            db.query(database.BreakdownElement).options(
                selectinload(database.BreakdownElement.scene_links)
            ).filter(database.BreakdownElement.id == str(existing.id)).first()
            return existing
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Element '{body.name}' already exists in category '{body.category}'"
            )

    db_element = database.BreakdownElement(
        project_id=project_id,
        category=body.category,
        name=body.name,
        description=body.description,
        metadata_=body.metadata,
        source="user",
    )
    db.add(db_element)
    db.commit()
    db.refresh(db_element)
    db.query(database.BreakdownElement).options(
        selectinload(database.BreakdownElement.scene_links)
    ).filter(database.BreakdownElement.id == str(db_element.id)).first()
    return db_element


@router.get("/element/{element_id}", response_model=schemas.BreakdownElementResponse)
async def get_element(
    element_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single breakdown element with scene links and enriched scene titles."""
    element = _verify_element_ownership(db, element_id, current_user.id)

    # Eagerly load scene_links
    element = db.query(database.BreakdownElement).options(
        selectinload(database.BreakdownElement.scene_links)
    ).filter(database.BreakdownElement.id == str(element.id)).first()

    # Enrich scene_links with scene titles from ListItem.content["title"]
    resp = schemas.BreakdownElementResponse.model_validate(element)

    if resp.scene_links:
        scene_item_ids = [str(link.scene_item_id) for link in resp.scene_links]
        scene_items = db.query(database.ListItem).filter(
            database.ListItem.id.in_(scene_item_ids)
        ).all()
        title_map = {
            str(item.id): (item.content or {}).get("title", "")
            for item in scene_items
        }
        for link in resp.scene_links:
            link.scene_title = title_map.get(str(link.scene_item_id))

    # Compute synced_to_characters for character elements
    if element.category == "character":
        synced_names = _get_synced_character_names(db, element.project_id)
        resp.synced_to_characters = element.name.lower() in synced_names

    return resp


@router.put("/element/{element_id}", response_model=schemas.BreakdownElementResponse)
async def update_element(
    element_id: UUID,
    body: schemas.BreakdownElementUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a breakdown element. Always sets user_modified=True."""
    element = _verify_element_ownership(db, element_id, current_user.id)

    update_data = body.model_dump(exclude_unset=True)

    # Map Pydantic 'metadata' field to ORM 'metadata_' attribute
    if "metadata" in update_data:
        update_data["metadata_"] = update_data.pop("metadata")

    for field, value in update_data.items():
        setattr(element, field, value)

    # Always mark as user-modified on any update
    element.user_modified = True

    db.commit()
    db.refresh(element)
    db.query(database.BreakdownElement).options(
        selectinload(database.BreakdownElement.scene_links)
    ).filter(database.BreakdownElement.id == str(element.id)).first()
    return element


@router.delete("/element/{element_id}")
async def delete_element(
    element_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Soft-delete a breakdown element. Never hard-deletes."""
    element = _verify_element_ownership(db, element_id, current_user.id)

    element.is_deleted = True
    db.commit()

    return {"status": "success", "message": "Element soft-deleted"}


# ============================================================
# Extraction trigger (API-01) -- calls real BreakdownService
# ============================================================

@router.post("/extract/{project_id}", response_model=schemas.BreakdownRunResponse)
async def trigger_extraction(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger AI extraction of production elements from screenplay content."""
    project = _verify_project_ownership(db, project_id, current_user.id)
    bible_context = build_bible_context(db, project)

    try:
        run = await breakdown_service.extract(db, project_id, bible_context=bible_context)
        return run
    except Exception as e:
        logger.error(f"Extraction failed for project {project_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Extraction failed: {str(e)}"
        )


# ============================================================
# Scene link add/remove (API-06)
# ============================================================

@router.post("/element/{element_id}/scenes", status_code=status.HTTP_201_CREATED)
async def add_scene_link(
    element_id: UUID,
    body: schemas.SceneLinkCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Link a breakdown element to a scene (ListItem). Idempotent: duplicate returns 200."""
    _verify_element_ownership(db, element_id, current_user.id)

    # Validate scene exists
    scene = db.query(database.ListItem).filter(
        database.ListItem.id == str(body.scene_item_id)
    ).first()
    if not scene:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found")

    # Idempotent: check for existing link
    existing = db.query(database.ElementSceneLink).filter(
        database.ElementSceneLink.element_id == str(element_id),
        database.ElementSceneLink.scene_item_id == str(body.scene_item_id),
    ).first()
    if existing:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"message": "Scene link already exists", "id": str(existing.id)},
        )

    link = database.ElementSceneLink(
        element_id=element_id,
        scene_item_id=body.scene_item_id,
        context=body.context,
        source="user",
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return {"message": "Scene linked", "id": str(link.id)}


@router.post("/element/{element_id}/sync-to-project")
async def sync_element_to_project(
    element_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Sync a character breakdown element to story.characters as a supporting ListItem.

    Idempotent: duplicate name (case-insensitive) returns already_exists with HTTP 200.
    Creates story.characters PhaseData on demand if absent.
    """
    element = _verify_element_ownership(db, element_id, current_user.id)

    # Look up (or create) story.characters PhaseData
    chars_pd = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == str(element.project_id),
        database.PhaseData.phase == "story",
        database.PhaseData.subsection_key == "characters",
    ).first()

    if not chars_pd:
        chars_pd = database.PhaseData(
            project_id=element.project_id,
            phase="story",
            subsection_key="characters",
            content={},
            sort_order=0,
        )
        db.add(chars_pd)
        db.flush()  # Get id without committing

    # Load existing ListItems for duplicate detection
    existing_items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == str(chars_pd.id)
    ).all()

    # Case-insensitive duplicate check (Python-side for SQLite/PostgreSQL compat)
    for item in existing_items:
        if (item.content.get("name") or "").lower() == element.name.lower():
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "already_exists", "list_item_id": str(item.id)},
            )

    # Create new supporting ListItem
    new_item = database.ListItem(
        phase_data_id=chars_pd.id,
        item_type="supporting",
        content={
            "name": element.name,
            "role": element.description or "",
            "dialogue_style": "",
        },
        status="draft",
        sort_order=len(existing_items),
    )
    db.add(new_item)
    db.commit()
    db.refresh(new_item)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": "created", "list_item_id": str(new_item.id)},
    )


@router.delete("/element/{element_id}/scenes/{scene_item_id}")
async def remove_scene_link(
    element_id: UUID,
    scene_item_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a scene link from a breakdown element. Hard-delete for junction table."""
    _verify_element_ownership(db, element_id, current_user.id)

    link = db.query(database.ElementSceneLink).filter(
        database.ElementSceneLink.element_id == str(element_id),
        database.ElementSceneLink.scene_item_id == str(scene_item_id),
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene link not found")

    db.delete(link)
    db.commit()
    return {"status": "success", "message": "Scene link removed"}


# ============================================================
# Summary endpoint (API-07)
# ============================================================

@router.get("/summary/{project_id}", response_model=schemas.BreakdownSummaryResponse)
async def get_summary(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get breakdown summary with category counts, staleness, and last run info."""
    project = _verify_project_ownership(db, project_id, current_user.id)

    # Single aggregation query (GROUP BY, not N+1)
    counts = db.query(
        database.BreakdownElement.category,
        func.count(database.BreakdownElement.id)
    ).filter(
        database.BreakdownElement.project_id == str(project_id),
        database.BreakdownElement.is_deleted == False,
    ).group_by(database.BreakdownElement.category).all()

    counts_dict = {cat: count for cat, count in counts}
    total_elements = sum(counts_dict.values())

    # Latest run
    last_run = db.query(database.BreakdownRun).filter(
        database.BreakdownRun.project_id == str(project_id)
    ).order_by(database.BreakdownRun.created_at.desc()).first()

    return schemas.BreakdownSummaryResponse(
        project_id=project_id,
        is_stale=project.breakdown_stale or False,
        total_elements=total_elements,
        counts_by_category=counts_dict,
        last_run=schemas.BreakdownRunResponse.model_validate(last_run) if last_run else None,
    )
