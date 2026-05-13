# backend/app/api/endpoints/list_items.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from .phase_data import _mark_breakdown_stale, _mark_shotlist_stale

router = APIRouter()


def _verify_phase_data_ownership(db: Session, phase_data_id: UUID, user_id: UUID) -> database.PhaseData:
    """Verify user owns the project containing this phase_data."""
    phase_data = db.query(database.PhaseData).filter(
        database.PhaseData.id == str(phase_data_id)
    ).first()
    if not phase_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")

    project = db.query(database.Project).filter(
        database.Project.id == str(phase_data.project_id),
        database.Project.owner_id == str(user_id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return phase_data


def _verify_item_ownership(db: Session, item_id: UUID, user_id: UUID) -> database.ListItem:
    """Verify user owns the project containing this list item."""
    item = db.query(database.ListItem).filter(database.ListItem.id == str(item_id)).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    _verify_phase_data_ownership(db, item.phase_data_id, user_id)
    return item


def _is_scene_item(db: Session, phase_data_id) -> database.PhaseData | None:
    """Return PhaseData if it represents the scenes/scene_list subsection, else None.

    Only scene_list items in the 'scenes' phase trigger breakdown staleness.
    """
    pd = db.query(database.PhaseData).filter(
        database.PhaseData.id == str(phase_data_id)
    ).first()
    if pd and str(pd.phase) == "scenes" and pd.subsection_key == "scene_list":
        return pd
    return None


def _is_character_item(db: Session, phase_data_id) -> database.PhaseData | None:
    """Return PhaseData if it represents story/characters subsection, else None.

    Character name changes affect shot fields, so they trigger shotlist staleness.
    """
    pd = db.query(database.PhaseData).filter(
        database.PhaseData.id == str(phase_data_id)
    ).first()
    if pd and str(pd.phase) == "story" and pd.subsection_key == "characters":
        return pd
    return None


@router.get("/{phase_data_id}", response_model=List[schemas.ListItemResponse])
async def get_list_items(
    phase_data_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all items for a phase_data subsection."""
    _verify_phase_data_ownership(db, phase_data_id, current_user.id)

    items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == phase_data_id
    ).order_by(database.ListItem.sort_order).all()

    return items


@router.get("/item/{item_id}", response_model=schemas.ListItemResponse)
async def get_list_item(
    item_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single list item."""
    item = _verify_item_ownership(db, item_id, current_user.id)
    return item


@router.post("/{phase_data_id}", response_model=schemas.ListItemResponse, status_code=status.HTTP_201_CREATED)
async def create_list_item(
    phase_data_id: UUID,
    item: schemas.ListItemCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new list item."""
    _verify_phase_data_ownership(db, phase_data_id, current_user.id)

    # Auto-assign sort_order if not provided
    if item.sort_order is None:
        max_order = db.query(database.ListItem).filter(
            database.ListItem.phase_data_id == phase_data_id
        ).count()
        sort_order = max_order
    else:
        sort_order = item.sort_order

    db_item = database.ListItem(
        phase_data_id=phase_data_id,
        item_type=item.item_type,
        content=item.content,
        sort_order=sort_order,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)

    scene_pd = _is_scene_item(db, phase_data_id)
    if scene_pd:
        _mark_breakdown_stale(db, scene_pd.project_id)
        _mark_shotlist_stale(db, scene_pd.project_id)
        db.commit()

    char_pd = _is_character_item(db, phase_data_id)
    if char_pd:
        _mark_shotlist_stale(db, char_pd.project_id)
        db.commit()

    return db_item


@router.patch("/item/{item_id}", response_model=schemas.ListItemResponse)
async def update_list_item(
    item_id: UUID,
    update: schemas.ListItemUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a list item's content or status."""
    item = _verify_item_ownership(db, item_id, current_user.id)

    if update.content is not None:
        # Merge new content into existing
        existing = item.content or {}
        existing.update(update.content)
        item.content = existing

    if update.status is not None:
        item.status = update.status

    db.commit()
    db.refresh(item)

    scene_pd = _is_scene_item(db, item.phase_data_id)
    if scene_pd:
        _mark_breakdown_stale(db, scene_pd.project_id)
        _mark_shotlist_stale(db, scene_pd.project_id)
        db.commit()

    char_pd = _is_character_item(db, item.phase_data_id)
    if char_pd:
        _mark_shotlist_stale(db, char_pd.project_id)
        db.commit()

    return item


@router.delete("/item/{item_id}")
async def delete_list_item(
    item_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a list item."""
    item = _verify_item_ownership(db, item_id, current_user.id)
    # Capture phase_data_id before deletion so we can check scene_list membership after
    phase_data_id = item.phase_data_id
    db.delete(item)
    db.commit()

    scene_pd = _is_scene_item(db, phase_data_id)
    if scene_pd:
        _mark_breakdown_stale(db, scene_pd.project_id)
        _mark_shotlist_stale(db, scene_pd.project_id)
        db.commit()

    char_pd = _is_character_item(db, phase_data_id)
    if char_pd:
        _mark_shotlist_stale(db, char_pd.project_id)
        db.commit()

    return {"status": "success", "message": "Item deleted"}


@router.post("/{phase_data_id}/reorder")
async def reorder_list_items(
    phase_data_id: UUID,
    reorder: schemas.ReorderRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reorder list items."""
    _verify_phase_data_ownership(db, phase_data_id, current_user.id)

    for reorder_item in reorder.items:
        db.query(database.ListItem).filter(
            database.ListItem.id == reorder_item.id,
            database.ListItem.phase_data_id == phase_data_id
        ).update({"sort_order": reorder_item.sort_order})

    db.commit()

    scene_pd = _is_scene_item(db, phase_data_id)
    if scene_pd:
        _mark_shotlist_stale(db, scene_pd.project_id)
        db.commit()

    return {"status": "success", "message": "Items reordered"}
