"""API endpoints for Auto Content feature."""

from fastapi import APIRouter, HTTPException, Query, Header, Depends
from typing import Optional
import logging

from models.auto_content import (
    CreateBatchJobPayload,
    UpdateOutlinePayload,
    StartGenerationPayload,
    BatchJobResponse,
    BatchJobDetailResponse,
    OutlineResponse,
    BatchItemsResponse,
    BatchItemResponse
)
from services.batch_job_service import BatchJobService
from core.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auto-content", tags=["auto-content"])


def get_service() -> BatchJobService:
    """Dependency to get BatchJobService instance."""
    return BatchJobService()


@router.post("/batch-jobs", response_model=BatchJobResponse)
async def create_batch_job(
    payload: CreateBatchJobPayload,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Create a new Auto Content batch job.

    Validates project structure in Google Drive and creates a batch job record.

    Required folder structure:
    - ProjectFolder/
      - GENERAL_ASSETS/
        - Script/ (at least one .pdf, .doc, or .gdoc file)
        - Master_Frames/ (at least one image)
        - Characters/ (images)
        - Props/ (images)
        - Settings/ (images)
    """
    try:
        success, batch_job_id, error = await service.create_batch_job(
            payload.user_id,
            payload.project_folder_id,
            payload.comfy_url
        )

        if not success:
            return BatchJobResponse(success=False, error=error)

        # Fetch created batch job
        batch_job = await service.get_batch_job(batch_job_id)

        if not batch_job:
            return BatchJobResponse(
                success=False,
                error="Batch job created but could not be retrieved"
            )

        return BatchJobResponse(success=True, batch_job=batch_job)

    except Exception as e:
        logger.error(f"Error in create_batch_job endpoint: {str(e)}")
        return BatchJobResponse(success=False, error=str(e))


@router.get("/batch-jobs/{batch_job_id}", response_model=BatchJobDetailResponse)
async def get_batch_job(
    batch_job_id: str,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Get comprehensive batch job details including all items.

    Returns the batch job record along with all associated batch items.
    """
    try:
        success, batch_job, items, error = await service.get_batch_job_with_items(
            batch_job_id
        )

        return BatchJobDetailResponse(
            success=success,
            batch_job=batch_job,
            items=items,
            error=error
        )

    except Exception as e:
        logger.error(f"Error in get_batch_job endpoint: {str(e)}")
        return BatchJobDetailResponse(
            success=False,
            error=str(e)
        )


@router.post("/batch-jobs/{batch_job_id}/start-generation", response_model=BatchJobResponse)
async def start_batch_generation(
    batch_job_id: str,
    payload: StartGenerationPayload,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Start master frame generation (fire-and-forget).

    This endpoint triggers the batch generation process in the background.
    Use GET /batch-jobs/{id} to poll for progress updates.

    The process:
    1. Lists all images in Master_Frames/ folder
    2. Creates batch_job_items for each variation
    3. Submits ImageGrid workflows to ComfyUI with rate limiting
    4. Updates progress as jobs complete

    Note: This is Phase 3 functionality and returns "Not implemented" in Phase 1.
    """
    try:
        success, error = await service.start_master_frame_generation(batch_job_id)

        if not success:
            return BatchJobResponse(success=False, error=error)

        batch_job = await service.get_batch_job(batch_job_id)

        if not batch_job:
            return BatchJobResponse(
                success=False,
                error="Failed to retrieve batch job after starting generation"
            )

        return BatchJobResponse(success=True, batch_job=batch_job)

    except Exception as e:
        logger.error(f"Error in start_batch_generation endpoint: {str(e)}")
        return BatchJobResponse(success=False, error=str(e))


@router.get("/batch-jobs/{batch_job_id}/items", response_model=BatchItemsResponse)
async def get_batch_items(
    batch_job_id: str,
    starred_only: bool = Query(False, description="Filter to only starred items"),
    limit: int = Query(100, ge=1, le=500, description="Number of items per page"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Get paginated batch items with optional filtering.

    Supports filtering by starred status and pagination.
    Always excludes deleted items.
    """
    try:
        success, items, total, error = await service.get_batch_items(
            batch_job_id,
            starred_only=starred_only,
            limit=limit,
            offset=offset
        )

        return BatchItemsResponse(
            success=success,
            items=items,
            total_count=total,
            error=error
        )

    except Exception as e:
        logger.error(f"Error in get_batch_items endpoint: {str(e)}")
        return BatchItemsResponse(
            success=False,
            error=str(e)
        )


@router.put("/batch-items/{item_id}/star", response_model=BatchItemResponse)
async def star_batch_item(
    item_id: str,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Star a batch item and move files to starred folder in Drive.

    This marks the item as starred and moves the associated images
    from imagesAI/ to imagesAI/starred/ in Google Drive.

    Note: This is Phase 4 functionality and returns "Not implemented" in Phase 1.
    """
    try:
        # TODO: Extract user_id from authorization header when auth is implemented
        user_id = "temp_user_id"  # Placeholder

        success, error = await service.star_item(item_id, user_id)

        if not success:
            return BatchItemResponse(success=False, error=error)

        item = await service.get_batch_item(item_id)

        return BatchItemResponse(success=True, item=item)

    except Exception as e:
        logger.error(f"Error in star_batch_item endpoint: {str(e)}")
        return BatchItemResponse(success=False, error=str(e))


@router.delete("/batch-items/{item_id}", response_model=BatchItemResponse)
async def delete_batch_item(
    item_id: str,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Soft delete a batch item and remove files from storage.

    This marks the item as deleted and removes the associated images
    from both Supabase Storage and Google Drive.

    Note: This is Phase 4 functionality and returns "Not implemented" in Phase 1.
    """
    try:
        # TODO: Extract user_id from authorization header when auth is implemented
        user_id = "temp_user_id"  # Placeholder

        success, error = await service.delete_item(item_id, user_id)

        if not success:
            return BatchItemResponse(success=False, error=error)

        return BatchItemResponse(success=True, item=None)

    except Exception as e:
        logger.error(f"Error in delete_batch_item endpoint: {str(e)}")
        return BatchItemResponse(success=False, error=str(e))


# Phase 2 endpoints (script analysis and outline generation)
@router.post("/batch-jobs/{batch_job_id}/generate-outline", response_model=OutlineResponse)
async def generate_outline(
    batch_job_id: str,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Generate scene outline from script (may take 30-60 seconds).

    This endpoint:
    1. Finds script file in Script/ folder
    2. Parses script content (PDF/DOCX/GDOC)
    3. Calls AI (OpenRouter) to generate structured outline
    4. Saves outline to database and uploads to Drive

    Note: This is Phase 2 functionality and will be implemented later.
    """
    return OutlineResponse(
        success=False,
        error="Outline generation not implemented yet - Phase 2"
    )


@router.put("/batch-jobs/{batch_job_id}/outline", response_model=OutlineResponse)
async def update_outline(
    batch_job_id: str,
    payload: UpdateOutlinePayload,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Save edited outline back to database and Drive.

    Note: This is Phase 2 functionality and will be implemented later.
    """
    return OutlineResponse(
        success=False,
        error="Outline update not implemented yet - Phase 2"
    )


@router.post("/batch-jobs/{batch_job_id}/cancel", response_model=BatchJobResponse)
async def cancel_batch_job(
    batch_job_id: str,
    authorization: Optional[str] = Header(None),
    service: BatchJobService = Depends(get_service)
):
    """
    Cancel an ongoing batch job.

    Note: This doesn't cancel already-running ComfyUI jobs, but prevents
    new jobs from being submitted.

    This is Phase 5 functionality and will be implemented later.
    """
    return BatchJobResponse(
        success=False,
        error="Batch job cancellation not implemented yet - Phase 5"
    )
