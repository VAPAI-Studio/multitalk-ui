from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from enum import Enum

class ImageEditStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class EditedImage(BaseModel):
    id: str
    created_at: datetime
    source_image_url: str
    prompt: str
    result_image_url: Optional[str] = None
    workflow_name: str = "image-edit"
    model_used: Optional[str] = None
    processing_time_seconds: Optional[int] = None
    user_ip: Optional[str] = None
    status: ImageEditStatus = ImageEditStatus.PENDING

class CreateEditedImagePayload(BaseModel):
    source_image_url: str
    prompt: str
    workflow_name: str = "image-edit"
    model_used: Optional[str] = None
    user_ip: Optional[str] = None

class UpdateEditedImagePayload(BaseModel):
    result_image_url: Optional[str] = None
    status: Optional[ImageEditStatus] = None
    processing_time_seconds: Optional[int] = None
    model_used: Optional[str] = None

class EditedImageResponse(BaseModel):
    success: bool
    edited_image: Optional[EditedImage] = None
    error: Optional[str] = None

class EditedImageListResponse(BaseModel):
    success: bool
    edited_images: list[EditedImage] = []
    total_count: int = 0
    error: Optional[str] = None