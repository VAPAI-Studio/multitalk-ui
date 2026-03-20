"""
RunPod Serverless Service

Handles communication with RunPod serverless API for ComfyUI workflow execution.

Uses a single universal ComfyUI endpoint (RUNPOD_ENDPOINT_ID) that accepts full
workflow JSON. Models live on the network volume; only custom node additions
require a Dockerfile rebuild.
"""

import httpx
from typing import Tuple, Optional, Dict, Any
from config.settings import settings
from services.workflow_service import WorkflowService


class RunPodService:
    """Service for RunPod serverless execution of ComfyUI workflows."""

    BASE_URL = "https://api.runpod.io/v2"

    async def submit_workflow(
        self,
        workflow_name: str,
        parameters: Dict[str, Any],
        api_key: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a workflow to the universal RunPod ComfyUI endpoint.

        Loads the workflow template, fills parameters, and sends the full workflow
        JSON to the single RUNPOD_ENDPOINT_ID. The universal handler on RunPod
        forwards it to its internal ComfyUI instance.

        Args:
            workflow_name: Workflow template name (e.g., 'VideoLipsync', 'WANI2V')
            parameters: Template parameters to substitute (e.g., filenames, prompts)
            api_key: RunPod API key (uses settings.RUNPOD_API_KEY if not provided)

        Returns:
            Tuple of (success, job_id, error_message)
        """
        api_key = api_key or settings.RUNPOD_API_KEY

        if not api_key:
            return False, None, "RunPod API key not configured. Please set RUNPOD_API_KEY."

        endpoint_id = settings.RUNPOD_ENDPOINT_ID
        if not endpoint_id:
            return False, None, "RUNPOD_ENDPOINT_ID not configured. Set it to your universal ComfyUI serverless endpoint."

        # Build full workflow JSON (same as the ComfyUI path)
        workflow_service = WorkflowService()
        build_success, workflow_json, build_error = await workflow_service.build_workflow(workflow_name, parameters)
        if not build_success:
            return False, None, f"Failed to build workflow '{workflow_name}': {build_error}"

        url = f"{self.BASE_URL}/{endpoint_id}/run"

        # Send the full workflow JSON — universal handler forwards it to ComfyUI
        payload = {
            "input": {"workflow": workflow_json}
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()

                data = response.json()
                job_id = data.get("id")

                if not job_id:
                    return False, None, "RunPod did not return a valid job ID"

                return True, job_id, None

        except httpx.TimeoutException:
            return False, None, "RunPod request timed out after 30 seconds"
        except httpx.HTTPStatusError as e:
            error_detail = f"RunPod HTTP error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except:
                pass
            return False, None, error_detail
        except httpx.RequestError as e:
            return False, None, f"RunPod request failed: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected RunPod error: {str(e)}"

    async def submit_built_workflow(
        self,
        workflow_json: dict,
        api_key: Optional[str] = None,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a pre-built workflow dict directly to the RunPod universal endpoint.

        Used by execute_dynamic_workflow_runpod to avoid double template loading.
        The workflow_json has already been built and validated by the caller.

        Args:
            workflow_json: Fully built ComfyUI workflow dict (all placeholders substituted).
            api_key: RunPod API key (uses settings.RUNPOD_API_KEY if not provided).

        Returns:
            Tuple of (success, job_id, error_message)
        """
        api_key = api_key or settings.RUNPOD_API_KEY
        if not api_key:
            return False, None, "RunPod API key not configured."

        endpoint_id = settings.RUNPOD_ENDPOINT_ID
        if not endpoint_id:
            return False, None, "RUNPOD_ENDPOINT_ID not configured."

        url = f"{self.BASE_URL}/{endpoint_id}/run"
        payload = {"input": {"workflow": workflow_json}}
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                job_id = data.get("id")
                if not job_id:
                    return False, None, "RunPod did not return a valid job ID"
                return True, job_id, None
        except httpx.TimeoutException:
            return False, None, "RunPod request timed out after 30 seconds"
        except httpx.HTTPStatusError as e:
            error_detail = f"RunPod HTTP error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except Exception:
                pass
            return False, None, error_detail
        except httpx.RequestError as e:
            return False, None, f"RunPod request failed: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected RunPod error: {str(e)}"

    async def get_job_status(
        self,
        job_id: str,
        endpoint_id: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Get the status of a RunPod job.

        Args:
            job_id: RunPod job ID
            endpoint_id: RunPod endpoint ID (uses settings.RUNPOD_ENDPOINT_ID if not provided)
            api_key: RunPod API key (uses settings.RUNPOD_API_KEY if not provided)

        Returns:
            Tuple of (success, status_data, error_message)
            - success: True if status check succeeded
            - status_data: Dictionary with job status and output (if completed)
            - error_message: Error description if failed, None otherwise

        Status data format:
        {
            "id": "job-id",
            "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED",
            "output": {...}  // Present when status is COMPLETED
        }
        """
        endpoint_id = endpoint_id or settings.RUNPOD_ENDPOINT_ID
        api_key = api_key or settings.RUNPOD_API_KEY

        if not endpoint_id or not api_key:
            return False, None, "RunPod credentials not configured"

        url = f"{self.BASE_URL}/{endpoint_id}/status/{job_id}"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()

                data = response.json()
                return True, data, None

        except httpx.TimeoutException:
            return False, None, "RunPod status check timed out after 10 seconds"
        except httpx.HTTPStatusError as e:
            error_detail = f"RunPod HTTP error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except:
                pass
            return False, None, error_detail
        except httpx.RequestError as e:
            return False, None, f"RunPod status check failed: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected RunPod error: {str(e)}"

    async def cancel_job(
        self,
        job_id: str,
        endpoint_id: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Cancel a RunPod job.

        Args:
            job_id: RunPod job ID
            endpoint_id: RunPod endpoint ID (uses settings.RUNPOD_ENDPOINT_ID if not provided)
            api_key: RunPod API key (uses settings.RUNPOD_API_KEY if not provided)

        Returns:
            Tuple of (success, error_message)
            - success: True if cancellation succeeded
            - error_message: Error description if failed, None otherwise
        """
        endpoint_id = endpoint_id or settings.RUNPOD_ENDPOINT_ID
        api_key = api_key or settings.RUNPOD_API_KEY

        if not endpoint_id or not api_key:
            return False, "RunPod credentials not configured"

        url = f"{self.BASE_URL}/{endpoint_id}/cancel/{job_id}"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers)
                response.raise_for_status()
                return True, None

        except httpx.HTTPStatusError as e:
            error_detail = f"RunPod cancel failed with HTTP {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "error" in error_json:
                    error_detail += f": {error_json['error']}"
            except:
                pass
            return False, error_detail
        except httpx.RequestError as e:
            return False, f"RunPod cancel request failed: {str(e)}"
        except Exception as e:
            return False, f"Unexpected RunPod cancel error: {str(e)}"

    async def health_check(
        self,
        endpoint_id: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Check if RunPod endpoint is healthy and accessible.

        Args:
            endpoint_id: RunPod endpoint ID (uses settings.RUNPOD_ENDPOINT_ID if not provided)
            api_key: RunPod API key (uses settings.RUNPOD_API_KEY if not provided)

        Returns:
            Tuple of (success, health_data, error_message)
            - success: True if endpoint is accessible
            - health_data: Endpoint information if available
            - error_message: Error description if failed, None otherwise
        """
        endpoint_id = endpoint_id or settings.RUNPOD_ENDPOINT_ID
        api_key = api_key or settings.RUNPOD_API_KEY

        if not endpoint_id or not api_key:
            return False, None, "RunPod credentials not configured"

        url = f"{self.BASE_URL}/{endpoint_id}/health"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()

                data = response.json()
                return True, data, None

        except httpx.TimeoutException:
            return False, None, "RunPod health check timed out"
        except httpx.HTTPStatusError as e:
            return False, None, f"RunPod health check failed with HTTP {e.response.status_code}"
        except httpx.RequestError as e:
            return False, None, f"RunPod health check request failed: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected RunPod health check error: {str(e)}"
