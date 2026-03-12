# Technology Stack: v1.1 Batch Video Upscale

**Project:** sideOUTsticks - Batch Video Upscale with Freepik API
**Researched:** 2026-03-11
**Scope:** Stack additions/changes needed for batch video upscaling. Existing stack (FastAPI, React/TS, Supabase, httpx, etc.) is validated and NOT re-researched.

---

## Critical Finding: Freepik Video Upscaler API Availability

**Confidence: LOW -- Requires owner validation before implementation begins.**

The Freepik public API documentation (docs.freepik.com) does NOT list a video upscaler endpoint as of March 2026. The documented endpoints are:

- `POST /v1/ai/image-upscaler` (Magnific Creative upscaler)
- `POST /v1/ai/image-upscaler-precision` (Magnific Precision upscaler)
- `POST /v1/ai/image-upscaler-precision-v2` (Precision V2)

The VIDEO upscaler exists as a web tool at freepik.com/ai/video-upscaler but is NOT documented as an API endpoint. The PROJECT.md references `api.freepik.com/v1/ai/video-upscaler` -- this may be:

1. A private/beta API endpoint the project owner has access to
2. An endpoint that was added after the docs were last indexed
3. An assumed endpoint path that needs verification

**Action required:** The project owner must confirm the exact API endpoint, authentication method, and parameter schema before implementation. The stack recommendations below assume the API follows the same pattern as the image upscaler (task-based async with polling), which is consistent with what PROJECT.md describes.

---

## Recommended Stack

### No New Dependencies Required

The existing stack already contains everything needed for this feature. This is a key finding -- no new pip packages or npm packages are required.

### Backend: Freepik API Client (NEW service, existing libraries)

| Technology | Version (installed) | Purpose | Why No Change Needed |
|------------|-------------------|---------|---------------------|
| **httpx** | 0.28.1 | HTTP client for Freepik API calls | Already used by RunPod, WorldLabs, ComfyUI services. Async-native, connection pooling, timeout handling. Identical pattern to `runpod_service.py` |
| **pydantic** | >=2.5.1 | Request/response models for Freepik API | Already used for all API models. Pydantic v2 with `model_validator` for parameter range validation |
| **FastAPI BackgroundTasks** | Built-in | Sequential batch queue processor | Already used in `infrastructure.py` for HF downloads. Perfect for fire-and-forget batch orchestration |
| **supabase-py** | >=2.3.0 | Batch job state persistence | Already used for all job tracking. Supabase tables for batch + individual video records |

**Rationale for zero new backend dependencies:** The Freepik API is a standard REST API with JSON payloads and API key auth. httpx handles this perfectly. The batch queue is a simple sequential processor (not a distributed job queue) because Freepik rate limits make parallelism counterproductive. FastAPI's `BackgroundTasks` or `asyncio.create_task` (both already in use) handle the background processing.

### Frontend: Batch Upload UI (NEW components, existing libraries)

| Technology | Version (installed) | Purpose | Why No Change Needed |
|------------|-------------------|---------|---------------------|
| **React** | 19.1.1 | Batch upload UI, queue visualization | Existing |
| **TypeScript** | ~5.8.3 | Type safety for batch/queue state | Existing |
| **TailwindCSS** | 3.4.17 | Styling (consistent with all feature pages) | Existing |
| **apiClient** | Custom | Backend API communication | Extend with new batch methods |

**No new npm packages needed.** The batch upload UI uses native HTML5 file input with `multiple` attribute, React state for queue management, and the existing `apiClient` pattern for API calls.

---

## Integration Points with Existing Stack

### 1. Freepik API Service (new file: `backend/services/freepik_service.py`)

**Pattern:** Follow `runpod_service.py` and `worldlabs_service.py` exactly.

```python
# Same pattern as RunPodService and WorldLabsService:
# - httpx.AsyncClient for HTTP calls
# - Tuple[bool, Optional[T], Optional[str]] return pattern
# - Settings-based configuration
# - Structured error handling with try/except httpx exceptions
```

**Authentication:** Header-based API key (`x-freepik-api-key: {key}`) -- simpler than RunPod's Bearer token. Stored in Settings as `FREEPIK_API_KEY`.

**API flow (mirrors existing async patterns):**
1. `POST /v1/ai/video-upscaler` with parameters --> returns `task_id`
2. `GET /v1/ai/video-upscaler/{task_id}` to poll --> returns status + output URL when COMPLETED
3. Statuses: CREATED --> IN_PROGRESS --> COMPLETED | FAILED

This is identical to the RunPod pattern (submit --> poll status --> get output).

### 2. Batch Queue Processor (new file: `backend/services/batch_upscale_service.py`)

**Pattern:** Follow `hf_download_service.py` for background job management.

The HF download service already demonstrates:
- In-memory job store for tracking (acceptable for single-user admin use)
- `asyncio.create_task` for background processing
- Progress tracking with percentage updates
- Error handling that doesn't crash the background task

**However, for batch upscale, use Supabase instead of in-memory store** because:
- Multiple users (not admin-only)
- Need to survive server restarts (Heroku dynos restart every 24h)
- Need to track credit exhaustion state across sessions
- Resume capability requires persistent state

**Queue strategy: Sequential processing with Supabase state machine.**

```
For each video in batch:
  1. Check credit status (if paused, stop processing)
  2. Submit to Freepik API
  3. Poll until COMPLETED/FAILED
  4. Download result, upload to Supabase Storage + Google Drive
  5. Update video record status
  6. Move to next video
```

Why sequential (not parallel):
- Freepik rate limits: Free=10/day, Tier 1=125/day
- Parallel submissions waste credits on potential failures
- Sequential allows credit-aware pausing between videos
- Simpler error handling and resume logic

### 3. Settings Additions (extend `backend/config/settings.py`)

```python
# Freepik Configuration
FREEPIK_API_KEY: str = ""
FREEPIK_API_BASE_URL: str = "https://api.freepik.com/v1/ai"
FREEPIK_POLL_INTERVAL: int = 10  # seconds between status checks
FREEPIK_TASK_TIMEOUT: int = 600  # max seconds to wait for a single video
```

### 4. Database Schema (new migration)

Two new tables, following existing patterns from `video_jobs` and `workflows`:

**`upscale_batches` table:**
- `id` UUID primary key
- `user_id` references auth.users
- `status` ENUM ('pending', 'processing', 'completed', 'failed', 'paused')
- `total_videos` integer
- `completed_videos` integer
- `failed_videos` integer
- `google_drive_folder_id` text (nullable -- existing project picker integration)
- `settings` JSONB (resolution, creativity, sharpen, grain, fps_boost, flavor)
- `pause_reason` text (nullable -- e.g., "Credit limit reached")
- `created_at`, `updated_at` timestamps

**`upscale_videos` table:**
- `id` UUID primary key
- `batch_id` references upscale_batches
- `user_id` references auth.users
- `status` ENUM ('pending', 'processing', 'completed', 'failed', 'skipped')
- `input_video_url` text (Supabase Storage URL of uploaded video)
- `output_video_url` text (nullable -- Supabase Storage URL of upscaled result)
- `google_drive_file_id` text (nullable)
- `freepik_task_id` text (nullable)
- `original_filename` text
- `file_size_bytes` bigint
- `duration_seconds` float (nullable)
- `error_message` text (nullable)
- `processing_started_at`, `processing_completed_at` timestamps
- `created_at` timestamp

### 5. Frontend Integration Points

**New API client methods** (extend `frontend/src/lib/apiClient.ts`):
```typescript
// Batch operations
createBatch(settings: BatchSettings): Promise<BatchResponse>
getBatch(batchId: string): Promise<BatchResponse>
getBatches(): Promise<BatchListResponse>
pauseBatch(batchId: string): Promise<void>
resumeBatch(batchId: string): Promise<void>
cancelBatch(batchId: string): Promise<void>

// Video upload (within batch)
uploadVideoToBatch(batchId: string, file: File): Promise<VideoResponse>
getVideoStatus(videoId: string): Promise<VideoResponse>
```

**Existing patterns reused:**
- `UnifiedFeed` component with `pageContext: 'video-upscale'`
- File upload via `FormData` (same as image upload pattern)
- Polling for status updates (same as ComfyUI job monitoring)
- Google Drive folder picker (existing `ProjectContext` in header)

### 6. Google Drive Output Delivery

**Existing service:** `backend/services/google_drive_service.py` already supports:
- `upload_file()` for uploading files to a specific folder
- Folder picker integration in frontend header (ProjectContext)

The batch processor downloads the upscaled video from Freepik's output URL, then:
1. Uploads to Supabase Storage (for in-app viewing)
2. Uploads to Google Drive folder (for project delivery)

Both operations use existing services -- no new Google Drive code needed.

---

## What NOT to Add (and Why)

| Technology | Why NOT |
|------------|---------|
| **Celery / Redis** | Overkill for sequential batch processing. The batch queue processes one video at a time -- `asyncio.create_task` with Supabase state tracking is sufficient. Celery adds operational complexity (Redis server, worker processes, broker configuration) for no benefit at this scale. |
| **RQ (Python-RQ)** | Same rationale as Celery. Background task queues are unnecessary when processing is sequential and state lives in Supabase. |
| **Bull/BullMQ (Node.js)** | Wrong runtime. Backend is Python/FastAPI. |
| **freepik Python SDK** | Does not exist. There is no official Python SDK for Freepik API. Raw httpx calls are the correct approach (same as RunPod, WorldLabs). |
| **aiohttp** | Already have httpx which is more modern and already used across all external API services in the codebase. Adding aiohttp would create inconsistency. |
| **python-ffmpeg / moviepy** | Not needed. We are not processing video locally -- Freepik handles all upscaling. Video files are passed through as binary blobs (upload original, download result). If duration/metadata extraction is needed later, `ffprobe` via subprocess is lighter. |
| **tus-py-client** | Resumable uploads (tus protocol) are unnecessary. Video files for upscaling are typically <500MB. Standard multipart upload to Supabase Storage works fine within Heroku's constraints. |
| **WebSocket for progress** | The existing polling pattern (frontend polls backend every few seconds) is already proven across ComfyUI and RunPod features. Adding WebSocket for batch progress adds complexity without meaningful UX improvement since Freepik processing takes minutes per video. |
| **SQLAlchemy / Alembic** | The project uses Supabase (direct table access via supabase-py). Adding an ORM would conflict with the established data access pattern. SQL migrations are run manually in Supabase dashboard. |

---

## Configuration Additions

### Backend `.env` additions:

```bash
# Freepik API Configuration
FREEPIK_API_KEY=your-freepik-api-key
# Optional overrides (sensible defaults in settings.py):
# FREEPIK_API_BASE_URL=https://api.freepik.com/v1/ai
# FREEPIK_POLL_INTERVAL=10
# FREEPIK_TASK_TIMEOUT=600
```

### Supabase Storage:

New bucket: `upscaled-videos` (or reuse `multitalk-videos` with a subfolder path like `upscaled/`). Recommend reusing `multitalk-videos` with path prefix to avoid bucket proliferation.

---

## New Files Needed

### Backend

```
backend/
├── services/
│   ├── freepik_service.py          # Freepik API client (submit, poll, download)
│   └── batch_upscale_service.py    # Batch orchestration, queue processing, credit detection
├── api/
│   └── batch_upscale.py            # API routes for batch operations
├── models/
│   └── batch_upscale.py            # Pydantic models for batch/video entities
└── migrations/
    └── 007_add_batch_upscale.sql   # upscale_batches + upscale_videos tables
```

### Frontend

```
frontend/src/
├── BatchVideoUpscale.tsx           # Main feature page (follows existing pattern)
├── components/
│   └── BatchQueue.tsx              # Queue visualization component (optional extraction)
└── lib/
    └── (extend apiClient.ts)       # New methods for batch operations
```

---

## Installation

```bash
# Backend: NO new packages needed
# All required libraries are already in requirements.txt:
# - httpx>=0.25.2 (for Freepik API calls)
# - pydantic>=2.5.1 (for models)
# - supabase>=2.3.0 (for job persistence)
# - aiohttp>=3.9.0 (already installed, not used for this feature)

# Frontend: NO new packages needed
# All required libraries are already in package.json:
# - react, react-dom (UI)
# - typescript (type safety)
# - tailwindcss (styling)
```

---

## Confidence Assessment

| Component | Confidence | Notes |
|-----------|------------|-------|
| httpx for Freepik API | HIGH | Identical pattern to 3 existing services in codebase |
| Sequential batch processing | HIGH | Simple state machine, proven pattern in HF downloads |
| Supabase for batch state | HIGH | Consistent with all other job tracking in the app |
| Freepik API endpoint path | LOW | `/v1/ai/video-upscaler` is NOT in public docs -- must verify with owner |
| Freepik API parameters | MEDIUM | PROJECT.md lists resolution, creativity, sharpen, grain, fps_boost, flavor -- matches web UI params but API schema unverified |
| Credit exhaustion detection | MEDIUM | Freepik likely returns HTTP 402/429 or an error status, but exact error shape needs discovery during implementation |
| Google Drive output delivery | HIGH | Existing service handles this; no new code needed |
| No new dependencies needed | HIGH | Verified against requirements.txt and package.json |

---

## Sources

- [Freepik API Documentation](https://docs.freepik.com/) -- Official API reference (image upscaler endpoints documented, video upscaler NOT found)
- [Freepik Image Upscaler Creative POST](https://docs.freepik.com/api-reference/image-upscaler-creative/post-image-upscaler) -- Task-based async pattern reference
- [Freepik Image Upscaler GET Status](https://docs.freepik.com/api-reference/image-upscaler-creative/get-image-upscaler.md) -- Polling endpoint pattern (CREATED/IN_PROGRESS/COMPLETED/FAILED)
- [Freepik Video Upscaler Web Tool](https://www.freepik.com/ai/video-upscaler) -- Parameters available in web UI (resolution, creativity, sharpen, grain, fps_boost, flavor)
- [Freepik Magnific Video Upscaler](https://www.freepik.com/magnific-video-upscaler) -- Magnific-powered video upscaling parameters documentation
- [Freepik API Pricing](https://www.freepik.com/api/pricing) -- Credit-based pricing model
- Codebase analysis: `backend/services/runpod_service.py`, `backend/services/worldlabs_service.py`, `backend/services/hf_download_service.py` -- Existing patterns for external API integration and background job processing
