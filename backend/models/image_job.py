from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

JobStatus = Literal['pending', 'processing', 'completed', 'failed', 'cancelled']

class ImageJob(BaseModel):
    """Model for image generation jobs (img2img, style-transfer, image-edit, etc.)"""
    id: str = Field(..., description="Primary key UUID")
    user_id: str = Field(..., description="User ID from auth.users (REQUIRED)")
    workflow_id: int = Field(..., description="Foreign key to workflows table")

    # Status tracking
    status: JobStatus = Field(..., description="Current job status")
    created_at: datetime = Field(..., description="When job was created")

    # Inputs
    input_image_urls: Optional[List[str]] = Field(None, description="Input image URLs (source, style, etc.)")
    prompt: Optional[str] = Field(None, description="Text prompt for generation/editing")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Workflow-specific params (JSONB)")

    # Outputs
    output_image_urls: Optional[List[str]] = Field(None, description="Output image URLs (Supabase Storage)")
    width: Optional[int] = Field(None, description="Image width in pixels")
    height: Optional[int] = Field(None, description="Image height in pixels")

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


class CreateImageJobPayload(BaseModel):
    """Payload for creating a new image job"""
    user_id: str  # REQUIRED
    workflow_name: str  # Will be converted to workflow_id by service
    comfy_url: str
    comfy_job_id: Optional[str] = None

    # Inputs
    input_image_urls: Optional[List[str]] = None
    prompt: Optional[str] = None

    # Output dimensions (optional, might be in parameters)
    width: Optional[int] = None
    height: Optional[int] = None

    # Workflow-specific parameters
    parameters: Dict[str, Any] = Field(default_factory=dict)

    # Google Drive integration
    project_id: Optional[str] = None


class UpdateImageJobPayload(BaseModel):
    """Payload for updating an image job"""
    status: Optional[JobStatus] = None

    # Outputs
    output_image_urls: Optional[List[str]] = None
    width: Optional[int] = None
    height: Optional[int] = None

    # Error handling
    error_message: Optional[str] = None


class CompleteImageJobPayload(BaseModel):
    """Payload for completing an image job"""
    job_id: str  # This is the UUID id, not comfy_job_id
    status: Literal['completed', 'failed']

    # Output information
    output_image_urls: Optional[List[str]] = None

    # Image metadata
    width: Optional[int] = None
    height: Optional[int] = None

    # Error if failed
    error_message: Optional[str] = None


class ImageJobResponse(BaseModel):
    """Response for image job operations"""
    success: bool
    image_job: Optional[ImageJob] = None
    error: Optional[str] = None


class ImageJobListResponse(BaseModel):
    """Response for listing image jobs"""
    success: bool
    image_jobs: List[ImageJob] = []
    total_count: int = 0
    error: Optional[str] = None


class ImageJobFeedResponse(BaseModel):
    """Response for feed endpoint - lightweight job data for display"""
    success: bool
    image_jobs: List[Dict[str, Any]] = []
    total_count: int = 0
    error: Optional[str] = None
