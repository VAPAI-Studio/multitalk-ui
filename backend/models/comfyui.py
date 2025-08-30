from pydantic import BaseModel
from typing import Optional, List, Any

class QueueStatus(BaseModel):
    queue_running: List[Any]
    queue_pending: List[Any]

class SystemDevice(BaseModel):
    name: str
    type: str
    vram_total: Optional[int] = None
    vram_free: Optional[int] = None

class SystemInfo(BaseModel):
    python_version: Optional[str] = None
    torch_version: Optional[str] = None

class SystemStats(BaseModel):
    system: Optional[SystemInfo] = None
    devices: Optional[List[SystemDevice]] = None

class ComfyUIStatus(BaseModel):
    connected: bool
    queue: Optional[QueueStatus] = None
    system_stats: Optional[SystemStats] = None
    error: Optional[str] = None
    base_url: Optional[str] = None

class ComfyUIStatusResponse(BaseModel):
    success: bool
    status: Optional[ComfyUIStatus] = None
    error: Optional[str] = None