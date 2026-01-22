from fastapi import APIRouter, HTTPException, Query, Header
from typing import Optional

from models.image_job import (
    CreateImageJobPayload,
    UpdateImageJobPayload,
    CompleteImageJobPayload,
    ImageJobResponse,
    ImageJobListResponse,
    ImageJobFeedResponse
)
from services.image_job_service import ImageJobService
from services.storage_service import StorageService
from core.supabase import get_supabase_for_token

router = APIRouter(prefix="/image-jobs", tags=["image-jobs"])

def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def get_service(access_token: Optional[str] = None):
    supabase = get_supabase_for_token(access_token)
    return ImageJobService(supabase)

@router.post("/", response_model=ImageJobResponse)
async def create_image_job(
    payload: CreateImageJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Create a new image job"""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.create_job(payload)

    if success:
        # Get the created job (by comfy_job_id if provided, otherwise get most recent)
        if payload.comfy_job_id:
            job, job_error = await service.get_job_by_comfy_id(payload.comfy_job_id)
        else:
            # Get most recent job for this workflow
            jobs, _, job_error = await service.get_recent_jobs(limit=1, workflow_name=payload.workflow_name)
            job = jobs[0] if jobs else None

        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.get("/", response_model=ImageJobListResponse)
async def get_image_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None, description="Filter by workflow name"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    authorization: Optional[str] = Header(None)
):
    """Get recent image jobs with optional filtering."""
    service = get_service(_extract_bearer_token(authorization))
    jobs, total_count, error = await service.get_recent_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name,
        user_id=user_id
    )

    return ImageJobListResponse(
        success=error is None,
        image_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/feed", response_model=ImageJobFeedResponse)
async def get_image_jobs_feed(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None, description="Filter by workflow name"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    authorization: Optional[str] = Header(None)
):
    """
    Optimized feed endpoint - minimal data, server-side caching.
    Returns only fields needed for feed display (no parameters, no comfyui details).
    Cached for 10 seconds to reduce database load.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow name
    - user_id: Filter by user ID
    - status: Filter by status (pending, processing, completed, failed)
    """
    service = get_service(_extract_bearer_token(authorization))

    jobs, total_count, error = await service.get_feed_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name,
        user_id=user_id,
        status=status
    )

    return ImageJobFeedResponse(
        success=error is None,
        image_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/{job_id}", response_model=ImageJobResponse)
async def get_image_job(job_id: str, authorization: Optional[str] = Header(None)):
    """Get a specific image job by ID"""
    service = get_service(_extract_bearer_token(authorization))
    job, error = await service.get_job(job_id)

    return ImageJobResponse(
        success=job is not None,
        image_job=job,
        error=error
    )

@router.put("/{job_id}", response_model=ImageJobResponse)
async def update_image_job(
    job_id: str,
    payload: UpdateImageJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Update an image job"""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.update_job(job_id, payload)

    if success:
        job, job_error = await service.get_job(job_id)
        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.put("/{job_id}/processing", response_model=ImageJobResponse)
async def update_to_processing(job_id: str, authorization: Optional[str] = Header(None)):
    """Mark image job as processing"""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.update_to_processing(job_id)

    if success:
        job, job_error = await service.get_job(job_id)
        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.put("/{job_id}/complete", response_model=ImageJobResponse)
async def complete_image_job(
    job_id: str,
    payload: CompleteImageJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Complete an image job (mark as completed or failed)"""
    if payload.job_id != job_id:
        raise HTTPException(status_code=400, detail="Job ID mismatch")

    service = get_service(_extract_bearer_token(authorization))
    storage_service = StorageService()

    # If completing successfully with output URLs, download from ComfyUI and upload to Supabase
    if payload.status == 'completed' and payload.output_image_urls:
        supabase_urls = []
        for comfy_url in payload.output_image_urls:
            print(f"[IMAGE_JOBS] Downloading image from ComfyUI: {comfy_url}")

            # Download from ComfyUI and upload to Supabase
            success, supabase_url, error = await storage_service.upload_image_from_url(
                comfy_url,
                'camera-angle-results'
            )

            if success and supabase_url:
                print(f"[IMAGE_JOBS] Successfully uploaded to Supabase: {supabase_url}")
                supabase_urls.append(supabase_url)
            else:
                # If upload fails, log error and keep the ComfyUI URL (fallback)
                print(f"[IMAGE_JOBS] Failed to upload to Supabase: {error}")
                supabase_urls.append(comfy_url)

        # Replace ComfyUI URLs with Supabase URLs
        payload.output_image_urls = supabase_urls

    success, error = await service.complete_job(payload)

    if success:
        job, job_error = await service.get_job(job_id)
        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.get("/completed/recent", response_model=ImageJobListResponse)
async def get_completed_image_jobs(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None, description="Filter by workflow name"),
    authorization: Optional[str] = Header(None)
):
    """Get completed image jobs"""
    service = get_service(_extract_bearer_token(authorization))
    jobs, error = await service.get_completed_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name
    )

    return ImageJobListResponse(
        success=error is None,
        image_jobs=jobs,
        total_count=len(jobs),
        error=error
    )

@router.delete("/{job_id}", response_model=ImageJobResponse)
async def delete_image_job(job_id: str, authorization: Optional[str] = Header(None)):
    """Delete an image job"""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.delete_job(job_id)

    return ImageJobResponse(
        success=success,
        error=error
    )
