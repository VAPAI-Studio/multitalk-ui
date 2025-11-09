from typing import Tuple, Optional, List
from datetime import datetime
from core.supabase import get_supabase_client
from models.image_job import (
    ImageJob,
    CreateImageJobPayload,
    UpdateImageJobPayload,
    CompleteImageJobPayload
)

class ImageJobService:
    """Service for managing image generation jobs (img2img, style-transfer, image-edit)"""

    def __init__(self):
        self.supabase = get_supabase_client()

    async def create_job(self, payload: CreateImageJobPayload) -> Tuple[bool, Optional[str]]:
        """Create a new image job"""
        try:
            job_data = {
                "user_id": payload.user_id,
                "workflow_name": payload.workflow_name,
                "status": "pending",
                "comfy_url": payload.comfy_url,
                "comfy_job_id": payload.comfy_job_id,
                "input_image_urls": payload.input_image_urls,
                "prompt": payload.prompt,
                "width": payload.width,
                "height": payload.height,
                "parameters": payload.parameters,
                "model_used": payload.model_used,
                "user_ip": payload.user_ip
            }

            result = self.supabase.table("image_jobs").insert(job_data).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to create image job"

        except Exception as e:
            return False, str(e)

    async def update_job(self, job_id: str, payload: UpdateImageJobPayload) -> Tuple[bool, Optional[str]]:
        """Update an image job"""
        try:
            update_data = {}

            if payload.status is not None:
                update_data["status"] = payload.status
            if payload.started_at is not None:
                update_data["started_at"] = payload.started_at.isoformat()
            if payload.completed_at is not None:
                update_data["completed_at"] = payload.completed_at.isoformat()
            if payload.processing_time_seconds is not None:
                update_data["processing_time_seconds"] = payload.processing_time_seconds
            if payload.output_image_urls is not None:
                update_data["output_image_urls"] = payload.output_image_urls
            if payload.width is not None:
                update_data["width"] = payload.width
            if payload.height is not None:
                update_data["height"] = payload.height
            if payload.comfyui_output_filename is not None:
                update_data["comfyui_output_filename"] = payload.comfyui_output_filename
            if payload.comfyui_output_subfolder is not None:
                update_data["comfyui_output_subfolder"] = payload.comfyui_output_subfolder
            if payload.comfyui_output_type is not None:
                update_data["comfyui_output_type"] = payload.comfyui_output_type
            if payload.error_message is not None:
                update_data["error_message"] = payload.error_message

            if not update_data:
                return True, None  # Nothing to update

            result = self.supabase.table("image_jobs").update(update_data).eq("id", job_id).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to update image job"

        except Exception as e:
            return False, str(e)

    async def update_to_processing(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """Mark job as processing"""
        try:
            update_data = {
                "status": "processing",
                "started_at": datetime.utcnow().isoformat()
            }

            result = self.supabase.table("image_jobs").update(update_data).eq("id", job_id).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to update job to processing"

        except Exception as e:
            return False, str(e)

    async def complete_job(self, payload: CompleteImageJobPayload) -> Tuple[bool, Optional[str]]:
        """Mark job as completed or failed"""
        try:
            update_data = {
                "status": payload.status,
                "completed_at": datetime.utcnow().isoformat()
            }

            if payload.output_image_urls:
                update_data["output_image_urls"] = payload.output_image_urls
            if payload.comfyui_output_filename:
                update_data["comfyui_output_filename"] = payload.comfyui_output_filename
            if payload.comfyui_output_subfolder:
                update_data["comfyui_output_subfolder"] = payload.comfyui_output_subfolder
            if payload.comfyui_output_type:
                update_data["comfyui_output_type"] = payload.comfyui_output_type
            if payload.width:
                update_data["width"] = payload.width
            if payload.height:
                update_data["height"] = payload.height
            if payload.error_message:
                update_data["error_message"] = payload.error_message

            result = self.supabase.table("image_jobs").update(update_data).eq("id", payload.job_id).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to complete job"

        except Exception as e:
            return False, str(e)

    async def get_job(self, job_id: str) -> Tuple[Optional[ImageJob], Optional[str]]:
        """Get a single image job by ID"""
        try:
            result = self.supabase.table("image_jobs").select("*").eq("id", job_id).execute()

            if result.data and len(result.data) > 0:
                return ImageJob(**result.data[0]), None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_job_by_comfy_id(self, comfy_job_id: str) -> Tuple[Optional[ImageJob], Optional[str]]:
        """Get a single image job by ComfyUI job ID"""
        try:
            result = self.supabase.table("image_jobs").select("*").eq("comfy_job_id", comfy_job_id).execute()

            if result.data and len(result.data) > 0:
                return ImageJob(**result.data[0]), None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_recent_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[List[ImageJob], int, Optional[str]]:
        """Get recent image jobs with optional filtering"""
        try:
            # Build query
            query = self.supabase.table("image_jobs").select("*", count="exact")

            # Apply filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            jobs = [ImageJob(**job) for job in result.data] if result.data else []
            total_count = result.count if hasattr(result, 'count') else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_completed_jobs(
        self,
        limit: int = 20,
        offset: int = 0,
        workflow_name: Optional[str] = None
    ) -> Tuple[List[ImageJob], Optional[str]]:
        """Get completed image jobs"""
        try:
            query = self.supabase.table("image_jobs").select("*").eq("status", "completed")

            if workflow_name:
                query = query.eq("workflow_name", workflow_name)

            result = query.order("completed_at", desc=True).range(offset, offset + limit - 1).execute()

            jobs = [ImageJob(**job) for job in result.data] if result.data else []
            return jobs, None

        except Exception as e:
            return [], str(e)

    async def delete_job(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """Delete an image job"""
        try:
            result = self.supabase.table("image_jobs").delete().eq("id", job_id).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to delete job"

        except Exception as e:
            return False, str(e)
