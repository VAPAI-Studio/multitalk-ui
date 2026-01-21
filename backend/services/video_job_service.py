from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime
from models.video_job import (
    VideoJob,
    CreateVideoJobPayload,
    UpdateVideoJobPayload,
    CompleteVideoJobPayload,
    JobStatus
)
from core.supabase import get_supabase


class VideoJobService:
    """Service for managing video generation jobs in the video_jobs table."""

    def __init__(self):
        self.supabase = get_supabase()

    async def create_job(self, payload: CreateVideoJobPayload) -> Tuple[bool, Optional[str]]:
        """
        Create a new video job record.
        Returns: (success, error_message)
        """
        try:
            job_data = {
                "user_id": payload.user_id,
                "workflow_name": payload.workflow_name,
                "status": "pending",
                "comfy_url": payload.comfy_url,
                "comfy_job_id": payload.comfy_job_id,
                "input_image_urls": payload.input_image_urls,
                "input_audio_urls": payload.input_audio_urls,
                "input_video_urls": payload.input_video_urls,
                "width": payload.width,
                "height": payload.height,
                "parameters": payload.parameters,
            }

            # Add fps and duration_seconds if provided
            if payload.fps is not None:
                job_data["fps"] = payload.fps
            if payload.duration_seconds is not None:
                job_data["duration_seconds"] = payload.duration_seconds

            # Remove None values to use database defaults
            job_data = {k: v for k, v in job_data.items() if v is not None}

            result = self.supabase.table("video_jobs").insert(job_data).execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to create video job"

        except Exception as e:
            return False, str(e)

    async def update_job(self, job_id: str, payload: UpdateVideoJobPayload) -> Tuple[bool, Optional[str]]:
        """
        Update an existing video job by comfy_job_id.
        Returns: (success, error_message)
        """
        try:
            update_data = {}

            if payload.status:
                update_data["status"] = payload.status
            if payload.output_video_urls:
                update_data["output_video_urls"] = payload.output_video_urls
            if payload.error_message is not None:
                update_data["error_message"] = payload.error_message
            if payload.parameters:
                update_data["parameters"] = payload.parameters

            update_data["updated_at"] = datetime.utcnow().isoformat()

            result = self.supabase.table("video_jobs") \
                .update(update_data) \
                .eq("comfy_job_id", job_id) \
                .execute()

            if result.data:
                return True, None
            else:
                return False, "Job not found"

        except Exception as e:
            return False, str(e)

    async def update_to_processing(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """
        Update job status to processing.
        Returns: (success, error_message)
        """
        try:
            result = self.supabase.table("video_jobs") \
                .update({
                    "status": "processing",
                    "updated_at": datetime.utcnow().isoformat()
                }) \
                .eq("comfy_job_id", job_id) \
                .execute()

            if result.data:
                return True, None
            else:
                return False, "Job not found"

        except Exception as e:
            return False, str(e)

    async def complete_job(self, payload: CompleteVideoJobPayload) -> Tuple[bool, Optional[VideoJob], Optional[str]]:
        """
        Complete a video job (success or failure).
        Returns: (success, job, error_message)
        """
        try:
            update_data = {
                "status": payload.status,
                "updated_at": datetime.utcnow().isoformat()
            }

            if payload.output_video_urls:
                update_data["output_video_urls"] = payload.output_video_urls
            if payload.error_message:
                update_data["error_message"] = payload.error_message
            if payload.duration_seconds is not None:
                update_data["duration_seconds"] = payload.duration_seconds
            if payload.thumbnail_url:
                update_data["thumbnail_url"] = payload.thumbnail_url

            result = self.supabase.table("video_jobs") \
                .update(update_data) \
                .eq("comfy_job_id", payload.job_id) \
                .execute()

            if result.data:
                job = VideoJob(**result.data[0])
                return True, job, None
            else:
                return False, None, "Job not found"

        except Exception as e:
            return False, None, str(e)

    async def get_job(self, job_id: str) -> Tuple[Optional[VideoJob], Optional[str]]:
        """
        Get a single video job by UUID.
        Returns: (job, error_message)
        """
        try:
            result = self.supabase.table("video_jobs") \
                .select("id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, input_audio_urls, input_video_urls, output_video_urls, width, height, fps, duration_seconds, parameters, error_message, thumbnail_url, created_at, updated_at") \
                .eq("id", job_id) \
                .single() \
                .execute()

            if result.data:
                job = VideoJob(**result.data)
                return job, None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_job_by_comfy_id(self, comfy_job_id: str) -> Tuple[Optional[VideoJob], Optional[str]]:
        """
        Get a single video job by comfy_job_id.
        Returns: (job, error_message)
        """
        try:
            result = self.supabase.table("video_jobs") \
                .select("id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, input_audio_urls, input_video_urls, output_video_urls, width, height, fps, duration_seconds, parameters, error_message, thumbnail_url, created_at, updated_at") \
                .eq("comfy_job_id", comfy_job_id) \
                .single() \
                .execute()

            if result.data:
                job = VideoJob(**result.data)
                return job, None
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
    ) -> Tuple[List[VideoJob], int, Optional[str]]:
        """
        Get recent video jobs with optional filtering.
        Returns: (jobs, total_count, error_message)
        """
        try:
            # Use specific columns instead of * for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, input_audio_urls, input_video_urls, output_video_urls, width, height, fps, duration_seconds, parameters, error_message, thumbnail_url, created_at, updated_at"
            query = self.supabase.table("video_jobs").select(columns, count="exact")

            # Apply filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True) \
                         .range(offset, offset + limit - 1)

            result = query.execute()

            jobs = [VideoJob(**job) for job in result.data]
            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_completed_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[List[VideoJob], int, Optional[str]]:
        """
        Get completed video jobs with optional filtering.
        Returns: (jobs, total_count, error_message)
        """
        try:
            # Use specific columns instead of * for better performance
            columns = "id, user_id, workflow_name, status, comfy_url, comfy_job_id, input_image_urls, input_audio_urls, input_video_urls, output_video_urls, width, height, fps, duration_seconds, parameters, error_message, thumbnail_url, created_at, updated_at"
            query = self.supabase.table("video_jobs").select(columns, count="exact")

            # Filter for completed jobs only
            query = query.eq("status", "completed")

            # Apply additional filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True) \
                         .range(offset, offset + limit - 1)

            result = query.execute()

            jobs = [VideoJob(**job) for job in result.data]
            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_recent_jobs_feed(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[List[Dict], Optional[str]]:
        """
        Get recent video jobs for feed display (optimized - no count, minimal columns).
        Returns: (jobs_dict_list, error_message)
        """
        try:
            # Select only columns needed for feed display
            feed_columns = "id, status, created_at, workflow_name, output_video_urls, width, height, comfy_job_id, error_message, thumbnail_url"

            query = self.supabase.table("video_jobs").select(feed_columns)  # No count

            # Apply filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

            result = query.execute()

            return result.data or [], None

        except Exception as e:
            return [], str(e)

    async def get_completed_jobs_feed(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[List[Dict], Optional[str]]:
        """
        Get completed video jobs for feed display (optimized - no count, minimal columns).
        Returns: (jobs_dict_list, error_message)
        """
        try:
            # Select only columns needed for feed display
            feed_columns = "id, status, created_at, workflow_name, output_video_urls, width, height, comfy_job_id, error_message, thumbnail_url"

            query = self.supabase.table("video_jobs").select(feed_columns)  # No count

            # Filter for completed jobs only
            query = query.eq("status", "completed")

            # Apply additional filters
            if workflow_name:
                query = query.eq("workflow_name", workflow_name)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

            result = query.execute()

            return result.data or [], None

        except Exception as e:
            return [], str(e)
