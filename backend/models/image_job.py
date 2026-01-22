from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

JobStatus = Literal['pending', 'processing', 'completed', 'failed']

class ImageJob(BaseModel):
    """Model for image generation jobs (img2img, style-transfer, image-edit, etc.)"""
    id: str = Field(..., description="Primary key UUID")
    user_id: Optional[str] = Field(None, description="User ID from auth.users")

    # Workflow identification
    workflow_name: str = Field(..., description="Workflow type: img2img, style-transfer, image-edit")

    # Status tracking
    status: JobStatus = Field(..., description="Current job status")
    created_at: datetime = Field(..., description="When job was created")
    started_at: Optional[datetime] = Field(None, description="When processing started")
    completed_at: Optional[datetime] = Field(None, description="When job completed")
    processing_time_seconds: Optional[int] = Field(None, description="Processing duration")

    # Common image inputs
    input_image_urls: Optional[List[str]] = Field(None, description="Input image URLs (source, style, etc.)")
    prompt: Optional[str] = Field(None, description="Text prompt for generation/editing")

    # Common image outputs
    output_image_urls: Optional[List[str]] = Field(None, description="Output image URLs (Supabase Storage)")
    width: Optional[int] = Field(None, description="Image width in pixels")
    height: Optional[int] = Field(None, description="Image height in pixels")

    # Feature-specific parameters
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Workflow-specific params (JSONB)")

    # ComfyUI integration
    comfy_job_id: Optional[str] = Field(None, description="ComfyUI prompt ID")
    comfy_url: str = Field(..., description="ComfyUI server URL")
    comfyui_output_filename: Optional[str] = Field(None, description="Output filename from ComfyUI")
    comfyui_output_subfolder: Optional[str] = Field(None, description="Output subfolder from ComfyUI")
    comfyui_output_type: str = Field(default='output', description="Output type from ComfyUI")

    # Error handling
    error_message: Optional[str] = Field(None, description="Error message if failed")

    # Metadata
    model_used: Optional[str] = Field(None, description="AI model used (Dreamshaper, Flux, etc.)")
    user_ip: Optional[str] = Field(None, description="User IP for anonymous tracking")
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class CreateImageJobPayload(BaseModel):
    """Payload for creating a new image job"""
    user_id: Optional[str] = None
    workflow_name: str
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

    # Metadata
    model_used: Optional[str] = None
    user_ip: Optional[str] = None


class UpdateImageJobPayload(BaseModel):
    """Payload for updating an image job"""
    status: Optional[JobStatus] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    processing_time_seconds: Optional[int] = None

    # Outputs
    output_image_urls: Optional[List[str]] = None
    width: Optional[int] = None
    height: Optional[int] = None

    # ComfyUI output info
    comfyui_output_filename: Optional[str] = None
    comfyui_output_subfolder: Optional[str] = None
    comfyui_output_type: Optional[str] = None

    # Error handling
    error_message: Optional[str] = None


class CompleteImageJobPayload(BaseModel):
    """Payload for completing an image job"""
    job_id: str  # This is the UUID id, not comfy_job_id
    status: Literal['completed', 'failed']

    # Output information
    output_image_urls: Optional[List[str]] = None
    comfyui_output_filename: Optional[str] = None
    comfyui_output_subfolder: Optional[str] = None
    comfyui_output_type: Optional[str] = None

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
    image_jobs: List[Dict[str, Any]] = []  # Named image_jobs for frontend compatibility
    total_count: int = 0
    error: Optional[str] = None
