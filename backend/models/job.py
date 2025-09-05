from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime

JobStatus = Literal['submitted', 'processing', 'completed', 'error']

class MultiTalkJob(BaseModel):
    job_id: str = Field(..., description="Primary key from ComfyUI")
    status: JobStatus = Field(..., description="Current job status")
    timestamp_submitted: datetime = Field(..., description="When job was submitted")
    timestamp_completed: Optional[datetime] = Field(None, description="When job was completed")
    filename: Optional[str] = Field(None, description="Output filename")
    subfolder: Optional[str] = Field(None, description="Output subfolder")
    image_filename: Optional[str] = Field(None, description="Input image filename")
    audio_filename: Optional[str] = Field(None, description="Input audio filename")
    width: int = Field(..., description="Video width")
    height: int = Field(..., description="Video height")
    trim_to_audio: bool = Field(..., description="Whether to trim video to audio length")
    comfy_url: str = Field(..., description="ComfyUI server URL")
    error_message: Optional[str] = Field(None, description="Error message if job failed")
    video_url: Optional[str] = Field(None, description="Supabase Storage URL for video")
    # workflow_type removed - not in database schema
    created_at: Optional[datetime] = Field(None, description="Database creation timestamp")
    updated_at: Optional[datetime] = Field(None, description="Database update timestamp")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }

class CreateJobPayload(BaseModel):
    job_id: str
    comfy_url: str
    image_filename: Optional[str] = None
    audio_filename: Optional[str] = None
    width: int
    height: int
    trim_to_audio: bool
    # workflow_type removed - not in database schema

class CompleteJobPayload(BaseModel):
    job_id: str
    status: Literal['completed', 'error']
    filename: Optional[str] = None
    subfolder: Optional[str] = None
    error_message: Optional[str] = None
    video_url: Optional[str] = None
    comfy_url: Optional[str] = None  # Add comfy_url to avoid database lookup
    video_type: Optional[str] = None  # Add video_type to use correct ComfyUI type

class JobResponse(BaseModel):
    success: bool
    error: Optional[str] = None
    job: Optional[MultiTalkJob] = None

class JobListResponse(BaseModel):
    success: bool
    jobs: list[MultiTalkJob] = []
    error: Optional[str] = None