from fastapi import APIRouter, Query
from typing import Optional

from models.comfyui import ComfyUIStatusResponse
from services.comfyui_service import ComfyUIService

router = APIRouter(prefix="/comfyui", tags=["comfyui"])

def get_comfyui_service():
    return ComfyUIService()

@router.get("/status", response_model=ComfyUIStatusResponse)
async def get_comfyui_status(base_url: Optional[str] = Query(None, description="Custom ComfyUI server URL")):
    """Get ComfyUI server status including queue and system information"""
    try:
        comfyui_service = get_comfyui_service()
        success, status, error = await comfyui_service.get_status(base_url)
        
        return ComfyUIStatusResponse(
            success=success,
            status=status,
            error=error
        )
        
    except Exception as e:
        return ComfyUIStatusResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )