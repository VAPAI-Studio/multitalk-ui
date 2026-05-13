"""API endpoints for the Drive QA Viewer.

Exposes:
  GET  /drive-qa/episode                 → episode metadata (hardcoded Max Wild 1x03)
  GET  /drive-qa/scenes                  → list of scene folders
  GET  /drive-qa/scenes/{scene_id}       → scene with assets + results
  GET  /drive-qa/file/{file_id}          → raw image bytes (proxy)
  GET  /drive-qa/file/{file_id}/thumbnail → small thumbnail bytes (proxy)
  GET  /drive-qa/reviews                 → all reviews for the current episode
  POST /drive-qa/reviews                 → upsert a review for a scene
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from core.auth import get_current_user
from models.drive_qa import (
    QAReviewListResponse,
    QAReviewResponse,
    QAReviewUpsertRequest,
    QASceneDetailResponse,
    QASceneListResponse,
)
from services.drive_qa_service import (
    EPISODE_ID,
    EPISODE_NAME,
    DriveQAReviewService,
    DriveQAService,
)


router = APIRouter(prefix="/drive-qa", tags=["drive-qa"])


# ---------------------------------------------------------------------------
# Episode + scenes
# ---------------------------------------------------------------------------


@router.get("/episode")
async def get_episode(_: dict = Depends(get_current_user)) -> dict:
    """Return the hardcoded episode currently exposed by the viewer."""
    return {"id": EPISODE_ID, "name": EPISODE_NAME}


@router.get("/scenes", response_model=QASceneListResponse)
async def list_scenes(
    _: dict = Depends(get_current_user),
) -> QASceneListResponse:
    service = DriveQAService()
    success, scenes, error = await service.list_scenes()
    return QASceneListResponse(
        success=success,
        episode_id=EPISODE_ID,
        episode_name=EPISODE_NAME,
        scenes=scenes,
        error=error,
    )


@router.get("/scenes/{scene_id}", response_model=QASceneDetailResponse)
async def get_scene(
    scene_id: str,
    _: dict = Depends(get_current_user),
) -> QASceneDetailResponse:
    service = DriveQAService()
    success, scene, error = await service.get_scene_detail(scene_id)
    return QASceneDetailResponse(success=success, scene=scene, error=error)


# ---------------------------------------------------------------------------
# File proxy (so the frontend can render Drive images with our auth)
# ---------------------------------------------------------------------------


@router.get("/file/{file_id}")
async def get_file_bytes(
    file_id: str,
    _: dict = Depends(get_current_user),
) -> Response:
    """Stream the full image bytes for a Drive file."""
    service = DriveQAService()
    success, content, mime_type, error = await service.download_file(file_id)
    if not success or content is None:
        raise HTTPException(status_code=502, detail=error or "Drive download failed")
    return Response(
        content=content,
        media_type=mime_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/file/{file_id}/thumbnail")
async def get_file_thumbnail(
    file_id: str,
    size: int = Query(400, ge=64, le=2000),
    _: dict = Depends(get_current_user),
) -> Response:
    """Proxy a Drive-generated thumbnail (smaller than the full image)."""
    service = DriveQAService()
    success, url, error = await service.get_thumbnail_url(file_id, size_px=size)
    if not success or not url:
        # Fall back to the full image if the thumbnail is unavailable.
        full_success, content, mime, full_error = await service.download_file(file_id)
        if not full_success or content is None:
            raise HTTPException(
                status_code=502,
                detail=error or full_error or "Drive thumbnail unavailable",
            )
        return Response(
            content=content,
            media_type=mime or "image/jpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url)
            r.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Thumbnail fetch failed: {e}")

    return Response(
        content=r.content,
        media_type=r.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "private, max-age=3600"},
    )


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------


@router.get("/reviews", response_model=QAReviewListResponse)
async def list_reviews(
    _: dict = Depends(get_current_user),
) -> QAReviewListResponse:
    service = DriveQAReviewService()
    success, reviews, error = await service.list_for_episode(EPISODE_ID)
    return QAReviewListResponse(success=success, reviews=reviews, error=error)


@router.post("/reviews", response_model=QAReviewResponse)
async def upsert_review(
    payload: QAReviewUpsertRequest,
    current_user=Depends(get_current_user),
) -> QAReviewResponse:
    service = DriveQAReviewService()
    success, review, error = await service.upsert(
        user_id=current_user.id,
        episode_id=payload.episode_id,
        scene_id=payload.scene_id,
        scene_name=payload.scene_name,
        status=payload.status,
        notes=payload.notes,
    )
    return QAReviewResponse(success=success, review=review, error=error)
