"""Pydantic schemas — must match backend/services/shotstream_service.py contract."""

from typing import List, Optional

from pydantic import BaseModel, Field


class Shot(BaseModel):
    prompt: str
    duration_sec: float = Field(3.0, ge=1.0, le=10.0)


class GenerateRequest(BaseModel):
    shots: List[Shot] = Field(..., min_length=1, max_length=8)
    width: int = Field(480, ge=64, le=1024)
    height: int = Field(832, ge=64, le=1024)
    seed: Optional[int] = None
    fps: int = Field(16, ge=8, le=30)


class GenerateResponse(BaseModel):
    job_id: str


class JobStatus(BaseModel):
    status: str  # queued | running | completed | failed | cancelled
    progress: Optional[float] = None
    output_url: Optional[str] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    device: Optional[str] = None
    pipeline_loaded: bool
    config_path: Optional[str] = None
    ckpt_path: Optional[str] = None


class CancelResponse(BaseModel):
    cancelled: bool
