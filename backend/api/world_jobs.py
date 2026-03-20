from fastapi import APIRouter, HTTPException, Query, Header
from typing import Optional

from models.world_job import (
    CreateWorldJobPayload,
    CompleteWorldJobPayload,
    WorldJobResponse,
    WorldJobListResponse,
    WorldJobFeedResponse
)
from services.world_job_service import WorldJobService
from core.supabase import get_supabase_for_token

router = APIRouter(prefix="/world-jobs", tags=["world-jobs"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def _resolve_token(authorization: Optional[str] = None, x_api_key: Optional[str] = None) -> Optional[str]:
    """Resolve auth token from Bearer header or API key."""
    if x_api_key:
        return None
    return _extract_bearer_token(authorization)


def get_service(access_token: Optional[str] = None):
    supabase = get_supabase_for_token(access_token)
    return WorldJobService(supabase)


@router.post("/", response_model=WorldJobResponse)
async def create_world_job(
    payload: CreateWorldJobPayload,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Create a new world job"""
    service = get_service(_resolve_token(authorization, x_api_key))
    success, job_id, error = await service.create_job(payload)

    if not success:
        return WorldJobResponse(success=False, error=error)

    if job_id:
        job, job_error = await service.get_job(job_id)
        return WorldJobResponse(success=True, world_job=job, error=job_error)

    return WorldJobResponse(success=True, error=None)


@router.get("/feed", response_model=WorldJobFeedResponse)
async def get_world_jobs_feed(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Optimized feed endpoint for world jobs."""
    service = get_service(_resolve_token(authorization, x_api_key))

    jobs, total_count, error = await service.get_feed_jobs(
        limit=limit,
        offset=offset,
        user_id=user_id,
        status=status
    )

    return WorldJobFeedResponse(
        success=error is None,
        world_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/completed/recent", response_model=WorldJobListResponse)
async def get_completed_world_jobs(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Get completed world jobs"""
    service = get_service(_resolve_token(authorization, x_api_key))
    jobs, total_count, error = await service.get_completed_jobs(
        limit=limit,
        offset=offset,
        user_id=user_id
    )

    return WorldJobListResponse(
        success=error is None,
        world_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/", response_model=WorldJobListResponse)
async def get_world_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Get recent world jobs with optional filtering."""
    service = get_service(_resolve_token(authorization, x_api_key))
    jobs, total_count, error = await service.get_recent_jobs(
        limit=limit,
        offset=offset,
        user_id=user_id
    )

    return WorldJobListResponse(
        success=error is None,
        world_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/{job_id}", response_model=WorldJobResponse)
async def get_world_job(
    job_id: str,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Get a specific world job by ID"""
    service = get_service(_resolve_token(authorization, x_api_key))
    job, error = await service.get_job(job_id)

    return WorldJobResponse(
        success=job is not None,
        world_job=job,
        error=error
    )


@router.put("/{job_id}/complete", response_model=WorldJobResponse)
async def complete_world_job(
    job_id: str,
    payload: CompleteWorldJobPayload,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Complete a world job (mark as completed or failed)"""
    if payload.job_id != job_id:
        raise HTTPException(status_code=400, detail="Job ID mismatch")

    service = get_service(_resolve_token(authorization, x_api_key))
    success, completed_job, error = await service.complete_job(payload)

    if not success:
        return WorldJobResponse(success=False, error=error)

    return WorldJobResponse(success=True, world_job=completed_job, error=None)


@router.delete("/{job_id}", response_model=WorldJobResponse)
async def delete_world_job(
    job_id: str,
    user_id: str = Query(..., description="User ID (required for ownership verification)"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    """Delete a world job (only if owned by user)"""
    service = get_service(_resolve_token(authorization, x_api_key))
    success, error = await service.delete_job(job_id, user_id)

    return WorldJobResponse(
        success=success,
        error=error
    )
