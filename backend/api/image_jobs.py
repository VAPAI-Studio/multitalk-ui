from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.image_job import (
    CreateImageJobPayload,
    UpdateImageJobPayload,
    CompleteImageJobPayload,
    ImageJobResponse,
    ImageJobListResponse
)
from services.image_job_service import ImageJobService

router = APIRouter(prefix="/image-jobs", tags=["image-jobs"])

def get_service():
    return ImageJobService()

@router.post("/", response_model=ImageJobResponse)
async def create_image_job(payload: CreateImageJobPayload):
    """Create a new image job"""
    service = get_service()
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
    user_id: Optional[str] = Query(None, description="Filter by user ID")
):
    """Get recent image jobs with optional filtering"""
    service = get_service()
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

@router.get("/{job_id}", response_model=ImageJobResponse)
async def get_image_job(job_id: str):
    """Get a specific image job by ID"""
    service = get_service()
    job, error = await service.get_job(job_id)

    return ImageJobResponse(
        success=job is not None,
        image_job=job,
        error=error
    )

@router.put("/{job_id}", response_model=ImageJobResponse)
async def update_image_job(job_id: str, payload: UpdateImageJobPayload):
    """Update an image job"""
    service = get_service()
    success, error = await service.update_job(job_id, payload)

    if success:
        job, job_error = await service.get_job(job_id)
        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.put("/{job_id}/processing", response_model=ImageJobResponse)
async def update_to_processing(job_id: str):
    """Mark image job as processing"""
    service = get_service()
    success, error = await service.update_to_processing(job_id)

    if success:
        job, job_error = await service.get_job(job_id)
        return ImageJobResponse(success=True, image_job=job, error=error or job_error)
    else:
        return ImageJobResponse(success=False, error=error)

@router.put("/{job_id}/complete", response_model=ImageJobResponse)
async def complete_image_job(job_id: str, payload: CompleteImageJobPayload):
    """Complete an image job (mark as completed or failed)"""
    if payload.job_id != job_id:
        raise HTTPException(status_code=400, detail="Job ID mismatch")

    service = get_service()
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
    workflow_name: Optional[str] = Query(None, description="Filter by workflow name")
):
    """Get completed image jobs"""
    service = get_service()
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
async def delete_image_job(job_id: str):
    """Delete an image job"""
    service = get_service()
    success, error = await service.delete_job(job_id)

    return ImageJobResponse(
        success=success,
        error=error
    )
