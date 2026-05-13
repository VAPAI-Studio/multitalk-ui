# backend/app/api/endpoints/review.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from screenwriter.models import schemas, database
from screenwriter.services.openai_service import openai_service
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.utils import validate_review_text, validate_framework, sanitize_html
from screenwriter.utils.bible_context import build_bible_context

router = APIRouter()

@router.post("/", response_model=schemas.ReviewResponse)
async def review_section(
    review_request: schemas.ReviewRequest,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Submit a section for AI review"""
    
    # Validate review text
    sanitized_text = sanitize_html(review_request.text)
    validate_review_text(sanitized_text)
    
    # Validate framework
    if not validate_framework(review_request.framework.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid framework specified"
        )
    
    # Get section and validate ownership
    section = db.query(database.Section).filter(
        database.Section.id == review_request.section_id
    ).first()
    
    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Section not found"
        )
    
    # Check if user owns the project
    project = db.query(database.Project).filter(
        database.Project.id == section.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to review this section"
        )
    
    try:
        # Build bible context for episode projects
        bible_context = build_bible_context(db, project)

        # Call OpenAI service with sanitized text
        review_result = await openai_service.review_section(
            section_id=str(section.id),
            text=sanitized_text,
            framework=review_request.framework,
            section_type=section.type,
            bible_context=bible_context,
        )
        
        # Update section with AI suggestions
        section.ai_suggestions = review_result
        db.commit()
        
        return review_result
    
    except Exception as e:
        print(f"Review error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing review request"
        )
