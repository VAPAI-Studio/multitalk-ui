"""
Freepik Video Upscaler Service

Wraps the Freepik AI Video Upscaler API for submitting upscale tasks,
checking status, and polling until completion. Follows the RunPod service
pattern: httpx.AsyncClient, tuple returns, settings-based config.

API docs: https://docs.freepik.com/reference/video-upscaler
"""

import asyncio
import time
import httpx
from typing import Optional, Tuple

from config.settings import settings


# Resolution values: Freepik API accepts "1k", "2k", "4k" directly
VALID_RESOLUTIONS = {"1k", "2k", "4k"}


class FreepikUpscalerService:
    """Service for Freepik Video Upscaler API communication."""

    @property
    def api_key(self) -> str:
        return settings.FREEPIK_API_KEY

    @property
    def base_url(self) -> str:
        return settings.FREEPIK_API_BASE_URL

    @property
    def poll_interval(self) -> int:
        return settings.FREEPIK_POLL_INTERVAL

    @property
    def task_timeout(self) -> int:
        return settings.FREEPIK_TASK_TIMEOUT

    # ------------------------------------------------------------------
    # submit_task
    # ------------------------------------------------------------------

    async def submit_task(
        self,
        video_url: str,
        resolution: str = "2k",
        creativity: int = 0,
        sharpen: int = 0,
        grain: int = 0,
        fps_boost: bool = False,
        flavor: str = "vivid",
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a video for upscaling to the Freepik API.

        Args:
            video_url: Public URL of the video to upscale.
            resolution: Target resolution ('1k', '2k', '4k').
            creativity: Creativity level 0-100.
            sharpen: Sharpen level 0-100.
            grain: Smart grain level 0-100.
            fps_boost: Enable FPS boosting.
            flavor: Output flavor ('vivid' or 'natural').

        Returns:
            Tuple of (success, task_id, error_message).
        """
        if not self.api_key:
            return False, None, "Freepik API key not configured. Please set FREEPIK_API_KEY."

        api_resolution = resolution if resolution in VALID_RESOLUTIONS else "2k"

        payload = {
            "video": video_url,
            "resolution": api_resolution,
            "creativity": creativity,
            "sharpen": sharpen,
            "smart_grain": grain,
            "fps_boost": fps_boost,
            "flavor": flavor,
        }

        headers = {
            "x-freepik-api-key": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/video-upscaler",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()

                data = response.json()
                task_id = data.get("data", {}).get("task_id")

                if not task_id:
                    return False, None, "Freepik API did not return a valid task_id"

                return True, task_id, None

        except httpx.TimeoutException:
            return False, None, "Freepik request timed out after 30 seconds"
        except httpx.HTTPStatusError as e:
            error_detail = f"Freepik HTTP error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except Exception:
                pass
            return False, None, error_detail
        except httpx.RequestError as e:
            return False, None, f"Freepik request failed: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected Freepik error: {str(e)}"

    # ------------------------------------------------------------------
    # check_task_status
    # ------------------------------------------------------------------

    async def check_task_status(
        self,
        task_id: str,
    ) -> Tuple[str, Optional[str], Optional[str]]:
        """
        Check the status of a Freepik upscale task.

        Args:
            task_id: The Freepik task ID to check.

        Returns:
            Tuple of (status, output_url_if_completed, error_if_failed).
            Possible statuses: 'COMPLETED', 'IN_PROGRESS', 'FAILED', 'ERROR'.
        """
        headers = {
            "x-freepik-api-key": self.api_key,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{self.base_url}/video-upscaler/{task_id}",
                    headers=headers,
                )
                response.raise_for_status()

                data = response.json()
                task_data = data.get("data", {})
                status = task_data.get("status", "UNKNOWN")

                if status == "COMPLETED":
                    generated = task_data.get("generated", [])
                    output_url = generated[0] if generated else None
                    return "COMPLETED", output_url, None

                if status == "FAILED":
                    error_msg = task_data.get("error", "Task failed without details")
                    return "FAILED", None, error_msg

                # IN_PROGRESS, QUEUED, or any other non-terminal status
                return status, None, None

        except httpx.TimeoutException:
            return "ERROR", None, "Freepik status check timed out"
        except httpx.HTTPStatusError as e:
            error_detail = f"Freepik HTTP error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except Exception:
                pass
            return "ERROR", None, error_detail
        except httpx.RequestError as e:
            return "ERROR", None, f"Freepik status check failed: {str(e)}"
        except Exception as e:
            return "ERROR", None, f"Unexpected Freepik error: {str(e)}"

    # ------------------------------------------------------------------
    # poll_until_complete
    # ------------------------------------------------------------------

    async def poll_until_complete(
        self,
        task_id: str,
        timeout: Optional[int] = None,
    ) -> Tuple[str, Optional[str], Optional[str]]:
        """
        Poll check_task_status until a terminal state or timeout.

        Uses exponential backoff starting at poll_interval, capped at 30s.

        Args:
            task_id: The Freepik task ID to poll.
            timeout: Max seconds to wait (defaults to settings.FREEPIK_TASK_TIMEOUT).

        Returns:
            Tuple of (status, output_url, error_message).
            Returns ('TIMEOUT', None, error_msg) if timeout exceeded.
        """
        if timeout is None:
            timeout = self.task_timeout

        start_time = time.monotonic()
        interval = self.poll_interval
        max_interval = 30

        while True:
            elapsed = time.monotonic() - start_time
            if elapsed >= timeout:
                return "TIMEOUT", None, f"Task {task_id} exceeded timeout of {timeout}s"

            status, output_url, error = await self.check_task_status(task_id)

            # Terminal states
            if status in ("COMPLETED", "FAILED"):
                return status, output_url, error

            # Transient error -- keep polling
            if status == "ERROR":
                # Could be a network blip, keep trying until timeout
                pass

            await asyncio.sleep(interval)
            interval = min(interval * 1.5, max_interval)
