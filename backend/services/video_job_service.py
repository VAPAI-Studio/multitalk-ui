from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime
import json
from models.video_job import (
    VideoJob,
    CreateVideoJobPayload,
    UpdateVideoJobPayload,
    CompleteVideoJobPayload,
    JobStatus
)
from core.supabase import get_supabase
from supabase import Client


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


class VideoJobService:
    """Service for managing video generation jobs in the video_jobs table."""

    # Cache for workflow lookups
    _workflow_cache: Dict[str, int] = {}
    _workflow_name_cache: Dict[int, str] = {}

    def __init__(self, supabase: Optional[Client] = None):
        self.supabase = supabase or get_supabase()

    async def _get_workflow_id(self, workflow_name: str) -> Optional[int]:
        """Get workflow_id from workflow_name, with caching."""
        if workflow_name in self._workflow_cache:
            return self._workflow_cache[workflow_name]

        try:
            result = self.supabase.table("workflows") \
                .select("id") \
                .eq("name", workflow_name) \
                .single() \
                .execute()

            if result.data:
                workflow_id = result.data["id"]
                self._workflow_cache[workflow_name] = workflow_id
                self._workflow_name_cache[workflow_id] = workflow_name
                return workflow_id
            return None
        except Exception:
            return None

    async def _get_workflow_name(self, workflow_id: int) -> Optional[str]:
        """Get workflow_name from workflow_id, with caching."""
        if workflow_id in self._workflow_name_cache:
            return self._workflow_name_cache[workflow_id]

        try:
            result = self.supabase.table("workflows") \
                .select("name") \
                .eq("id", workflow_id) \
                .single() \
                .execute()

            if result.data:
                workflow_name = result.data["name"]
                self._workflow_name_cache[workflow_id] = workflow_name
                self._workflow_cache[workflow_name] = workflow_id
                return workflow_name
            return None
        except Exception:
            return None

    def _enrich_job_with_workflow_name(self, job_data: Dict) -> Dict:
        """Add workflow_name to job data if workflow_id exists."""
        if "workflow_id" in job_data and job_data["workflow_id"]:
            workflow_id = job_data["workflow_id"]
            if workflow_id in self._workflow_name_cache:
                job_data["workflow_name"] = self._workflow_name_cache[workflow_id]
        return job_data

    async def create_job(self, payload: CreateVideoJobPayload) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create a new video job record.
        Returns: (success, job_id, error_message)
        """
        try:
            # Lookup workflow_id from workflow_name
            workflow_id = await self._get_workflow_id(payload.workflow_name)
            if not workflow_id:
                return False, None, f"Unknown workflow: {payload.workflow_name}"

            job_data = {
                "user_id": payload.user_id,
                "workflow_id": workflow_id,
                "status": "pending",
                "comfy_url": payload.comfy_url,
                "comfy_job_id": payload.comfy_job_id,
                "input_image_urls": payload.input_image_urls,
                "input_audio_urls": payload.input_audio_urls,
                "input_video_urls": payload.input_video_urls,
                "width": payload.width,
                "height": payload.height,
                "parameters": payload.parameters,
                "project_id": payload.project_id,
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
                job_id = result.data[0].get("id")
                return True, job_id, None
            else:
                return False, None, "Failed to create video job"

        except Exception as e:
            return False, None, str(e)

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
            if payload.thumbnail_url:
                update_data["thumbnail_url"] = payload.thumbnail_url
            if payload.error_message is not None:
                update_data["error_message"] = payload.error_message
            if payload.width is not None:
                update_data["width"] = payload.width
            if payload.height is not None:
                update_data["height"] = payload.height
            if payload.fps is not None:
                update_data["fps"] = payload.fps
            if payload.duration_seconds is not None:
                update_data["duration_seconds"] = payload.duration_seconds

            if not update_data:
                return True, None  # Nothing to update

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
                .update({"status": "processing"}) \
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
            }

            if payload.output_video_urls:
                update_data["output_video_urls"] = payload.output_video_urls
            if payload.error_message:
                update_data["error_message"] = payload.error_message
            if payload.duration_seconds is not None:
                update_data["duration_seconds"] = payload.duration_seconds
            if payload.thumbnail_url:
                update_data["thumbnail_url"] = payload.thumbnail_url
            if payload.width is not None:
                update_data["width"] = payload.width
            if payload.height is not None:
                update_data["height"] = payload.height
            if payload.fps is not None:
                update_data["fps"] = payload.fps

            result = self.supabase.table("video_jobs") \
                .update(update_data) \
                .eq("comfy_job_id", payload.job_id) \
                .execute()

            if result.data:
                job_data = self._enrich_job_with_workflow_name(result.data[0])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                job = VideoJob(**job_data)
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
                .select("*") \
                .eq("id", job_id) \
                .single() \
                .execute()

            if result.data:
                job_data = result.data
                # Get workflow name
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                job = VideoJob(**job_data)
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
                .select("*") \
                .eq("comfy_job_id", comfy_job_id) \
                .single() \
                .execute()

            if result.data:
                job_data = result.data
                # Get workflow name
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                job = VideoJob(**job_data)
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
            query = self.supabase.table("video_jobs").select("*", count="exact")

            # Apply filters
            if workflow_name:
                workflow_id = await self._get_workflow_id(workflow_name)
                if workflow_id:
                    query = query.eq("workflow_id", workflow_id)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True) \
                         .range(offset, offset + limit - 1)

            result = query.execute()

            # Parse and enrich jobs
            jobs = []
            for job_data in result.data:
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(VideoJob(**job_data))

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
            query = self.supabase.table("video_jobs").select("*", count="exact")

            # Filter for completed jobs only
            query = query.eq("status", "completed")

            # Apply additional filters
            if workflow_name:
                workflow_id = await self._get_workflow_id(workflow_name)
                if workflow_id:
                    query = query.eq("workflow_id", workflow_id)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            query = query.order("created_at", desc=True) \
                         .range(offset, offset + limit - 1)

            result = query.execute()

            # Parse and enrich jobs
            jobs = []
            for job_data in result.data:
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(VideoJob(**job_data))

            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_feed_jobs(
        self,
        limit: int = 50,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None
    ) -> Tuple[List[Dict], int, Optional[str]]:
        """
        Optimized feed query - returns minimal columns needed for display.
        Returns: (jobs_dict_list, total_count, error_message)
        """
        try:
            # Join with workflows to get workflow_name
            feed_columns = "id, status, created_at, workflow_id, output_video_urls, thumbnail_url, comfy_job_id, error_message, width, height"

            query = self.supabase.table("video_jobs").select(feed_columns, count="exact")

            # Apply filters
            if workflow_name:
                workflow_id = await self._get_workflow_id(workflow_name)
                if workflow_id:
                    query = query.eq("workflow_id", workflow_id)
            if user_id:
                query = query.eq("user_id", user_id)
            if status:
                query = query.eq("status", status)

            # Order and paginate
            query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

            result = query.execute()
            total_count = result.count if result.count is not None else len(result.data or [])

            # Enrich with workflow names
            jobs = []
            for job_data in (result.data or []):
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                jobs.append(job_data)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def delete_job(self, job_id: str, user_id: str) -> Tuple[bool, Optional[str]]:
        """
        Delete a video job by UUID (only if owned by user).
        Returns: (success, error_message)
        """
        try:
            result = self.supabase.table("video_jobs") \
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
