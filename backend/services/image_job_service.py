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

    async def create_job(self, payload: CreateImageJobPayload) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create a new image job.
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
                "prompt": payload.prompt,
                "width": payload.width,
                "height": payload.height,
                "parameters": payload.parameters,
                "project_id": payload.project_id,
            }

            # Remove None values to use database defaults
            job_data = {k: v for k, v in job_data.items() if v is not None}

            result = self.supabase.table("image_jobs").insert(job_data).execute()

            if result.data:
                job_id = result.data[0].get("id")
                return True, job_id, None
            else:
                return False, None, "Failed to create image job"

        except Exception as e:
            return False, None, str(e)

    async def update_job(self, job_id: str, payload: UpdateImageJobPayload) -> Tuple[bool, Optional[str]]:
        """Update an image job by UUID or comfy_job_id"""
        try:
            update_data = {}

            if payload.status is not None:
                update_data["status"] = payload.status
            if payload.output_image_urls is not None:
                update_data["output_image_urls"] = payload.output_image_urls
            if payload.width is not None:
                update_data["width"] = payload.width
            if payload.height is not None:
                update_data["height"] = payload.height
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
            result = self.supabase.table("image_jobs") \
                .update({"status": "processing"}) \
                .eq("comfy_job_id", job_id) \
                .execute()

            if result.data:
                return True, None
            else:
                return False, "Failed to update job to processing"

        except Exception as e:
            return False, str(e)

    async def complete_job(self, payload: CompleteImageJobPayload) -> Tuple[bool, Optional[ImageJob], Optional[str]]:
        """
        Mark job as completed or failed.
        Returns: (success, job, error_message)
        """
        try:
            update_data = {
                "status": payload.status,
            }

            if payload.output_image_urls:
                update_data["output_image_urls"] = payload.output_image_urls
            if payload.width:
                update_data["width"] = payload.width
            if payload.height:
                update_data["height"] = payload.height
            if payload.error_message:
                update_data["error_message"] = payload.error_message

            # Try to find by UUID first, then by comfy_job_id
            # This handles both cases: endpoint passing UUID or comfy_job_id
            result = self.supabase.table("image_jobs") \
                .update(update_data) \
                .eq("id", payload.job_id) \
                .execute()

            # If no match by UUID, try by comfy_job_id
            if not result.data:
                result = self.supabase.table("image_jobs") \
                    .update(update_data) \
                    .eq("comfy_job_id", payload.job_id) \
                    .execute()

            if result.data:
                job_data = result.data[0]
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                job = ImageJob(**job_data)
                return True, job, None
            else:
                return False, None, "Failed to complete job"

        except Exception as e:
            return False, None, str(e)

    async def get_job(self, job_id: str) -> Tuple[Optional[ImageJob], Optional[str]]:
        """Get a single image job by UUID"""
        try:
            result = self.supabase.table("image_jobs") \
                .select("*") \
                .eq("id", job_id) \
                .single() \
                .execute()

            if result.data:
                job_data = result.data
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                return ImageJob(**job_data), None
            else:
                return None, "Job not found"

        except Exception as e:
            return None, str(e)

    async def get_job_by_comfy_id(self, comfy_job_id: str) -> Tuple[Optional[ImageJob], Optional[str]]:
        """Get a single image job by ComfyUI job ID"""
        try:
            result = self.supabase.table("image_jobs") \
                .select("*") \
                .eq("comfy_job_id", comfy_job_id) \
                .single() \
                .execute()

            if result.data:
                job_data = result.data
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                return ImageJob(**job_data), None
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
            query = self.supabase.table("image_jobs").select("*", count="exact")

            # Apply filters
            if workflow_name:
                workflow_id = await self._get_workflow_id(workflow_name)
                if workflow_id:
                    query = query.eq("workflow_id", workflow_id)
            if user_id:
                query = query.eq("user_id", user_id)

            # Order and paginate
            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            # Parse and enrich jobs
            jobs = []
            for job_data in (result.data or []):
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(ImageJob(**job_data))

            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def get_completed_jobs(
        self,
        limit: int = 20,
        offset: int = 0,
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[List[ImageJob], int, Optional[str]]:
        """Get completed image jobs"""
        try:
            query = self.supabase.table("image_jobs").select("*", count="exact").eq("status", "completed")

            if workflow_name:
                workflow_id = await self._get_workflow_id(workflow_name)
                if workflow_id:
                    query = query.eq("workflow_id", workflow_id)
            if user_id:
                query = query.eq("user_id", user_id)

            result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

            # Parse and enrich jobs
            jobs = []
            for job_data in (result.data or []):
                if job_data.get("workflow_id"):
                    job_data["workflow_name"] = await self._get_workflow_name(job_data["workflow_id"])
                job_data['parameters'] = _parse_parameters(job_data.get('parameters'))
                jobs.append(ImageJob(**job_data))

            total_count = result.count if result.count is not None else len(jobs)

            return jobs, total_count, None

        except Exception as e:
            return [], 0, str(e)

    async def delete_job(self, job_id: str, user_id: str) -> Tuple[bool, Optional[str]]:
        """Delete an image job (only if owned by user)"""
        try:
            result = self.supabase.table("image_jobs") \
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
        workflow_name: Optional[str] = None,
        user_id: Optional[str] = None,
        status: Optional[str] = None
    ) -> Tuple[List[Dict], int, Optional[str]]:
        """
        Optimized feed query - returns minimal columns needed for display.
        Returns: (jobs_dict_list, total_count, error_message)
        """
        try:
            # Minimal columns for feed display
            feed_columns = "id, status, created_at, workflow_id, output_image_urls, prompt, comfy_job_id, error_message, width, height"

            query = self.supabase.table("image_jobs").select(feed_columns, count="exact")

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
