from fastapi import APIRouter, HTTPException, Request
from models.image_edit import ImageEditRequest, ImageEditResponse
from services.openrouter_service import OpenRouterService
from services.storage_service import StorageService
from services.edited_image_service import EditedImageService
from models.edited_image import CreateEditedImagePayload, ImageEditStatus
import time

router = APIRouter(prefix="/image-edit", tags=["image-edit"])

def get_openrouter_service():
    return OpenRouterService()

def get_storage_service():
    return StorageService()

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

@router.post("/", response_model=ImageEditResponse)
async def edit_image(edit_request: ImageEditRequest, request: Request):
    """Edit an image using OpenRouter's Gemini model with storage and database tracking"""
    start_time = time.time()
    edited_image_id = None
    
    try:
        # Initialize services
        openrouter_service = get_openrouter_service()
        storage_service = get_storage_service()
        edited_image_service = get_edited_image_service()
        
        # Step 1: Upload source image to storage
        source_upload_success, source_storage_url, source_error = await storage_service.upload_image_from_data_url(
            edit_request.image_data, "source-images"
        )
        
        if not source_upload_success:
            return ImageEditResponse(
                success=False,
                error=f"Failed to store source image: {source_error}"
            )
        
        # Step 2: Create edited image record in database
        create_payload = CreateEditedImagePayload(
            source_image_url=source_storage_url,
            prompt=edit_request.prompt,
            workflow_name="openrouter-gemini",
            user_ip=get_client_ip(request)
        )
        
        create_success, edited_image_id, create_error = await edited_image_service.create_edited_image(create_payload)
        
        if not create_success:
            return ImageEditResponse(
                success=False,
                error=f"Failed to create database record: {create_error}"
            )
        
        # Step 3: Update status to processing
        await edited_image_service.update_to_processing(edited_image_id)
        
        # Step 4: Generate edited image
        edit_success, result_image_url, edit_error = await openrouter_service.edit_image(
            edit_request.image_data, 
            edit_request.prompt
        )
        
        if not edit_success or not result_image_url:
            # Mark as failed in database
            await edited_image_service.fail_edited_image(
                edited_image_id, 
                edit_error or "Image generation failed"
            )
            
            return ImageEditResponse(
                success=False,
                error=edit_error or "Image generation failed"
            )
        
        # Step 5: Upload result image to storage
        # Check if result is a data URL or regular URL
        if result_image_url.startswith('data:image/'):
            # Handle data URL
            result_upload_success, result_storage_url, result_error = await storage_service.upload_image_from_data_url(
                result_image_url, "edited-images"
            )
        else:
            # Handle regular URL
            result_upload_success, result_storage_url, result_error = await storage_service.upload_image_from_url(
                result_image_url, "edited-images"
            )
        
        if not result_upload_success:
            # Mark as failed in database
            await edited_image_service.fail_edited_image(
                edited_image_id, 
                f"Failed to store result image: {result_error}"
            )
            
            return ImageEditResponse(
                success=False,
                error=f"Failed to store result image: {result_error}"
            )
        
        # Step 6: Mark as completed in database
        processing_time = int(time.time() - start_time)
        completion_success, completed_image, completion_error = await edited_image_service.complete_edited_image(
            edited_image_id,
            result_storage_url,
            processing_time,
            "google/gemini-flash-1.5-8b"
        )
        
        if not completion_success:
            print(f"Warning: Failed to mark image as completed: {completion_error}")
        
        # Return the stored result image URL
        return ImageEditResponse(
            success=True,
            image_url=result_storage_url,
            error=None
        )
        
    except Exception as e:
        # Mark as failed in database if we have an ID
        if edited_image_id:
            try:
                await edited_image_service.fail_edited_image(
                    edited_image_id, 
                    f"Server error: {str(e)}"
                )
            except:
                pass
        
        return ImageEditResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )

@router.get("/health")
async def check_openrouter_config():
    """Check if OpenRouter is properly configured"""
    openrouter_service = get_openrouter_service()
    has_key = bool(openrouter_service.api_key)
    
    return {
        "configured": has_key,
        "message": "OpenRouter API key configured" if has_key else "OpenRouter API key not set"
    }