from fastapi import APIRouter, HTTPException, Request, Header
from typing import Optional
from models.image_edit import ImageEditRequest, ImageEditResponse
from services.openrouter_service import OpenRouterService
from services.storage_service import StorageService
from services.image_job_service import ImageJobService
from models.image_job import CreateImageJobPayload, CompleteImageJobPayload
import time
import uuid

router = APIRouter(prefix="/image-edit", tags=["image-edit"])

def get_openrouter_service():
    return OpenRouterService()

def get_storage_service():
    return StorageService()

def get_image_job_service(auth_token: Optional[str] = None):
    return ImageJobService(auth_token=auth_token)

def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None

@router.post("/", response_model=ImageEditResponse)
async def edit_image(
    edit_request: ImageEditRequest,
    request: Request,
    authorization: Optional[str] = Header(None)
):
    """Edit an image using OpenRouter's Gemini model with storage and database tracking"""
    start_time = time.time()
    image_job_id = None

    try:
        # Initialize services
        openrouter_service = get_openrouter_service()
        storage_service = get_storage_service()
        image_job_service = get_image_job_service(_extract_bearer_token(authorization))

        # Step 1: Upload source image to storage
        source_upload_success, source_storage_url, source_error = await storage_service.upload_image_from_data_url(
            edit_request.image_data, "source-images"
        )

        if not source_upload_success:
            return ImageEditResponse(
                success=False,
                error=f"Failed to store source image: {source_error}"
            )

        # Step 2: Create image job record
        job_id = str(uuid.uuid4())
        image_job_payload = CreateImageJobPayload(
            user_id=edit_request.user_id if hasattr(edit_request, 'user_id') else None,
            comfy_job_id=job_id,
            workflow_name="image-edit",
            comfy_url="openrouter",  # Not using ComfyUI for this
            input_image_urls=[source_storage_url],
            prompt=edit_request.prompt,
            parameters={"model": "google/gemini-flash-1.5-8b"}
        )

        success, created_job_id, error = await image_job_service.create_job(image_job_payload)
        if success and created_job_id:
            image_job_id = created_job_id

        # Step 3: Update status to processing
        if image_job_id:
            await image_job_service.update_to_processing(image_job_id)

        # Step 4: Generate edited image
        edit_success, result_image_url, edit_error = await openrouter_service.edit_image(
            edit_request.image_data,
            edit_request.prompt
        )

        if not edit_success or not result_image_url:
            # Mark image job as failed
            if image_job_id:
                fail_payload = CompleteImageJobPayload(
                    job_id=image_job_id,
                    status="failed",
                    error_message=edit_error or "Image generation failed"
                )
                await image_job_service.complete_job(fail_payload)

            return ImageEditResponse(
                success=False,
                error=edit_error or "Image generation failed"
            )

        # Step 5: Upload result image to storage
        if result_image_url.startswith('data:image/'):
            result_upload_success, result_storage_url, result_error = await storage_service.upload_image_from_data_url(
                result_image_url, "edited-images"
            )
        else:
            result_upload_success, result_storage_url, result_error = await storage_service.upload_image_from_url(
                result_image_url, "edited-images"
            )

        if not result_upload_success:
            # Mark image job as failed
            if image_job_id:
                fail_payload = CompleteImageJobPayload(
                    job_id=image_job_id,
                    status="failed",
                    error_message=f"Failed to store result image: {result_error}"
                )
                await image_job_service.complete_job(fail_payload)

            return ImageEditResponse(
                success=False,
                error=f"Failed to store result image: {result_error}"
            )

        # Step 6: Complete image job
        if image_job_id:
            complete_job_payload = CompleteImageJobPayload(
                job_id=image_job_id,
                status="completed",
                output_image_urls=[result_storage_url]
            )
            await image_job_service.complete_job(complete_job_payload)

        # Return the stored result image URL
        return ImageEditResponse(
            success=True,
            image_url=result_storage_url,
            error=None
        )

    except Exception as e:
        # Mark image job as failed
        if image_job_id:
            try:
                image_job_service_instance = get_image_job_service(_extract_bearer_token(authorization))
                fail_payload = CompleteImageJobPayload(
                    job_id=image_job_id,
                    status="failed",
                    error_message=f"Server error: {str(e)}"
                )
                await image_job_service_instance.complete_job(fail_payload)
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
