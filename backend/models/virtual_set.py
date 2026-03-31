from pydantic import BaseModel
from typing import Optional, List, Literal


class MultiImageInput(BaseModel):
    image_data: str  # data:image/...;base64,...
    azimuth: Optional[int] = None  # 0-360 degrees


class VirtualSetGenerateRequest(BaseModel):
    prompt_type: Literal["image", "multi-image", "video"] = "image"

    # For ImagePrompt (single image)
    image_data: Optional[str] = None  # data:image/...;base64,...

    # For MultiImagePrompt
    images: Optional[List[MultiImageInput]] = None
    reconstruct_images: bool = False

    # For VideoPrompt (URL from prior upload)
    video_url: Optional[str] = None

    # Common
    text_prompt: Optional[str] = None
    display_name: str = "Virtual Set Scene"
    model: str = "Marble 0.1-plus"  # or "Marble 0.1-mini"

class VirtualSetGenerateResponse(BaseModel):
    success: bool
    operation_id: Optional[str] = None
    error: Optional[str] = None

class VirtualSetStatusResponse(BaseModel):
    success: bool
    done: bool = False
    splat_url: Optional[str] = None
    world_id: Optional[str] = None
    error: Optional[str] = None

class VirtualSetSaveWorldRequest(BaseModel):
    image_data: str  # original image data URL (for thumbnail in feed)
    splat_url: str
    world_id: Optional[str] = None
    model: str = "Marble 0.1-plus"
    prompt_type: Optional[str] = "image"  # "image", "multi-image", or "video"

class VirtualSetSaveWorldResponse(BaseModel):
    success: bool
    job_id: Optional[str] = None
    error: Optional[str] = None

class VirtualSetReconstructRequest(BaseModel):
    screenshot_data: str  # data:image/png;base64,... from canvas
    original_image_data: str  # reference image (data URL or storage URL)
    prompt: str = ""
    comfy_url: str  # ComfyUI server URL
    client_id: str = ""  # optional client ID for WebSocket tracking

class VirtualSetReconstructResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None  # ComfyUI prompt ID for polling
    job_id: Optional[str] = None
    image_url: Optional[str] = None  # kept for potential future use
    error: Optional[str] = None

class VirtualSetGenerateAssetRequest(BaseModel):
    image_front: str  # data:image/...;base64,...
    image_back: Optional[str] = None  # data:image/...;base64,... (if not provided, use image_front)
    asset_name: str = "3D Asset"
    comfy_url: str  # ComfyUI server URL
    client_id: str = ""  # optional client ID for WebSocket tracking

class VirtualSetGenerateAssetResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None  # ComfyUI prompt ID for polling
    job_id: Optional[str] = None  # Database job ID
    error: Optional[str] = None
