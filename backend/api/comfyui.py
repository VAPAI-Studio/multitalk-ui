from fastapi import APIRouter, Query, UploadFile, File, HTTPException
from typing import Optional, Dict, Any
from pydantic import BaseModel

from models.comfyui import ComfyUIStatusResponse
from services.comfyui_service import ComfyUIService

# Request/Response models
class PromptRequest(BaseModel):
    base_url: str
    prompt: Dict[str, Any]
    client_id: str

class PromptResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None
    error: Optional[str] = None

class AudioUploadResponse(BaseModel):
    success: bool
    filename: Optional[str] = None
    error: Optional[str] = None

class HistoryResponse(BaseModel):
    success: bool
    history: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

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

@router.post("/upload-audio", response_model=AudioUploadResponse)
async def upload_audio(
    base_url: str = Query(..., description="ComfyUI server URL"),
    audio: UploadFile = File(..., description="Audio file to upload")
):
    """Upload audio file to ComfyUI server"""
    try:
        if not audio.filename:
            raise HTTPException(status_code=400, detail="No filename provided")
            
        # Read the audio data
        audio_data = await audio.read()
        
        comfyui_service = get_comfyui_service()
        success, filename, error = await comfyui_service.upload_audio(
            base_url, audio_data, audio.filename
        )
        
        return AudioUploadResponse(
            success=success,
            filename=filename,
            error=error
        )
        
    except Exception as e:
        return AudioUploadResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )

@router.post("/submit-prompt", response_model=PromptResponse)
async def submit_prompt(request: PromptRequest):
    """Submit workflow prompt to ComfyUI"""
    try:
        comfyui_service = get_comfyui_service()
        
        # Build the prompt payload
        payload = {
            "prompt": request.prompt,
            "client_id": request.client_id
        }
        
        success, prompt_id, error = await comfyui_service.submit_prompt(
            request.base_url, payload
        )
        
        return PromptResponse(
            success=success,
            prompt_id=prompt_id,
            error=error
        )
        
    except Exception as e:
        return PromptResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )

@router.get("/history/{job_id}", response_model=HistoryResponse)
async def get_history(
    job_id: str,
    base_url: str = Query(..., description="ComfyUI server URL")
):
    """Get job history/status from ComfyUI"""
    try:
        comfyui_service = get_comfyui_service()
        success, history_data, error = await comfyui_service.get_history(base_url, job_id)
        
        return HistoryResponse(
            success=success,
            history=history_data,
            error=error
        )
        
    except Exception as e:
        return HistoryResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )