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
    UpscaleBatch,
)
from services.freepik_service import FreepikUpscalerService
from services.upscale_job_service import UpscaleJobService

router = APIRouter(prefix="/upscale", tags=["upscale"])


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
# Background Processing
# ---------------------------------------------------------------------------


async def _process_single_video(video: dict, batch: dict) -> bool:
    """
    Process a single video through Freepik upscaling.

    Returns True if completed, False if failed.
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
        await job_service.update_video_status(
            video_id, "failed", error_message=error,
        )
        await job_service.increment_failed_count(batch_id)
        return False

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
        return True
    else:
        err_msg = poll_error or f"Freepik task ended with status: {status}"
        await job_service.update_video_status(
            video_id, "failed", error_message=err_msg,
        )
        await job_service.increment_failed_count(batch_id)
        return False


async def _process_batch(batch_id: str) -> None:
    """
    Process all pending videos in a batch sequentially.

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
            await _process_single_video(video, batch)

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
