"""
RunPod API Router

Provides HTTP endpoints for RunPod serverless execution.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional
from pydantic import BaseModel

from services.runpod_service import RunPodService
from config.settings import settings
from core.auth import get_current_user

router = APIRouter(prefix="/runpod", tags=["runpod"])


# Request/Response Models
class SubmitWorkflowRequest(BaseModel):
    """Request to submit a workflow to RunPod"""
    workflow_name: str
    parameters: Dict[str, Any]


class SubmitWorkflowResponse(BaseModel):
    """Response from workflow submission"""
    success: bool
    job_id: Optional[str] = None
    endpoint_id: Optional[str] = None
    error: Optional[str] = None


class JobStatusResponse(BaseModel):
    """Response from job status check"""
    success: bool
    status: Optional[str] = None  # IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class RunPodHealthResponse(BaseModel):
    """Response from health check"""
    enabled: bool
    configured: bool
    error: Optional[str] = None


# API Endpoints
@router.post("/submit-workflow", response_model=SubmitWorkflowResponse)
async def submit_workflow(
    payload: SubmitWorkflowRequest,
    current_user=Depends(get_current_user)
):
    """
    Submit a workflow to RunPod serverless.

    Requires:
    - ENABLE_RUNPOD=true in settings
    - Valid RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID configured

    Process:
    1. Build workflow from template using WorkflowService
    2. Validate workflow structure
    3. Submit to RunPod serverless endpoint
    4. Return RunPod job ID for monitoring
    """
    if not settings.ENABLE_RUNPOD:
        raise HTTPException(
            status_code=503,
            detail="RunPod integration is currently disabled. Set ENABLE_RUNPOD=true to enable."
        )

    # Build full workflow JSON from template, send to universal ComfyUI endpoint
    runpod_service = RunPodService()
    success, job_id, error = await runpod_service.submit_workflow(
        workflow_name=payload.workflow_name,
        parameters=payload.parameters,
    )

    if not success:
        raise HTTPException(
            status_code=500,
            detail=error or "RunPod submission failed"
        )

    return SubmitWorkflowResponse(
        success=True,
        job_id=job_id,
        endpoint_id=settings.RUNPOD_ENDPOINT_ID,
        error=None
    )


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    endpoint_id: Optional[str] = None,
    current_user=Depends(get_current_user)
):
    """
    Get the status of a RunPod job.

    Returns:
    - IN_QUEUE: Job is waiting to be processed
    - IN_PROGRESS: Job is currently being processed
    - COMPLETED: Job finished successfully (output field will contain results)
    - FAILED: Job failed (check error message)
    """
    if not settings.ENABLE_RUNPOD:
        raise HTTPException(
            status_code=503,
            detail="RunPod integration is currently disabled"
        )

    runpod_service = RunPodService()
    success, data, error = await runpod_service.get_job_status(
        job_id,
        endpoint_id=endpoint_id
    )

    if not success:
        raise HTTPException(
            status_code=500,
            detail=error or "Failed to get job status from RunPod"
        )

    return JobStatusResponse(
        success=True,
        status=data.get("status"),
        output=data.get("output"),
        error=None
    )


@router.post("/cancel/{job_id}")
async def cancel_job(
    job_id: str,
    endpoint_id: Optional[str] = None,
    current_user=Depends(get_current_user)
):
    """
    Cancel a RunPod job.

    Note: Cancellation may not be immediate. The job might still complete
    if it's already being processed.
    """
    if not settings.ENABLE_RUNPOD:
        raise HTTPException(
            status_code=503,
            detail="RunPod integration is currently disabled"
        )

    runpod_service = RunPodService()
    success, error = await runpod_service.cancel_job(job_id, endpoint_id=endpoint_id)

    if not success:
        raise HTTPException(
            status_code=500,
            detail=error or "Failed to cancel RunPod job"
        )

    return {"success": True, "message": "Job cancellation requested"}


@router.get("/health", response_model=RunPodHealthResponse)
async def health_check():
    """
    Check if RunPod is enabled and properly configured.

    Returns:
    - enabled: Whether ENABLE_RUNPOD is set to true
    - configured: Whether RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are set
    - error: Any configuration issues

    This endpoint does NOT require authentication - it's used by the frontend
    to determine whether to show the RunPod toggle.
    """
    enabled = settings.ENABLE_RUNPOD
    configured = bool(settings.RUNPOD_API_KEY and settings.RUNPOD_ENDPOINT_ID)

    error = None
    if enabled and not configured:
        error = "RunPod is enabled but credentials are missing"

    return RunPodHealthResponse(
        enabled=enabled,
        configured=configured,
        error=error
    )


@router.get("/endpoint-info")
async def get_endpoint_info(
    endpoint_id: Optional[str] = None,
    current_user=Depends(get_current_user)
):
    """
    Get information about the RunPod endpoint.

    Useful for debugging and monitoring.
    """
    if not settings.ENABLE_RUNPOD:
        raise HTTPException(
            status_code=503,
            detail="RunPod integration is currently disabled"
        )

    runpod_service = RunPodService()
    success, data, error = await runpod_service.health_check(endpoint_id=endpoint_id)

    if not success:
        raise HTTPException(
            status_code=500,
            detail=error or "Failed to get endpoint info from RunPod"
        )

    return {
        "success": True,
        "endpoint_id": endpoint_id or settings.RUNPOD_ENDPOINT_ID,
        "data": data
    }
