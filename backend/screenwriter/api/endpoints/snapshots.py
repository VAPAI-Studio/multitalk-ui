# backend/app/api/endpoints/snapshots.py

import logging
from uuid import UUID

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, undefer, joinedload

from screenwriter.models import schemas, database
from screenwriter.models.database import SnapshotTriggerType
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.services.snapshot_service import (
    create_snapshot, restore_from_snapshot, remove_screenplay_content,
    _serialize_phase_data, _serialize_screenplay_content,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _verify_project_ownership(db: Session, project_id: UUID, user_id):
    """Verify user owns the project. Returns project or raises 404."""
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_manual_snapshot(
    project_id: UUID,
    body: schemas.SnapshotCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a manual snapshot of the project's current writing state."""
    _verify_project_ownership(db, project_id, current_user.id)
    snapshot = create_snapshot(db, project_id, SnapshotTriggerType.MANUAL, label=body.label)
    db.commit()
    return schemas.SnapshotResponse.model_validate(snapshot).model_dump(by_alias=True)


@router.get("/")
async def list_snapshots(
    project_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List snapshots for a project with pagination (excludes data blob via deferred column)."""
    _verify_project_ownership(db, project_id, current_user.id)
    base_query = db.query(database.ProjectSnapshot).filter(
        database.ProjectSnapshot.project_id == str(project_id)
    )
    total = base_query.count()
    snapshots = (
        base_query
        .order_by(database.ProjectSnapshot.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "items": [schemas.SnapshotResponse.model_validate(s).model_dump(by_alias=True) for s in snapshots],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


@router.get("/{snapshot_id}")
async def get_snapshot(
    project_id: UUID,
    snapshot_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single snapshot with full data blob for preview (HIST-02)."""
    _verify_project_ownership(db, project_id, current_user.id)
    snapshot = db.query(database.ProjectSnapshot).options(
        undefer(database.ProjectSnapshot.data)
    ).filter(
        database.ProjectSnapshot.id == str(snapshot_id),
        database.ProjectSnapshot.project_id == str(project_id),
    ).first()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return schemas.SnapshotDetailResponse.model_validate(snapshot).model_dump(by_alias=True)


@router.delete("/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot(
    project_id: UUID,
    snapshot_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a snapshot by ID."""
    _verify_project_ownership(db, project_id, current_user.id)
    snapshot = db.query(database.ProjectSnapshot).filter(
        database.ProjectSnapshot.id == str(snapshot_id),
        database.ProjectSnapshot.project_id == str(project_id),
    ).first()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    db.delete(snapshot)
    db.commit()


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(
    project_id: UUID,
    snapshot_id: UUID,
    body: Optional[schemas.RestoreRequest] = None,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore project state from a snapshot (REST-01, REST-02, REST-04).

    If body contains phase_ids, only restore those phases (partial restore).
    If no body or phase_ids is None, restore everything (full restore).
    """
    _verify_project_ownership(db, project_id, current_user.id)

    snapshot = db.query(database.ProjectSnapshot).options(
        undefer(database.ProjectSnapshot.data)
    ).filter(
        database.ProjectSnapshot.id == str(snapshot_id),
        database.ProjectSnapshot.project_id == str(project_id),
    ).first()
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")

    phase_ids = body.phase_ids if body else None
    result = restore_from_snapshot(db, project_id, snapshot, phase_ids=phase_ids)
    db.commit()
    return result


@router.get("/current-state")
async def get_current_state(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return current project writing state in snapshot-compatible format (COMP-01)."""
    _verify_project_ownership(db, project_id, current_user.id)

    phase_data_rows = (
        db.query(database.PhaseData)
        .options(joinedload(database.PhaseData.list_items))
        .filter(database.PhaseData.project_id == str(project_id))
        .all()
    )
    screenplay_rows = (
        db.query(database.ScreenplayContent)
        .filter(database.ScreenplayContent.project_id == str(project_id))
        .all()
    )

    data = {
        "version": 1,
        "phase_data": [_serialize_phase_data(pd) for pd in phase_data_rows],
        "screenplay_content": [_serialize_screenplay_content(sc) for sc in screenplay_rows],
    }
    return data


@router.post("/remove-screenplay")
async def remove_screenplay(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove all screenplay content with safety snapshot (SCRP-01)."""
    _verify_project_ownership(db, project_id, current_user.id)
    result = remove_screenplay_content(db, project_id)
    db.commit()
    return result
