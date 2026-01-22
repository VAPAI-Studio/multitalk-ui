from typing import Tuple, Optional, List, Dict, Any
from datetime import datetime
import json
from core.supabase import get_supabase
from supabase import Client
from models.image_job import (
    ImageJob,
    CreateImageJobPayload,
    UpdateImageJobPayload,
    CompleteImageJobPayload
)


def _parse_parameters(params) -> Dict[str, Any]:
    """Parse parameters field - handles both dict and JSON string."""
    if params is None:
        return {}
    if isinstance(params, dict):
        return params
    if isinstance(params, str):
        try:
            return json.loads(params)
        except json.JSONDecodeError:
            return {}
    return {}


class ImageJobService:
    """Service for managing image generation jobs (img2img, style-transfer, image-edit)"""

    def __init__(self, supabase: Optional[Client] = None):
        self.supabase = supabase or get_supabase()

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
            # Use specific columns and .single() for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, output_image_urls, prompt, width, height, parameters, model_used, user_ip, comfyui_output_filename, comfyui_output_subfolder, comfyui_output_type, error_message, started_at, completed_at, processing_time_seconds, created_at"
            result = self.supabase.table("image_jobs") \
                .select(columns) \
                .eq("id", job_id) \
                .single() \
                .execute()

            if result.data:
                result.data['parameters'] = _parse_parameters(result.data.get('parameters'))
                return ImageJob(**result.data), None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_job_by_comfy_id(self, comfy_job_id: str) -> Tuple[Optional[ImageJob], Optional[str]]:
        """Get a single image job by ComfyUI job ID"""
        try:
            # Use specific columns and .single() for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, output_image_urls, prompt, width, height, parameters, model_used, user_ip, comfyui_output_filename, comfyui_output_subfolder, comfyui_output_type, error_message, started_at, completed_at, processing_time_seconds, created_at"
            result = self.supabase.table("image_jobs") \
                .select(columns) \
                .eq("comfy_job_id", comfy_job_id) \
                .single() \
                .execute()

            if result.data:
                result.data['parameters'] = _parse_parameters(result.data.get('parameters'))
                return ImageJob(**result.data), None
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
            # Use specific columns instead of * for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, output_image_urls, prompt, width, height, parameters, model_used, user_ip, comfyui_output_filename, comfyui_output_subfolder, comfyui_output_type, error_message, started_at, completed_at, processing_time_seconds, created_at"
            query = self.supabase.table("image_jobs").select(columns, count="exact")

            # Apply filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            # Parse parameters field (may be JSON string or dict)
            jobs = []
            for job in (result.data or []):
                job['parameters'] = _parse_parameters(job.get('parameters'))
                jobs.append(ImageJob(**job))
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
            # Use specific columns instead of * for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, output_image_urls, prompt, width, height, parameters, model_used, user_ip, comfyui_output_filename, comfyui_output_subfolder, comfyui_output_type, error_message, started_at, completed_at, processing_time_seconds, created_at"
            query = self.supabase.table("image_jobs").select(columns).eq("status", "completed")

            if workflow_name:
                query = query.eq("workflow_name", workflow_name)

            result = query.order("completed_at", desc=True).range(offset, offset + limit - 1).execute()

            # Parse parameters field (may be JSON string or dict)
            jobs = []
            for job in (result.data or []):
                job['parameters'] = _parse_parameters(job.get('parameters'))
                jobs.append(ImageJob(**job))
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

    async def get_feed_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None
    ) -> Tuple[List[Dict], int, Optional[str]]:
        """
        Optimized feed query with server-side caching.
        Returns minimal columns needed for feed display.
        Cached for 10 seconds to reduce database load.

        Returns: (jobs_dict_list, total_count, error_message)
        """
        from core.cache import get_cached, set_cached, make_feed_cache_key

        # Check cache first
        cache_key = make_feed_cache_key("image_jobs", user_id, workflow_name, status, limit, offset)
        cached = get_cached(cache_key)
        if cached is not None:
            return cached

        try:
            # Minimal columns for feed display (no parameters, no comfyui output details)
            feed_columns = "id, status, created_at, workflow_name, output_image_urls, prompt, comfy_job_id, error_message, model_used"

            query = self.supabase.table("image_jobs").select(feed_columns, count="exact")

            # Apply filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)
            if status:
                query = query.eq("status", status)

            # Order and paginate
            query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

            result = query.execute()
            total_count = result.count if result.count is not None else len(result.data or [])

            response = (result.data or [], total_count, None)

            # Cache the result
            set_cached(cache_key, response)

            return response

        except Exception as e:
            return [], 0, str(e)
