from fastapi import APIRouter, HTTPException
from typing import List

from models.job import (
    CreateJobPayload,
    CompleteJobPayload,
    MultiTalkJob,
    JobResponse,
    JobListResponse
)
from services.job_service import JobService

router = APIRouter(prefix="/jobs", tags=["jobs"])

def get_job_service():
    return JobService()

@router.post("/", response_model=JobResponse)
async def create_job(payload: CreateJobPayload):
    """Create a new job record"""
    job_service = get_job_service()
    success, error = await job_service.create_job(payload)
    
    if success:
        job, job_error = await job_service.get_job(payload.job_id)
        return JobResponse(success=True, job=job, error=error or job_error)
    else:
        return JobResponse(success=False, error=error)

@router.put("/{job_id}/processing", response_model=JobResponse)
async def update_job_to_processing(job_id: str):
    """Update job status to processing"""
    job_service = get_job_service()
    success, error = await job_service.update_job_to_processing(job_id)
    
    if success:
        job, job_error = await job_service.get_job(job_id)
        return JobResponse(success=True, job=job, error=error or job_error)
    else:
        return JobResponse(success=False, error=error)

@router.put("/{job_id}/complete", response_model=JobResponse)
async def complete_job(job_id: str, payload: CompleteJobPayload):
    """Complete a job with success or error status"""
    if payload.job_id != job_id:
        raise HTTPException(status_code=400, detail="Job ID mismatch")
    
    job_service = get_job_service()
    success, error = await job_service.complete_job(payload)
    
    if success:
        job, job_error = await job_service.get_job(job_id)
        return JobResponse(success=True, job=job, error=error or job_error)
    else:
        return JobResponse(success=False, error=error)

@router.get("/recent", response_model=JobListResponse)
async def get_recent_jobs(limit: int = 50):
    """Get recent jobs"""
    job_service = get_job_service()
    jobs, error = await job_service.get_recent_jobs(limit)
    return JobListResponse(success=error is None, jobs=jobs, error=error)

@router.get("/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Get a specific job by ID"""
    job_service = get_job_service()
    job, error = await job_service.get_job(job_id)
    return JobResponse(success=job is not None, job=job, error=error)

@router.get("/completed/with-videos", response_model=JobListResponse)
async def get_completed_jobs_with_videos(limit: int = 20):
    """Get completed jobs that have video files"""
    job_service = get_job_service()
    jobs, error = await job_service.get_completed_jobs_with_videos(limit)
    return JobListResponse(success=error is None, jobs=jobs, error=error)