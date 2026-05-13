# backend/app/api/endpoints/projects.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.utils import validate_project_title, validate_framework
from screenwriter.exceptions import NotFoundException, ValidationException
from screenwriter.templates import get_template, get_template_subsections

router = APIRouter()

@router.post("/", response_model=schemas.Project)
async def create_project(
    project: schemas.ProjectCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new project"""
    # Validate project title
    validate_project_title(project.title)
    
    # Validate framework
    if not validate_framework(project.framework.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid framework selected"
        )
    
    db_project = database.Project(
        **project.dict(),
        owner_id=current_user.id
    )
    db.add(db_project)
    db.flush()  # Assigns db_project.id without committing

    # Create default sections based on framework
    section_types = [
        database.SectionType.INCITING_INCIDENT,
        database.SectionType.PLOT_POINT_1,
        database.SectionType.MIDPOINT,
        database.SectionType.PLOT_POINT_2,
        database.SectionType.CLIMAX,
        database.SectionType.RESOLUTION
    ]
    
    for section_type in section_types:
        db_section = database.Section(
            project_id=db_project.id,
            type=section_type,
            ai_suggestions={"issues": [], "suggestions": []}
        )
        db.add(db_section)
    
    db.commit()
    db.refresh(db_project)
    
    return db_project

@router.post("/v2", response_model=schemas.ProjectResponseV2)
async def create_project_v2(
    project: schemas.ProjectCreateV2,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new template-based project with auto-scaffolded phase data."""
    validate_project_title(project.title)

    # Validate template exists
    try:
        template_config = get_template(project.template.value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid template: {project.template.value}"
        )

    db_project = database.Project(
        title=project.title,
        template=project.template,
        current_phase=database.PhaseType.IDEA,
        owner_id=current_user.id
    )
    db.add(db_project)
    db.flush()

    # Auto-create phase_data rows for all subsections in the template
    subsections = get_template_subsections(project.template.value)
    for sub in subsections:
        pd = database.PhaseData(
            project_id=db_project.id,
            phase=sub["phase"],
            subsection_key=sub["subsection_key"],
            sort_order=sub["sort_order"],
            content={},
            ai_suggestions={},
        )
        db.add(pd)

    db.commit()
    db.refresh(db_project)
    return db_project


@router.get("/", response_model=List[schemas.Project])
async def list_projects(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all projects for the current user"""
    projects = db.query(database.Project).options(
        joinedload(database.Project.sections)
            .joinedload(database.Section.checklist_items)
    ).filter(
        database.Project.owner_id == current_user.id
    ).order_by(database.Project.created_at.desc()).all()
    
    return projects

@router.get("/{project_id}", response_model=schemas.Project)
async def get_project(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific project"""
    project = db.query(database.Project).options(
        joinedload(database.Project.sections)
            .joinedload(database.Section.checklist_items)
    ).filter(
        database.Project.id == project_id,
        database.Project.owner_id == current_user.id
    ).first()

    if not project:
        raise NotFoundException(resource="Project", identifier=str(project_id))
    
    return project

@router.patch("/{project_id}", response_model=schemas.Project)
async def update_project(
    project_id: UUID,
    project_update: schemas.ProjectUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a project"""
    project = db.query(database.Project).filter(
        database.Project.id == project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    update_data = project_update.dict(exclude_unset=True)
    
    # Validate title if it's being updated
    if 'title' in update_data and update_data['title'] is not None:
        validate_project_title(update_data['title'])
    
    # Validate framework if it's being updated
    if 'framework' in update_data and update_data['framework'] is not None:
        if not validate_framework(update_data['framework'].value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid framework selected"
            )
    
    for field, value in update_data.items():
        setattr(project, field, value)
    
    db.commit()
    db.refresh(project)
    
    return project

@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a project"""
    project = db.query(database.Project).filter(
        database.Project.id == project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    db.delete(project)
    db.commit()
    
    return {"status": "success", "message": "Project deleted"}
