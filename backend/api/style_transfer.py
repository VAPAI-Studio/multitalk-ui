from fastapi import APIRouter, Query, Request
from typing import List, Optional
import time

from models.style_transfer import StyleTransfer, CreateStyleTransferPayload, UpdateStyleTransferPayload, StyleTransferListResponse, StyleTransferResponse
from services.style_transfer_service import StyleTransferService
from services.storage_service import StorageService
from services.comfyui_service import ComfyUIService

router = APIRouter()

def get_style_transfer_service() -> StyleTransferService:
    return StyleTransferService()

def get_storage_service() -> StorageService:
    return StorageService()

def get_comfyui_service() -> ComfyUIService:
    return ComfyUIService()

def get_client_ip(request: Request) -> str:
    """Extract client IP from request headers"""
    real_ip = request.headers.get("x-real-ip")
    forwarded_for = request.headers.get("x-forwarded-for")
    
    if real_ip:
        return real_ip
    elif forwarded_for:
        return forwarded_for.split(",")[0].strip()
    
    return request.client.host if request.client else "unknown"

@router.post("/", response_model=StyleTransferResponse)
async def create_style_transfer(payload: CreateStyleTransferPayload, request: Request):
    """Create a new style transfer record"""
    try:
        style_transfer_service = get_style_transfer_service()
        
        # Add client IP to payload
        payload.user_ip = get_client_ip(request)
        
        success, transfer_id, error = await style_transfer_service.create_style_transfer(payload)
        
        if success:
            # Get the created record
            success, style_transfer, error = await style_transfer_service.get_style_transfer(transfer_id)
            if success:
                return StyleTransferResponse(
                    success=True,
                    style_transfer=style_transfer,
                    error=None
                )
        
        return StyleTransferResponse(
            success=False,
            error=error or "Failed to create style transfer"
        )
        
    except Exception as e:
        return StyleTransferResponse(success=False, error=str(e))

@router.get("/{transfer_id}", response_model=StyleTransferResponse)
async def get_style_transfer(transfer_id: str):
    """Get a style transfer by ID"""
    try:
        style_transfer_service = get_style_transfer_service()
        success, style_transfer, error = await style_transfer_service.get_style_transfer(transfer_id)
        
        return StyleTransferResponse(
            success=success,
            style_transfer=style_transfer,
            error=error
        )
        
    except Exception as e:
        return StyleTransferResponse(success=False, error=str(e))

@router.put("/{transfer_id}", response_model=StyleTransferResponse)
async def update_style_transfer(transfer_id: str, payload: UpdateStyleTransferPayload):
    """Update a style transfer record"""
    try:
        style_transfer_service = get_style_transfer_service()
        success, style_transfer, error = await style_transfer_service.update_style_transfer(transfer_id, payload)
        
        return StyleTransferResponse(
            success=success,
            style_transfer=style_transfer,
            error=error
        )
        
    except Exception as e:
        return StyleTransferResponse(success=False, error=str(e))

@router.put("/{transfer_id}/processing")
async def update_to_processing(transfer_id: str):
    """Update style transfer status to processing"""
    try:
        style_transfer_service = get_style_transfer_service()
        success, error = await style_transfer_service.update_to_processing(transfer_id)
        
        return {"success": success, "error": error}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.put("/{transfer_id}/complete")
async def complete_style_transfer(
    transfer_id: str, 
    result_image_url: str = Query(...),
    processing_time_seconds: Optional[int] = Query(None),
    model_used: Optional[str] = Query(None)
):
    """Complete a style transfer with result image"""
    try:
        style_transfer_service = get_style_transfer_service()
        success, style_transfer, error = await style_transfer_service.complete_style_transfer(
            transfer_id, result_image_url, processing_time_seconds, model_used
        )
        
        return {"success": success, "style_transfer": style_transfer, "error": error}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.put("/{transfer_id}/fail")
async def fail_style_transfer(transfer_id: str, error_message: str = Query(...)):
    """Mark a style transfer as failed"""
    try:
        style_transfer_service = get_style_transfer_service()
        success, style_transfer, error = await style_transfer_service.fail_style_transfer(transfer_id, error_message)
        
        return {"success": success, "style_transfer": style_transfer, "error": error}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/", response_model=StyleTransferListResponse)
async def get_recent_style_transfers(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    completed_only: bool = Query(False, description="Return only completed transfers with results")
):
    """Get recent style transfers for the generation feed"""
    try:
        style_transfer_service = get_style_transfer_service()
        
        if completed_only:
            success, style_transfers, total_count, error = await style_transfer_service.get_completed_style_transfers(limit, offset)
        else:
            success, style_transfers, total_count, error = await style_transfer_service.get_recent_style_transfers(limit, offset)
        
        return StyleTransferListResponse(
            success=success,
            style_transfers=style_transfers,
            total_count=total_count,
            error=error
        )
        
    except Exception as e:
        return StyleTransferListResponse(success=False, error=str(e))

@router.post("/submit-to-comfyui")
async def submit_style_transfer_to_comfyui(
    request: Request,
    comfy_url: str = Query(...),
    transfer_id: str = Query(...)
):
    """Submit a style transfer workflow to ComfyUI"""
    try:
        comfyui_service = get_comfyui_service()
        style_transfer_service = get_style_transfer_service()
        
        # Get the JSON data from the request body
        prompt_json = await request.json()
        
        # ComfyUI expects the workflow wrapped in a "prompt" field with a client_id
        import uuid
        comfyui_payload = {
            "prompt": prompt_json,
            "client_id": f"style-transfer-{uuid.uuid4().hex[:8]}"
        }
        
        # Submit to ComfyUI
        success, prompt_id, error = await comfyui_service.submit_prompt(comfy_url, comfyui_payload)
        
        if success:
            # Update the style transfer with the ComfyUI prompt ID
            await style_transfer_service.update_style_transfer(
                transfer_id, 
                UpdateStyleTransferPayload(comfyui_prompt_id=prompt_id)
            )
            
            return {"success": True, "prompt_id": prompt_id, "error": None}
        else:
            return {"success": False, "prompt_id": None, "error": error}
            
    except Exception as e:
        return {"success": False, "prompt_id": None, "error": str(e)}
