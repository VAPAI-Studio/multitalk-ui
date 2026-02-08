from fastapi import APIRouter, HTTPException, Query, Header
from typing import Optional
import httpx
from models.video_job import (
    CreateVideoJobPayload,
    UpdateVideoJobPayload,
    CompleteVideoJobPayload,
    VideoJobResponse,
    VideoJobListResponse,
    VideoJobFeedResponse
)
from services.video_job_service import VideoJobService
from services.storage_service import StorageService
from services.thumbnail_service import ThumbnailService
from services.google_drive_service import GoogleDriveService
from core.supabase import get_supabase_for_token

router = APIRouter(prefix="/video-jobs", tags=["video-jobs"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def get_service(access_token: Optional[str] = None):
    """Dependency to get VideoJobService instance."""
    supabase = get_supabase_for_token(access_token)
    return VideoJobService(supabase)


@router.post("/", response_model=VideoJobResponse)
async def create_video_job(
    payload: CreateVideoJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Create a new video job."""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.create_job(payload)

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.get("/", response_model=VideoJobListResponse)
async def get_video_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None)
):
    """
    Get recent video jobs with optional filtering.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow (lipsync-one, lipsync-multi, video-lipsync, wan-i2v)
    - user_id: Filter by user ID
    """
    service = get_service(_extract_bearer_token(authorization))

    jobs, total_count, error = await service.get_recent_jobs(
        limit=limit,
        offset=offset,
        workflow_name=workflow_name,
        user_id=user_id
    )

    return VideoJobListResponse(
        success=error is None,
        video_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/feed", response_model=VideoJobFeedResponse)
async def get_video_jobs_feed(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None)
):
    """
    Optimized feed endpoint - minimal data, server-side caching.
    Returns only fields needed for feed display (no parameters, no input URLs).
    Cached for 10 seconds to reduce database load.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow
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

    return VideoJobFeedResponse(
        success=error is None,
        video_jobs=jobs,
        total_count=total_count,
        error=error
    )


@router.get("/completed/recent", response_model=VideoJobListResponse)
async def get_completed_video_jobs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    workflow_name: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None)
):
    """
    Get recent completed video jobs with optional filtering.

    Query parameters:
    - limit: Maximum number of jobs to return (1-100)
    - offset: Number of jobs to skip (for pagination)
    - workflow_name: Filter by workflow (lipsync-one, lipsync-multi, video-lipsync, wan-i2v)
    - user_id: Filter by user ID
    """
    service = get_service(_extract_bearer_token(authorization))
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
async def get_video_job(job_id: str, authorization: Optional[str] = Header(None)):
    """Get a single video job by UUID."""
    service = get_service(_extract_bearer_token(authorization))
    job, error = await service.get_job(job_id)

    if error:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)


@router.get("/comfy/{comfy_job_id}", response_model=VideoJobResponse)
async def get_video_job_by_comfy_id(
    comfy_job_id: str,
    authorization: Optional[str] = Header(None)
):
    """Get a single video job by ComfyUI job ID."""
    service = get_service(_extract_bearer_token(authorization))
    job, error = await service.get_job_by_comfy_id(comfy_job_id)

    if error:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)


@router.put("/{job_id}/processing", response_model=VideoJobResponse)
async def update_to_processing(job_id: str, authorization: Optional[str] = Header(None)):
    """Update job status to processing."""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.update_to_processing(job_id)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.put("/{job_id}", response_model=VideoJobResponse)
async def update_video_job(
    job_id: str,
    payload: UpdateVideoJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Update a video job."""
    service = get_service(_extract_bearer_token(authorization))
    success, error = await service.update_job(job_id, payload)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, error=None)


@router.put("/{job_id}/complete", response_model=VideoJobResponse)
async def complete_video_job(
    job_id: str,
    payload: CompleteVideoJobPayload,
    authorization: Optional[str] = Header(None)
):
    """Complete a video job (success or failure)."""
    # Override job_id from path parameter
    payload.job_id = job_id

    service = get_service(_extract_bearer_token(authorization))
    storage_service = StorageService()
    thumbnail_service = ThumbnailService()

    # Get job to check for project_id and current status
    existing_job, _ = await service.get_job_by_comfy_id(job_id)
    project_id = existing_job.project_id if existing_job else None

    # Skip if job is already completed (prevents duplicate uploads on repeated calls)
    if existing_job and existing_job.status == 'completed':
        print(f"[VIDEO_JOBS] Job {job_id} already completed, skipping upload")
        return VideoJobResponse(success=True, video_job=existing_job, error=None)

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

        # Upload to Google Drive if project_id is set (non-blocking)
        if project_id and supabase_urls:
            try:
                drive_service = GoogleDriveService()

                # Get or create AI-Videos folder
                folder_success, ai_folder_id, folder_error = await drive_service.get_or_create_folder(
                    parent_id=project_id,
                    folder_name='AI-Videos'
                )

                if folder_success and ai_folder_id:
                    print(f"[VIDEO_JOBS] Uploading to Google Drive folder: AI-Videos ({ai_folder_id})")

                    # Download file content from first Supabase URL and upload to Drive
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        response = await client.get(supabase_urls[0])
                        if response.status_code == 200:
                            file_content = response.content
                            drive_filename = f"{job_id}.mp4"

                            upload_success, file_id, upload_error = await drive_service.upload_file(
                                file_content=file_content,
                                filename=drive_filename,
                                folder_id=ai_folder_id,
                                mime_type='video/mp4'
                            )

                            if upload_success:
                                print(f"[VIDEO_JOBS] ✅ Video uploaded to Google Drive: {drive_filename}")
                            else:
                                print(f"[VIDEO_JOBS] ⚠️ Failed to upload to Google Drive: {upload_error}")
                        else:
                            print(f"[VIDEO_JOBS] ⚠️ Failed to download video for Drive upload: {response.status_code}")
                else:
                    print(f"[VIDEO_JOBS] ⚠️ Failed to create Drive folder: {folder_error}")

            except Exception as drive_error:
                # Google Drive upload is non-blocking - log error but continue
                print(f"[VIDEO_JOBS] ⚠️ Google Drive upload error (non-blocking): {str(drive_error)}")

    success, job, error = await service.complete_job(payload)

    if not success:
        raise HTTPException(status_code=404, detail=error)

    return VideoJobResponse(success=True, video_job=job, error=None)
