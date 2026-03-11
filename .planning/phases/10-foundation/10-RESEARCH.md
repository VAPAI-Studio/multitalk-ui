# Phase 10: Foundation - Research

**Researched:** 2026-03-11
**Domain:** Database schema, Freepik API service, batch API endpoints, upscale settings model, background task with restart recovery
**Confidence:** HIGH (architecture patterns verified in codebase; Freepik API contract is MEDIUM per owner-validated PROJECT.md)

## Summary

Phase 10 establishes the end-to-end foundation for batch video upscaling: database tables, a Freepik API service, backend API endpoints, and a background processing task that survives server restarts. The goal is narrow: a single video can be submitted, processed through Freepik, and tracked to completion in the database. No multi-video batch loop, no output delivery pipeline, no frontend -- those are Phases 11-13.

The existing codebase provides strong patterns for every component in this phase. The Freepik service follows the exact same shape as `runpod_service.py` (httpx async client, tuple returns, Settings-based config). The database migration follows the pattern of `004_add_runpod_support.sql` (idempotent DDL with existence checks). The API router follows `video_jobs.py` (auth via `get_current_user`, standard CRUD). The background task follows the `hf_download_service.py` pattern but persists state to Supabase instead of an in-memory dict. The startup recovery hook uses FastAPI's lifespan context manager (the modern replacement for the deprecated `@app.on_event("startup")`).

**Primary recommendation:** Build in strict order: (1) database migration, (2) Pydantic models, (3) FreepikUpscalerService, (4) UpscaleJobService (CRUD), (5) API router with fire-and-forget background task, (6) lifespan startup recovery, (7) Settings additions. Each step is independently testable.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Database schema supports batch and per-video tracking (new tables/migration) | Schema design in Architecture Patterns section; migration follows `004_add_runpod_support.sql` pattern; two tables `upscale_batches` + `upscale_videos` with full column spec |
| INFR-02 | Freepik API key stored as backend environment variable (FREEPIK_API_KEY) | Settings additions documented; follows existing `RUNPOD_API_KEY` pattern in `config/settings.py` |
| INFR-04 | Backend batch processor survives server restarts (resumes interrupted batches on startup) | Lifespan startup recovery pattern documented; heartbeat column for stale detection; `asyncio.create_task` with DB-backed state |
| SETT-01 | User can configure global upscale settings: resolution, creativity, sharpen, grain, FPS boost, flavor | Pydantic model `UpscaleSettings` with validated ranges; stored as individual columns on `upscale_batches` table (not JSONB) for queryability |
| SETT-02 | Settings default to sensible values (2k, creativity=0, sharpen=0, grain=0, FPS boost=off, vivid) | Defaults baked into Pydantic model with `Field(default=...)` and database column defaults |
| QUEU-01 | Videos process sequentially one at a time through the Freepik API | Background task processes single video in Phase 10; sequential loop deferred to Phase 11 but architecture supports it |
| QUEU-02 | Queue is database-backed and processing continues when user navigates away or closes browser | All state persisted to Supabase; background task runs server-side independent of client connection; startup recovery handles restarts |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | >=0.25.2 (installed) | Freepik API HTTP client | Already used by RunPod, WorldLabs, ComfyUI services; async-native with timeout handling |
| pydantic | >=2.5.1 (installed) | Request/response models, settings validation | Already used for all API models in the project |
| pydantic-settings | >=2.1.0 (installed) | `FREEPIK_API_KEY` and config | Already used in `config/settings.py` |
| supabase-py | >=2.3.0 (installed) | Batch/video state persistence | Already used for all job tracking in the project |
| FastAPI | >=0.104.1 (installed) | API endpoints, BackgroundTasks, lifespan | Already the app framework |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| asyncio (stdlib) | Built-in | `create_task` for background processing | Fire-and-forget batch task after endpoint returns |
| contextlib (stdlib) | Built-in | `asynccontextmanager` for lifespan events | Startup recovery of interrupted batches |
| uuid (stdlib) | Built-in | Batch/video ID generation (client-side) | Only if generating IDs in Python; Supabase `gen_random_uuid()` preferred |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| httpx | aiohttp | aiohttp is installed but not used by any service in the codebase; httpx is the established pattern |
| Supabase tables | In-memory dict | In-memory loses state on Heroku restart (24h cycle); fatal for multi-hour batch runs |
| BackgroundTasks/create_task | Celery/RQ | Massive overkill; adds Redis dependency, worker processes, and operational complexity for sequential single-video processing |
| Individual columns for settings | JSONB column | Individual columns enable DB-level defaults and validation; JSONB requires application-level parsing |

**Installation:**
```bash
# No new packages needed -- everything is already installed
# Verify: pip list | grep -E "httpx|pydantic|supabase|fastapi"
```

## Architecture Patterns

### Recommended Project Structure

```
backend/
├── migrations/
│   └── 007_add_upscale_batches.sql    # New tables + indexes
├── models/
│   └── upscale.py                      # Pydantic models for batch/video/settings
├── services/
│   ├── freepik_service.py              # Freepik API wrapper (submit, poll)
│   └── upscale_job_service.py          # CRUD for upscale_batches + upscale_videos
├── api/
│   └── upscale.py                      # HTTP endpoints for batch operations
├── config/
│   └── settings.py                     # + FREEPIK_API_KEY, FREEPIK_API_BASE_URL, etc.
└── main.py                             # + router registration + lifespan startup recovery
```

### Pattern 1: Service Tuple Returns

**What:** Every service method returns `Tuple[bool, Optional[T], Optional[str]]` for `(success, data, error)`.
**When to use:** All service layer methods.
**Example:**
```python
# Source: backend/services/runpod_service.py (existing pattern)
class FreepikUpscalerService:
    async def submit_task(
        self, video_url: str, params: UpscaleSettings
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Submit video to Freepik. Returns (success, task_id, error)."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/video-upscaler",
                    headers={"x-freepik-api-key": self.api_key},
                    json={...}
                )
                response.raise_for_status()
                data = response.json()
                task_id = data["data"]["task_id"]
                return True, task_id, None
        except httpx.HTTPStatusError as e:
            return False, None, f"Freepik HTTP {e.response.status_code}"
        except Exception as e:
            return False, None, str(e)
```

### Pattern 2: Fire-and-Forget Background Task with DB State

**What:** Endpoint returns immediately with batch_id; processing runs in background via `asyncio.create_task`.
**When to use:** The batch start endpoint (must respond in <1 second to avoid Heroku H12 timeout).
**Example:**
```python
# Source: Modeled on backend/services/hf_download_service.py but with DB persistence
@router.post("/batches/{batch_id}/start")
async def start_batch(batch_id: str, user=Depends(get_current_user)):
    # Validate batch exists and belongs to user
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.status != "pending":
        raise HTTPException(400, f"Batch is {batch.status}, not pending")

    # Update status in DB BEFORE launching background task
    await service.update_batch_status(batch_id, "processing")

    # Fire-and-forget: returns immediately
    asyncio.create_task(_process_batch(batch_id))

    return {"success": True, "batch_id": batch_id, "status": "processing"}
```

### Pattern 3: Lifespan Startup Recovery

**What:** On server startup, find batches stuck in "processing" status and resume them.
**When to use:** App initialization. Replaces deprecated `@app.on_event("startup")`.
**Example:**
```python
# Source: FastAPI docs (https://fastapi.tiangolo.com/advanced/events/)
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: recover interrupted batches
    service = UpscaleJobService()
    interrupted = await service.get_batches_by_status("processing")
    for batch in interrupted:
        # The video that was mid-processing when server died gets marked failed
        await service.fail_current_processing_video(batch.id, "Server restart interrupted processing")
        # Resume from next pending video
        asyncio.create_task(_process_batch(batch.id))
        print(f"[UPSCALE] Resumed interrupted batch {batch.id}")
    yield
    # Shutdown: nothing to clean up (state is in DB)

app = FastAPI(title="MultiTalk API", version="1.0.0", lifespan=lifespan)
```

### Pattern 4: Migration with Idempotent DDL

**What:** SQL migration uses `IF NOT EXISTS` and `DO $$ ... END $$` blocks for safe re-runs.
**When to use:** All database migrations.
**Example:**
```sql
-- Source: backend/migrations/004_add_runpod_support.sql (existing pattern)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'upscale_batches'
    ) THEN
        CREATE TABLE upscale_batches (...);
        RAISE NOTICE 'Created upscale_batches table';
    ELSE
        RAISE NOTICE 'upscale_batches table already exists';
    END IF;
END $$;
```

### Pattern 5: Freepik Async Task Polling

**What:** Submit task via POST, poll status via GET until terminal state.
**When to use:** Each video submission to Freepik.
**Example:**
```python
# Source: Modeled on Freepik image upscaler API pattern
# POST -> task_id; GET /task_id -> status
async def _poll_until_complete(self, task_id: str, timeout: int = 600) -> Tuple[str, Optional[str], Optional[str]]:
    """Poll Freepik task. Returns (status, output_url, error)."""
    start = time.time()
    interval = 5  # Start at 5 seconds
    while time.time() - start < timeout:
        status, output_url, error = await self.check_task_status(task_id)
        if status in ("COMPLETED", "FAILED"):
            return status, output_url, error
        await asyncio.sleep(interval)
        interval = min(interval * 1.5, 30)  # Exponential backoff, cap at 30s
    return "TIMEOUT", None, f"Task {task_id} did not complete within {timeout}s"
```

### Anti-Patterns to Avoid

- **Extending video_jobs table:** `video_jobs` has FK to `workflows` (ComfyUI-specific), requires `comfy_url` (non-nullable). Batch upscale uses Freepik, not ComfyUI. Use separate tables.
- **In-memory batch state:** The `hf_download_service.py` pattern (`_HF_JOBS: dict = {}`) loses all state on Heroku restart. All batch/video state goes to Supabase from day one.
- **Freepik API calls inside request handlers:** Any endpoint that calls Freepik synchronously will exceed Heroku's 30-second timeout. All Freepik interaction happens in background tasks.
- **Single "completed" status for dual-destination upload:** Track `supabase_upload_status` and `drive_upload_status` separately on the video record to handle partial upload failures (Phase 12 uses these columns).
- **Using `@app.on_event("startup")`:** This is deprecated in modern FastAPI/Starlette. Use the `lifespan` context manager instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for Freepik API | Custom urllib/requests wrapper | httpx.AsyncClient | Already used in 3 services; handles async, timeouts, streaming, connection pooling |
| Job state persistence | In-memory dict | Supabase tables via supabase-py | Survives restarts, supports concurrent users, enables pause/resume |
| Background task execution | Thread pool, Celery, RQ | asyncio.create_task + DB state | Sequential processing needs no distributed queue; DB state provides restart recovery |
| API authentication | Custom JWT parsing | Existing `get_current_user()` dependency | Already handles Bearer token + API key auth |
| Video upload to staging | Custom S3 code | Existing StorageService | Already handles upload_video_from_url and direct uploads |
| Settings validation | Manual range checks | Pydantic Field(ge=, le=, default=) | Declarative validation with automatic error messages |

**Key insight:** This phase introduces zero new external dependencies. Every component follows a proven pattern already in the codebase. The only genuinely new code is the Freepik service (modeled on RunPod service) and the database schema.

## Common Pitfalls

### Pitfall 1: Batch State Lost on Heroku Restart
**What goes wrong:** Using in-memory dict for batch tracking (like `hf_download_service.py`). Heroku cycles dynos at least daily, killing all in-memory state. A 10-video batch queued overnight disappears.
**Why it happens:** Copying the existing in-memory pattern without considering that batch upscale runs for hours, not seconds.
**How to avoid:** ALL state in Supabase from the start. The batch and video tables are the single source of truth. Background tasks read/write DB on every state transition. Startup recovery scans for orphaned "processing" batches.
**Warning signs:** Module-level dict variables tracking batch state; no database table for batches.

### Pitfall 2: Heroku 30-Second Timeout on Batch Start
**What goes wrong:** The batch start endpoint tries to submit the first video to Freepik synchronously, exceeding the 30-second request timeout.
**Why it happens:** Applying the single-submission pattern (ComfyUI/RunPod) to batch start, where Freepik submission + initial poll takes 5-10 seconds.
**How to avoid:** The start endpoint ONLY updates `batch.status = 'processing'` in the database and launches `asyncio.create_task()`. Response time must be <1 second. Frontend starts polling immediately after receiving the batch_id.
**Warning signs:** Any Freepik API call inside a request handler.

### Pitfall 3: Background Task Silent Failure
**What goes wrong:** The `asyncio.create_task()` background task throws an unhandled exception. Python only logs "Task exception was never retrieved" on GC. The batch stays "processing" forever.
**Why it happens:** No top-level try/except in the background task. Individual video errors propagate to the task level.
**How to avoid:** Wrap the entire processing function in `try/except Exception`. On any unhandled error, update batch status to "failed" with error message. Add `last_heartbeat` timestamp column, updated every processing cycle. On startup, detect batches where `last_heartbeat` is stale (>5 min old with status "processing").
**Warning signs:** `asyncio.create_task()` called without a done_callback or top-level exception handler.

### Pitfall 4: Freepik API Contract Mismatch
**What goes wrong:** The video upscaler API endpoint, parameters, or response format differs from the image upscaler pattern assumed in the code.
**Why it happens:** The video upscaler API is not publicly documented on docs.freepik.com as of March 2026. PROJECT.md specifies `api.freepik.com/v1/ai/video-upscaler` but this needs live validation.
**How to avoid:** Build the FreepikUpscalerService as a clean abstraction. The endpoint URL, request body keys, and response parsing are all configurable or isolated in single methods. If the API differs, changes are contained to one file. First implementation task should be a standalone test script that submits a real video and polls to completion.
**Warning signs:** Hard-coded endpoint paths and parameter names scattered across multiple files.

### Pitfall 5: Missing Columns for Later Phases
**What goes wrong:** The Phase 10 migration creates tables with only the columns needed for Phase 10. Phase 11 needs `last_heartbeat`, `pause_reason`, `retry_count`. Phase 12 needs `supabase_upload_status`, `drive_upload_status`. Each requires a new migration, slowing development.
**How to avoid:** Include ALL columns from the architecture research in the initial migration. Columns for later phases default to NULL and cost nothing. The schema from ARCHITECTURE.md already includes heartbeat, pause_reason, per-destination upload status, and retry tracking. Build the full schema once.
**Warning signs:** Planning to "add columns later" or "we'll migrate when we need it."

## Code Examples

### Database Schema (Complete for all phases)

```sql
-- Source: .planning/research/ARCHITECTURE.md, adapted for Phase 10
-- Migration: 007_add_upscale_batches.sql

-- upscale_batches: groups multiple videos for a single upscale run
CREATE TABLE IF NOT EXISTS upscale_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused', 'cancelled')),

    -- Upscale settings (individual columns, not JSONB, for queryability + DB defaults)
    resolution TEXT NOT NULL DEFAULT '2k',
    creativity INTEGER NOT NULL DEFAULT 0,
    sharpen INTEGER NOT NULL DEFAULT 0,
    grain INTEGER NOT NULL DEFAULT 0,
    fps_boost BOOLEAN NOT NULL DEFAULT false,
    flavor TEXT NOT NULL DEFAULT 'vivid',

    -- Google Drive output (Phase 12, but column exists from start)
    project_id TEXT,

    -- Counts (denormalized for fast reads)
    total_videos INTEGER NOT NULL DEFAULT 0,
    completed_videos INTEGER NOT NULL DEFAULT 0,
    failed_videos INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Processing health (Phase 11 uses, but column exists from start)
    last_heartbeat TIMESTAMPTZ,

    -- Pause/resume (Phase 11 uses, but column exists from start)
    paused_at TIMESTAMPTZ,
    pause_reason TEXT,

    -- Error
    error_message TEXT
);

-- upscale_videos: individual video within a batch
CREATE TABLE IF NOT EXISTS upscale_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES upscale_batches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused')),
    queue_position INTEGER NOT NULL,

    -- Input
    input_filename TEXT NOT NULL,
    input_storage_url TEXT NOT NULL,
    input_file_size BIGINT,

    -- Freepik tracking
    freepik_task_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,

    -- Output (Phase 12 populates, but columns exist from start)
    output_storage_url TEXT,
    output_drive_file_id TEXT,
    supabase_upload_status TEXT DEFAULT 'pending'
        CHECK (supabase_upload_status IN ('pending', 'completed', 'failed', 'skipped')),
    drive_upload_status TEXT DEFAULT 'pending'
        CHECK (drive_upload_status IN ('pending', 'completed', 'failed', 'skipped')),

    -- Metadata
    duration_seconds FLOAT,
    width INTEGER,
    height INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Error
    error_message TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_upscale_batches_user ON upscale_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upscale_batches_status ON upscale_batches(status);
CREATE INDEX IF NOT EXISTS idx_upscale_batches_heartbeat ON upscale_batches(status, last_heartbeat)
    WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_upscale_videos_batch ON upscale_videos(batch_id, queue_position);
CREATE INDEX IF NOT EXISTS idx_upscale_videos_status ON upscale_videos(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_upscale_videos_freepik ON upscale_videos(freepik_task_id)
    WHERE freepik_task_id IS NOT NULL;
```

### Pydantic Models

```python
# Source: Modeled on backend/models/video_job.py
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

# Settings model with defaults matching SETT-02
class UpscaleSettings(BaseModel):
    resolution: Literal['1k', '2k', '4k'] = Field(default='2k', description="Target resolution")
    creativity: int = Field(default=0, ge=0, le=100, description="Creativity level 0-100")
    sharpen: int = Field(default=0, ge=0, le=100, description="Sharpen level 0-100")
    grain: int = Field(default=0, ge=0, le=100, description="Smart grain level 0-100")
    fps_boost: bool = Field(default=False, description="Enable FPS boost")
    flavor: Literal['vivid', 'natural'] = Field(default='vivid', description="Output flavor")

BatchStatus = Literal['pending', 'processing', 'completed', 'failed', 'paused', 'cancelled']
VideoStatus = Literal['pending', 'processing', 'completed', 'failed', 'paused']

class CreateBatchPayload(BaseModel):
    settings: UpscaleSettings = Field(default_factory=UpscaleSettings)
    project_id: Optional[str] = None  # Google Drive folder ID

class BatchResponse(BaseModel):
    success: bool
    batch_id: Optional[str] = None
    status: Optional[BatchStatus] = None
    error: Optional[str] = None

class UpscaleVideo(BaseModel):
    id: str
    batch_id: str
    status: VideoStatus
    queue_position: int
    input_filename: str
    input_storage_url: str
    freepik_task_id: Optional[str] = None
    output_storage_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

class UpscaleBatch(BaseModel):
    id: str
    user_id: str
    status: BatchStatus
    resolution: str
    creativity: int
    sharpen: int
    grain: int
    fps_boost: bool
    flavor: str
    project_id: Optional[str] = None
    total_videos: int
    completed_videos: int
    failed_videos: int
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    videos: List[UpscaleVideo] = []

class BatchDetailResponse(BaseModel):
    success: bool
    batch: Optional[UpscaleBatch] = None
    error: Optional[str] = None
```

### FreepikUpscalerService

```python
# Source: Modeled on backend/services/runpod_service.py
import httpx
import asyncio
import time
from typing import Tuple, Optional
from config.settings import settings

class FreepikUpscalerService:
    """Wraps the Freepik Video Upscaler API. Single-video scope."""

    def __init__(self):
        self.api_key = settings.FREEPIK_API_KEY
        self.base_url = settings.FREEPIK_API_BASE_URL

    async def submit_task(
        self, video_url: str, resolution: str, creativity: int,
        sharpen: int, grain: int, fps_boost: bool, flavor: str
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Submit video to Freepik. Returns (success, task_id, error)."""
        if not self.api_key:
            return False, None, "FREEPIK_API_KEY not configured"

        headers = {
            "x-freepik-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        # Map resolution to Freepik's expected format
        resolution_map = {"1k": "1080p", "2k": "1440p", "4k": "2160p"}

        payload = {
            "video": video_url,
            "resolution": resolution_map.get(resolution, "1440p"),
            "creativity": creativity,
            "sharpen": sharpen,
            "grain": grain,
            "fps_boost": fps_boost,
            "flavor": flavor,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/video-upscaler",
                    headers=headers, json=payload
                )
                response.raise_for_status()
                data = response.json()
                task_id = data.get("data", {}).get("task_id")
                if not task_id:
                    return False, None, "Freepik did not return a task_id"
                return True, task_id, None
        except httpx.HTTPStatusError as e:
            return False, None, f"Freepik HTTP {e.response.status_code}: {e.response.text[:200]}"
        except httpx.TimeoutException:
            return False, None, "Freepik request timed out"
        except Exception as e:
            return False, None, f"Freepik error: {str(e)}"

    async def check_task_status(
        self, task_id: str
    ) -> Tuple[str, Optional[str], Optional[str]]:
        """Poll task. Returns (status, output_url, error).
        Statuses: CREATED, IN_PROGRESS, COMPLETED, FAILED."""
        headers = {"x-freepik-api-key": self.api_key}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{self.base_url}/video-upscaler/{task_id}",
                    headers=headers
                )
                response.raise_for_status()
                data = response.json().get("data", {})
                status = data.get("status", "UNKNOWN")
                output_url = None
                if status == "COMPLETED":
                    generated = data.get("generated", [])
                    output_url = generated[0] if generated else None
                error = data.get("error") if status == "FAILED" else None
                return status, output_url, error
        except httpx.HTTPStatusError as e:
            return "ERROR", None, f"Freepik HTTP {e.response.status_code}"
        except Exception as e:
            return "ERROR", None, str(e)
```

### Settings Additions

```python
# Source: Add to backend/config/settings.py
# Freepik Video Upscaler Configuration
FREEPIK_API_KEY: str = ""
FREEPIK_API_BASE_URL: str = "https://api.freepik.com/v1/ai"
FREEPIK_POLL_INTERVAL: int = 10      # seconds between status checks
FREEPIK_TASK_TIMEOUT: int = 600      # max seconds per video (10 min)
```

### API Router

```python
# Source: Modeled on backend/api/video_jobs.py
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from core.auth import get_current_user
import asyncio

router = APIRouter(prefix="/upscale", tags=["upscale"])

@router.post("/batches")
async def create_batch(payload: CreateBatchPayload, user=Depends(get_current_user)):
    """Create batch with settings. Returns batch_id."""
    # ...

@router.post("/batches/{batch_id}/videos")
async def upload_video_to_batch(
    batch_id: str, file: UploadFile = File(...), user=Depends(get_current_user)
):
    """Upload source video to batch. Stores in Supabase Storage staging area."""
    # Validate file type, size
    # Upload to Supabase Storage: multitalk-videos/upscale-inputs/{batch_id}/{filename}
    # Create upscale_videos record
    # ...

@router.post("/batches/{batch_id}/start")
async def start_batch(batch_id: str, user=Depends(get_current_user)):
    """Start processing. Returns immediately (<1s). Processing runs in background."""
    # Validate batch ownership and status
    # Update batch status to 'processing', set started_at
    # asyncio.create_task(_process_batch(batch_id))
    # Return batch_id immediately
    # ...

@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, user=Depends(get_current_user)):
    """Get batch with all video statuses. Used by frontend polling."""
    # ...

@router.get("/batches")
async def list_batches(user=Depends(get_current_user)):
    """List user's batches (paginated)."""
    # ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@app.on_event("startup")` | `lifespan` context manager | FastAPI 0.93+ / Starlette 0.27+ | Deprecated decorator still works but lifespan is the recommended pattern |
| In-memory job stores | DB-backed state | Always best practice; was acceptable in v1.0 for admin-only HF downloads | Must use DB for multi-user, multi-hour batch operations |
| Freepik 8-second video limit | 15-second limit, 450 frames, 150 MB max | Updated per current Freepik product page (March 2026) | Relaxed constraint; validation should use current limits |

**Deprecated/outdated:**
- `@app.on_event("startup")`: Deprecated in Starlette. Use `lifespan=lifespan` parameter on `FastAPI()` constructor instead. Cannot mix old and new patterns.

## Freepik API Contract Summary

**Confidence: MEDIUM** -- Based on PROJECT.md specification + image upscaler API pattern. The video upscaler API is NOT publicly documented on docs.freepik.com. The owner has confirmed the endpoint path and parameters.

| Property | Value | Source |
|----------|-------|--------|
| Base URL | `https://api.freepik.com/v1/ai` | PROJECT.md |
| Submit endpoint | `POST /video-upscaler` | PROJECT.md (inferred from image pattern) |
| Status endpoint | `GET /video-upscaler/{task_id}` | PROJECT.md (inferred from image pattern) |
| Auth header | `x-freepik-api-key: {key}` | Freepik image upscaler docs (HIGH) |
| Task statuses | CREATED -> IN_PROGRESS -> COMPLETED / FAILED | Freepik image upscaler docs (HIGH) |
| Response shape | `{ "data": { "task_id": "...", "status": "...", "generated": [...] } }` | Image upscaler docs (MEDIUM for video) |
| Rate limits | 10 hits/s sustained, 50 hits/s burst; Free=10/day, Tier 1=125/day | Freepik rate limits docs (HIGH) |
| Video limits | 15 seconds, 450 frames, 150 MB; MP4/MOV/WEBM formats | Freepik product page (MEDIUM) |
| Parameters | resolution, creativity (0-100), sharpen (0-100), grain (0-100), fps_boost (bool), flavor (vivid/natural) | Freepik product page + PROJECT.md (MEDIUM) |

**First implementation task must validate this contract with a live API call.**

## Open Questions

1. **Freepik video upscaler exact API contract**
   - What we know: PROJECT.md says `api.freepik.com/v1/ai/video-upscaler`, parameters match web UI
   - What's unclear: Exact request body field names (is it `video` or `video_url` or `video_base64`?), exact response field names, credit consumption per video
   - Recommendation: First plan task should be a standalone test script that submits a real video and logs the full request/response. Build the service abstraction after validating.

2. **Video submission format: URL or base64?**
   - What we know: Image upscaler uses base64. Video files are 10-150 MB (too large for base64 in JSON body).
   - What's unclear: Whether the video upscaler accepts a URL reference to an already-hosted video, or requires multipart upload, or uses base64
   - Recommendation: Design the FreepikUpscalerService to support URL-based submission (pass Supabase Storage public URL). If API requires base64 or multipart, adapt within the service. The service interface (`submit_task(video_url, params)`) does not need to change.

3. **Credit exhaustion error shape**
   - What we know: REST convention suggests HTTP 402 or 429 with a descriptive body
   - What's unclear: Exact HTTP status code and response body when credits are exhausted
   - Recommendation: Phase 10 does not need credit exhaustion handling (single video). Phase 11 implements it. The FreepikUpscalerService should return the raw HTTP status code and response body on errors so Phase 11 can classify them.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.0+ with pytest-asyncio (auto mode) |
| Config file | `backend/pytest.ini` (exists) |
| Quick run command | `pytest tests/ -x -v` |
| Full suite command | `pytest --cov=services --cov=api --cov-report=term-missing` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFR-01 | Batch + video tables created; CRUD works | unit | `pytest tests/test_upscale_job_service.py -x` | Wave 0 |
| INFR-02 | FREEPIK_API_KEY in settings, service reads it | unit | `pytest tests/test_freepik_service.py::test_api_key_config -x` | Wave 0 |
| INFR-04 | Startup recovery finds interrupted batches and resumes | unit | `pytest tests/test_batch_recovery.py -x` | Wave 0 |
| SETT-01 | All settings accepted with valid ranges | unit | `pytest tests/test_upscale_models.py -x` | Wave 0 |
| SETT-02 | Defaults applied when settings omitted | unit | `pytest tests/test_upscale_models.py::test_defaults -x` | Wave 0 |
| QUEU-01 | Single video submits to Freepik and polls to completion | unit (mocked) | `pytest tests/test_freepik_service.py -x` | Wave 0 |
| QUEU-02 | Background task updates DB; state survives restart simulation | integration | `pytest tests/test_batch_processing.py -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_upscale_*.py tests/test_freepik_*.py tests/test_batch_*.py -x -v`
- **Per wave merge:** `pytest --cov=services --cov=api --cov-report=term-missing`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_upscale_models.py` -- Pydantic model validation (defaults, ranges, Literal types)
- [ ] `tests/test_freepik_service.py` -- FreepikUpscalerService with mocked httpx (submit, poll, error handling)
- [ ] `tests/test_upscale_job_service.py` -- CRUD operations with mocked Supabase client
- [ ] `tests/test_upscale_api.py` -- API endpoint tests with TestClient (auth, validation, background task)
- [ ] `tests/test_batch_recovery.py` -- Startup recovery logic (find interrupted batches, resume)
- [ ] `tests/conftest.py` -- May need additional fixtures for Supabase mock, Freepik mock

## Sources

### Primary (HIGH confidence)
- Codebase: `backend/services/runpod_service.py` -- Service pattern (httpx, tuple returns)
- Codebase: `backend/services/hf_download_service.py` -- Background task pattern (asyncio.create_task)
- Codebase: `backend/services/video_job_service.py` -- Supabase CRUD pattern
- Codebase: `backend/migrations/004_add_runpod_support.sql` -- Idempotent migration pattern
- Codebase: `backend/config/settings.py` -- Settings/env var pattern
- Codebase: `backend/core/auth.py` -- Authentication dependency pattern
- [Freepik Image Upscaler POST API](https://docs.freepik.com/api-reference/image-upscaler-creative/post-image-upscaler) -- Task-based async pattern, auth header, response shape
- [Freepik Image Upscaler GET Status](https://docs.freepik.com/api-reference/image-upscaler-creative/get-image-upscaler) -- Polling pattern, status values
- [FastAPI Lifespan Events](https://fastapi.tiangolo.com/advanced/events/) -- Modern startup/shutdown pattern
- `.planning/research/ARCHITECTURE.md` -- Full component design and schema
- `.planning/research/STACK.md` -- Stack decisions and rationale
- `.planning/research/PITFALLS.md` -- 15 pitfalls with prevention strategies

### Secondary (MEDIUM confidence)
- [Freepik API Rate Limits](https://docs.freepik.com/ratelimits) -- 10 hits/s sustained, 50 hits/s burst
- [Freepik Video Upscaler Product Page](https://www.freepik.com/ai/video-upscaler) -- Parameters and limits (15s, 450 frames, 150MB)
- [Freepik Magnific Video Upscaler](https://www.freepik.com/magnific-video-upscaler) -- Parameter details (creativity, sharpen, grain, flavor)
- `.planning/PROJECT.md` -- Freepik API endpoint specification from owner

### Tertiary (LOW confidence)
- Freepik video upscaler API exact request/response format -- NOT publicly documented; inferred from image upscaler pattern and PROJECT.md specification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies, all patterns verified in codebase
- Architecture: HIGH -- Every component maps to an existing pattern in the codebase
- Database schema: HIGH -- Clean design following existing migration patterns, includes forward-looking columns
- Freepik API integration: MEDIUM -- Auth pattern confirmed via image upscaler docs; video endpoint path and params from PROJECT.md
- Pitfalls: HIGH -- 5 phase-specific pitfalls identified with concrete prevention strategies

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain; Freepik API contract is the only volatility risk)
