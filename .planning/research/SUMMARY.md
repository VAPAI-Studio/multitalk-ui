# Project Research Summary

**Project:** sideOUTsticks — v1.1 Batch Video Upscale with Freepik API
**Domain:** Batch video upscaling via external credit-based API integrated into an existing AI media processing platform
**Researched:** 2026-03-11
**Confidence:** MEDIUM (all internal architecture is HIGH; external Freepik API contract is the single LOW-confidence blocker)

## Executive Summary

This milestone adds batch video upscaling to an existing, well-structured FastAPI + React platform that already handles ComfyUI and RunPod AI workflows, Supabase storage, and Google Drive delivery. The core work is a sequential batch queue processor that submits videos one-by-one to the Freepik Video Upscaler API, polls for completion, and delivers outputs to both Supabase Storage and Google Drive. No new npm or pip dependencies are required — the entire feature is built on patterns already proven in the codebase (httpx service layer, BackgroundTasks, Supabase state machine, StorageService and GoogleDriveService reuse).

The recommended approach follows a strict backend-driven architecture: the batch processing loop runs as a server-side background task backed by persistent Supabase state, so processing continues when the user closes the browser and survives Heroku dyno restarts. The frontend's role is limited to initiating the batch, uploading source videos individually, and polling for status updates every 5 seconds. This design is non-negotiable given Heroku's 30-second request timeout and daily dyno cycling. Processing is sequential (one video at a time) because Freepik's credit-based pricing model and daily rate limits make parallelism counterproductive and complicate the critical pause-on-credit-exhaustion feature.

The critical blocker before implementation can begin: the Freepik Video Upscaler API endpoint (`api.freepik.com/v1/ai/video-upscaler`) is referenced in PROJECT.md but is NOT publicly documented on docs.freepik.com as of March 2026. The project owner must confirm the API contract (endpoint URL, request parameters, response format, credit model, error codes) before Phase 1 can start. This is the only LOW-confidence item. Everything else — stack, architecture, feature scope, pitfall mitigations — is grounded in the existing codebase and established patterns.

## Key Findings

### Recommended Stack

The existing stack needs zero new dependencies. The pattern for integrating Freepik is identical to `runpod_service.py` and `worldlabs_service.py`: an httpx-based service class with tuple returns `(success, data, error)`, Settings-based API key configuration, and BackgroundTasks for fire-and-forget processing. The batch queue state lives in two new Supabase tables (`upscale_batches`, `upscale_videos`) rather than in memory — this is the single most important architectural departure from the existing HF download service pattern, which used an in-memory dict that would be fatal on Heroku for long-running user-facing batches.

**Core technologies:**
- **httpx** (0.28.1, already installed): Freepik API client — identical to the pattern already used in 3 existing services; handles async, streaming, connection pooling, and timeout configuration
- **FastAPI BackgroundTasks / asyncio.create_task** (built-in, already used): Batch queue runner — fire-and-forget with DB-backed state for restart survival
- **supabase-py** (>=2.3.0, already installed): Batch and video state persistence — survives restarts, supports pause/resume, enables multi-user concurrent batches
- **StorageService** (existing, `backend/services/storage_service.py`): Output delivery to Supabase Storage via `upload_video_from_url()` — already handles the download-from-URL pattern; streaming modifications needed for large video files
- **GoogleDriveService** (existing, `backend/services/google_drive_service.py`): Output delivery to Google Drive — zero modifications needed; reuse `get_or_create_folder()` and `upload_file()`

**No new pip or npm packages needed.** The entire feature uses existing installed libraries. See STACK.md for rationale on excluded technologies (Celery, RQ, aiohttp, ffmpeg, WebSockets, SQLAlchemy).

### Expected Features

**Must have (table stakes):**
- Multi-file upload with video validation (type, size, 8-second duration limit per Freepik constraint) — "batch" implies multi-file; warn before submission, not after
- Global settings panel (resolution, creativity, sharpen, grain, fps_boost, flavor) with preset buttons — configure once, apply to all
- Sequential queue processing, database-backed and backend-driven — core state machine; queue must survive page close and server restart
- Per-video status tracking (pending / processing / completed / failed / paused) with elapsed time and error messages
- Output delivery to Supabase Storage + Google Drive `AI-Upscaled` subfolder — explicitly required by PROJECT.md; non-blocking Drive upload (failure does not fail the video)
- Per-video error handling with manual retry (max 2 auto-retries for transient errors, then manual)
- Batch summary view (total / completed / processing / pending / failed counts + progress bar + estimated time remaining)

**Should have (competitive differentiators):**
- Credit exhaustion detection with pause-and-notify — batch pauses with a clear notification and Resume button instead of failing all remaining videos silently
- Resume capability after credit recharge — re-queues all paused videos from where the batch left off, settings preserved, no re-uploading
- Batch history with re-run — extends existing feed sidebar with batch grouping; "Re-run" creates new batch with same settings
- Queue reordering via drag-and-drop for pending items only
- Batch-level ZIP download of all completed videos

**Defer to later milestone:**
- Per-video settings override (global settings sufficient for v1; adds UI complexity without proportional value)
- Video trimming/splitting to work around the 8-second limit (major scope increase — FFmpeg, segment management, audio sync)
- Upload videos FROM Google Drive (explicitly out-of-scope per PROJECT.md)
- Real-time credit balance display (Freepik API does not expose a balance endpoint)
- Before/after video comparison viewer

### Architecture Approach

The feature decomposes into 7 components across a strictly backend-driven pipeline. The frontend initiates and observes; the backend orchestrates. Source videos flow: frontend local file -> individual backend upload -> Supabase Storage staging -> Freepik API (sequential) -> download result (streaming) -> re-upload to Supabase Storage + Google Drive. Two new Supabase tables provide the state machine backbone. Build order is a linear dependency chain — no parallel tracks are possible because each phase depends on the prior one being functional and testable.

**Major components:**
1. **FreepikUpscalerService** (`backend/services/freepik_service.py`) — Freepik API wrapper: submit task, poll status, check credits. Single responsibility; isolated from batch logic so API changes are absorbed in one place.
2. **BatchJobManager** (`backend/services/batch_manager.py`) — Sequential processing loop: pop next pending video, submit to Freepik, poll to completion, trigger output delivery, handle credit exhaustion with pause/resume. Heartbeat column in DB detects stale/crashed tasks.
3. **Database schema** (`upscale_batches` + `upscale_videos`) — Persistent state machine for batch lifecycle and per-video status; `last_heartbeat` for stale-batch detection; per-destination upload status columns for atomicity tracking.
4. **Output Delivery Pipeline** — Orchestration inside BatchJobManager calling existing StorageService and GoogleDriveService; streaming download from Freepik (no full-file buffering in memory); temp-file-based Google Drive upload to avoid MediaInMemoryUpload memory spike.
5. **Backend API layer** (`backend/api/upscale.py`) — 8 HTTP endpoints for CRUD on batches and videos; all protected with existing `get_current_user()` auth dependency; registered in `main.py` with one `include_router` line.
6. **Frontend page and state** (`frontend/src/pages/BatchUpscale.tsx` + `useBatchUpscale.ts`) — Multi-file upload zone, parameter controls, per-video status display, pause/resume UI; polls `GET /api/upscale/batches/{id}` every 5 seconds, stops on terminal states.
7. **Credit monitoring and pause/resume** (behavior within BatchJobManager) — Classifies Freepik errors into three categories with distinct handlers: per-second rate limit (backoff + retry), credit exhaustion (pause batch + notify), daily RPD limit (pause + calculate reset time).

### Critical Pitfalls

1. **Batch state lost on Heroku dyno restart** — Never use in-memory job stores for batch state. ALL state goes to Supabase from day one. Add startup recovery (`@app.on_event("startup")`) that resumes interrupted batches. The existing `hf_download_service.py` in-memory dict pattern would be catastrophic here. (Affects Phase 1 schema design.)

2. **Heroku 30-second timeout killing batch submissions** — The batch submission endpoint must return immediately with a `batch_id` and launch processing as a background task. No Freepik API calls inside request handlers. Frontend receives the batch ID instantly and starts polling. (Affects Phase 1 API design.)

3. **Credit exhaustion treated as a regular per-video error** — Parse Freepik error responses to distinguish: (a) per-second rate limit (429) — exponential backoff and retry; (b) credit exhaustion (402 or custom error code) — pause entire batch and notify user; (c) daily RPD limit — pause and calculate reset time. Failing to separate these causes wasted credits and confusing UX. (Must be designed in Phase 1 FreepikUpscalerService, implemented in Phase 2.)

4. **Large video downloads loaded into backend memory** — Existing `storage_service.py:98` loads full file content into memory (`video_response.content`). Acceptable for small ComfyUI outputs (5-20 MB), fatal for 50-200 MB upscaled videos on Heroku's 512 MB limit. Also: `google_drive_service.py:235` uses `MediaInMemoryUpload`. Both must use streaming equivalents for this feature. (Affects Phase 3 output delivery.)

5. **Freepik API endpoint undocumented** — `api.freepik.com/v1/ai/video-upscaler` is not in public API docs as of March 2026. Validate manually before writing any code: make a live test call, confirm endpoint URL, parameters, response format, credit model, and error codes. Build the FreepikUpscalerService as a clean abstraction so any API changes are absorbed in one file. (Blocks Phase 0 validation gate.)

## Implications for Roadmap

Based on combined research, the build order is a strict linear dependency chain with one pre-implementation validation gate and 4 build phases. The architecture research explicitly documents this as a linear dependency — unlike the v1.0 infrastructure milestone (which had two parallel tracks), this feature cannot be parallelized.

### Phase 0: API Validation (Pre-implementation Gate)

**Rationale:** The single highest-risk item in this entire feature is the unverified Freepik API endpoint. All subsequent phases depend on knowing the exact API contract. This is a required gate before any code is written — not optional research. A manual test call takes 30 minutes and eliminates all LOW-confidence items.
**Delivers:** Confirmed API endpoint URL, parameter schema, response format, Freepik task status states, error codes (especially credit exhaustion), and credit consumption model per video.
**Addresses:** Pitfall #8 (Freepik API documentation gap)
**Avoids:** Building the FreepikUpscalerService against assumed parameters that may not match the real API

### Phase 1: Foundation — Database + Freepik Service + Basic API

**Rationale:** The database schema is the zero-dependency foundation. Everything else (batch manager, frontend, output delivery) depends on having the tables and the Freepik service working end-to-end with a single video. The schema must include ALL columns needed by later phases (heartbeat, per-destination upload status) to avoid mid-feature migrations.
**Delivers:** Migration `007_add_upscale_batches.sql` applied; `freepik_service.py` tested with a real single-video end-to-end; `upscale_job_service.py` CRUD; `upscale.py` API routes for create batch, upload video, start batch; `FREEPIK_API_KEY` in Settings; fire-and-forget endpoint returning `batch_id` instantly.
**Addresses:** TS-1 (upload validation), TS-2 (settings model), TS-3 (queue foundation)
**Avoids:** Pitfall #1 (in-memory state), Pitfall #2 (30-second timeout)

### Phase 2: Batch Processing — Sequential Queue + Credit Management

**Rationale:** Once single-video processing works end-to-end, add the sequential processing loop with the three-category error classification (rate limit, credit exhaustion, daily limit), heartbeat tracking, and pause/resume. This is the core differentiator and the most complex phase. Getting error classification right here prevents the cascade failure mode (all remaining videos failing when credits run out).
**Delivers:** `batch_manager.py` with start/resume/cancel; three-category Freepik error handling; pause state in DB with `pause_reason`; resume and cancel endpoints; heartbeat column updated on every processing cycle; idempotent re-submission (check for existing `freepik_task_id` before submitting).
**Addresses:** D-1 (credit exhaustion detection), D-2 (resume after recharge), TS-6 (error handling with retry)
**Avoids:** Pitfall #3 (credit exhaustion as afterthought), Pitfall #6 (polling too aggressive or too lazy), Pitfall #9 (background task silent failure), Pitfall #10 (rate limit vs credit error conflation), Pitfall #11 (non-idempotent resume)

### Phase 3: Output Delivery — Supabase Storage + Google Drive

**Rationale:** With batch processing functional, add the output delivery step. This phase reuses existing services with minimal new code, but requires streaming download (not full-file-in-memory) and per-destination status tracking (for atomicity across two independent services). Requires a code spike to confirm Supabase Storage's Python SDK supports streaming upload of 50-200 MB files.
**Delivers:** Streaming video download from Freepik (httpx chunk iteration); upload to Supabase Storage (streaming or temp-file path); Google Drive upload via temp file (replacing MediaInMemoryUpload); per-video `supabase_upload_status` and `drive_upload_status` tracking; startup recovery for interrupted batches at server restart; public or long-lived signed URLs for completed videos.
**Addresses:** TS-5 (output delivery to Supabase + Drive)
**Avoids:** Pitfall #4 (memory exhaustion on large videos), Pitfall #5 (dual-destination atomicity), Pitfall #12 (signed URL expiry), Pitfall #14 (Drive folder context persistence)

### Phase 4: Frontend — Upload UI + Progress Display + Results

**Rationale:** The backend is fully functional after Phase 3. The frontend can be built and tested against the working API without any backend unknowns remaining. All component patterns exist in the codebase (file upload, polling hooks, ProjectContext, ResizableFeedSidebar). No new libraries needed.
**Delivers:** `BatchUpscale.tsx` main page with parameter controls and presets; `BatchUploadZone.tsx` multi-file drag-drop with per-file duration validation; `BatchProgress.tsx` per-video status with color-coded badges; `useBatchUpscale.ts` hook with 5-second polling and terminal state detection; navigation entry in `studioConfig.ts`; pause/resume banner UI; per-video preview and download; batch summary progress bar with estimated time remaining; cascade cleanup on batch deletion.
**Addresses:** TS-1 through TS-7 (all table stakes), D-4 (queue reordering, stretch goal)
**Avoids:** Pitfall #13 (unclear state visibility), Pitfall #15 (batch cleanup orphaning files and Freepik tasks)

### Phase Ordering Rationale

- **Phase 0 is a hard gate.** No code is written until the Freepik API contract is confirmed. This eliminates the only LOW-confidence item and prevents building against wrong assumptions.
- **Phase 1 before everything else** because the DB schema underpins all state management. The schema must include ALL columns needed by Phases 2 and 3 (heartbeat, per-destination upload status, granular video statuses) to avoid mid-feature migrations.
- **Phase 2 before Phase 3** because output delivery only has work to do if the batch manager is completing videos and triggering the delivery step.
- **Phase 4 last** because it is pure frontend with zero backend unknowns at that point, minimizing rework.
- **No parallel tracks.** Unlike the v1.0 infrastructure milestone, this feature is a single pipeline. A single developer or pair should move through the phases in order.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 0 (API Validation):** Must confirm the Freepik video upscaler API contract before writing any code. Specifically needed: exact endpoint URL, parameter names and types, response body structure, error code for credit exhaustion (HTTP 402? body field?), credit consumption model (per-frame? per-video? capped?), daily quota reset time. Make a live test call — this is mandatory, not optional.
- **Phase 3 (Streaming Uploads to Supabase):** The existing `storage_service.py` uses standard non-streaming uploads capped at 6 MB. The Supabase Python SDK's support for streaming or multipart upload of 50-200 MB videos needs a code spike before Phase 3 begins. If the SDK does not support it natively, the alternative is writing to a temp file and uploading from disk (Heroku dynos have ~4 GB ephemeral disk space).

Phases with standard patterns (skip research during planning):
- **Phase 1 (DB + Service Layer):** Follows proven patterns from `runpod_service.py` and `hf_download_service.py`. Schema design is fully specified in ARCHITECTURE.md. No research needed beyond Phase 0 API validation.
- **Phase 2 (Batch Manager):** Sequential state machine with DB-backed state is a well-understood pattern. Existing codebase has analogous implementations. No external library research needed.
- **Phase 4 (Frontend):** All component patterns exist in the codebase. No new libraries needed. Standard React polling hook with cleanup. Direct implementation from ARCHITECTURE.md component spec.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies confirmed by reviewing requirements.txt and package.json. All patterns verified against 3 existing service files in codebase. |
| Features | HIGH | Table stakes well-understood from Freepik product page, PROJECT.md requirements, and competitor analysis (Topaz batch queue community). Differentiators clearly defined with acceptance criteria. |
| Architecture | HIGH | All component patterns derived from existing, working code. Interfaces follow established service layer conventions exactly. Build order validated with clear dependency chain. |
| Pitfalls | HIGH | 15 pitfalls identified with codebase-specific evidence (specific file names and line numbers). Prevention strategies are concrete and actionable. |
| Freepik API Contract | LOW | Video upscaler API not publicly documented. Parameters inferred from web UI and image upscaler API patterns. Must be validated with a live test call before Phase 1. |

**Overall confidence:** MEDIUM (all internal architecture is HIGH; external API contract is the single LOW-confidence blocker that a 30-minute validation call can resolve)

### Gaps to Address

- **Freepik video upscaler API contract:** Before writing any code, the project owner must make a live test call to confirm endpoint URL, parameter names, response format, error codes, and credit consumption model. Document findings to unblock Phase 1. This is the only gap that blocks implementation.
- **Freepik credit exhaustion error signature:** The exact HTTP status code and response body for credit exhaustion is unknown. Research suggests HTTP 402 but the actual error must be discovered during Phase 0 validation (ideally by intentionally depleting credits on a low-balance test account, or from internal Freepik documentation the project owner may have access to).
- **Supabase Storage streaming upload in Python:** The existing upload pattern handles small files. The SDK's support for streaming or multipart upload of 50-200 MB videos needs a code spike at the start of Phase 3 before committing to a full implementation.
- **Freepik 8-second video duration limit enforcement:** The limit is stated on the product page but not confirmed in API documentation. Determine whether the API enforces it with a validation error or silently accepts longer videos (which affects whether the validation gate must be in the frontend, the backend, or both).

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `backend/services/runpod_service.py`, `backend/services/worldlabs_service.py`, `backend/services/hf_download_service.py`, `backend/services/storage_service.py` (lines 28, 98, 116), `backend/services/google_drive_service.py` (line 235), `backend/api/video_jobs.py` (lines 263-344) — existing service patterns, output delivery pattern, memory usage risks
- [Freepik API Documentation](https://docs.freepik.com/) — confirmed image upscaler endpoints; video upscaler NOT present as of 2026-03-11
- [Freepik API rate limits](https://docs.freepik.com/ratelimits) — 10 hits/s sustained, 50 hits/s burst; tier-based daily limits (Free: 10/day, Tier 1: 125/day)
- [Heroku request timeout docs](https://devcenter.heroku.com/articles/request-timeout) — 30-second hard limit (H12 error)
- [Supabase storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits) — 6 MB standard; resumable upload (TUS protocol) required for larger files
- [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) — fire-and-forget pattern, exception handling limitations

### Secondary (MEDIUM confidence)
- [Freepik AI Video Upscaler product page](https://www.freepik.com/ai/video-upscaler) — parameters (resolution, creativity, sharpen, grain, fps_boost, flavor) and 8-second duration limit
- [Freepik Image Upscaler Creative API](https://docs.freepik.com/api-reference/image-upscaler-creative/post-image-upscaler) — POST to submit + GET to poll pattern (CREATED/IN_PROGRESS/COMPLETED/FAILED statuses); closest documented analog to video upscaler
- [Supabase resumable uploads blog](https://supabase.com/blog/storage-v3-resumable-uploads) — TUS protocol support for large file uploads
- [Topaz Video AI batch queue community request](https://community.topazlabs.com/t/much-better-batch-control-of-all-items-in-queue-required/80123) — user demand evidence for better queue control features
- [LogRocket: UI patterns for async workflows](https://blog.logrocket.com/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines) — progress tracking and partial failure UX patterns

### Tertiary (LOW confidence)
- PROJECT.md specification of `api.freepik.com/v1/ai/video-upscaler` as the endpoint — unverified against live API; requires owner validation before implementation
- Freepik credit exhaustion HTTP status assumed to be 402 — inferred from REST conventions; actual error signature unknown

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes, pending Phase 0 API validation*
