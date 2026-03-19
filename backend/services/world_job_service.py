from typing import Tuple, Optional, List, Dict, Any
import json
from core.supabase import get_supabase
from supabase import Client
from models.world_job import (
    WorldJob,
    CreateWorldJobPayload,
    CompleteWorldJobPayload
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


class WorldJobService:
    """Service for managing 3D world generation jobs (World Labs API)"""

    def __init__(self, supabase: Optional[Client] = None):
        self.supabase = supabase or get_supabase()

    async def create_job(self, payload: CreateWorldJobPayload) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create a new world job.
        Returns: (success, job_id, error_message)
        """
        try:
            job_data = {
                "user_id": payload.user_id,
                "status": "pending",
                "world_id": payload.world_id,
                "operation_id": payload.operation_id,
                "splat_url": payload.splat_url,
                "model": payload.model,
                "prompt_type": payload.prompt_type,
                "input_image_urls": payload.input_image_urls,
                "input_video_url": payload.input_video_url,
                "text_prompt": payload.text_prompt,
                "display_name": payload.display_name,
                "thumbnail_url": payload.thumbnail_url,
                "parameters": payload.parameters,
            }

            # Remove None values to use database defaults
            job_data = {k: v for k, v in job_data.items() if v is not None}

            result = self.supabase.table("world_jobs").insert(job_data).execute()

            if result.data:
                job_id = result.data[0].get("id")
                return True, job_id, None
            else:
                return False, None, "Failed to create world job"

        except Exception as e:
            return False, None, str(e)

    async def update_to_processing(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """Mark job as processing (by UUID)"""
        try:
            result = self.supabase.table("world_jobs") \
                .update({"status": "processing"}) \
                .eq("id", job_id) \
                .execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to update job to processing"

        except Exception as e:
            return False, str(e)

    async def complete_job(self, payload: CompleteWorldJobPayload) -> Tuple[bool, Optional[WorldJob], Optional[str]]:
        """
        Mark job as completed or failed.
        Returns: (success, job, error_message)
        """
        try:
            update_data = {
                "status": payload.status,
            }

            if payload.splat_url:
                update_data["splat_url"] = payload.splat_url
            if payload.world_id:
                update_data["world_id"] = payload.world_id
            if payload.thumbnail_url:
                update_data["thumbnail_url"] = payload.thumbnail_url
            if payload.error_message:
                update_data["error_message"] = payload.error_message

            result = self.supabase.table("world_jobs") \
                .update(update_data) \
                .eq("id", payload.job_id) \
                .execute()

            if result.data:
                job_data = result.data[0]
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                job = WorldJob(**job_data)
                return True, job, None
            else:
                return False, None, "Failed to complete job"

        except Exception as e:
            return False, None, str(e)

    async def get_job(self, job_id: str) -> Tuple[Optional[WorldJob], Optional[str]]:
        """Get a single world job by UUID"""
        try:
            result = self.supabase.table("world_jobs") \
                .select("*") \
                .eq("id", job_id) \
                .single() \
                .execute()

            if result.data:
                job_data = result.data
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                return WorldJob(**job_data), None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_recent_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        user_id: Optional[str] = None
    ) -> Tuple[List[WorldJob], int, Optional[str]]:
        """Get recent world jobs with optional filtering"""
        try:
            query = self.supabase.table("world_jobs").select("*", count="exact")

            if user_id:
                query = query.eq("user_id", user_id)

            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            jobs = []
            for job_data in (result.data or []):
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(WorldJob(**job_data))

            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_completed_jobs(
        self,
        limit: int = 20,
        offset: int = 0,
        user_id: Optional[str] = None
    ) -> Tuple[List[WorldJob], int, Optional[str]]:
        """Get completed world jobs"""
        try:
            query = self.supabase.table("world_jobs").select("*", count="exact").eq("status", "completed")

            if user_id:
                query = query.eq("user_id", user_id)

            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            jobs = []
            for job_data in (result.data or []):
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(WorldJob(**job_data))

            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def delete_job(self, job_id: str, user_id: str) -> Tuple[bool, Optional[str]]:
        """Delete a world job (only if owned by user)"""
        try:
            result = self.supabase.table("world_jobs") \
                .delete() \
                .eq("id", job_id) \
                .eq("user_id", user_id) \
                .execute()

            if result.data:
                return True, None
            else:
                return False, "Job not found or not owned by user"

        except Exception as e:
            return False, str(e)

    async def get_feed_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        user_id: Optional[str] = None,
        status: Optional[str] = None
    ) -> Tuple[List[Dict], int, Optional[str]]:
        """
        Optimized feed query - returns minimal columns needed for display.
        Returns: (jobs_dict_list, total_count, error_message)
        """
        try:
            feed_columns = "id, status, created_at, world_id, splat_url, model, prompt_type, input_image_urls, thumbnail_url, text_prompt, display_name, error_message, parameters"

            query = self.supabase.table("world_jobs").select(feed_columns, count="exact")

            if user_id:
                query = query.eq("user_id", user_id)
            if status:
                query = query.eq("status", status)

            query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

            result = query.execute()
            total_count = result.count if result.count is not None else len(result.data or [])

            jobs = list(result.data or [])

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)
