from fastapi import APIRouter, Query, Header
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

from services.video_job_service import VideoJobService
from services.image_job_service import ImageJobService
from core.supabase import get_supabase_for_token

router = APIRouter(prefix="/feed", tags=["feed"])


class UnifiedFeedItem(BaseModel):
    """A unified feed item that can represent videos or images."""
    id: str
    type: str  # 'video', 'image'
    status: str
    created_at: str
    workflow_name: Optional[str] = None
    user_id: Optional[str] = None
    # For videos
    output_video_urls: Optional[List[str]] = None
    thumbnail_url: Optional[str] = None
    # For images
    output_image_urls: Optional[List[str]] = None
    # Common fields
    width: Optional[int] = None
    height: Optional[int] = None
    comfy_job_id: Optional[str] = None
    error_message: Optional[str] = None
    prompt: Optional[str] = None


class UnifiedFeedResponse(BaseModel):
    """Response for unified feed endpoint."""
    success: bool
    items: List[UnifiedFeedItem]
    total_count: int = 0
    error: Optional[str] = None


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def get_video_job_service(access_token: Optional[str] = None):
    supabase = get_supabase_for_token(access_token)
    return VideoJobService(supabase)


def get_image_job_service(access_token: Optional[str] = None):
    supabase = get_supabase_for_token(access_token)
    return ImageJobService(supabase)


@router.get("/unified", response_model=UnifiedFeedResponse)
async def get_unified_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False),
    types: Optional[str] = Query(default=None, description="Comma-separated list of types: video,image"),
    user_id: Optional[str] = Query(default=None, description="Filter by user ID"),
    authorization: Optional[str] = Header(None)
):
    """
    Get a unified feed of all generation types (videos and images).

    This endpoint combines results from video_jobs and image_jobs tables into a single feed,
    sorted by created_at descending.

    Use the 'types' parameter to filter by specific types (video, image).
    """
    try:
        token = _extract_bearer_token(authorization)

        # Parse types filter
        allowed_types = {'video', 'image'}
        if types:
            requested_types = set(t.strip() for t in types.split(','))
            feed_types = requested_types & allowed_types
        else:
            feed_types = allowed_types

        all_items: List[Dict[str, Any]] = []

        # Fetch more than needed to handle pagination across sources
        fetch_limit = limit + offset

        if 'video' in feed_types:
            video_service = get_video_job_service(token)
            if completed_only:
                video_jobs, _, error = await video_service.get_completed_jobs(
                    limit=fetch_limit,
                    user_id=user_id
                )
            else:
                video_jobs, _, error = await video_service.get_recent_jobs(
                    limit=fetch_limit,
                    user_id=user_id
                )

            if error:
                return UnifiedFeedResponse(success=False, items=[], error=f"Video fetch error: {error}")

            for job in video_jobs:
                all_items.append({
                    'id': job.id,
                    'type': 'video',
                    'status': job.status,
                    'created_at': job.created_at,
                    'workflow_name': job.workflow_name,
                    'user_id': job.user_id,
                    'output_video_urls': job.output_video_urls,
                    'thumbnail_url': job.thumbnail_url,
                    'width': job.width,
                    'height': job.height,
                    'comfy_job_id': job.comfy_job_id,
                    'error_message': job.error_message,
                })

        if 'image' in feed_types:
            image_service = get_image_job_service(token)
            if completed_only:
                image_jobs, _, error = await image_service.get_completed_jobs(
                    limit=fetch_limit,
                    user_id=user_id
                )
            else:
                image_jobs, _, error = await image_service.get_recent_jobs(
                    limit=fetch_limit,
                    user_id=user_id
                )

            if error:
                return UnifiedFeedResponse(success=False, items=[], error=f"Image fetch error: {error}")

            for job in image_jobs:
                all_items.append({
                    'id': job.id,
                    'type': 'image',
                    'status': job.status,
                    'created_at': job.created_at,
                    'workflow_name': job.workflow_name,
                    'user_id': job.user_id,
                    'output_image_urls': job.output_image_urls,
                    'width': job.width,
                    'height': job.height,
                    'comfy_job_id': job.comfy_job_id,
                    'error_message': job.error_message,
                    'prompt': job.prompt,
                })

        # Sort all items by created_at descending
        all_items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

        # Apply pagination
        paginated_items = all_items[offset:offset + limit]

        # Convert to response model
        feed_items = [UnifiedFeedItem(**item) for item in paginated_items]

        return UnifiedFeedResponse(
            success=True,
            items=feed_items,
            total_count=len(all_items)
        )

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))


@router.get("/videos", response_model=UnifiedFeedResponse)
async def get_video_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False),
    workflow_name: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(None)
):
    """Get video jobs feed."""
    try:
        token = _extract_bearer_token(authorization)
        video_service = get_video_job_service(token)

        if completed_only:
            jobs, total, error = await video_service.get_completed_jobs(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name,
                user_id=user_id
            )
        else:
            jobs, total, error = await video_service.get_recent_jobs(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name,
                user_id=user_id
            )

        if error:
            return UnifiedFeedResponse(success=False, items=[], error=error)

        feed_items = [
            UnifiedFeedItem(
                id=job.id,
                type='video',
                status=job.status,
                created_at=job.created_at,
                workflow_name=job.workflow_name,
                user_id=job.user_id,
                output_video_urls=job.output_video_urls,
                thumbnail_url=job.thumbnail_url,
                width=job.width,
                height=job.height,
                comfy_job_id=job.comfy_job_id,
                error_message=job.error_message,
            )
            for job in jobs
        ]
        return UnifiedFeedResponse(success=True, items=feed_items, total_count=total)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))


@router.get("/images", response_model=UnifiedFeedResponse)
async def get_images_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False),
    workflow_name: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(None)
):
    """Get image jobs feed."""
    try:
        token = _extract_bearer_token(authorization)
        image_service = get_image_job_service(token)

        if completed_only:
            jobs, total, error = await image_service.get_completed_jobs(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name,
                user_id=user_id
            )
        else:
            jobs, total, error = await image_service.get_recent_jobs(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name,
                user_id=user_id
            )

        if error:
            return UnifiedFeedResponse(success=False, items=[], error=error)

        feed_items = [
            UnifiedFeedItem(
                id=job.id,
                type='image',
                status=job.status,
                created_at=job.created_at,
                workflow_name=job.workflow_name,
                user_id=job.user_id,
                output_image_urls=job.output_image_urls,
                width=job.width,
                height=job.height,
                comfy_job_id=job.comfy_job_id,
                error_message=job.error_message,
                prompt=job.prompt,
            )
            for job in jobs
        ]
        return UnifiedFeedResponse(success=True, items=feed_items, total_count=total)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))
