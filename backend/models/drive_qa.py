"""Pydantic models for the Drive QA Viewer."""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


ReviewStatus = Literal["pending", "ok", "nok"]


class QAImage(BaseModel):
    """A single image file (asset or result) inside a scene."""

    id: str
    name: str
    mime_type: str
    size: Optional[int] = None
    modified_time: Optional[datetime] = None


class QAScene(BaseModel):
    """A scene in the QA viewer (lightweight; no file lists)."""

    id: str
    name: str
    modified_time: Optional[datetime] = None


class QASceneListResponse(BaseModel):
    success: bool
    episode_id: str
    episode_name: Optional[str] = None
    scenes: List[QAScene] = []
    error: Optional[str] = None


class QASceneDetail(BaseModel):
    """Full scene contents split into assets and results."""

    id: str
    name: str
    assets: List[QAImage] = Field(default_factory=list)
    results: List[QAImage] = Field(default_factory=list)


class QASceneDetailResponse(BaseModel):
    success: bool
    scene: Optional[QASceneDetail] = None
    error: Optional[str] = None


class QAReview(BaseModel):
    """A QA review record."""

    id: str
    episode_id: str
    scene_id: str
    scene_name: str
    status: ReviewStatus
    notes: Optional[str] = None
    user_id: str
    created_at: datetime
    updated_at: datetime


class QAReviewUpsertRequest(BaseModel):
    """Request body to create or update a review."""

    episode_id: str
    scene_id: str
    scene_name: str
    status: ReviewStatus
    notes: Optional[str] = None


class QAReviewResponse(BaseModel):
    success: bool
    review: Optional[QAReview] = None
    error: Optional[str] = None


class QAReviewListResponse(BaseModel):
    success: bool
    reviews: List[QAReview] = Field(default_factory=list)
    error: Optional[str] = None
