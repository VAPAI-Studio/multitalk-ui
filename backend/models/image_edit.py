from pydantic import BaseModel
from typing import Optional

class ImageEditRequest(BaseModel):
    image_data: str  # Base64 encoded image
    prompt: str
    
class ImageEditResponse(BaseModel):
    success: bool
    image_url: Optional[str] = None
    error: Optional[str] = None