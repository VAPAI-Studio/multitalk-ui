from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

JobStatus = Literal['pending', 'processing', 'completed', 'failed', 'cancelled']


class WorldJob(BaseModel):
    """Model for 3D world generation jobs (World Labs API)"""
    id: str = Field(..., description="Primary key UUID")
    user_id: str = Field(..., description="User ID from auth.users")

    # Status tracking
    status: JobStatus = Field(..., description="Current job status")
    created_at: datetime = Field(..., description="When job was created")

    # World Labs integration
    world_id: Optional[str] = Field(None, description="World Labs world ID")
    operation_id: Optional[str] = Field(None, description="World Labs operation ID (for polling)")
    splat_url: Optional[str] = Field(None, description="3D asset URL (.spz file)")
    model: str = Field("Marble 0.1-plus", description="World Labs model used")

    # Input type
    prompt_type: Optional[str] = Field(None, description="image, multi-image, or video")

    # Inputs
    input_image_urls: Optional[List[str]] = Field(None, description="Source images used")
    input_video_url: Optional[str] = Field(None, description="Source video URL (if video prompt)")
    text_prompt: Optional[str] = Field(None, description="Optional user text prompt")
    display_name: Optional[str] = Field(None, description="User-facing name")

    # Display
    thumbnail_url: Optional[str] = Field(None, description="Preview image for feed")

    # Flexible parameters
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata (JSONB)")

    # Error handling
    error_message: Optional[str] = Field(None, description="Error message if failed")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class CreateWorldJobPayload(BaseModel):
    """Payload for creating a new world job"""
    user_id: Optional[str] = None  # Can be set from auth token

    # World Labs fields
    world_id: Optional[str] = None
    operation_id: Optional[str] = None
    splat_url: Optional[str] = None
    model: str = "Marble 0.1-plus"

    # Input type
    prompt_type: Optional[str] = None

    # Inputs
    input_image_urls: Optional[List[str]] = None
    input_video_url: Optional[str] = None
    text_prompt: Optional[str] = None
    display_name: Optional[str] = None

    # Display
    thumbnail_url: Optional[str] = None

    # Extra
    parameters: Dict[str, Any] = Field(default_factory=dict)


class CompleteWorldJobPayload(BaseModel):
    """Payload for completing a world job"""
    job_id: str  # UUID
    status: Literal['completed', 'failed']

    # World Labs results
    splat_url: Optional[str] = None
    world_id: Optional[str] = None
    thumbnail_url: Optional[str] = None

    # Error if failed
    error_message: Optional[str] = None


class WorldJobResponse(BaseModel):
    """Response for world job operations"""
    success: bool
    world_job: Optional[WorldJob] = None
    error: Optional[str] = None


class WorldJobListResponse(BaseModel):
    """Response for listing world jobs"""
    success: bool
    world_jobs: List[WorldJob] = []
    total_count: int = 0
    error: Optional[str] = None


class WorldJobFeedResponse(BaseModel):
    """Response for feed endpoint - lightweight job data for display"""
    success: bool
    world_jobs: List[Dict[str, Any]] = []
    total_count: int = 0
    error: Optional[str] = None
