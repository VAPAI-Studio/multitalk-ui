# backend/app/api/endpoints/sections.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user

router = APIRouter()

@router.get("/{section_id}", response_model=schemas.Section)
async def get_section(
    section_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific section"""
    section = db.query(database.Section).filter(
        database.Section.id == section_id
    ).first()
    
    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Section not found"
        )
    
    # Verify user owns the project
    project = db.query(database.Project).filter(
        database.Project.id == section.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this section"
        )
    
    return section

@router.patch("/{section_id}", response_model=schemas.Section)
async def update_section(
    section_id: UUID,
    section_update: schemas.SectionUpdate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a section's content"""
    section = db.query(database.Section).filter(
        database.Section.id == section_id
    ).first()
    
    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Section not found"
        )
    
    # Verify user owns the project
    project = db.query(database.Project).filter(
        database.Project.id == section.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this section"
        )
    
    # Update section
    update_data = section_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(section, field, value)
    
    db.commit()
    db.refresh(section)
    
    return section

@router.post("/{section_id}/checklist", response_model=schemas.ChecklistItem)
async def create_checklist_item(
    section_id: UUID,
    checklist_item: schemas.ChecklistItemCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a checklist item to a section"""
    section = db.query(database.Section).filter(
        database.Section.id == section_id
    ).first()
    
    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Section not found"
        )
    
    # Verify user owns the project
    project = db.query(database.Project).filter(
        database.Project.id == section.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to add checklist items to this section"
        )
    
    # Create checklist item
    db_checklist_item = database.ChecklistItem(
        **checklist_item.dict(),
        section_id=section_id
    )
    db.add(db_checklist_item)
    db.commit()
    db.refresh(db_checklist_item)
    
    return db_checklist_item

@router.patch("/checklist/{item_id}", response_model=schemas.ChecklistItem)
async def update_checklist_item(
    item_id: UUID,
    item_update: schemas.ChecklistItemCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a checklist item"""
    item = db.query(database.ChecklistItem).filter(
        database.ChecklistItem.id == item_id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checklist item not found"
        )
    
    # Verify user owns the project
    section = db.query(database.Section).filter(
        database.Section.id == item.section_id
    ).first()
    
    project = db.query(database.Project).filter(
        database.Project.id == section.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this checklist item"
        )
    
    # Update item
    update_data = item_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)
    
    db.commit()
    db.refresh(item)
    
    return item
