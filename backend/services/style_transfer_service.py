import os
from typing import Tuple, Optional, List
from datetime import datetime
from supabase import create_client, Client

from models.style_transfer import StyleTransfer, CreateStyleTransferPayload, UpdateStyleTransferPayload, StyleTransferStatus

class StyleTransferService:
    def __init__(self):
        self.supabase: Client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_ANON_KEY")
        )

    async def create_style_transfer(self, payload: CreateStyleTransferPayload) -> Tuple[bool, Optional[str], Optional[str]]:
        """Create a new style transfer record"""
        try:
            data = {
                "source_image_url": payload.source_image_url,
                "style_image_url": payload.style_image_url,
                "prompt": payload.prompt,
                "workflow_name": payload.workflow_name,
                "user_ip": payload.user_ip,
                "status": StyleTransferStatus.PENDING.value
            }
            
            result = self.supabase.table("style_transfers").insert(data).execute()
            
            if result.data and len(result.data) > 0:
                return True, result.data[0]["id"], None
            else:
                return False, None, "Failed to create style transfer record"
                
        except Exception as e:
            return False, None, str(e)

    async def update_style_transfer(self, transfer_id: str, payload: UpdateStyleTransferPayload) -> Tuple[bool, Optional[StyleTransfer], Optional[str]]:
        """Update a style transfer record"""
        try:
            update_data = {}
            
            if payload.result_image_url is not None:
                update_data["result_image_url"] = payload.result_image_url
            if payload.model_used is not None:
                update_data["model_used"] = payload.model_used
            if payload.processing_time_seconds is not None:
                update_data["processing_time_seconds"] = payload.processing_time_seconds
            if payload.status is not None:
                update_data["status"] = payload.status.value
            if payload.comfyui_prompt_id is not None:
                update_data["comfyui_prompt_id"] = payload.comfyui_prompt_id
            if payload.error_message is not None:
                update_data["error_message"] = payload.error_message
                
            result = self.supabase.table("style_transfers")\
                .update(update_data)\
                .eq("id", transfer_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                style_transfer = StyleTransfer(**result.data[0])
                return True, style_transfer, None
            else:
                return False, None, "Failed to update style transfer record"
                
        except Exception as e:
            return False, None, str(e)

    async def get_style_transfer(self, transfer_id: str) -> Tuple[bool, Optional[StyleTransfer], Optional[str]]:
        """Get a style transfer by ID"""
        try:
            result = self.supabase.table("style_transfers")\
                .select("*")\
                .eq("id", transfer_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                style_transfer = StyleTransfer(**result.data[0])
                return True, style_transfer, None
            else:
                return False, None, "Style transfer not found"
                
        except Exception as e:
            return False, None, str(e)

    async def get_recent_style_transfers(self, limit: int = 20, offset: int = 0) -> Tuple[bool, List[StyleTransfer], int, Optional[str]]:
        """Get recent style transfers"""
        try:
            # Get total count
            count_result = self.supabase.table("style_transfers")\
                .select("*", count="exact")\
                .execute()
            total_count = count_result.count if count_result.count else 0
            
            # Get paginated results
            result = self.supabase.table("style_transfers")\
                .select("*")\
                .order("created_at", desc=True)\
                .range(offset, offset + limit - 1)\
                .execute()
            
            if result.data:
                style_transfers = [StyleTransfer(**item) for item in result.data]
                return True, style_transfers, total_count, None
            else:
                return True, [], total_count, None
                
        except Exception as e:
            return False, [], 0, str(e)

    async def get_completed_style_transfers(self, limit: int = 20, offset: int = 0) -> Tuple[bool, List[StyleTransfer], int, Optional[str]]:
        """Get only completed style transfers with result images"""
        try:
            # Get total count of completed transfers
            count_result = self.supabase.table("style_transfers")\
                .select("*", count="exact")\
                .eq("status", StyleTransferStatus.COMPLETED.value)\
                .not_.is_("result_image_url", "null")\
                .execute()
            total_count = count_result.count if count_result.count else 0
            
            # Get paginated results
            result = self.supabase.table("style_transfers")\
                .select("*")\
                .eq("status", StyleTransferStatus.COMPLETED.value)\
                .not_.is_("result_image_url", "null")\
                .order("created_at", desc=True)\
                .range(offset, offset + limit - 1)\
                .execute()
            
            if result.data:
                style_transfers = [StyleTransfer(**item) for item in result.data]
                return True, style_transfers, total_count, None
            else:
                return True, [], total_count, None
                
        except Exception as e:
            return False, [], 0, str(e)

    async def update_to_processing(self, transfer_id: str) -> Tuple[bool, Optional[str]]:
        """Update a style transfer status to processing"""
        try:
            result = self.supabase.table("style_transfers")\
                .update({"status": StyleTransferStatus.PROCESSING.value})\
                .eq("id", transfer_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                return True, None
            else:
                return False, "Failed to update status to processing"
                
        except Exception as e:
            return False, str(e)

    async def complete_style_transfer(self, transfer_id: str, result_image_url: str, processing_time_seconds: Optional[int] = None, model_used: Optional[str] = None) -> Tuple[bool, Optional[StyleTransfer], Optional[str]]:
        """Complete a style transfer with result image"""
        try:
            update_data = {
                "result_image_url": result_image_url,
                "status": StyleTransferStatus.COMPLETED.value
            }
            
            if processing_time_seconds is not None:
                update_data["processing_time_seconds"] = processing_time_seconds
            if model_used is not None:
                update_data["model_used"] = model_used
                
            result = self.supabase.table("style_transfers")\
                .update(update_data)\
                .eq("id", transfer_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                style_transfer = StyleTransfer(**result.data[0])
                return True, style_transfer, None
            else:
                return False, None, "Failed to complete style transfer"
                
        except Exception as e:
            return False, None, str(e)

    async def fail_style_transfer(self, transfer_id: str, error_message: str) -> Tuple[bool, Optional[StyleTransfer], Optional[str]]:
        """Mark a style transfer as failed"""
        try:
            result = self.supabase.table("style_transfers")\
                .update({
                    "status": StyleTransferStatus.FAILED.value,
                    "error_message": error_message
                })\
                .eq("id", transfer_id)\
                .execute()
            
            if result.data and len(result.data) > 0:
                style_transfer = StyleTransfer(**result.data[0])
                return True, style_transfer, None
            else:
                return False, None, "Failed to mark style transfer as failed"
                
        except Exception as e:
            return False, None, str(e)
