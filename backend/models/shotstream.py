"""
Pydantic models for ShotStream — streaming multi-shot video generation.

Reference: https://github.com/KlingAIResearch/ShotStream

ShotStream runs as its OWN local HTTP service on the same machine as ComfyUI
(different port). The backend proxies to it via ShotStreamService. This module
defines the public contract exposed by `/api/shotstream/*` to the frontend.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal


class Shot(BaseModel):
    """A single shot in a multi-shot sequence."""
    prompt: str = Field(..., description="Text prompt for this shot")
    duration_sec: float = Field(
        3.0,
        ge=1.0,
        le=10.0,
        description="Duration of this shot in seconds"
    )


class ShotStreamSubmitRequest(BaseModel):
    """Request to submit a multi-shot generation job."""
    shots: List[Shot] = Field(
        ...,
        min_length=1,
        max_length=8,
        description="Ordered list of shots to generate"
    )
    width: int = Field(480, ge=64, le=1024, description="Frame width (px)")
    height: int = Field(832, ge=64, le=1024, description="Frame height (px)")
    seed: Optional[int] = Field(
        None,
        description="Random seed; None = random"
    )
    fps: int = Field(16, ge=8, le=30, description="Target frames per second")


class ShotStreamSubmitResponse(BaseModel):
    success: bool
    job_id: Optional[str] = None
    error: Optional[str] = None


ShotStreamStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class ShotStreamStatusResponse(BaseModel):
    success: bool
    job_id: str
    status: ShotStreamStatus
    progress: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="0.0 to 1.0, if the local service reports it"
    )
    output_url: Optional[str] = Field(
        None,
        description="URL to the finished MP4 (served by the local ShotStream "
                    "service or proxied through this backend)"
    )
    error: Optional[str] = None


class ShotStreamCancelResponse(BaseModel):
    success: bool
    error: Optional[str] = None


class ShotStreamHealthResponse(BaseModel):
    enabled: bool = Field(..., description="ENABLE_SHOTSTREAM flag")
    configured: bool = Field(..., description="SHOTSTREAM_SERVICE_URL is set")
    reachable: bool = Field(..., description="Local service responded to /health")
    service_url: Optional[str] = None
    device: Optional[str] = Field(None, description="Reported by local service (e.g. cuda:0)")
    error: Optional[str] = None
