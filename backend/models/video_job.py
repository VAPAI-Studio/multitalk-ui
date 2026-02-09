from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

JobStatus = Literal['pending', 'processing', 'completed', 'failed', 'cancelled']

class VideoJob(BaseModel):
    """Model for video generation jobs (lipsync, video-lipsync, wan-i2v, etc.)"""
    id: str = Field(..., description="Primary key UUID")
    user_id: str = Field(..., description="User ID from auth.users (REQUIRED)")
    workflow_id: int = Field(..., description="Foreign key to workflows table")

    # Status tracking
    status: JobStatus = Field(..., description="Current job status")
    created_at: datetime = Field(..., description="When job was created")

    # Inputs
    input_image_urls: Optional[List[str]] = Field(None, description="Input image URLs")
    input_audio_urls: Optional[List[str]] = Field(None, description="Input audio URLs")
    input_video_urls: Optional[List[str]] = Field(None, description="Input video URLs")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Workflow-specific params (JSONB)")

    # Outputs
    output_video_urls: Optional[List[str]] = Field(None, description="Output video URLs (Supabase Storage)")
    thumbnail_url: Optional[str] = Field(None, description="Pre-generated thumbnail URL (first frame)")
    width: Optional[int] = Field(None, description="Video width in pixels")
    height: Optional[int] = Field(None, description="Video height in pixels")
    fps: Optional[int] = Field(None, description="Frames per second")
    duration_seconds: Optional[float] = Field(None, description="Video duration")

    # ComfyUI integration
    comfy_job_id: Optional[str] = Field(None, description="ComfyUI prompt ID")
    comfy_url: str = Field(..., description="ComfyUI server URL")

    # Google Drive integration
    project_id: Optional[str] = Field(None, description="Google Drive folder ID for saving outputs")

    # Error handling
    error_message: Optional[str] = Field(None, description="Error message if failed")

    # Denormalized workflow name for convenience (populated by service)
    workflow_name: Optional[str] = Field(None, description="Workflow name (denormalized from workflows table)")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class CreateVideoJobPayload(BaseModel):
    """Payload for creating a new video job"""
    user_id: str  # REQUIRED
    workflow_name: str  # Will be converted to workflow_id by service
    comfy_url: str
    comfy_job_id: Optional[str] = None

    # Inputs
    input_image_urls: Optional[List[str]] = None
    input_audio_urls: Optional[List[str]] = None
    input_video_urls: Optional[List[str]] = None

    # Output dimensions (optional, might be in parameters)
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[int] = None
    duration_seconds: Optional[float] = None

    # Workflow-specific parameters
    parameters: Dict[str, Any] = Field(default_factory=dict)

    # Google Drive integration
    project_id: Optional[str] = None


class UpdateVideoJobPayload(BaseModel):
    """Payload for updating a video job"""
    status: Optional[JobStatus] = None

    # Outputs
    output_video_urls: Optional[List[str]] = None
    thumbnail_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[int] = None
    duration_seconds: Optional[float] = None

    # Error handling
    error_message: Optional[str] = None


class CompleteVideoJobPayload(BaseModel):
    """Payload for completing a video job"""
    job_id: str  # This is the UUID id, not comfy_job_id
    status: Literal['completed', 'failed']

    # Output information
    output_video_urls: Optional[List[str]] = None
    thumbnail_url: Optional[str] = None

    # Video metadata
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[int] = None
    duration_seconds: Optional[float] = None

    # Error if failed
    error_message: Optional[str] = None


class VideoJobResponse(BaseModel):
    """Response for video job operations"""
    success: bool
    video_job: Optional[VideoJob] = None
    error: Optional[str] = None


class VideoJobListResponse(BaseModel):
    """Response for listing video jobs"""
    success: bool
    video_jobs: List[VideoJob] = []
    total_count: int = 0
    error: Optional[str] = None


class VideoJobFeedResponse(BaseModel):
    """Response for feed endpoint - lightweight job data for display"""
    success: bool
    video_jobs: List[Dict[str, Any]] = []
    total_count: int = 0
    error: Optional[str] = None
