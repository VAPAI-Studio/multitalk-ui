from pydantic import BaseModel
from typing import Optional

class UploadVideoPayload(BaseModel):
    comfy_url: str
    filename: str
    subfolder: str
    job_id: str

class VideoUploadResponse(BaseModel):
    success: bool
    public_url: Optional[str] = None
    error: Optional[str] = None

class VideoFile(BaseModel):
    name: str
    public_url: str

class VideoListResponse(BaseModel):
    success: bool
    files: list[VideoFile] = []
    error: Optional[str] = None

class DeleteVideoResponse(BaseModel):
    success: bool
    error: Optional[str] = None