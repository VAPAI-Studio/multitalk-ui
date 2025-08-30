from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional

from models.edited_image import (
    EditedImage,
    CreateEditedImagePayload,
    UpdateEditedImagePayload,
    EditedImageResponse,
    EditedImageListResponse,
    ImageEditStatus
)
from services.edited_image_service import EditedImageService

router = APIRouter(prefix="/edited-images", tags=["edited-images"])

def get_edited_image_service():
    return EditedImageService()

def get_client_ip(request: Request) -> str:
    """Extract client IP from request"""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    
    return request.client.host if request.client else "unknown"

@router.post("/", response_model=EditedImageResponse)
async def create_edited_image(payload: CreateEditedImagePayload, request: Request):
    """Create a new edited image record"""
    try:
        # Add client IP if not provided
        if not payload.user_ip:
            payload.user_ip = get_client_ip(request)
        
        edited_image_service = get_edited_image_service()
        success, image_id, error = await edited_image_service.create_edited_image(payload)
        
        if success and image_id:
            # Get the created record
            success, edited_image, error = await edited_image_service.get_edited_image(image_id)
            return EditedImageResponse(success=success, edited_image=edited_image, error=error)
        else:
            return EditedImageResponse(success=False, error=error)
        
    except Exception as e:
        return EditedImageResponse(success=False, error=str(e))

@router.get("/{image_id}", response_model=EditedImageResponse)
async def get_edited_image(image_id: str):
    """Get a single edited image by ID"""
    try:
        edited_image_service = get_edited_image_service()
        success, edited_image, error = await edited_image_service.get_edited_image(image_id)
        
        return EditedImageResponse(success=success, edited_image=edited_image, error=error)
        
    except Exception as e:
        return EditedImageResponse(success=False, error=str(e))

@router.put("/{image_id}", response_model=EditedImageResponse)
async def update_edited_image(image_id: str, payload: UpdateEditedImagePayload):
    """Update an edited image record"""
    try:
        edited_image_service = get_edited_image_service()
        success, edited_image, error = await edited_image_service.update_edited_image(image_id, payload)
        
        return EditedImageResponse(success=success, edited_image=edited_image, error=error)
        
    except Exception as e:
        return EditedImageResponse(success=False, error=str(e))

@router.put("/{image_id}/processing")
async def update_to_processing(image_id: str):
    """Update an image status to processing"""
    try:
        edited_image_service = get_edited_image_service()
        success, error = await edited_image_service.update_to_processing(image_id)
        
        return {"success": success, "error": error}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.put("/{image_id}/complete")
async def complete_edited_image(
    image_id: str,
    result_image_url: str = Query(...),
    processing_time_seconds: Optional[int] = Query(None),
    model_used: Optional[str] = Query(None)
):
    """Mark an edited image as completed with result URL"""
    try:
        edited_image_service = get_edited_image_service()
        success, edited_image, error = await edited_image_service.complete_edited_image(
            image_id, result_image_url, processing_time_seconds, model_used
        )
        
        return EditedImageResponse(success=success, edited_image=edited_image, error=error)
        
    except Exception as e:
        return EditedImageResponse(success=False, error=str(e))

@router.put("/{image_id}/fail")
async def fail_edited_image(image_id: str, error_message: str = Query(...)):
    """Mark an edited image as failed"""
    try:
        edited_image_service = get_edited_image_service()
        success, error = await edited_image_service.fail_edited_image(image_id, error_message)
        
        return {"success": success, "error": error}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/", response_model=EditedImageListResponse)
async def get_recent_edited_images(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    completed_only: bool = Query(False, description="Return only completed images with results")
):
    """Get recent edited images for the generation feed"""
    try:
        edited_image_service = get_edited_image_service()
        
        if completed_only:
            success, edited_images, total_count, error = await edited_image_service.get_completed_edited_images(limit, offset)
        else:
            success, edited_images, total_count, error = await edited_image_service.get_recent_edited_images(limit, offset)
        
        return EditedImageListResponse(
            success=success,
            edited_images=edited_images,
            total_count=total_count,
            error=error
        )
        
    except Exception as e:
        return EditedImageListResponse(success=False, error=str(e))