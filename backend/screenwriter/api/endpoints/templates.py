# backend/app/api/endpoints/templates.py

from fastapi import APIRouter, HTTPException, status
from typing import List

from screenwriter.templates import get_template, list_templates

router = APIRouter()


@router.get("/", response_model=List[dict])
async def get_templates():
    """List all available templates with summary info."""
    return list_templates()


@router.get("/{template_id}")
async def get_template_config(template_id: str):
    """Get full template configuration by ID."""
    try:
        return get_template(template_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found"
        )
