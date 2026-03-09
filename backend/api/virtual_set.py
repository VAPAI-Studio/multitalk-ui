from fastapi import APIRouter, Header
from typing import Optional
import uuid

from models.virtual_set import (
    VirtualSetGenerateRequest,
    VirtualSetGenerateResponse,
    VirtualSetStatusResponse,
    VirtualSetSaveWorldRequest,
    VirtualSetSaveWorldResponse,
    VirtualSetReconstructRequest,
    VirtualSetReconstructResponse,
)
from services.worldlabs_service import WorldLabsService
from services.openrouter_service import OpenRouterService
from services.storage_service import StorageService
from services.image_job_service import ImageJobService
from models.image_job import CreateImageJobPayload, CompleteImageJobPayload

router = APIRouter(prefix="/virtual-set", tags=["virtual-set"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def _resolve_token(authorization: Optional[str] = None, x_api_key: Optional[str] = None) -> Optional[str]:
    """Resolve auth token from Bearer header or API key."""
    if x_api_key:
        return None
    return _extract_bearer_token(authorization)


@router.post("/generate", response_model=VirtualSetGenerateResponse)
async def generate_world(
    request: VirtualSetGenerateRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Upload image to storage and submit to World Labs for 3D world generation."""
    try:
        storage_service = StorageService()
        worldlabs_service = WorldLabsService()

        # Upload image to Supabase to get a public URL (World Labs needs a URL, not data URL)
        upload_success, public_url, upload_error = (
            await storage_service.upload_image_from_data_url(
                request.image_data, "virtual-set-sources"
            )
        )
        if not upload_success or not public_url:
            return VirtualSetGenerateResponse(
                success=False,
                error=f"Failed to upload image: {upload_error}",
            )

        # Submit to World Labs
        success, operation_id, error = await worldlabs_service.generate_world(
            image_url=public_url,
            display_name=request.display_name,
            model=request.model,
        )

        return VirtualSetGenerateResponse(
            success=success,
            operation_id=operation_id,
            error=error,
        )

    except Exception as e:
        return VirtualSetGenerateResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.get("/status/{operation_id}", response_model=VirtualSetStatusResponse)
async def get_world_status(operation_id: str):
    """Poll World Labs operation status and extract splat URL when done."""
    try:
        worldlabs_service = WorldLabsService()

        success, done, world_data, error = await worldlabs_service.poll_operation(
            operation_id
        )

        if not success:
            return VirtualSetStatusResponse(
                success=False,
                error=error,
            )

        if not done:
            return VirtualSetStatusResponse(
                success=True,
                done=False,
            )

        # Extract splat URL from completed world data
        splat_url = WorldLabsService.extract_splat_url(world_data or {})
        world_id = (world_data or {}).get("id")

        if not splat_url:
            return VirtualSetStatusResponse(
                success=False,
                done=True,
                error="No splat asset URL found in world response",
            )

        return VirtualSetStatusResponse(
            success=True,
            done=True,
            splat_url=splat_url,
            world_id=world_id,
        )

    except Exception as e:
        return VirtualSetStatusResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.post("/save-world", response_model=VirtualSetSaveWorldResponse)
async def save_world(
    request: VirtualSetSaveWorldRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Save a generated 3D world as an image job for the feed."""
    try:
        storage_service = StorageService()
        image_job_service = ImageJobService(
            auth_token=_resolve_token(authorization, x_api_key)
        )

        # Upload original image to get a URL for the feed thumbnail
        upload_success, image_url, upload_error = (
            await storage_service.upload_image_from_data_url(
                request.image_data, "virtual-set-sources"
            )
        )
        if not upload_success or not image_url:
            return VirtualSetSaveWorldResponse(
                success=False,
                error=f"Failed to store image: {upload_error}",
            )

        # Create image job with splat_url in parameters
        job_id = str(uuid.uuid4())
        job_payload = CreateImageJobPayload(
            user_id=None,
            comfy_job_id=job_id,
            workflow_name="virtual-set-world",
            comfy_url="worldlabs",
            input_image_urls=[image_url],
            prompt=f"3D World ({request.model})",
            parameters={
                "splat_url": request.splat_url,
                "world_id": request.world_id,
                "model": request.model,
            },
        )

        success, created_job_id, error = await image_job_service.create_job(job_payload)
        if not success:
            return VirtualSetSaveWorldResponse(
                success=False,
                error=f"Failed to save world: {error}",
            )

        # Mark as completed immediately
        if created_job_id:
            await image_job_service.complete_job(
                CompleteImageJobPayload(
                    job_id=created_job_id,
                    status="completed",
                    output_image_urls=[image_url],
                )
            )

        return VirtualSetSaveWorldResponse(
            success=True,
            job_id=created_job_id,
        )

    except Exception as e:
        return VirtualSetSaveWorldResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.post("/reconstruct", response_model=VirtualSetReconstructResponse)
async def reconstruct_image(
    request: VirtualSetReconstructRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Reconstruct a high-quality image from screenshot + original using OpenRouter."""
    image_job_id = None

    try:
        openrouter_service = OpenRouterService()
        storage_service = StorageService()
        image_job_service = ImageJobService(
            auth_token=_resolve_token(authorization, x_api_key)
        )

        # Upload screenshot to storage
        screenshot_upload_success, screenshot_url, screenshot_error = (
            await storage_service.upload_image_from_data_url(
                request.screenshot_data, "virtual-set-screenshots"
            )
        )
        if not screenshot_upload_success:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to store screenshot: {screenshot_error}",
            )

        # Upload original image to storage (handle both data URLs and regular URLs)
        if request.original_image_data.startswith("data:image/"):
            original_upload_success, original_url, original_error = (
                await storage_service.upload_image_from_data_url(
                    request.original_image_data, "virtual-set-sources"
                )
            )
        else:
            # Already a URL (e.g., loaded from feed), use it directly
            original_upload_success = True
            original_url = request.original_image_data
            original_error = None

        if not original_upload_success:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to store original image: {original_error}",
            )

        # Create image job record
        job_id = str(uuid.uuid4())
        base_prompt = (
            "Using the original reference image, reconstruct and enhance this 3D viewport screenshot "
            "into a high-quality photorealistic image. Maintain the exact camera angle and perspective "
            "from the screenshot while applying the detail, texture quality, and lighting from the original."
        )
        full_prompt = f"{base_prompt} {request.prompt}".strip() if request.prompt else base_prompt

        job_payload = CreateImageJobPayload(
            user_id=None,
            comfy_job_id=job_id,
            workflow_name="virtual-set",
            comfy_url="openrouter",
            input_image_urls=[screenshot_url, original_url],
            prompt=full_prompt,
            parameters={"model": "google/gemini-2.5-flash-image-preview:free"},
        )

        success, created_job_id, error = await image_job_service.create_job(job_payload)
        if success and created_job_id:
            image_job_id = created_job_id

        if image_job_id:
            await image_job_service.update_to_processing(image_job_id)

        # Call OpenRouter with the screenshot image + prompt referencing original
        edit_success, result_image_url, edit_error = await openrouter_service.edit_image(
            request.screenshot_data,
            full_prompt,
        )

        if not edit_success or not result_image_url:
            if image_job_id:
                await image_job_service.complete_job(
                    CompleteImageJobPayload(
                        job_id=image_job_id,
                        status="failed",
                        error_message=edit_error or "Image reconstruction failed",
                    )
                )
            return VirtualSetReconstructResponse(
                success=False,
                error=edit_error or "Image reconstruction failed",
            )

        # Upload result to storage
        if result_image_url.startswith("data:image/"):
            result_upload_success, result_storage_url, result_error = (
                await storage_service.upload_image_from_data_url(
                    result_image_url, "virtual-set-results"
                )
            )
        else:
            result_upload_success, result_storage_url, result_error = (
                await storage_service.upload_image_from_url(
                    result_image_url, "virtual-set-results"
                )
            )

        if not result_upload_success:
            if image_job_id:
                await image_job_service.complete_job(
                    CompleteImageJobPayload(
                        job_id=image_job_id,
                        status="failed",
                        error_message=f"Failed to store result: {result_error}",
                    )
                )
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to store result image: {result_error}",
            )

        # Complete job
        if image_job_id:
            await image_job_service.complete_job(
                CompleteImageJobPayload(
                    job_id=image_job_id,
                    status="completed",
                    output_image_urls=[result_storage_url],
                )
            )

        return VirtualSetReconstructResponse(
            success=True,
            image_url=result_storage_url,
            job_id=image_job_id,
        )

    except Exception as e:
        if image_job_id:
            try:
                ijs = ImageJobService(auth_token=_resolve_token(authorization, x_api_key))
                await ijs.complete_job(
                    CompleteImageJobPayload(
                        job_id=image_job_id,
                        status="failed",
                        error_message=f"Server error: {str(e)}",
                    )
                )
            except Exception:
                pass

        return VirtualSetReconstructResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.get("/health")
async def check_config():
    """Check if World Labs and OpenRouter APIs are configured."""
    worldlabs_service = WorldLabsService()
    openrouter_service = OpenRouterService()

    has_worldlabs = bool(worldlabs_service.api_key)
    has_openrouter = bool(openrouter_service.api_key)

    return {
        "configured": has_worldlabs and has_openrouter,
        "worldlabs_configured": has_worldlabs,
        "openrouter_configured": has_openrouter,
        "message": (
            "All APIs configured"
            if has_worldlabs and has_openrouter
            else f"Missing: {', '.join(k for k, v in [('WORLDLABS_API_KEY', has_worldlabs), ('OPENROUTER_API_KEY', has_openrouter)] if not v)}"
        ),
    }
