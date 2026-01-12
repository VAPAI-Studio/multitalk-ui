from fastapi import APIRouter, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

from services.video_job_service import VideoJobService
from services.edited_image_service import EditedImageService
from services.style_transfer_service import StyleTransferService

router = APIRouter(prefix="/feed", tags=["feed"])


class UnifiedFeedItem(BaseModel):
    """A unified feed item that can represent videos, edited images, or style transfers."""
    id: str
    type: str  # 'video', 'edited_image', 'style_transfer'
    status: str
    created_at: str
    workflow_name: Optional[str] = None
    # For videos
    output_video_urls: Optional[List[str]] = None
    width: Optional[int] = None
    height: Optional[int] = None
    comfy_job_id: Optional[str] = None
    error_message: Optional[str] = None
    thumbnail_url: Optional[str] = None
    # For images
    result_image_url: Optional[str] = None
    source_image_url: Optional[str] = None
    prompt: Optional[str] = None


class UnifiedFeedResponse(BaseModel):
    """Response for unified feed endpoint."""
    success: bool
    items: List[UnifiedFeedItem]
    error: Optional[str] = None


def get_video_job_service():
    return VideoJobService()


def get_edited_image_service():
    return EditedImageService()


def get_style_transfer_service():
    return StyleTransferService()


@router.get("/unified", response_model=UnifiedFeedResponse)
async def get_unified_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False),
    types: Optional[str] = Query(default=None, description="Comma-separated list of types: video,edited_image,style_transfer")
):
    """
    Get a unified feed of all generation types (videos, edited images, style transfers).

    This endpoint combines results from all tables into a single feed, sorted by created_at.
    Use the 'types' parameter to filter by specific types.

    Optimized for feed display - minimal columns, no count query.
    """
    try:
        # Parse types filter
        allowed_types = {'video', 'edited_image', 'style_transfer'}
        if types:
            requested_types = set(t.strip() for t in types.split(','))
            feed_types = requested_types & allowed_types
        else:
            feed_types = allowed_types

        all_items: List[Dict[str, Any]] = []

        # Fetch from each service based on requested types
        # We fetch more than needed to handle pagination across sources
        fetch_limit = limit + offset

        if 'video' in feed_types:
            video_service = get_video_job_service()
            if completed_only:
                video_data, error = await video_service.get_completed_jobs_feed(limit=fetch_limit)
            else:
                video_data, error = await video_service.get_recent_jobs_feed(limit=fetch_limit)

            if error:
                return UnifiedFeedResponse(success=False, items=[], error=f"Video fetch error: {error}")

            for item in video_data:
                all_items.append({
                    **item,
                    'type': 'video'
                })

        if 'edited_image' in feed_types:
            image_service = get_edited_image_service()
            if completed_only:
                image_data, error = await image_service.get_completed_edited_images_feed(limit=fetch_limit)
            else:
                image_data, error = await image_service.get_recent_edited_images_feed(limit=fetch_limit)

            if error:
                return UnifiedFeedResponse(success=False, items=[], error=f"Edited image fetch error: {error}")

            for item in image_data:
                all_items.append({
                    **item,
                    'type': 'edited_image'
                })

        if 'style_transfer' in feed_types:
            style_service = get_style_transfer_service()
            if completed_only:
                style_data, error = await style_service.get_completed_style_transfers_feed(limit=fetch_limit)
            else:
                style_data, error = await style_service.get_recent_style_transfers_feed(limit=fetch_limit)

            if error:
                return UnifiedFeedResponse(success=False, items=[], error=f"Style transfer fetch error: {error}")

            for item in style_data:
                all_items.append({
                    **item,
                    'type': 'style_transfer'
                })

        # Sort all items by created_at descending
        all_items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

        # Apply pagination
        paginated_items = all_items[offset:offset + limit]

        # Convert to response model
        feed_items = [UnifiedFeedItem(**item) for item in paginated_items]

        return UnifiedFeedResponse(success=True, items=feed_items)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))


@router.get("/videos", response_model=UnifiedFeedResponse)
async def get_video_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False),
    workflow_name: Optional[str] = Query(default=None)
):
    """Get video jobs feed (optimized)."""
    try:
        video_service = get_video_job_service()

        if completed_only:
            data, error = await video_service.get_completed_jobs_feed(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name
            )
        else:
            data, error = await video_service.get_recent_jobs_feed(
                limit=limit,
                offset=offset,
                workflow_name=workflow_name
            )

        if error:
            return UnifiedFeedResponse(success=False, items=[], error=error)

        feed_items = [UnifiedFeedItem(**{**item, 'type': 'video'}) for item in data]
        return UnifiedFeedResponse(success=True, items=feed_items)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))


@router.get("/images", response_model=UnifiedFeedResponse)
async def get_images_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False)
):
    """Get edited images feed (optimized)."""
    try:
        image_service = get_edited_image_service()

        if completed_only:
            data, error = await image_service.get_completed_edited_images_feed(limit=limit, offset=offset)
        else:
            data, error = await image_service.get_recent_edited_images_feed(limit=limit, offset=offset)

        if error:
            return UnifiedFeedResponse(success=False, items=[], error=error)

        feed_items = [UnifiedFeedItem(**{**item, 'type': 'edited_image'}) for item in data]
        return UnifiedFeedResponse(success=True, items=feed_items)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))


@router.get("/style-transfers", response_model=UnifiedFeedResponse)
async def get_style_transfers_feed(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    completed_only: bool = Query(default=False)
):
    """Get style transfers feed (optimized)."""
    try:
        style_service = get_style_transfer_service()

        if completed_only:
            data, error = await style_service.get_completed_style_transfers_feed(limit=limit, offset=offset)
        else:
            data, error = await style_service.get_recent_style_transfers_feed(limit=limit, offset=offset)

        if error:
            return UnifiedFeedResponse(success=False, items=[], error=error)

        feed_items = [UnifiedFeedItem(**{**item, 'type': 'style_transfer'}) for item in data]
        return UnifiedFeedResponse(success=True, items=feed_items)

    except Exception as e:
        return UnifiedFeedResponse(success=False, items=[], error=str(e))
