"""
Pydantic models for batch video upscaling.

Defines settings, request/response payloads, and data models for the
upscale_batches and upscale_videos tables. Used by the API router,
job service, and background processing task.
"""
import re
from dataclasses import dataclass, field
from typing import Optional, List, Literal

from pydantic import BaseModel, Field
from datetime import datetime

# --- Status types ---

BatchStatus = Literal['pending', 'processing', 'completed', 'failed', 'paused', 'cancelled']
VideoStatus = Literal['pending', 'processing', 'completed', 'failed', 'paused']
FailureType = Literal['transient', 'credit_exhaustion', 'permanent']

# --- Settings ---


class UpscaleSettings(BaseModel):
    """Upscale settings with defaults matching SETT-02 specification."""
    resolution: Literal['1k', '2k', '4k'] = Field(
        default='2k', description="Target resolution"
    )
    creativity: int = Field(
        default=0, ge=0, le=100, description="Creativity level 0-100"
    )
    sharpen: int = Field(
        default=0, ge=0, le=100, description="Sharpen level 0-100"
    )
    grain: int = Field(
        default=0, ge=0, le=100, description="Smart grain level 0-100"
    )
    fps_boost: bool = Field(
        default=False, description="Enable FPS boost"
    )
    flavor: Literal['vivid', 'natural'] = Field(
        default='vivid', description="Output flavor"
    )


# --- Request payloads ---


class CreateBatchPayload(BaseModel):
    """Payload for creating a new upscale batch."""
    settings: UpscaleSettings = Field(default_factory=UpscaleSettings)
    project_id: Optional[str] = None  # Google Drive folder ID


class AddVideoPayload(BaseModel):
    """Payload for adding a video to a batch."""
    input_filename: str
    input_storage_url: str
    input_file_size: Optional[int] = None
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None


# --- Response models ---


class BatchResponse(BaseModel):
    """Response for batch operations (create, start, cancel)."""
    success: bool
    batch_id: Optional[str] = None
    status: Optional[BatchStatus] = None
    error: Optional[str] = None


class UpscaleVideo(BaseModel):
    """Represents a single video within an upscale batch."""
    id: str
    batch_id: str
    status: VideoStatus
    queue_position: int
    input_filename: str
    input_storage_url: str
    freepik_task_id: Optional[str] = None
    output_storage_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class UpscaleBatch(BaseModel):
    """Represents a batch of videos for upscaling."""
    id: str
    user_id: str
    status: BatchStatus
    resolution: str
    creativity: int
    sharpen: int
    grain: int
    fps_boost: bool
    flavor: str
    project_id: Optional[str] = None
    total_videos: int
    completed_videos: int
    failed_videos: int
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    videos: List[UpscaleVideo] = []


class BatchDetailResponse(BaseModel):
    """Response for batch detail endpoint (includes video list)."""
    success: bool
    batch: Optional[UpscaleBatch] = None
    error: Optional[str] = None


# --- Batch processing support ---


@dataclass
class ProcessingResult:
    """Result of processing a single video in a batch.

    Used by the background processor to communicate outcome and whether
    the batch should be paused (e.g. on credit exhaustion).
    """
    success: bool
    failure_type: Optional[FailureType] = None
    error_message: Optional[str] = None
    should_pause_batch: bool = field(default=False)


# Patterns for credit-exhaustion keywords (used with 429 status)
_CREDIT_KEYWORDS = re.compile(
    r"quota|limit\s+exceeded|insufficient|credit|budget",
    re.IGNORECASE,
)


def _classify_error(error_message: str) -> FailureType:
    """Classify an error message into a FailureType.

    Classification rules (evaluated in order):
    1. 402 -> credit_exhaustion
    2. 429 + quota/limit/insufficient/credit/budget keyword -> credit_exhaustion
    3. 500/502/503/504 -> transient
    4. timeout / timed out -> transient
    5. connection / request failed -> transient
    6. generic 429 (no credit keywords) -> transient
    7. everything else -> permanent
    """
    msg = error_message.lower()

    # 1. HTTP 402 always means payment/credit issue
    if "402" in msg:
        return "credit_exhaustion"

    # 2. 429 with credit-related keywords
    if "429" in msg and _CREDIT_KEYWORDS.search(error_message):
        return "credit_exhaustion"

    # 3. Server errors (5xx)
    if re.search(r"50[0-4]", msg):
        return "transient"

    # 4. Timeout
    if "timeout" in msg or "timed out" in msg:
        return "transient"

    # 5. Connection errors
    if "connection" in msg or "request failed" in msg:
        return "transient"

    # 6. Generic 429 (rate limit, no credit keywords)
    if "429" in msg:
        return "transient"

    # 7. Default: permanent
    return "permanent"


class ReorderPayload(BaseModel):
    """Payload for reordering pending videos in a batch."""
    video_ids: List[str]
