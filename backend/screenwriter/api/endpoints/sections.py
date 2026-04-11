# backend/app/api/endpoints/sections.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.utils import validate_section_content, validate_checklist_prompt, validate_checklist_answer, sanitize_html

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
    
    # Validate and sanitize user notes if provided
    if 'user_notes' in update_data and update_data['user_notes'] is not None:
        update_data['user_notes'] = sanitize_html(update_data['user_notes'])
        update_data['user_notes'] = validate_section_content(update_data['user_notes'])
    
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
    
    # Validate checklist item data
    validate_checklist_prompt(checklist_item.prompt)
    
    # Create checklist item
    checklist_data = checklist_item.dict()
    checklist_data['prompt'] = sanitize_html(checklist_data['prompt'])
    if 'answer' in checklist_data and checklist_data['answer']:
        checklist_data['answer'] = validate_checklist_answer(sanitize_html(checklist_data['answer']))
    
    db_checklist_item = database.ChecklistItem(
        **checklist_data,
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
    
    # Validate prompt if provided
    if 'prompt' in update_data and update_data['prompt'] is not None:
        validate_checklist_prompt(update_data['prompt'])
        update_data['prompt'] = sanitize_html(update_data['prompt'])
    
    # Validate answer if provided
    if 'answer' in update_data and update_data['answer'] is not None:
        update_data['answer'] = validate_checklist_answer(sanitize_html(update_data['answer']))
    
    for field, value in update_data.items():
        setattr(item, field, value)
    
    db.commit()
    db.refresh(item)
    
    return item
