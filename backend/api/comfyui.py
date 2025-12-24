import os
from fastapi import APIRouter, Query, UploadFile, File, HTTPException
from typing import Optional, Dict, Any
from pydantic import BaseModel

from models.comfyui import ComfyUIStatusResponse
from services.comfyui_service import ComfyUIService
from services.workflow_service import WorkflowService

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

class WorkflowSubmitRequest(BaseModel):
    workflow_name: str
    parameters: Dict[str, Any]
    client_id: str
    base_url: str
    comfyui_api_key: Optional[str] = None  # ComfyUI API key for paid nodes (Gemini, etc.)

class WorkflowSubmitResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None
    workflow_name: Optional[str] = None
    error: Optional[str] = None

router = APIRouter(prefix="/comfyui", tags=["comfyui"])

def get_comfyui_service():
    return ComfyUIService()

def get_workflow_service():
    return WorkflowService()

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

@router.post("/upload-image", response_model=AudioUploadResponse)  # Reusing AudioUploadResponse as it has the same structure
async def upload_image(
    base_url: str = Query(..., description="ComfyUI server URL"),
    image: UploadFile = File(..., description="Image file to upload")
):
    """Upload image file to ComfyUI server"""
    try:
        if not image.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        # Read the image data
        image_data = await image.read()

        comfyui_service = get_comfyui_service()
        # Reusing upload_audio method as ComfyUI uses the same endpoint for both
        success, filename, error = await comfyui_service.upload_audio(
            base_url, image_data, image.filename
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

@router.post("/submit-workflow", response_model=WorkflowSubmitResponse)
async def submit_workflow(request: WorkflowSubmitRequest):
    """
    Submit a workflow to ComfyUI using a template and parameters

    This is the standardized endpoint for all workflow submissions.
    It loads the workflow template from backend, fills in parameters,
    validates, and submits to ComfyUI.

    Example:
        {
            "workflow_name": "VideoLipsync",
            "parameters": {
                "VIDEO_FILENAME": "video.mp4",
                "AUDIO_FILENAME": "audio.wav",
                "WIDTH": 640,
                "HEIGHT": 360
            },
            "client_id": "my-client-123",
            "base_url": "https://comfy.vapai.studio"
        }
    """
    try:
        workflow_service = get_workflow_service()
        comfyui_service = get_comfyui_service()

        # Load and build workflow from template
        success, workflow, error = await workflow_service.build_workflow(
            request.workflow_name,
            request.parameters
        )

        if not success:
            return WorkflowSubmitResponse(
                success=False,
                error=f"Failed to build workflow: {error}"
            )

        # Validate workflow
        is_valid, validation_error = await workflow_service.validate_workflow(workflow)
        if not is_valid:
            return WorkflowSubmitResponse(
                success=False,
                error=f"Workflow validation failed: {validation_error}"
            )

        # Submit to ComfyUI
        payload = {
            "prompt": workflow,
            "client_id": request.client_id
        }

        # Add ComfyUI API key if provided (required for paid API nodes like Gemini)
        # First check request, then fall back to environment variable
        api_key = request.comfyui_api_key or os.getenv("COMFY_API_KEY")
        if api_key:
            payload["extra_data"] = {
                "api_key_comfy_org": api_key
            }

        success, prompt_id, error = await comfyui_service.submit_prompt(
            request.base_url,
            payload
        )

        return WorkflowSubmitResponse(
            success=success,
            prompt_id=prompt_id,
            workflow_name=request.workflow_name,
            error=error
        )

    except Exception as e:
        return WorkflowSubmitResponse(
            success=False,
            error=f"Server error: {str(e)}"
        )

@router.get("/workflows")
async def list_workflows():
    """List all available workflow templates"""
    try:
        workflow_service = get_workflow_service()
        templates = workflow_service.list_templates()

        return {
            "success": True,
            "workflows": templates
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Server error: {str(e)}"
        }

@router.get("/workflows/{workflow_name}/parameters")
async def get_workflow_parameters(workflow_name: str):
    """Get the required parameters for a specific workflow template"""
    try:
        workflow_service = get_workflow_service()
        success, parameters, error = await workflow_service.get_template_parameters(workflow_name)

        if not success:
            raise HTTPException(status_code=404, detail=error)

        return {
            "success": True,
            "workflow_name": workflow_name,
            "parameters": parameters
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "error": f"Server error: {str(e)}"
        }