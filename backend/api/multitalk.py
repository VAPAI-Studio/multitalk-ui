from fastapi import APIRouter, Request, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
import uuid
import base64

from services.storage_service import StorageService
from services.comfyui_service import ComfyUIService
from services.workflow_service import WorkflowService

router = APIRouter()

class MultiTalkParametersRequest(BaseModel):
    """Request model for MultiTalk with parameters"""
    image_data: str  # Base64 data URL for image
    audio_filename: str  # Audio filename after upload
    width: int = 640
    height: int = 360
    mode: str = "multitalk"  # "multitalk" or "infinitetalk"
    audio_scale: float = 1.0
    custom_prompt: str = "a woman is talking"
    trim_to_audio: bool = True
    audio_end_time: Optional[float] = None
    comfy_url: Optional[str] = "https://comfy.vapai.studio"

def get_storage_service() -> StorageService:
    return StorageService()

def get_comfyui_service() -> ComfyUIService:
    return ComfyUIService()

def get_workflow_service() -> WorkflowService:
    return WorkflowService()

def get_client_ip(request: Request) -> str:
    """Extract client IP from request headers"""
    real_ip = request.headers.get("x-real-ip")
    forwarded_for = request.headers.get("x-forwarded-for")
    
    if real_ip:
        return real_ip
    elif forwarded_for:
        return forwarded_for.split(",")[0].strip()
    
    return request.client.host if request.client else "unknown"

@router.post("/upload-audio")
async def upload_audio_to_comfyui(
    request: Request,
    audio: UploadFile = File(...),
    comfy_url: str = Form("https://comfy.vapai.studio")
):
    """Upload audio file to ComfyUI and return filename"""
    try:
        comfyui_service = get_comfyui_service()
        
        # Read audio file content and get filename
        audio_content = await audio.read()
        filename = audio.filename or "audio.wav"
        
        # Upload audio to ComfyUI
        success, audio_filename, error = await comfyui_service.upload_audio(comfy_url, audio_content, filename)
        
        if not success:
            return {
                "success": False,
                "error": f"Failed to upload audio: {error}"
            }
        
        # audio_filename is already extracted by the service
        
        return {
            "success": True,
            "audio_filename": audio_filename,
            "error": None
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@router.post("/submit-with-template")
async def submit_multitalk_with_template(
    request: Request,
    multitalk_request: MultiTalkParametersRequest
):
    """Submit a MultiTalk video generation using backend template system"""
    try:
        comfyui_service = get_comfyui_service()
        workflow_service = get_workflow_service()
        
        # Extract base64 data from data URL
        image_base64 = multitalk_request.image_data.split(',')[1] if ',' in multitalk_request.image_data else multitalk_request.image_data
        
        # Choose template based on mode
        template_name = "infinite_talk_one_person" if multitalk_request.mode == "infinitetalk" else "multitalk_one_person"
        
        # Build workflow parameters
        workflow_params = {
            "BASE64_IMAGE": image_base64,
            "AUDIO_FILENAME": multitalk_request.audio_filename,
            "WIDTH": multitalk_request.width,
            "HEIGHT": multitalk_request.height,
            "CUSTOM_PROMPT": multitalk_request.custom_prompt,
            "TRIM_TO_AUDIO": multitalk_request.trim_to_audio
        }
        
        # Add mode-specific parameters
        if multitalk_request.mode == "infinitetalk":
            workflow_params["AUDIO_SCALE"] = multitalk_request.audio_scale
            if multitalk_request.audio_end_time:
                workflow_params["AUDIO_END_TIME"] = str(int(multitalk_request.audio_end_time))
        
        # Build workflow from template
        workflow_success, workflow_json, workflow_error = await workflow_service.build_workflow(
            template_name, 
            workflow_params
        )
        
        if not workflow_success:
            return {
                "success": False,
                "error": f"Failed to build workflow: {workflow_error}"
            }
        
        # Submit to ComfyUI
        comfy_url = multitalk_request.comfy_url or "https://comfy.vapai.studio"
        
        # ComfyUI expects the workflow wrapped in a "prompt" field with a client_id
        comfyui_payload = {
            "prompt": workflow_json,
            "client_id": f"multitalk-{uuid.uuid4().hex[:8]}"
        }
        
        submit_success, prompt_id, submit_error = await comfyui_service.submit_prompt(
            comfy_url, 
            comfyui_payload
        )
        
        if not submit_success:
            return {
                "success": False,
                "error": submit_error or "Failed to submit to ComfyUI"
            }
        
        # Return success with the prompt ID for polling
        return {
            "success": True,
            "prompt_id": prompt_id,
            "error": None
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@router.get("/templates")
async def list_multitalk_templates():
    """List available MultiTalk workflow templates"""
    try:
        workflow_service = get_workflow_service()
        all_templates = workflow_service.list_templates()
        
        # Filter to only MultiTalk templates
        multitalk_templates = {
            name: desc for name, desc in all_templates.items() 
            if "multitalk" in name.lower() or "infinite" in name.lower()
        }
        
        return {
            "success": True,
            "templates": multitalk_templates
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }