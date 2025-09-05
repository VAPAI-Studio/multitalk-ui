from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum

class StyleTransferStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class StyleTransfer(BaseModel):
    id: str
    created_at: datetime
    source_image_url: str
    style_image_url: str
    prompt: str
    result_image_url: Optional[str] = None
    workflow_name: str = "StyleTransfer"
    model_used: Optional[str] = None
    processing_time_seconds: Optional[int] = None
    user_ip: Optional[str] = None
    status: StyleTransferStatus = StyleTransferStatus.PENDING
    comfyui_prompt_id: Optional[str] = None
    error_message: Optional[str] = None
    updated_at: Optional[datetime] = None

class CreateStyleTransferPayload(BaseModel):
    source_image_url: str
    style_image_url: str
    prompt: str
    workflow_name: str = "StyleTransfer"
    user_ip: Optional[str] = None

class UpdateStyleTransferPayload(BaseModel):
    result_image_url: Optional[str] = None
    model_used: Optional[str] = None
    processing_time_seconds: Optional[int] = None
    status: Optional[StyleTransferStatus] = None
    comfyui_prompt_id: Optional[str] = None
    error_message: Optional[str] = None

class StyleTransferResponse(BaseModel):
    success: bool
    style_transfer: Optional[StyleTransfer] = None
    error: Optional[str] = None

class StyleTransferListResponse(BaseModel):
    success: bool
    style_transfers: List[StyleTransfer] = []
    total_count: int = 0
    error: Optional[str] = None
