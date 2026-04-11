# backend/app/api/endpoints/shots.py

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from screenwriter.models import schemas, database
from screenwriter.services.shotlist_generation_service import shotlist_generation_service
from screenwriter.api.dependencies import get_db, get_current_user

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


@router.post("/{project_id}", response_model=schemas.ShotResponse, status_code=status.HTTP_201_CREATED)
async def create_shot(
    project_id: UUID,
    body: schemas.ShotCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new shot for a project."""
    _verify_project_ownership(db, project_id, current_user.id)

    db_shot = database.Shot(
        project_id=str(project_id),
        scene_item_id=str(body.scene_item_id) if body.scene_item_id else None,
        shot_number=body.shot_number,
        script_text=body.script_text,
        script_range=body.script_range or {},
        fields=body.fields or {},
        sort_order=body.sort_order if body.sort_order is not None else 0,
        source=body.source,
        ai_generated=body.ai_generated,
    )
    db.add(db_shot)
    db.commit()
    db.refresh(db_shot)
    return db_shot


@router.get("/{project_id}", response_model=List[schemas.ShotResponse])
async def list_shots(
    project_id: UUID,
    scene_item_id: Optional[UUID] = None,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all shots for a project, optionally filtered by scene."""
    _verify_project_ownership(db, project_id, current_user.id)

    query = db.query(database.Shot).filter(
        database.Shot.project_id == str(project_id)
    )

    if scene_item_id is not None:
        query = query.filter(database.Shot.scene_item_id == str(scene_item_id))

    query = query.order_by(database.Shot.scene_item_id, database.Shot.sort_order)
    return query.all()


@router.get("/{project_id}/status")
async def get_shotlist_status(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get shotlist staleness status and shot count."""
    project = _verify_project_ownership(db, project_id, current_user.id)
    shot_count = db.query(database.Shot).filter(
        database.Shot.project_id == str(project_id)
    ).count()
    return {
        "shotlist_stale": project.shotlist_stale or False,
        "shot_count": shot_count,
    }


@router.post("/{project_id}/acknowledge-stale")
async def acknowledge_shotlist_stale(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear shotlist_stale flag (user acknowledged the staleness)."""
    project = _verify_project_ownership(db, project_id, current_user.id)
    project.shotlist_stale = False
    db.commit()
    return {"status": "success"}


@router.post("/{project_id}/generate")
async def generate_shotlist(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Trigger AI generation of shotlist. Preserves user-modified shots."""
    _verify_project_ownership(db, project_id, current_user.id)
    result = await shotlist_generation_service.generate(db, project_id)
    return result


@router.get("/{project_id}/{shot_id}", response_model=schemas.ShotResponse)
async def get_shot(
    project_id: UUID,
    shot_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single shot by ID."""
    _verify_project_ownership(db, project_id, current_user.id)

    shot = db.query(database.Shot).filter(
        database.Shot.id == str(shot_id),
        database.Shot.project_id == str(project_id)
    ).first()
    if not shot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shot not found")
    return shot


@router.put("/{project_id}/{shot_id}", response_model=schemas.ShotResponse)
async def update_shot(
    project_id: UUID,
    shot_id: UUID,
    body: schemas.ShotUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Partially update a shot."""
    _verify_project_ownership(db, project_id, current_user.id)

    shot = db.query(database.Shot).filter(
        database.Shot.id == str(shot_id),
        database.Shot.project_id == str(project_id)
    ).first()
    if not shot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shot not found")

    update_data = body.model_dump(exclude_unset=True)

    # Convert scene_item_id UUID to string for storage
    if "scene_item_id" in update_data and update_data["scene_item_id"] is not None:
        update_data["scene_item_id"] = str(update_data["scene_item_id"])

    for field, value in update_data.items():
        setattr(shot, field, value)

    # AISG-06: Mark shot as user-modified on any manual edit
    shot.user_modified = True

    db.commit()
    db.refresh(shot)
    return shot


@router.delete("/{project_id}/{shot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shot(
    project_id: UUID,
    shot_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Hard-delete a shot."""
    _verify_project_ownership(db, project_id, current_user.id)

    shot = db.query(database.Shot).filter(
        database.Shot.id == str(shot_id),
        database.Shot.project_id == str(project_id)
    ).first()
    if not shot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shot not found")

    db.delete(shot)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/reorder")
async def reorder_shots(
    project_id: UUID,
    reorder: schemas.ReorderRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Bulk-update sort_order for shots."""
    _verify_project_ownership(db, project_id, current_user.id)

    shot_ids = [str(item.id) for item in reorder.items]

    # Validate all shots belong to this project
    count = db.query(database.Shot).filter(
        database.Shot.id.in_(shot_ids),
        database.Shot.project_id == str(project_id)
    ).count()

    if count != len(shot_ids):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="One or more shot IDs do not belong to this project"
        )

    for item in reorder.items:
        db.query(database.Shot).filter(
            database.Shot.id == str(item.id)
        ).update({"sort_order": item.sort_order})

    db.commit()
    return {"status": "success", "message": "Shots reordered"}
