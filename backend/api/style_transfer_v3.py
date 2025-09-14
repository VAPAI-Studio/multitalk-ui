from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional
import uuid

from models.style_transfer import CreateStyleTransferPayload, UpdateStyleTransferPayload
from services.style_transfer_service import StyleTransferService
from services.storage_service import StorageService
from services.comfyui_service import ComfyUIService
from services.workflow_service import WorkflowService

router = APIRouter()

class StyleTransferParametersRequest(BaseModel):
    """Request model for style transfer with parameters (new approach)"""
    subject_image_data: str  # Base64 data URL for subject image
    style_image_data: str    # Base64 data URL for style image
    prompt: str
    width: int = 1024
    height: int = 1024
    comfy_url: Optional[str] = "https://comfy.vapai.studio"

class CompleteStyleTransferRequest(BaseModel):
    """Request model for completing style transfer with result upload"""
    result_url: str  # ComfyUI result URL

def get_style_transfer_service() -> StyleTransferService:
    return StyleTransferService()

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

@router.post("/submit-with-template")
async def submit_style_transfer_with_template(
    request: Request,
    style_request: StyleTransferParametersRequest
):
    """Submit a style transfer using backend template system"""
    try:
        storage_service = get_storage_service()
        style_transfer_service = get_style_transfer_service()
        comfyui_service = get_comfyui_service()
        workflow_service = get_workflow_service()
        
        # Step 1: Upload subject image to Supabase storage
        subject_upload_success, subject_storage_url, subject_error = await storage_service.upload_image_from_data_url(
            style_request.subject_image_data, "style-transfer-sources"
        )
        
        if not subject_upload_success:
            return {
                "success": False,
                "error": f"Failed to upload subject image: {subject_error}"
            }
        
        # Step 2: Upload style image to Supabase storage  
        style_upload_success, style_storage_url, style_error = await storage_service.upload_image_from_data_url(
            style_request.style_image_data, "style-transfer-sources"
        )
        
        if not style_upload_success:
            return {
                "success": False,
                "error": f"Failed to upload style image: {style_error}"
            }
        
        # Step 3: Create style transfer record in database with proper URLs
        create_payload = CreateStyleTransferPayload(
            source_image_url=subject_storage_url,  # Supabase URL
            style_image_url=style_storage_url,      # Supabase URL
            prompt=style_request.prompt,
            workflow_name="StyleTransfer",
            user_ip=get_client_ip(request)
        )
        
        create_success, transfer_id, create_error = await style_transfer_service.create_style_transfer(create_payload)
        
        if not create_success:
            return {
                "success": False,
                "error": f"Failed to create style transfer record: {create_error}"
            }
        
        # Step 4: Update status to processing
        await style_transfer_service.update_to_processing(transfer_id)
        
        # Step 5: Build workflow from template using WorkflowService
        # Extract base64 data from data URLs for workflow
        subject_base64 = style_request.subject_image_data.split(',')[1] if ',' in style_request.subject_image_data else style_request.subject_image_data
        style_base64 = style_request.style_image_data.split(',')[1] if ',' in style_request.style_image_data else style_request.style_image_data
        
        workflow_params = {
            "SUBJECT_IMAGE": subject_base64,
            "STYLE_IMAGE": style_base64,
            "CUSTOM_PROMPT": style_request.prompt,
            "WIDTH": style_request.width,
            "HEIGHT": style_request.height
        }
        
        workflow_success, workflow_json, workflow_error = await workflow_service.build_workflow(
            "style_transfer_v1", 
            workflow_params
        )
        
        if not workflow_success:
            # Mark as failed in database
            await style_transfer_service.fail_style_transfer(
                transfer_id, 
                f"Failed to build workflow: {workflow_error}"
            )
            return {
                "success": False,
                "error": f"Failed to build workflow: {workflow_error}"
            }
        
        # Step 6: Submit to ComfyUI with proper format
        comfy_url = style_request.comfy_url or "https://comfy.vapai.studio"
        
        # ComfyUI expects the workflow wrapped in a "prompt" field with a client_id
        comfyui_payload = {
            "prompt": workflow_json,
            "client_id": f"style-transfer-{uuid.uuid4().hex[:8]}"
        }
        
        submit_success, prompt_id, submit_error = await comfyui_service.submit_prompt(
            comfy_url, 
            comfyui_payload
        )
        
        if not submit_success:
            # Mark as failed in database
            await style_transfer_service.fail_style_transfer(
                transfer_id, 
                submit_error or "Failed to submit to ComfyUI"
            )
            return {
                "success": False,
                "error": submit_error or "Failed to submit to ComfyUI"
            }
        
        # Step 7: Update the style transfer with ComfyUI prompt ID
        await style_transfer_service.update_style_transfer(
            transfer_id,
            UpdateStyleTransferPayload(comfyui_prompt_id=prompt_id)
        )
        
        # Return success with the transfer ID and prompt ID
        return {
            "success": True,
            "style_transfer_id": transfer_id,
            "prompt_id": prompt_id,
            "error": None
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@router.post("/complete-with-upload/{transfer_id}")
async def complete_style_transfer_with_upload(
    transfer_id: str,
    request: CompleteStyleTransferRequest
):
    """Complete a style transfer by uploading the result to Supabase storage"""
    try:
        storage_service = get_storage_service()
        style_transfer_service = get_style_transfer_service()
        
        # Upload result image to Supabase storage
        result_url = request.result_url
        if result_url.startswith('data:image/'):
            # Handle data URL
            upload_success, storage_url, upload_error = await storage_service.upload_image_from_data_url(
                result_url, "style-transfer-results"
            )
        else:
            # Handle regular URL from ComfyUI - download and upload
            upload_success, storage_url, upload_error = await storage_service.upload_image_from_url(
                result_url, "style-transfer-results"
            )
        
        if not upload_success:
            # Mark as failed
            await style_transfer_service.fail_style_transfer(
                transfer_id,
                f"Failed to upload result: {upload_error}"
            )
            return {
                "success": False,
                "error": f"Failed to upload result: {upload_error}"
            }
        
        # Complete the style transfer with the Supabase storage URL
        complete_success, style_transfer, complete_error = await style_transfer_service.complete_style_transfer(
            transfer_id,
            storage_url,  # Supabase storage URL
            None,  # processing_time_seconds (optional)
            "Flux Style Transfer"  # model_used
        )
        
        return {
            "success": complete_success,
            "style_transfer": style_transfer,
            "error": complete_error
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@router.get("/templates")
async def list_workflow_templates():
    """List available workflow templates"""
    try:
        workflow_service = get_workflow_service()
        templates = workflow_service.list_templates()
        
        return {
            "success": True,
            "templates": templates
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@router.get("/templates/{template_name}/parameters")
async def get_template_parameters(template_name: str):
    """Get required parameters for a specific template"""
    try:
        workflow_service = get_workflow_service()
        success, parameters, error = await workflow_service.get_template_parameters(template_name)
        
        if not success:
            return {
                "success": False,
                "error": error
            }
        
        return {
            "success": True,
            "parameters": parameters
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }