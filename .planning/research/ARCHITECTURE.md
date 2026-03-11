# Architecture Research: Batch Video Upscale with Freepik API

**Research Date:** 2026-03-11
**Dimension:** Architecture
**Question:** How does a batch video upscale feature with an external API (Freepik) integrate with the existing architecture?
**Milestone Context:** v1.1 -- Adding batch video upscale to existing AI media processing app with FastAPI + React stack, Supabase DB/Storage, Google Drive integration.

---

## 1. Component Inventory

The batch video upscale feature decomposes into seven components. Each maps to existing architectural patterns or introduces a new pattern only where necessary.

### Component A: Freepik Video Upscaler Service

**Purpose:** Wrap the Freepik Video Upscaler API (`api.freepik.com/v1/ai/video-upscaler`) in a backend service class, handling authentication, submission, polling, and result retrieval.

**Boundaries:**
- Backend only. No frontend-to-Freepik communication.
- Encapsulates all Freepik-specific logic: API key auth, request formatting, task status polling, output URL retrieval.
- Does NOT manage batch sequencing (that is Component C's job).
- Handles a single video upscale task: submit, poll, return result.

**Interface:**
```python
class FreepikUpscalerService:
    async def submit_task(
        self, video_url: str, params: UpscaleParams
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Submit video to Freepik. Returns (success, task_id, error)."""

    async def check_task_status(
        self, task_id: str
    ) -> Tuple[str, Optional[str], Optional[str]]:
        """Poll task. Returns (status, output_url, error).
        Statuses: CREATED, IN_PROGRESS, COMPLETED, FAILED."""

    async def check_credits(self) -> Tuple[bool, Optional[int], Optional[str]]:
        """Check remaining credits. Returns (success, credits_remaining, error)."""
```

**Integration with existing architecture:**
- New service: `backend/services/freepik_service.py`
- Follows existing service tuple-return pattern: `(success, data, error)`
- Uses `httpx.AsyncClient` for API calls (same as `runpod_service.py`)
- New config in `backend/config/settings.py`: `FREEPIK_API_KEY`
- Auth: `x-freepik-api-key` header (stored server-side, never exposed to frontend)

**Freepik API Pattern (based on PROJECT.md and image upscaler API pattern):**
```
POST api.freepik.com/v1/ai/video-upscaler
Headers: x-freepik-api-key: <key>
Body: { video (base64 or URL), resolution, creativity, sharpen, grain, fps_boost, flavor }
Response: { data: { task_id, status: "CREATED" } }

GET api.freepik.com/v1/ai/video-upscaler/{task_id}
Response: { data: { task_id, status, generated: [{ url }] } }
```

**Confidence:** MEDIUM -- The Freepik video upscaler API endpoint path and parameters are specified in PROJECT.md but the API documentation is not publicly indexed. The architecture is designed to match the confirmed Freepik image upscaler API pattern (POST to submit, GET to poll with task_id, statuses CREATED/IN_PROGRESS/COMPLETED/FAILED). The exact video endpoint may differ in parameter naming; this should be validated during implementation.

---

### Component B: Batch Job Manager

**Purpose:** Orchestrate sequential processing of a batch of videos. One video at a time to Freepik, advancing through a queue, detecting credit exhaustion, pausing, and resuming.

**Boundaries:**
- Backend. Runs as a background loop (FastAPI BackgroundTask or asyncio task).
- Owns the batch lifecycle: pending -> processing -> completed/failed/paused.
- Calls Component A (FreepikUpscalerService) for individual video tasks.
- Calls Component D (Output Delivery) when a video completes.
- Updates database records (Component E) as videos progress.
- Does NOT handle HTTP requests directly (Component F does that).

**Interface:**
```python
class BatchJobManager:
    async def start_batch(self, batch_id: str) -> None:
        """Begin processing videos in batch sequentially.
        Runs as background task. Self-manages until batch completes or pauses."""

    async def resume_batch(self, batch_id: str) -> None:
        """Resume a paused batch (after credits refilled)."""

    async def cancel_batch(self, batch_id: str) -> None:
        """Cancel remaining unprocessed videos in batch."""
```

**Key behaviors:**
1. Pop next pending video from batch queue
2. Submit to Freepik via Component A
3. Poll for completion (3-second intervals, matching RunPod pattern)
4. On COMPLETED: trigger output delivery, mark video as completed, advance to next
5. On FAILED: mark video as failed, advance to next (don't halt batch for single failures)
6. On credit exhaustion (HTTP 402 or credit check returns 0): pause entire batch, notify frontend
7. On resume: re-check credits, continue from where paused

**Integration with existing architecture:**
- New module: `backend/services/batch_manager.py`
- Background task pattern: matches `hf_download_service.py` in-memory job tracking approach, except backed by Supabase (persistent across restarts since batches can run for hours)
- Polling pattern: matches the existing ComfyUI and RunPod polling (3s intervals)

---

### Component C: Database Schema (Batch + Video Tracking)

**Purpose:** Store batch metadata and per-video status in Supabase, enabling progress tracking, pause/resume, and history.

**Schema Design:**

```sql
-- Batch: groups multiple videos for a single upscale run
CREATE TABLE upscale_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused', 'cancelled')),

    -- Upscale parameters (shared across all videos in batch)
    resolution TEXT,           -- e.g., '1080p', '4k'
    creativity INTEGER DEFAULT 0,
    sharpen BOOLEAN DEFAULT false,
    grain TEXT DEFAULT 'none',
    fps_boost BOOLEAN DEFAULT false,
    flavor TEXT DEFAULT 'standard',

    -- Google Drive output
    project_id TEXT,           -- Google Drive folder ID (from ProjectContext)
    drive_subfolder TEXT DEFAULT 'AI-Upscaled',

    -- Counts (denormalized for fast reads)
    total_videos INTEGER NOT NULL DEFAULT 0,
    completed_videos INTEGER NOT NULL DEFAULT 0,
    failed_videos INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Pause/resume
    paused_at TIMESTAMPTZ,
    pause_reason TEXT,         -- e.g., 'credit_exhaustion'

    -- Error
    error_message TEXT
);

-- Individual video within a batch
CREATE TABLE upscale_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES upscale_batches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    queue_position INTEGER NOT NULL,  -- Order within batch

    -- Input
    input_filename TEXT NOT NULL,
    input_storage_url TEXT NOT NULL,  -- Supabase Storage URL of uploaded source video
    input_file_size BIGINT,          -- bytes

    -- Freepik tracking
    freepik_task_id TEXT,

    -- Output
    output_storage_url TEXT,         -- Supabase Storage URL of upscaled video
    output_drive_file_id TEXT,       -- Google Drive file ID (if uploaded)

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

-- Indexes for common queries
CREATE INDEX idx_upscale_batches_user ON upscale_batches(user_id, created_at DESC);
CREATE INDEX idx_upscale_batches_status ON upscale_batches(status);
CREATE INDEX idx_upscale_videos_batch ON upscale_videos(batch_id, queue_position);
CREATE INDEX idx_upscale_videos_status ON upscale_videos(batch_id, status);
```

**Why separate tables (not extending video_jobs):**
- `video_jobs` is tightly coupled to ComfyUI/RunPod execution (comfy_job_id, comfy_url, workflow_id FK to workflows table). Batch upscale uses Freepik, not ComfyUI.
- Batch concept (parent with ordered children) does not exist in the current flat `video_jobs` model.
- The batch has its own lifecycle (pause/resume) that is architecturally distinct from single-job tracking.
- Avoids schema pollution of the existing, working job system.

**Integration with existing architecture:**
- New migration: `backend/migrations/007_add_upscale_batches.sql`
- New Pydantic models: `backend/models/upscale.py`
- New service: `backend/services/upscale_job_service.py` (CRUD operations, follows `VideoJobService` pattern)
- Supabase client: reuses existing `core/supabase.py` singleton

---

### Component D: Output Delivery Pipeline

**Purpose:** When Freepik completes an upscaled video, download it and deliver to both Supabase Storage and Google Drive.

**Data Flow:**
```
Freepik API (completed task)
  |
  | GET output URL from task status response
  v
Backend downloads video bytes (httpx streaming)
  |
  +---> Upload to Supabase Storage (multitalk-videos bucket)
  |       Returns: public URL for in-app viewing
  |
  +---> Upload to Google Drive (if project_id set)
          Uses existing GoogleDriveService
          Creates "AI-Upscaled" subfolder in project folder
          Returns: Drive file ID
```

**Integration with existing architecture:**
- Reuses `StorageService.upload_video_from_url()` -- already handles download-from-URL and upload-to-Supabase pattern (see existing `storage_service.py` line 386-467)
- Reuses `GoogleDriveService.get_or_create_folder()` + `upload_file()` -- already handles folder creation and file upload to shared drive (see existing `google_drive_service.py`)
- Pattern matches existing `video_jobs.py` complete endpoint (lines 263-344) which already does Supabase upload + Google Drive upload on job completion
- Key difference: Freepik returns a URL (not ComfyUI view endpoint), so `upload_video_from_url()` is the right method

**No new service needed.** This is orchestration logic inside `BatchJobManager`, calling existing services.

---

### Component E: Backend API Layer

**Purpose:** HTTP endpoints for the frontend to create batches, upload source videos, check status, pause/resume, and cancel.

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upscale/batches` | Create batch with parameters, receive batch_id |
| POST | `/api/upscale/batches/{batch_id}/videos` | Upload source video to batch (multipart) |
| POST | `/api/upscale/batches/{batch_id}/start` | Start processing the batch |
| GET | `/api/upscale/batches/{batch_id}` | Get batch status with all video statuses |
| GET | `/api/upscale/batches` | List user's batches (paginated) |
| POST | `/api/upscale/batches/{batch_id}/resume` | Resume paused batch |
| POST | `/api/upscale/batches/{batch_id}/cancel` | Cancel remaining videos |
| DELETE | `/api/upscale/batches/{batch_id}/videos/{video_id}` | Remove video from pending batch |

**Integration with existing architecture:**
- New router: `backend/api/upscale.py`
- Registered in `main.py`: `app.include_router(upscale.router, prefix="/api")`
- Auth: uses existing `get_current_user()` dependency (all authenticated users, not admin-only)
- File upload: multipart form handling (same pattern as `storage.py`)
- Source videos uploaded to Supabase Storage first (frontend -> backend -> Supabase), then Freepik processes from URL

**Video upload flow (source videos):**
```
Frontend (multi-file picker)
  |
  | POST /api/upscale/batches/{batch_id}/videos
  | Content-Type: multipart/form-data
  | Body: video file
  v
Backend (upscale.py router)
  |
  | Auth check (get_current_user)
  | Validate file type/size
  v
Backend uploads to Supabase Storage
  | bucket: multitalk-videos, path: upscale-inputs/{batch_id}/{filename}
  |
  | Creates upscale_videos record with input_storage_url
  v
Returns: video_id, queue_position
```

---

### Component F: Frontend Page + State Management

**Purpose:** Feature page for batch video upscale with file upload, parameter controls, batch progress display, and results.

**Component structure:**
```
frontend/src/pages/BatchUpscale.tsx        -- Main page component
frontend/src/components/BatchUploadZone.tsx -- Multi-file upload with drag-drop
frontend/src/components/BatchProgress.tsx   -- Batch status + per-video progress
frontend/src/hooks/useBatchUpscale.ts       -- State management + polling hook
```

**State management approach:**

```typescript
interface BatchState {
  // Batch metadata
  batchId: string | null;
  batchStatus: 'idle' | 'uploading' | 'pending' | 'processing' | 'completed' | 'paused' | 'failed';

  // Videos in batch
  videos: UpscaleVideo[];  // { id, filename, status, progress, outputUrl, error }

  // Upscale parameters
  params: {
    resolution: string;
    creativity: number;
    sharpen: boolean;
    grain: string;
    fps_boost: boolean;
    flavor: string;
  };

  // Progress summary
  totalVideos: number;
  completedVideos: number;
  failedVideos: number;

  // Pause state
  isPaused: boolean;
  pauseReason: string | null;
}
```

**Polling strategy:**
- When batch is `processing`: poll `GET /api/upscale/batches/{batch_id}` every 5 seconds
- Response includes all video statuses, so a single poll updates the entire UI
- Stop polling when batch reaches terminal state (completed, failed, cancelled)
- Use `useEffect` cleanup to stop polling on unmount

**Integration with existing architecture:**
- New studio entry in `studioConfig.ts` under Video Studio (alongside existing Video Upscale)
- Or: replace existing `upscale-vid` app with enhanced batch version
- Uses existing `ProjectContext` for Google Drive folder selection (already in header via `ProjectSelector`)
- Uses existing `apiClient` for all backend calls (add new methods)
- Page layout follows existing pattern: main content + ResizableFeedSidebar (though feed shows batch history, not ComfyUI jobs)
- Navigation: added to Video Studio group in sidebar

---

### Component G: Credit Monitoring + Pause/Resume

**Purpose:** Detect Freepik credit exhaustion and manage the pause-notify-resume cycle.

**Detection strategy:**
- Primary: HTTP 402 or 429 response from Freepik API on task submission = out of credits
- Secondary: Explicit credit check endpoint (if Freepik provides one)
- Tertiary: Rate limit tracking in-memory (count submissions, compare to known limits)

**Pause flow:**
```
BatchJobManager detects credit exhaustion
  |
  | 1. Update batch status to 'paused' in DB
  | 2. Set pause_reason = 'credit_exhaustion'
  | 3. Set paused_at timestamp
  v
Frontend (polling) detects batch.status === 'paused'
  |
  | Show banner: "Credits exhausted. Add credits and click Resume."
  | Show Resume button
  v
User clicks Resume
  |
  | POST /api/upscale/batches/{batch_id}/resume
  v
BatchJobManager.resume_batch()
  |
  | 1. Check credits (optional validation)
  | 2. Update batch status to 'processing'
  | 3. Restart background loop from next pending video
  v
Processing continues
```

**Integration with existing architecture:**
- No new components needed. This is behavior within `BatchJobManager` + frontend polling.
- Pause/resume is a state transition in the database, handled by existing CRUD patterns.

---

## 2. Data Flow

### Complete Batch Upscale Flow (End-to-End)

```
User (Browser)
  |
  | 1. Select videos (multi-file picker)
  | 2. Set upscale parameters (resolution, creativity, etc.)
  | 3. Confirm Google Drive project (ProjectContext in header)
  | 4. Click "Start Batch"
  v
Frontend (BatchUpscale.tsx)
  |
  | POST /api/upscale/batches  (create batch with params)
  | POST /api/upscale/batches/{id}/videos x N  (upload each video)
  | POST /api/upscale/batches/{id}/start  (begin processing)
  v
Backend API (upscale.py)
  |
  | Creates batch + video records in Supabase
  | Uploads source videos to Supabase Storage
  | Spawns BatchJobManager.start_batch() as background task
  v
BatchJobManager (batch_manager.py)  [background loop]
  |
  | FOR EACH pending video (sequential):
  |   |
  |   | 1. Download source from Supabase Storage URL
  |   | 2. Submit to Freepik API
  |   |      POST api.freepik.com/v1/ai/video-upscaler
  |   |      Body: { video, resolution, creativity, ... }
  |   |      Response: { task_id }
  |   |
  |   | 3. Poll Freepik every 3s
  |   |      GET api.freepik.com/v1/ai/video-upscaler/{task_id}
  |   |      Until: COMPLETED or FAILED
  |   |
  |   | 4. On COMPLETED:
  |   |      Download output from Freepik URL
  |   |      Upload to Supabase Storage (StorageService.upload_video_from_url)
  |   |      Upload to Google Drive (GoogleDriveService.upload_file) -- if project_id set
  |   |      Update upscale_videos record (output URLs, status=completed)
  |   |      Increment batch.completed_videos
  |   |
  |   | 5. On FAILED:
  |   |      Update upscale_videos record (error, status=failed)
  |   |      Increment batch.failed_videos
  |   |      Continue to next video (don't halt batch)
  |   |
  |   | 6. On CREDIT EXHAUSTION (402/429):
  |   |      Update batch status=paused, pause_reason=credit_exhaustion
  |   |      EXIT loop (wait for resume)
  |
  | After all videos: Update batch status=completed (or failed if all failed)
  v
Frontend (polling every 5s)
  |
  | GET /api/upscale/batches/{id}
  | Updates BatchProgress component with per-video statuses
  | Shows completed video thumbnails/previews
  | Handles pause state (resume button)
  v
User sees results in-app (Supabase URLs)
User finds organized files in Google Drive (AI-Upscaled folder)
```

### Source Video Upload Flow

```
User drags videos into upload zone
  |
  v
Frontend (BatchUploadZone.tsx)
  |
  | For each file (sequential or parallel with limit):
  |   POST /api/upscale/batches/{batch_id}/videos
  |   Content-Type: multipart/form-data
  |   Body: video file bytes
  v
Backend (upscale.py)
  |
  | Validate: file type (mp4, mov, webm, avi, mkv), size limit
  | Upload to Supabase Storage: multitalk-videos/upscale-inputs/{batch_id}/{filename}
  v
Supabase Storage
  |
  | Returns: public URL
  v
Backend creates upscale_videos record
  | { batch_id, input_filename, input_storage_url, queue_position, status: 'pending' }
  v
Frontend adds video to local state list
```

### Output Delivery Flow (per video)

```
Freepik COMPLETED status
  |
  | task status response contains output URL
  v
BatchJobManager
  |
  +---> StorageService.upload_video_from_url(freepik_output_url)
  |       |
  |       | Downloads video bytes from Freepik
  |       | Uploads to Supabase: multitalk-videos/upscale-outputs/{date}/{batch_id}_{filename}
  |       | Returns: Supabase public URL
  |       v
  |     Update upscale_videos.output_storage_url
  |
  +---> GoogleDriveService (if batch.project_id is set)
          |
          | get_or_create_folder(project_id, "AI-Upscaled")
          | upload_file(video_bytes, filename, folder_id)
          | Returns: Drive file ID
          v
        Update upscale_videos.output_drive_file_id
```

---

## 3. Integration Surface with Existing Architecture

### Backend: What Already Exists and Gets Reused

| Existing Component | How It's Reused | Modification Needed |
|---|---|---|
| `core/supabase.py` | DB client for batch/video records | None |
| `config/settings.py` | New `FREEPIK_API_KEY` config | Add one field |
| `services/storage_service.py` | `upload_video_from_url()` for output delivery | None |
| `services/google_drive_service.py` | `get_or_create_folder()` + `upload_file()` for Drive output | None |
| `core/auth.py` | `get_current_user()` for endpoint protection | None |
| `main.py` | Router registration | Add one `include_router` line |

### Backend: What's New

| New Component | File | Purpose |
|---|---|---|
| Freepik service | `backend/services/freepik_service.py` | Freepik API wrapper (submit, poll, credit check) |
| Batch manager | `backend/services/batch_manager.py` | Sequential processing loop, pause/resume logic |
| Upscale job service | `backend/services/upscale_job_service.py` | CRUD for batch + video records in Supabase |
| API router | `backend/api/upscale.py` | HTTP endpoints for frontend |
| Pydantic models | `backend/models/upscale.py` | Request/response models |
| DB migration | `backend/migrations/007_add_upscale_batches.sql` | Tables + indexes |

### Frontend: What Already Exists and Gets Reused

| Existing Component | How It's Reused | Modification Needed |
|---|---|---|
| `contexts/ProjectContext.tsx` | Google Drive folder selection | None |
| `lib/apiClient.ts` | HTTP client with auth | Add new methods |
| `lib/studioConfig.ts` | Navigation config | Add app entry or modify existing |
| `components/ResizableFeedSidebar.tsx` | Sidebar for batch history | None (configure with new context) |
| `contexts/AuthContext.tsx` | User identity for batch ownership | None |

### Frontend: What's New

| New Component | File | Purpose |
|---|---|---|
| Batch upscale page | `frontend/src/pages/BatchUpscale.tsx` | Main feature page |
| Upload zone | `frontend/src/components/BatchUploadZone.tsx` | Multi-file drag-drop upload |
| Batch progress | `frontend/src/components/BatchProgress.tsx` | Per-video status display |
| Batch hook | `frontend/src/hooks/useBatchUpscale.ts` | State management + polling |

### External Service: Freepik API

| Concern | Detail |
|---|---|
| Auth | `x-freepik-api-key` header, single global key (like RunPod pattern) |
| Rate limits | Free=10/day, Tier 1=125/day (from PROJECT.md) |
| Async pattern | POST to submit, GET to poll with task_id |
| Statuses | CREATED -> IN_PROGRESS -> COMPLETED/FAILED |
| Credit pricing | Frame-based (longer/higher-res videos cost more) |
| Video limits | Up to 8 seconds per video (Freepik constraint) |

---

## 4. Patterns to Follow

### Pattern 1: Service Tuple Returns

All existing services return `Tuple[bool, Optional[T], Optional[str]]` for `(success, data, error)`. The new Freepik and upscale services must follow this.

```python
# Good - matches existing pattern
async def submit_task(self, ...) -> Tuple[bool, Optional[str], Optional[str]]:
    try:
        ...
        return True, task_id, None
    except Exception as e:
        return False, None, str(e)
```

### Pattern 2: Background Task with DB-Backed State

The HF download service uses in-memory job tracking (acceptable for single-admin). Batch upscale needs DB-backed state because:
- Batches can run for hours (10+ videos at ~3-5 min each)
- Must survive server restarts
- Multiple users can have concurrent batches
- Pause/resume requires persistent state

```python
# Pattern: Background task that updates DB
async def start_batch(self, batch_id: str):
    """Spawned via BackgroundTasks. Self-manages via DB state."""
    while True:
        video = await self._get_next_pending_video(batch_id)
        if not video:
            break

        await self._process_single_video(batch_id, video)

        # Check if batch was cancelled/paused externally
        batch = await self._get_batch(batch_id)
        if batch.status in ('cancelled', 'paused'):
            break
```

### Pattern 3: Polling from Frontend

Existing RunPod jobs poll every 3 seconds. Batch upscale should poll less aggressively since individual videos take minutes, not seconds.

```typescript
// 5-second polling interval for batch status
useEffect(() => {
    if (!batchId || terminalStates.includes(batchStatus)) return;

    const interval = setInterval(async () => {
        const response = await apiClient.getBatchStatus(batchId);
        updateBatchState(response);
    }, 5000);

    return () => clearInterval(interval);
}, [batchId, batchStatus]);
```

### Pattern 4: Non-Blocking Output Delivery

The existing `video_jobs.py` complete endpoint (lines 305-344) treats Google Drive upload as non-blocking. Batch upscale follows the same pattern:

```python
# Google Drive upload is best-effort, does not fail the video
try:
    await drive_service.upload_file(...)
except Exception as e:
    print(f"[UPSCALE] Drive upload failed (non-blocking): {e}")
    # Video is still marked completed with Supabase URL
```

---

## 5. Anti-Patterns to Avoid

### Anti-Pattern 1: Extending video_jobs Table

**What:** Adding batch columns to the existing `video_jobs` table.
**Why bad:** `video_jobs` has FK to `workflows` table (ComfyUI-specific), requires `comfy_url` (non-nullable), and has no concept of parent-child batch relationships. Forcing batch upscale into this model creates nullable-everything and confusing data.
**Instead:** Separate `upscale_batches` + `upscale_videos` tables with clean schema.

### Anti-Pattern 2: Frontend-Driven Sequential Processing

**What:** Frontend submits one video at a time, waits for completion, then submits next.
**Why bad:** Requires browser to stay open for hours. Page navigation, tab closure, or sleep kills the batch. No pause/resume possible.
**Instead:** Backend-driven background loop. Frontend only observes via polling.

### Anti-Pattern 3: Parallel Freepik Submissions

**What:** Submitting all videos to Freepik simultaneously.
**Why bad:** Burns through daily credit quota instantly. No ability to pause. Freepik rate limits cause failures.
**Instead:** Sequential processing with credit awareness between each submission.

### Anti-Pattern 4: Storing Freepik Output URLs as Permanent References

**What:** Saving the Freepik-provided output URL as the permanent result.
**Why bad:** Freepik URLs are temporary (likely 24-48 hour expiry like similar services). Link rot.
**Instead:** Always download and re-upload to Supabase Storage for permanent access.

---

## 6. Suggested Build Order

Components have clear dependencies that dictate build order. Each phase can be completed and tested independently.

### Phase 1: Foundation (DB + Freepik Service + Basic API)

**Build:** Component C (Database Schema) + Component A (Freepik Service) + minimal Component E (API)

**Rationale:** The database schema and Freepik API wrapper are zero-dependency foundations. A minimal API endpoint allows testing Freepik integration end-to-end with a single video before building batch logic.

**Deliverables:**
1. Migration `007_add_upscale_batches.sql` applied
2. `backend/models/upscale.py` with Pydantic models
3. `backend/services/freepik_service.py` (submit + poll + credit check)
4. `backend/services/upscale_job_service.py` (CRUD for batches/videos)
5. `backend/api/upscale.py` with create batch + upload video + start endpoints
6. `FREEPIK_API_KEY` in `config/settings.py`

**Testing checkpoint:** Backend can create a batch, upload a video, submit to Freepik, poll for completion, and store the result URL in the database.

---

### Phase 2: Batch Processing (Sequential Queue + Pause/Resume)

**Build:** Component B (Batch Job Manager) + Component G (Credit Monitoring)

**Rationale:** Once single-video processing works, add the sequential queue loop, credit detection, and pause/resume. This is the core differentiator from a simple "upscale one video" feature.

**Dependencies:** Phase 1 (Freepik service + DB + API)

**Deliverables:**
1. `backend/services/batch_manager.py` with start/resume/cancel
2. Credit exhaustion detection (402/429 handling)
3. Pause state management in DB
4. Resume endpoint in API
5. Cancel endpoint in API

**Testing checkpoint:** Backend processes 3+ videos sequentially, handles one failing without stopping, pauses on simulated credit exhaustion, and resumes successfully.

---

### Phase 3: Output Delivery (Supabase + Google Drive)

**Build:** Component D (Output Delivery Pipeline)

**Rationale:** Once batch processing works, add the output delivery step. This reuses existing services (`StorageService`, `GoogleDriveService`) and follows the proven pattern from `video_jobs.py`.

**Dependencies:** Phase 2 (batch processing must complete videos) + Phase 1

**Deliverables:**
1. Output download from Freepik + upload to Supabase Storage
2. Google Drive upload to AI-Upscaled subfolder (when project_id set)
3. DB updates with output URLs and Drive file IDs

**Testing checkpoint:** Completed upscaled video appears in Supabase Storage with valid public URL. If project is selected, video also appears in Google Drive under AI-Upscaled folder.

---

### Phase 4: Frontend (Upload + Progress + Results)

**Build:** Component F (Frontend Page + State Management)

**Rationale:** Backend is fully functional at this point. Frontend can be built and tested against the working API.

**Dependencies:** Phase 3 (complete backend flow)

**Deliverables:**
1. `BatchUpscale.tsx` page with parameter controls
2. `BatchUploadZone.tsx` for multi-file upload
3. `BatchProgress.tsx` for per-video status display
4. `useBatchUpscale.ts` hook for state + polling
5. Navigation entry in `studioConfig.ts`
6. ApiClient methods for all upscale endpoints
7. Pause/resume UI (banner + button)
8. Completed results with preview and download

**Testing checkpoint:** User can upload multiple videos, configure parameters, start batch, watch progress update in real-time, see pause notification, resume, and view/download completed results.

---

### Dependency Graph

```
Phase 1: DB Schema + Freepik Service + Basic API
    |
    +---> Phase 2: Batch Processing + Credit Management
              |
              +---> Phase 3: Output Delivery (Supabase + Drive)
                        |
                        +---> Phase 4: Frontend Page + UX
```

**Critical path:** Entirely linear. Each phase depends on the previous one.
**No parallel tracks** -- unlike the infrastructure milestone, this feature is a single pipeline.

---

## 7. Scalability Considerations

| Concern | Current Scale (1-5 users) | At 50 users | Mitigation |
|---|---|---|---|
| Concurrent batches | 1-2 active | 10-20 active | Background tasks are lightweight (just polling). Freepik rate limits are the bottleneck, not server resources |
| Freepik credits | 10-125/day shared | Insufficient | Per-user API keys or Freepik enterprise plan needed. Current architecture supports single shared key |
| Supabase Storage | ~500MB/day | ~5GB/day | Supabase Pro plan handles this. Add cleanup job for old input files |
| Google Drive | Minimal | 15GB/day | Service account quota may need increase |
| DB connections | 1-2 concurrent | 10-20 concurrent | Supabase connection pooling handles this |
| Background tasks | 1-2 loops | 10-20 loops | asyncio handles concurrent coroutines well. Add max concurrent limit if needed |
| Heroku memory | ~100MB for polling | ~200MB | Polling is lightweight (no video data in memory during poll phase) |

---

## 8. Heroku-Specific Constraints

| Constraint | Impact | Mitigation |
|---|---|---|
| 30-second request timeout | Source video upload for large files may timeout | Upload to Supabase Storage first (frontend -> Supabase direct, or chunked upload through backend) |
| 512MB memory limit | Large video download/upload during output delivery | Stream in chunks, never buffer entire video in memory |
| Dyno cycling (free tier) | Background tasks killed on restart | DB-backed state means batch manager can resume where it left off. Add startup recovery: check for `processing` batches and restart their loops |
| No persistent filesystem | Cannot cache videos locally | All storage is external (Supabase Storage, Google Drive). Already the pattern for this app |

### Startup Recovery Pattern

```python
# In main.py or app startup
@app.on_event("startup")
async def recover_interrupted_batches():
    """Resume any batches that were processing when server restarted."""
    service = UpscaleJobService()
    interrupted = await service.get_batches_by_status('processing')
    for batch in interrupted:
        # Mark current video as failed (it was interrupted)
        await service.fail_current_video(batch.id, "Server restart")
        # Resume from next pending video
        asyncio.create_task(batch_manager.start_batch(batch.id))
```

---

## Quality Gate Checklist

- [x] Integration points with existing system identified (Section 3: 6 reused backend components, 5 reused frontend components)
- [x] New vs modified components explicit (Section 3: tables showing reused vs new)
- [x] Build order considers dependencies (Section 6: 4 phases with linear dependency chain)
- [x] Data flow direction explicit (Section 2: 3 detailed flow diagrams)
- [x] Component boundaries clear (Section 1: 7 components with interfaces)
- [x] Anti-patterns documented (Section 5: 4 anti-patterns with alternatives)
- [x] Heroku constraints addressed (Section 8: 4 constraints with mitigations)

---

## Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Architecture pattern | HIGH | Follows proven patterns already in codebase (service layer, tuple returns, background tasks, output delivery pipeline) |
| DB schema | HIGH | Clean separation matches domain model, indexes support query patterns |
| Freepik API shape | MEDIUM | Based on confirmed image upscaler API pattern + PROJECT.md specification. Exact video endpoint parameters need validation |
| Build order | HIGH | Linear dependency chain is straightforward, each phase testable independently |
| Output delivery | HIGH | Reuses existing, working StorageService + GoogleDriveService with zero modifications |
| Credit exhaustion detection | MEDIUM | Assumed HTTP 402/429 response. Actual Freepik credit error responses need validation |
| Frontend integration | HIGH | Follows established page + hook + component pattern used by all other features |

---

*Research completed: 2026-03-11*
