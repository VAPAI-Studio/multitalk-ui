from fastapi import APIRouter, HTTPException
from typing import List, Optional

from models.storage import (
    UploadVideoPayload,
    VideoUploadResponse,
    VideoListResponse,
    DeleteVideoResponse,
    VideoFile
)
from pydantic import BaseModel
from services.storage_service import StorageService

router = APIRouter(prefix="/storage", tags=["storage"])

class UploadImageFromUrlPayload(BaseModel):
    image_url: str
    folder: str = "images"

class ImageUploadResponse(BaseModel):
    success: bool
    public_url: Optional[str] = None
    error: Optional[str] = None

def get_storage_service():
    return StorageService()

@router.post("/images/upload-from-url", response_model=ImageUploadResponse)
async def upload_image_from_url(payload: UploadImageFromUrlPayload):
    """Download image from URL and upload to Supabase Storage"""
    storage_service = get_storage_service()
    success, public_url, error = await storage_service.upload_image_from_url(
        payload.image_url,
        payload.folder
    )

    return ImageUploadResponse(
        success=success,
        public_url=public_url,
        error=error
    )

@router.post("/videos/upload", response_model=VideoUploadResponse)
async def upload_video_to_storage(payload: UploadVideoPayload):
    """Download video from ComfyUI and upload to Supabase Storage"""
    storage_service = get_storage_service()
    success, public_url, error = await storage_service.upload_video_to_storage(
        payload.comfy_url,
        payload.filename,
        payload.subfolder,
        payload.job_id,
        payload.video_type
    )

    return VideoUploadResponse(
        success=success,
        public_url=public_url,
        error=error
    )

@router.delete("/videos", response_model=DeleteVideoResponse)
async def delete_video_from_storage(public_url: str):
    """Delete a video from Supabase Storage"""
    storage_service = get_storage_service()
    success, error = await storage_service.delete_video_from_storage(public_url)
    
    return DeleteVideoResponse(
        success=success,
        error=error
    )

@router.get("/videos", response_model=VideoListResponse)
async def list_storage_videos():
    """List all videos in Supabase Storage"""
    storage_service = get_storage_service()
    files, error = await storage_service.list_storage_videos()
    
    return VideoListResponse(
        success=error is None,
        files=files,
        error=error
    )