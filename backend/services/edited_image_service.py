import os
from typing import Tuple, Optional, List
from datetime import datetime
from supabase import create_client, Client

from models.edited_image import EditedImage, CreateEditedImagePayload, UpdateEditedImagePayload, ImageEditStatus

class EditedImageService:
    def __init__(self):
        self.supabase: Client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_ANON_KEY")
        )

    async def create_edited_image(self, payload: CreateEditedImagePayload) -> Tuple[bool, Optional[str], Optional[str]]:
        """Create a new edited image record"""
        try:
            data = {
                "source_image_url": payload.source_image_url,
                "prompt": payload.prompt,
                "workflow_name": payload.workflow_name,
                "model_used": payload.model_used,
                "user_ip": payload.user_ip,
                "status": ImageEditStatus.PENDING.value
            }
            
            result = self.supabase.table("edited_images").insert(data).execute()
            
            if result.data and len(result.data) > 0:
                return True, result.data[0]["id"], None
            else:
                return False, None, "Failed to create edited image record"
                
        except Exception as e:
            return False, None, str(e)

    async def update_edited_image(self, image_id: str, payload: UpdateEditedImagePayload) -> Tuple[bool, Optional[EditedImage], Optional[str]]:
        """Update an edited image record"""
        try:
            data = {}
            if payload.result_image_url is not None:
                data["result_image_url"] = payload.result_image_url
            if payload.status is not None:
                data["status"] = payload.status.value
            if payload.processing_time_seconds is not None:
                data["processing_time_seconds"] = payload.processing_time_seconds
            if payload.model_used is not None:
                data["model_used"] = payload.model_used
            
            if not data:
                return False, None, "No data to update"
            
            result = self.supabase.table("edited_images").update(data).eq("id", image_id).execute()
            
            if result.data and len(result.data) > 0:
                edited_image = EditedImage(**result.data[0])
                return True, edited_image, None
            else:
                return False, None, "Failed to update edited image record"
                
        except Exception as e:
            return False, None, str(e)

    async def get_edited_image(self, image_id: str) -> Tuple[bool, Optional[EditedImage], Optional[str]]:
        """Get a single edited image by ID"""
        try:
            result = self.supabase.table("edited_images").select("*").eq("id", image_id).execute()
            
            if result.data and len(result.data) > 0:
                edited_image = EditedImage(**result.data[0])
                return True, edited_image, None
            else:
                return False, None, "Edited image not found"
                
        except Exception as e:
            return False, None, str(e)

    async def get_recent_edited_images(self, limit: int = 20, offset: int = 0) -> Tuple[bool, List[EditedImage], int, Optional[str]]:
        """Get recent edited images for the generation feed"""
        try:
            # Get total count
            count_result = self.supabase.table("edited_images").select("*", count="exact").execute()
            total_count = count_result.count if count_result.count else 0
            
            # Get paginated results
            result = self.supabase.table("edited_images")\
                .select("*")\
                .order("created_at", desc=True)\
                .range(offset, offset + limit - 1)\
                .execute()
            
            if result.data:
                edited_images = [EditedImage(**item) for item in result.data]
                return True, edited_images, total_count, None
            else:
                return True, [], total_count, None
                
        except Exception as e:
            return False, [], 0, str(e)

    async def get_completed_edited_images(self, limit: int = 20, offset: int = 0) -> Tuple[bool, List[EditedImage], int, Optional[str]]:
        """Get only completed edited images with result images"""
        try:
            # Get total count of completed images
            count_result = self.supabase.table("edited_images")\
                .select("*", count="exact")\
                .eq("status", ImageEditStatus.COMPLETED.value)\
                .not_.is_("result_image_url", "null")\
                .execute()
            total_count = count_result.count if count_result.count else 0
            
            # Get paginated results
            result = self.supabase.table("edited_images")\
                .select("*")\
                .eq("status", ImageEditStatus.COMPLETED.value)\
                .not_.is_("result_image_url", "null")\
                .order("created_at", desc=True)\
                .range(offset, offset + limit - 1)\
                .execute()
            
            if result.data:
                edited_images = [EditedImage(**item) for item in result.data]
                return True, edited_images, total_count, None
            else:
                return True, [], total_count, None
                
        except Exception as e:
            return False, [], 0, str(e)

    async def update_to_processing(self, image_id: str) -> Tuple[bool, Optional[str]]:
        """Update an image status to processing"""
        try:
            result = self.supabase.table("edited_images")\
                .update({"status": ImageEditStatus.PROCESSING.value})\
                .eq("id", image_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                return True, None
            else:
                return False, "Failed to update status to processing"
                
        except Exception as e:
            return False, str(e)

    async def complete_edited_image(self, image_id: str, result_image_url: str, processing_time_seconds: Optional[int] = None, model_used: Optional[str] = None) -> Tuple[bool, Optional[EditedImage], Optional[str]]:
        """Mark an edited image as completed with result URL"""
        try:
            data = {
                "result_image_url": result_image_url,
                "status": ImageEditStatus.COMPLETED.value
            }
            
            if processing_time_seconds is not None:
                data["processing_time_seconds"] = processing_time_seconds
            if model_used is not None:
                data["model_used"] = model_used
            
            result = self.supabase.table("edited_images").update(data).eq("id", image_id).execute()
            
            if result.data and len(result.data) > 0:
                edited_image = EditedImage(**result.data[0])
                return True, edited_image, None
            else:
                return False, None, "Failed to complete edited image"
                
        except Exception as e:
            return False, None, str(e)

    async def fail_edited_image(self, image_id: str, error_message: str) -> Tuple[bool, Optional[str]]:
        """Mark an edited image as failed"""
        try:
            result = self.supabase.table("edited_images")\
                .update({
                    "status": ImageEditStatus.FAILED.value,
                    "model_used": f"Error: {error_message}"
                })\
                .eq("id", image_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                return True, None
            else:
                return False, "Failed to update status to failed"
                
        except Exception as e:
            return False, str(e)