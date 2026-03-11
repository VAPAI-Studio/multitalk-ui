"""
Upscale Job Service

CRUD operations for upscale_batches and upscale_videos tables.
Follows the VideoJobService pattern: Supabase client injection,
tuple returns for write ops, Optional for reads.
"""

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from core.supabase import get_supabase
from models.upscale import UpscaleSettings

try:
    from supabase import Client
except ImportError:
    Client = None  # type: ignore


class UpscaleJobService:
    """Service for managing upscale batches and videos in the database."""

    def __init__(self, supabase=None):
        self.supabase = supabase or get_supabase()

    # ------------------------------------------------------------------
    # Batch CRUD
    # ------------------------------------------------------------------

    async def create_batch(
        self,
        user_id: str,
        settings: UpscaleSettings,
        project_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[dict], Optional[str]]:
        """
        Create a new upscale batch.

        Returns:
            (success, batch_data, error_message)
        """
        try:
            row = {
                "user_id": user_id,
                "status": "pending",
                "resolution": settings.resolution,
                "creativity": settings.creativity,
                "sharpen": settings.sharpen,
                "grain": settings.grain,
                "fps_boost": settings.fps_boost,
                "flavor": settings.flavor,
                "total_videos": 0,
                "completed_videos": 0,
                "failed_videos": 0,
            }
            if project_id:
                row["project_id"] = project_id

            result = self.supabase.table("upscale_batches").insert(row).execute()

            if result.data:
                batch = result.data[0] if isinstance(result.data, list) else result.data
                return True, batch, None
            return False, None, "Failed to create batch"

        except Exception as e:
            return False, None, str(e)

    async def get_batch(
        self,
        batch_id: str,
        user_id: str,
    ) -> Optional[dict]:
        """
        Get a batch with its nested videos list.

        Returns:
            Batch dict with 'videos' key, or None if not found.
        """
        try:
            batch_result = (
                self.supabase.table("upscale_batches")
                .select("*")
                .eq("id", batch_id)
                .eq("user_id", user_id)
                .single()
                .execute()
            )
            batch = batch_result.data
            if not batch:
                return None

            # Fetch videos for this batch
            videos_result = (
                self.supabase.table("upscale_videos")
                .select("*")
                .eq("batch_id", batch_id)
                .order("queue_position")
                .execute()
            )
            batch["videos"] = videos_result.data or []
            return batch

        except Exception:
            return None

    async def list_user_batches(
        self,
        user_id: str,
        limit: int = 20,
    ) -> List[dict]:
        """
        List batches for a user, ordered by created_at desc.

        Returns:
            List of batch dicts (without nested videos).
        """
        try:
            result = (
                self.supabase.table("upscale_batches")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return result.data or []

        except Exception:
            return []

    async def update_batch_status(
        self,
        batch_id: str,
        status: str,
        error_message: Optional[str] = None,
    ) -> bool:
        """
        Update batch status. Sets started_at when 'processing',
        completed_at when terminal ('completed', 'failed').

        Returns:
            True on success.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data: dict = {"status": status}

            if status == "processing":
                update_data["started_at"] = now
            if status in ("completed", "failed"):
                update_data["completed_at"] = now
            if error_message is not None:
                update_data["error_message"] = error_message

            result = (
                self.supabase.table("upscale_batches")
                .update(update_data)
                .eq("id", batch_id)
                .execute()
            )
            return bool(result.data)

        except Exception:
            return False

    async def update_batch_heartbeat(self, batch_id: str) -> bool:
        """
        Update the last_heartbeat timestamp on a batch.

        Returns:
            True on success.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            result = (
                self.supabase.table("upscale_batches")
                .update({"last_heartbeat": now})
                .eq("id", batch_id)
                .execute()
            )
            return bool(result.data)

        except Exception:
            return False

    async def get_batches_by_status(self, status: str) -> List[dict]:
        """
        Get all batches matching a given status (for startup recovery).

        Returns:
            List of batch dicts.
        """
        try:
            result = (
                self.supabase.table("upscale_batches")
                .select("*")
                .eq("status", status)
                .execute()
            )
            return result.data or []

        except Exception:
            return []

    # ------------------------------------------------------------------
    # Video CRUD
    # ------------------------------------------------------------------

    async def add_video_to_batch(
        self,
        batch_id: str,
        user_id: str,
        input_filename: str,
        input_storage_url: str,
        queue_position: int,
        input_file_size: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> Tuple[bool, Optional[dict], Optional[str]]:
        """
        Add a video to an upscale batch.

        Inserts into upscale_videos and increments total_videos on the batch.

        Returns:
            (success, video_data, error_message)
        """
        try:
            row: dict = {
                "batch_id": batch_id,
                "user_id": user_id,
                "status": "pending",
                "queue_position": queue_position,
                "input_filename": input_filename,
                "input_storage_url": input_storage_url,
            }
            if input_file_size is not None:
                row["input_file_size"] = input_file_size
            if duration_seconds is not None:
                row["duration_seconds"] = duration_seconds
            if width is not None:
                row["width"] = width
            if height is not None:
                row["height"] = height

            result = self.supabase.table("upscale_videos").insert(row).execute()

            if not result.data:
                return False, None, "Failed to insert video"

            video = result.data[0] if isinstance(result.data, list) else result.data

            # Increment total_videos on the batch
            await self._increment_batch_field(batch_id, "total_videos")

            return True, video, None

        except Exception as e:
            return False, None, str(e)

    async def update_video_status(
        self,
        video_id: str,
        status: str,
        freepik_task_id: Optional[str] = None,
        output_url: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> bool:
        """
        Update a video's status. Sets started_at when 'processing',
        completed_at when terminal ('completed', 'failed').

        Returns:
            True on success.
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            update_data: dict = {"status": status}

            if status == "processing":
                update_data["started_at"] = now
            if status in ("completed", "failed"):
                update_data["completed_at"] = now
            if freepik_task_id is not None:
                update_data["freepik_task_id"] = freepik_task_id
            if output_url is not None:
                update_data["output_storage_url"] = output_url
            if error_message is not None:
                update_data["error_message"] = error_message

            result = (
                self.supabase.table("upscale_videos")
                .update(update_data)
                .eq("id", video_id)
                .execute()
            )
            return bool(result.data)

        except Exception:
            return False

    async def get_next_pending_video(self, batch_id: str) -> Optional[dict]:
        """
        Get the next pending video (lowest queue_position) for a batch.

        Returns:
            Video dict, or None if no pending videos remain.
        """
        try:
            result = (
                self.supabase.table("upscale_videos")
                .select("*")
                .eq("batch_id", batch_id)
                .eq("status", "pending")
                .order("queue_position")
                .limit(1)
                .execute()
            )
            if result.data:
                return result.data[0] if isinstance(result.data, list) else result.data
            return None

        except Exception:
            return None

    async def fail_current_processing_video(
        self,
        batch_id: str,
        error_message: str,
    ) -> bool:
        """
        Find the video with status='processing' in a batch and mark it 'failed'.

        Returns:
            True if a processing video was found and marked failed.
        """
        try:
            # Find the processing video
            find_result = (
                self.supabase.table("upscale_videos")
                .select("id")
                .eq("batch_id", batch_id)
                .eq("status", "processing")
                .limit(1)
                .execute()
            )

            if not find_result.data:
                return False

            video_id = find_result.data[0]["id"] if isinstance(find_result.data, list) else find_result.data["id"]

            # Mark it failed
            now = datetime.now(timezone.utc).isoformat()
            update_result = (
                self.supabase.table("upscale_videos")
                .update({
                    "status": "failed",
                    "error_message": error_message,
                    "completed_at": now,
                })
                .eq("id", video_id)
                .execute()
            )
            return bool(update_result.data)

        except Exception:
            return False

    # ------------------------------------------------------------------
    # Counter helpers
    # ------------------------------------------------------------------

    async def increment_completed_count(self, batch_id: str) -> bool:
        """Increment completed_videos count on a batch."""
        return await self._increment_batch_field(batch_id, "completed_videos")

    async def increment_failed_count(self, batch_id: str) -> bool:
        """Increment failed_videos count on a batch."""
        return await self._increment_batch_field(batch_id, "failed_videos")

    async def _increment_batch_field(self, batch_id: str, field: str) -> bool:
        """
        Read-then-update a numeric field on upscale_batches.

        Supabase JS has `.rpc()` for atomic increments, but the Python
        client doesn't support that cleanly, so we read + write.
        """
        try:
            # Read current value
            read_result = (
                self.supabase.table("upscale_batches")
                .select(field)
                .eq("id", batch_id)
                .single()
                .execute()
            )
            if not read_result.data:
                return False

            current = read_result.data
            current_val = current.get(field, 0) if isinstance(current, dict) else 0

            # Write incremented value
            update_result = (
                self.supabase.table("upscale_batches")
                .update({field: current_val + 1})
                .eq("id", batch_id)
                .execute()
            )
            return bool(update_result.data)

        except Exception:
            return False
