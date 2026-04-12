"""
ShotStream API Router.

Proxies requests to a locally-hosted ShotStream daemon. See
`services/shotstream_service.py` for the expected daemon contract.
"""

from fastapi import APIRouter, Depends, HTTPException

from config.settings import settings
from core.auth import get_current_user
from models.shotstream import (
    ShotStreamCancelResponse,
    ShotStreamHealthResponse,
    ShotStreamStatusResponse,
    ShotStreamSubmitRequest,
    ShotStreamSubmitResponse,
)
from services.shotstream_service import ShotStreamService

router = APIRouter(prefix="/shotstream", tags=["shotstream"])


@router.post("/submit", response_model=ShotStreamSubmitResponse)
async def submit_shotstream_job(
    payload: ShotStreamSubmitRequest,
    current_user=Depends(get_current_user),
):
    """Submit a multi-shot generation job to the local ShotStream daemon."""
    if not settings.ENABLE_SHOTSTREAM:
        raise HTTPException(
            status_code=503,
            detail="ShotStream is disabled. Set ENABLE_SHOTSTREAM=true to enable.",
        )

    service = ShotStreamService()
    success, job_id, error = await service.submit(payload.model_dump())
    if not success:
        raise HTTPException(status_code=502, detail=error or "ShotStream submit failed")

    return ShotStreamSubmitResponse(success=True, job_id=job_id)


@router.get("/status/{job_id}", response_model=ShotStreamStatusResponse)
async def get_shotstream_status(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Poll job status from the local ShotStream daemon."""
    if not settings.ENABLE_SHOTSTREAM:
        raise HTTPException(status_code=503, detail="ShotStream is disabled")

    service = ShotStreamService()
    success, data, error = await service.status(job_id)
    if not success or data is None:
        raise HTTPException(status_code=502, detail=error or "ShotStream status failed")

    return ShotStreamStatusResponse(
        success=True,
        job_id=job_id,
        status=data.get("status", "queued"),
        progress=data.get("progress"),
        output_url=data.get("output_url"),
        error=data.get("error"),
    )


@router.post("/cancel/{job_id}", response_model=ShotStreamCancelResponse)
async def cancel_shotstream_job(
    job_id: str,
    current_user=Depends(get_current_user),
):
    """Ask the local daemon to cancel a running job."""
    if not settings.ENABLE_SHOTSTREAM:
        raise HTTPException(status_code=503, detail="ShotStream is disabled")

    service = ShotStreamService()
    success, error = await service.cancel(job_id)
    if not success:
        raise HTTPException(status_code=502, detail=error or "ShotStream cancel failed")

    return ShotStreamCancelResponse(success=True)


@router.get("/health", response_model=ShotStreamHealthResponse)
async def shotstream_health():
    """
    Report ShotStream availability. Public (no auth) so the frontend can
    decide whether to render the toggle / page.
    """
    enabled = settings.ENABLE_SHOTSTREAM
    service_url = settings.SHOTSTREAM_SERVICE_URL or None
    configured = bool(service_url)

    if not enabled or not configured:
        return ShotStreamHealthResponse(
            enabled=enabled,
            configured=configured,
            reachable=False,
            service_url=service_url,
            error=None if enabled else "ShotStream is disabled",
        )

    service = ShotStreamService()
    reachable, data, error = await service.health()
    return ShotStreamHealthResponse(
        enabled=enabled,
        configured=configured,
        reachable=reachable,
        service_url=service_url,
        device=(data or {}).get("device"),
        error=error,
    )
