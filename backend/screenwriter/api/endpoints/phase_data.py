# backend/app/api/endpoints/phase_data.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Dict
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.models.database import BreakdownElement
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.templates import get_template

router = APIRouter()

# Phases that trigger breakdown_stale when their content is updated.
BREAKDOWN_SENSITIVE_PHASES = {"write", "scenes"}
SHOTLIST_SENSITIVE_PHASES = {"write", "scenes"}


def _mark_breakdown_stale(db: Session, project_id) -> None:
    """Set breakdown_stale=True if a breakdown exists for this project.

    Does not commit -- caller's existing commit covers the change.
    Only marks stale when at least one non-deleted BreakdownElement exists.
    """
    has_breakdown = db.query(BreakdownElement).filter(
        BreakdownElement.project_id == str(project_id),
        BreakdownElement.is_deleted == False,  # noqa: E712
    ).first() is not None
    if has_breakdown:
        project = db.query(database.Project).filter(
            database.Project.id == str(project_id)
        ).first()
        if project:
            project.breakdown_stale = True


def _mark_shotlist_stale(db: Session, project_id) -> None:
    """Set shotlist_stale=True if shots exist for this project.

    Does not commit -- caller's existing commit covers the change.
    Only marks stale when at least one Shot exists.
    """
    has_shots = db.query(database.Shot).filter(
        database.Shot.project_id == str(project_id),
    ).first() is not None
    if has_shots:
        project = db.query(database.Project).filter(
            database.Project.id == str(project_id)
        ).first()
        if project:
            project.shotlist_stale = True


def _verify_project_ownership(db: Session, project_id: UUID, user_id: UUID) -> database.Project:
    """Verify user owns the project and return it."""
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


# NOTE: readiness must be defined BEFORE the /{project_id}/{phase}/{subsection_key}
# catch-all route, otherwise FastAPI matches "readiness" as a phase parameter.
@router.get("/{project_id}/readiness/{phase}")
async def get_readiness(
    project_id: UUID,
    phase: str,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Calculate readiness scores for a wizard based on project data completeness."""
    project = _verify_project_ownership(db, project_id, current_user.id)

    if not project.template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project has no template")

    template_config = get_template(project.template.value)

    # Find the target phase in the template
    target_phase = None
    for p in template_config.get("phases", []):
        if p["id"] == phase:
            target_phase = p
            break

    if not target_phase:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Phase '{phase}' not found")

    # Get all phase_data for this project
    all_data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project_id
    ).all()
    data_map = {f"{d.phase}.{d.subsection_key}": d for d in all_data}

    # Calculate readiness for each wizard subsection
    readiness = {"checks": [], "overall_percent": 0, "is_ready": False}
    total_score = 0
    total_max = 0

    for sub in target_phase.get("subsections", []):
        wizard_config = sub.get("wizard_config", {})
        for check in wizard_config.get("readiness_checks", []):
            source = check["source"]
            label = check["label"]

            source_data = data_map.get(source)
            content = source_data.content if source_data else {}

            if "count_fields" in check:
                fields = check["count_fields"]
                filled = sum(1 for f in fields if content.get(f))
                total = len(fields)
            elif "count_items" in check:
                # Count list items for this phase_data
                if source_data:
                    item_count = db.query(database.ListItem).filter(
                        database.ListItem.phase_data_id == source_data.id
                    ).count()
                else:
                    item_count = 0
                filled = item_count
                total = max(1, item_count)  # At least 1 required
            else:
                filled = 0
                total = 1

            total_score += filled
            total_max += total

            readiness["checks"].append({
                "label": label,
                "filled": filled,
                "total": total,
                "percent": round(filled / total * 100, 1) if total > 0 else 0
            })

    if total_max > 0:
        readiness["overall_percent"] = round(total_score / total_max * 100, 1)
    readiness["is_ready"] = readiness["overall_percent"] >= 50

    return readiness


@router.get("/{project_id}/{phase}", response_model=List[schemas.PhaseDataResponse])
async def get_phase_data(
    project_id: UUID,
    phase: str,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all subsection data for a phase."""
    _verify_project_ownership(db, project_id, current_user.id)

    data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project_id,
        database.PhaseData.phase == phase
    ).order_by(database.PhaseData.sort_order).all()

    return data


@router.get("/{project_id}/{phase}/{subsection_key}", response_model=schemas.PhaseDataResponse)
async def get_subsection_data(
    project_id: UUID,
    phase: str,
    subsection_key: str,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get content for a specific subsection."""
    _verify_project_ownership(db, project_id, current_user.id)

    data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project_id,
        database.PhaseData.phase == phase,
        database.PhaseData.subsection_key == subsection_key
    ).first()

    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")

    return data


@router.patch("/{project_id}/{phase}/{subsection_key}", response_model=schemas.PhaseDataResponse)
async def update_subsection_data(
    project_id: UUID,
    phase: str,
    subsection_key: str,
    update: schemas.PhaseDataUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update content for a specific subsection (merge into existing JSONB)."""
    _verify_project_ownership(db, project_id, current_user.id)

    data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == str(project_id),
        database.PhaseData.phase == phase,
        database.PhaseData.subsection_key == subsection_key
    ).first()

    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Phase data not found")

    # Merge new content into existing content
    existing = dict(data.content or {})
    existing.update(update.content)
    data.content = existing
    flag_modified(data, "content")

    if phase in BREAKDOWN_SENSITIVE_PHASES:
        _mark_breakdown_stale(db, project_id)
    if phase in SHOTLIST_SENSITIVE_PHASES:
        _mark_shotlist_stale(db, project_id)

    db.commit()
    db.refresh(data)
    return data
