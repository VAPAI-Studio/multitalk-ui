from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from models.video_job import (
    CreateVideoJobPayload,
    UpdateVideoJobPayload,
    CompleteVideoJobPayload,
    VideoJobResponse,
    VideoJobListResponse,
    VideoJob
)
from services.video_job_service import VideoJobService
from services.storage_service import StorageService
from services.thumbnail_service import ThumbnailService

router = APIRouter(prefix="/video-jobs", tags=["video-jobs"])


def get_service():
    """Dependency to get VideoJobService instance."""
    return VideoJobService()


@router.post("/", response_model=VideoJobResponse)
async def create_video_job(payload: CreateVideoJobPayload):
    """Create a new video job."""
    service = get_service()
    success, error = await service.create_job(payload)

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.get("/", response_model=VideoJobListResponse)
async def get_video_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None)
):
    """
    Get recent video jobs with optional filtering.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow (lipsync-one, lipsync-multi, video-lipsync, wan-i2v)
    - user_id: Filter by user ID
    """
    service = get_service()
    jobs, total_count, error = await service.get_recent_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name,
        user_id=user_id
    )

    if error:
        return VideoJobListResponse(
            success=False,
            video_jobs=[],
            total_count=0,
            error=error
        )

    return VideoJobListResponse(
        success=True,
        video_jobs=jobs,
        total_count=total_count,
        error=None
    )


@router.get("/completed/recent", response_model=VideoJobListResponse)
async def get_completed_video_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None)
):
    """
    Get recent completed video jobs with optional filtering.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow (lipsync-one, lipsync-multi, video-lipsync, wan-i2v)
    - user_id: Filter by user ID
    """
    service = get_service()
    jobs, total_count, error = await service.get_completed_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name,
        user_id=user_id
    )

    if error:
        return VideoJobListResponse(
            success=False,
            video_jobs=[],
            total_count=0,
            error=error
        )

    return VideoJobListResponse(
        success=True,
        video_jobs=jobs,
        total_count=total_count,
        error=None
    )


@router.get("/{job_id}", response_model=VideoJobResponse)
async def get_video_job(job_id: str):
    """Get a single video job by UUID."""
    service = get_service()
    job, error = await service.get_job(job_id)

    if error:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)


@router.get("/comfy/{comfy_job_id}", response_model=VideoJobResponse)
async def get_video_job_by_comfy_id(comfy_job_id: str):
    """Get a single video job by ComfyUI job ID."""
    service = get_service()
    job, error = await service.get_job_by_comfy_id(comfy_job_id)

    if error:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)


@router.put("/{job_id}/processing", response_model=VideoJobResponse)
async def update_to_processing(job_id: str):
    """Update job status to processing."""
    service = get_service()
    success, error = await service.update_to_processing(job_id)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.put("/{job_id}", response_model=VideoJobResponse)
async def update_video_job(job_id: str, payload: UpdateVideoJobPayload):
    """Update a video job."""
    service = get_service()
    success, error = await service.update_job(job_id, payload)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.put("/{job_id}/complete", response_model=VideoJobResponse)
async def complete_video_job(job_id: str, payload: CompleteVideoJobPayload):
    """Complete a video job (success or failure)."""
    # Override job_id from path parameter
    payload.job_id = job_id

    service = get_service()
    storage_service = StorageService()
    thumbnail_service = ThumbnailService()

    # If completing successfully with output URLs, download from ComfyUI and upload to Supabase
    if payload.status == 'completed' and payload.output_video_urls:
        supabase_urls = []
        for comfy_url in payload.output_video_urls:
            print(f"[VIDEO_JOBS] Downloading video from ComfyUI: {comfy_url}")

            # Download from ComfyUI and upload to Supabase
            success_upload, supabase_url, upload_error = await storage_service.upload_video_from_url(
                comfy_url,
                'video-results'
            )

            if success_upload and supabase_url:
                print(f"[VIDEO_JOBS] Successfully uploaded to Supabase: {supabase_url}")
                supabase_urls.append(supabase_url)
            else:
                # If upload fails, log error and keep the ComfyUI URL (fallback)
                print(f"[VIDEO_JOBS] Failed to upload to Supabase: {upload_error}")
                supabase_urls.append(comfy_url)

        # Replace ComfyUI URLs with Supabase URLs
        payload.output_video_urls = supabase_urls

        # Generate thumbnail from the first video (non-blocking - errors don't fail the job)
        if supabase_urls:
            try:
                print(f"[VIDEO_JOBS] Generating thumbnail for job {job_id}...")
                thumb_success, thumb_url, thumb_error = await thumbnail_service.generate_thumbnail_from_url(
                    supabase_urls[0],
                    job_id,
                    width=400,
                    height=400
                )

                if thumb_success and thumb_url:
                    print(f"[VIDEO_JOBS] Thumbnail generated: {thumb_url}")
                    payload.thumbnail_url = thumb_url
                else:
                    print(f"[VIDEO_JOBS] Thumbnail generation failed (non-blocking): {thumb_error}")
            except Exception as e:
                # Thumbnail generation is non-blocking - log error but continue
                print(f"[VIDEO_JOBS] Thumbnail generation exception (non-blocking): {str(e)}")

    success, job, error = await service.complete_job(payload)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)
