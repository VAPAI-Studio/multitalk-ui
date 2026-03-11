"""
Upscale API Router

Endpoints for batch video upscaling: create batches, add videos,
start processing, and query status. Background processing functions
handle Freepik API submission and polling.
"""

import asyncio
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from models.upscale import (
    AddVideoPayload,
    BatchDetailResponse,
    BatchResponse,
    CreateBatchPayload,
    ProcessingResult,
    ReorderPayload,
    UpscaleBatch,
    _classify_error,
)
from services.freepik_service import FreepikUpscalerService
from services.upscale_job_service import UpscaleJobService

router = APIRouter(prefix="/upscale", tags=["upscale"])

MAX_RETRIES = 2
BASE_DELAY = 2  # seconds


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.post("/batches", response_model=BatchResponse)
async def create_batch(
    payload: CreateBatchPayload,
    user=Depends(get_current_user),
):
    """Create a new upscale batch."""
    service = UpscaleJobService()
    success, batch_data, error = await service.create_batch(
        user_id=user.id,
        settings=payload.settings,
        project_id=payload.project_id,
    )

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return BatchResponse(
        success=True,
        batch_id=batch_data.get("id"),
        status=batch_data.get("status", "pending"),
    )


@router.post("/batches/{batch_id}/videos")
async def add_video(
    batch_id: str,
    payload: AddVideoPayload,
    user=Depends(get_current_user),
):
    """Add a video to an existing batch."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    # Queue position is current total + 1
    queue_position = batch.get("total_videos", 0) + 1

    success, video_data, error = await service.add_video_to_batch(
        batch_id=batch_id,
        user_id=user.id,
        input_filename=payload.input_filename,
        input_storage_url=payload.input_storage_url,
        queue_position=queue_position,
        input_file_size=payload.input_file_size,
        duration_seconds=payload.duration_seconds,
        width=payload.width,
        height=payload.height,
    )

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return {"success": True, "video_id": video_data.get("id")}


@router.post("/batches/{batch_id}/start", response_model=BatchResponse)
async def start_batch(
    batch_id: str,
    user=Depends(get_current_user),
):
    """Start processing a batch. Returns immediately; processing runs in background."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if batch.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Batch is '{batch.get('status')}', must be 'pending' to start",
        )

    await service.update_batch_status(batch_id, "processing")

    # Launch background task -- does NOT block the response
    asyncio.create_task(_process_batch(batch_id))

    return BatchResponse(
        success=True,
        batch_id=batch_id,
        status="processing",
    )


@router.get("/batches/{batch_id}", response_model=BatchDetailResponse)
async def get_batch_detail(
    batch_id: str,
    user=Depends(get_current_user),
):
    """Get batch with nested videos."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    return BatchDetailResponse(
        success=True,
        batch=UpscaleBatch(**batch),
    )


@router.get("/batches")
async def list_batches(
    user=Depends(get_current_user),
):
    """List batches for the current user."""
    service = UpscaleJobService()
    batches = await service.list_user_batches(user.id)
    return batches


# ---------------------------------------------------------------------------
# Batch Operations: Resume, Retry, Reorder
# ---------------------------------------------------------------------------


@router.post("/batches/{batch_id}/resume", response_model=BatchResponse)
async def resume_batch(
    batch_id: str,
    user=Depends(get_current_user),
):
    """Resume a paused batch. Unpauses videos, clears pause metadata, restarts processing."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if batch.get("status") != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Batch is '{batch.get('status')}', must be 'paused' to resume",
        )

    await service.unpause_videos(batch_id)
    await service.clear_pause_metadata(batch_id)
    await service.update_batch_status(batch_id, "processing")

    # Relaunch background processing
    asyncio.create_task(_process_batch(batch_id))

    return BatchResponse(
        success=True,
        batch_id=batch_id,
        status="processing",
    )


@router.post("/batches/{batch_id}/videos/{video_id}/retry")
async def retry_video(
    batch_id: str,
    video_id: str,
    user=Depends(get_current_user),
):
    """Retry a failed video. Resets it to pending and relaunches processing if batch is terminal."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    success = await service.retry_video(video_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Video not found or not in 'failed' status",
        )

    await service.decrement_failed_count(batch_id)

    # If batch is in terminal state, relaunch processing
    if batch.get("status") in ("completed", "failed"):
        await service.update_batch_status(batch_id, "processing")
        asyncio.create_task(_process_batch(batch_id))

    return {"success": True, "video_id": video_id, "status": "pending"}


@router.patch("/batches/{batch_id}/reorder")
async def reorder_queue(
    batch_id: str,
    payload: ReorderPayload,
    user=Depends(get_current_user),
):
    """Reorder pending videos in a batch by providing video_ids in desired order."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    success = await service.reorder_videos(batch_id, payload.video_ids)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to reorder videos")

    return {"success": True}


# ---------------------------------------------------------------------------
# Background Processing
# ---------------------------------------------------------------------------


async def _process_single_video(video: dict, batch: dict) -> ProcessingResult:
    """
    Process a single video through Freepik upscaling.

    Returns ProcessingResult with success status and error classification.
    """
    job_service = UpscaleJobService()
    freepik = FreepikUpscalerService()

    video_id = video["id"]
    batch_id = batch["id"]

    # Mark video as processing
    await job_service.update_video_status(video_id, "processing")

    # Submit to Freepik
    success, task_id, error = await freepik.submit_task(
        video_url=video["input_storage_url"],
        resolution=batch.get("resolution", "2k"),
        creativity=batch.get("creativity", 0),
        sharpen=batch.get("sharpen", 0),
        grain=batch.get("grain", 0),
        fps_boost=batch.get("fps_boost", False),
        flavor=batch.get("flavor", "vivid"),
    )

    if not success:
        failure_type = _classify_error(error or "Unknown error")
        await job_service.update_video_status(
            video_id, "failed", error_message=error,
        )
        await job_service.increment_failed_count(batch_id)
        return ProcessingResult(
            success=False,
            failure_type=failure_type,
            error_message=error,
            should_pause_batch=(failure_type == "credit_exhaustion"),
        )

    # Record freepik task id
    await job_service.update_video_status(
        video_id, "processing", freepik_task_id=task_id,
    )

    # Poll until complete
    status, output_url, poll_error = await freepik.poll_until_complete(task_id)

    if status == "COMPLETED":
        await job_service.update_video_status(
            video_id, "completed", output_url=output_url,
        )
        await job_service.increment_completed_count(batch_id)
        return ProcessingResult(success=True)
    else:
        err_msg = poll_error or f"Freepik task ended with status: {status}"
        failure_type = _classify_error(err_msg)
        await job_service.update_video_status(
            video_id, "failed", error_message=err_msg,
        )
        await job_service.increment_failed_count(batch_id)
        return ProcessingResult(
            success=False,
            failure_type=failure_type,
            error_message=err_msg,
            should_pause_batch=(failure_type == "credit_exhaustion"),
        )


async def _process_video_with_retry(video: dict, batch: dict) -> ProcessingResult:
    """
    Retry wrapper around _process_single_video.

    Retries transient failures up to MAX_RETRIES times with exponential backoff.
    Does NOT retry credit_exhaustion or permanent errors.
    """
    job_service = UpscaleJobService()
    video_id = video["id"]

    for attempt in range(MAX_RETRIES + 1):
        result = await _process_single_video(video, batch)

        if result.success:
            return result

        # Don't retry credit exhaustion or permanent errors
        if result.failure_type in ("credit_exhaustion", "permanent"):
            return result

        # Transient failure -- retry if attempts remain
        if attempt < MAX_RETRIES:
            delay = BASE_DELAY * (2 ** attempt)
            await asyncio.sleep(delay)
            await job_service.update_video_retry_count(video_id, attempt + 1)

    return result


async def _process_batch(batch_id: str) -> None:
    """
    Process all pending videos in a batch sequentially.

    Features:
    - Uses _process_video_with_retry for automatic retry of transient errors
    - Pauses batch and remaining videos on credit exhaustion
    - Re-checks batch status each iteration to handle external pause/cancel

    Wrapped entirely in try/except to prevent silent background task failure.
    """
    job_service = UpscaleJobService()

    try:
        # Get batch info for settings
        # Note: get_batch requires user_id but for background tasks we query directly
        batch = await _get_batch_for_processing(job_service, batch_id)
        if not batch:
            await job_service.update_batch_status(
                batch_id, "failed", error_message="Batch not found during processing",
            )
            return

        while True:
            video = await job_service.get_next_pending_video(batch_id)
            if not video:
                # No more pending videos -- batch is done
                await job_service.update_batch_status(batch_id, "completed")
                break

            await job_service.update_batch_heartbeat(batch_id)
            result = await _process_video_with_retry(video, batch)

            # Handle credit exhaustion: pause batch and remaining videos
            if result.should_pause_batch:
                await job_service.pause_all_pending_videos(batch_id)
                await job_service.pause_batch(batch_id, "credit_exhaustion")
                break

            # Re-check batch status to handle external pause/cancel
            batch = await _get_batch_for_processing(job_service, batch_id)
            if not batch or batch.get("status") != "processing":
                break

    except Exception as e:
        print(f"[UPSCALE] Batch {batch_id} processing error: {e}")
        await job_service.update_batch_status(
            batch_id, "failed", error_message=str(e),
        )


async def _get_batch_for_processing(job_service: UpscaleJobService, batch_id: str) -> dict | None:
    """
    Get batch data for background processing (no user_id filter).

    Background tasks don't have a user context, so we query by batch_id only.
    """
    try:
        result = (
            job_service.supabase.table("upscale_batches")
            .select("*")
            .eq("id", batch_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        return None
