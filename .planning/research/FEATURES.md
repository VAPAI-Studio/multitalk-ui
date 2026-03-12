# Feature Landscape: Batch Video Upscale

**Domain:** Batch video upscaling with external API integration (Freepik Video Upscaler)
**Researched:** 2026-03-11
**Milestone:** v1.1 Batch Video Upscale
**Context:** Adding batch upscale capability to existing AI media processing platform that already has single-video ComfyUI-based upscaling (SeedVR2), Google Drive integration with project folder picker, Supabase storage, and per-video job tracking.

---

## Table Stakes

Features users expect from any batch video upscaling interface. Missing any of these makes the feature feel broken or unfinished compared to the existing single-video upscale page.

### TS-1: Multi-File Upload with Video Validation

| Aspect | Detail |
|--------|--------|
| **Why expected** | The word "batch" implies multi-file. A batch upscaler that only accepts one file is just a regular upscaler. Users need drag-and-drop or file picker for multiple videos at once. |
| **Complexity** | Low |
| **Notes** | Validate on selection: file type (MP4, MOV, AVI, WebM, MKV per Freepik support), file size (warn for very large files given Heroku 512MB memory limit), and video duration (Freepik video upscaler has an 8-second limit per the product page -- this is a critical constraint that must be surfaced early). Show thumbnail preview and metadata (duration, resolution, file size) for each queued video. Reuse existing file input patterns from VideoUpscale.tsx. |
| **Acceptance** | Accept multiple video files via file picker or drag-and-drop. Show preview thumbnail, filename, duration, resolution, and file size for each. Reject invalid formats with clear error message. Warn if video exceeds 8-second duration limit before submission. |

### TS-2: Per-Video Settings Panel

| Aspect | Detail |
|--------|--------|
| **Why expected** | Freepik Video Upscaler exposes multiple parameters (resolution, creativity, sharpen, grain, FPS boost, flavor). Users expect to configure these. The question is whether to set globally for the batch or per-video. |
| **Complexity** | Low-Medium |
| **Notes** | Use global defaults with optional per-video override. Most batch workflows use "set once, apply to all" with the ability to tweak individual items. Parameters from PROJECT.md: resolution (360p-4K), creativity, sharpen, grain, fps_boost, flavor. Provide preset buttons (e.g., "Standard", "Cinematic", "Animation") that set sensible defaults for common use cases. Per-video override should be a collapse/expand panel on each queue item. |
| **Acceptance** | Global settings panel at the top applies to all videos by default. Each video in the queue has an expandable per-video settings override. Presets for common configurations. Settings persist across session (localStorage). |

### TS-3: Sequential Queue Processing

| Aspect | Detail |
|--------|--------|
| **Why expected** | The PROJECT.md specifies "process one-by-one" to avoid rate limit bursts. Users expect to see their queue processed in order with clear indication of what's running, what's waiting, and what's done. |
| **Complexity** | Medium |
| **Notes** | Backend orchestrates: pick next pending video, submit to Freepik API, poll for completion (CREATED -> IN_PROGRESS -> COMPLETED/FAILED), then move to next. Frontend shows ordered list with status badges per item. This is the core state machine of the feature. The queue lives in the database (Supabase) so it survives page refreshes and browser closes. Freepik rate limits: Free=10/day, Tier 1=125/day. |
| **Acceptance** | Videos process sequentially, one at a time. Queue order visible in UI. Status per video: pending, processing, completed, failed, paused. Queue persists across page refreshes (database-backed). Processing continues even if user navigates away (backend-driven). |

### TS-4: Per-Video Status Tracking with Progress

| Aspect | Detail |
|--------|--------|
| **Why expected** | Users need to know what's happening with each video. A batch with no per-item status is a black box. The existing app already has rich job tracking (video_jobs table, feed sidebar). |
| **Complexity** | Medium |
| **Notes** | Each video in the batch gets its own row in the database. Status lifecycle: pending -> processing -> completed/failed/paused. Show Freepik task status (CREATED -> IN_PROGRESS -> COMPLETED/FAILED) mapped to the internal status. The existing VideoJob model already supports this with its status field and per-job tracking. For processing items, show elapsed time and Freepik's reported progress if available. For completed items, show thumbnail of the upscaled result. |
| **Acceptance** | Each video shows its current status with visual indicator (color-coded badge). Processing videos show elapsed time. Completed videos show output thumbnail and download link. Failed videos show error message and retry button. Paused videos show reason (credit exhaustion) and resume button. |

### TS-5: Output Delivery to Supabase Storage + Google Drive

| Aspect | Detail |
|--------|--------|
| **Why expected** | The PROJECT.md explicitly requires dual storage: Supabase for in-app viewing, Google Drive for organized project delivery. The existing video_jobs completion handler already does this (see `backend/api/video_jobs.py` lines 263-344). |
| **Complexity** | Low-Medium |
| **Notes** | Reuse the exact pattern from the existing `complete_video_job` endpoint: download from Freepik output URL, upload to Supabase Storage (`video-results` bucket), generate thumbnail, then upload to Google Drive's `AI-Videos` subfolder under the selected project. The `project_id` comes from ProjectContext (already in header). Non-blocking: Drive upload failure does not fail the job. |
| **Acceptance** | Completed upscaled videos automatically saved to Supabase Storage. If a Google Drive project is selected, videos also uploaded to `{project}/AI-Videos/` folder. Thumbnail generated for feed display. Both uploads are non-blocking (failures logged but don't fail the job). In-app preview and download work via Supabase URL. |

### TS-6: Error Handling with Per-Video Retry

| Aspect | Detail |
|--------|--------|
| **Why expected** | External API calls fail. Freepik can return FAILED status, network errors can occur, rate limits can be hit. Users expect to retry individual failed videos without re-submitting the entire batch. |
| **Complexity** | Medium |
| **Notes** | Retry resets a single video's status to `pending` and re-queues it. The backend picks it up on the next queue poll cycle. Important: do NOT auto-retry infinitely -- max 2 automatic retries with exponential backoff, then mark as failed and let the user manually retry. Distinguish between retryable errors (network timeout, 5xx from Freepik) and non-retryable errors (invalid video format, 4xx from Freepik). |
| **Acceptance** | Failed videos show error message and a "Retry" button. Automatic retry (up to 2 attempts) for transient errors. Manual retry button for persistent failures. Retry count shown on each video. Non-retryable errors clearly indicated (no retry button). |

### TS-7: Batch Summary View

| Aspect | Detail |
|--------|--------|
| **Why expected** | Users need to see the overall state of their batch at a glance: how many total, how many done, how many failed, estimated time remaining. |
| **Complexity** | Low |
| **Notes** | Summary bar at the top of the queue: "5/12 completed, 1 processing, 6 pending" with a progress bar. Estimated time remaining based on average processing time of completed items. This is pure frontend computation from the per-video status data. |
| **Acceptance** | Summary shows: total count, completed count, processing count, pending count, failed count. Progress bar reflects overall completion percentage. Estimated time remaining (after at least 1 video completes). |

---

## Differentiators

Features that set this apart from simply running Freepik's own web upscaler 12 times manually. These justify building a custom batch interface.

### D-1: Credit Exhaustion Detection with Pause-and-Notify

| Aspect | Detail |
|--------|--------|
| **Value proposition** | When Freepik credits run out mid-batch, instead of failing all remaining videos, the system pauses the queue and notifies the user. This is explicitly called out in PROJECT.md as a core feature. No competitor does this well -- most just fail silently or error out. |
| **Complexity** | Medium-High |
| **Notes** | Detect credit exhaustion from Freepik API response (likely a 402/429 or specific error code in the FAILED status). When detected: (1) mark current video as `paused`, (2) mark all pending videos as `paused`, (3) set batch status to `paused_credit_exhaustion`, (4) show prominent UI notification with link to Freepik to add credits. Requires distinguishing credit exhaustion from other API errors. The pause state must be distinct from failed -- paused items should retain their queue position and settings. |
| **Acceptance** | Credit exhaustion detected automatically from API responses. All remaining videos pause (not fail). Prominent notification tells user why and links to Freepik. No data loss on pause. Resume button re-queues all paused videos. Queue order and settings preserved through pause/resume cycle. |

### D-2: Resume Capability After Credit Recharge

| Aspect | Detail |
|--------|--------|
| **Value proposition** | After the user adds credits to their Freepik account, they click "Resume" and the batch continues from where it left off. No re-uploading, no re-configuring, no re-ordering. |
| **Complexity** | Medium |
| **Notes** | Resume sets all `paused` videos back to `pending` and restarts the queue processor. The backend picks up where it left off. Optionally verify credit availability before resuming (make a test API call). Resume should also work after browser close/reopen since the queue is database-backed. Must handle edge case: user resumes but still has insufficient credits -- re-detect and re-pause gracefully. |
| **Acceptance** | "Resume" button appears when batch is paused. Clicking it re-queues all paused videos. Processing resumes from the first pending video. Works after browser close and reopen. Re-pauses gracefully if credits still insufficient. Optional: "Check Credits" button to verify before resuming. |

### D-3: Batch History with Re-Run

| Aspect | Detail |
|--------|--------|
| **Value proposition** | View past batches, see results, and re-run a batch with the same or different settings. Useful for iterating on upscale settings (e.g., try different creativity/sharpen combinations). |
| **Complexity** | Low-Medium |
| **Notes** | The existing GenerationFeed/ResizableFeedSidebar pattern already handles per-feature job history. Extend it with batch grouping: group individual video jobs by `batch_id`. Show batch-level summary (X/Y completed, total duration, settings used). "Re-run" creates a new batch with the same source videos and settings. Requires adding a `batch_id` field to video jobs. |
| **Acceptance** | Past batches visible in feed sidebar grouped by batch. Batch summary shows completion stats. Individual video results viewable from batch. "Re-run" option creates new batch with same settings (and optionally same source videos if still available). |

### D-4: Queue Reordering (Drag-and-Drop)

| Aspect | Detail |
|--------|--------|
| **Value proposition** | Users often realize after queuing that they want certain videos processed first. Drag-and-drop reordering before or during processing (for pending items only) adds a level of control that distinguishes this from a simple FIFO queue. |
| **Complexity** | Medium |
| **Notes** | Only pending items can be reordered. Processing and completed items are locked in position. Use a `queue_position` integer field in the database. Drag-and-drop using a lightweight library (dnd-kit or similar, already common in React ecosystems). Update positions via API call. Topaz Video AI's community has explicitly requested better batch queue control, indicating this is a real user need. |
| **Acceptance** | Drag-and-drop to reorder pending videos in queue. Processing/completed items cannot be moved. Queue order persists (database-backed). Visual handle or grip indicator for draggable items. |

### D-5: Batch-Level Download (ZIP)

| Aspect | Detail |
|--------|--------|
| **Value proposition** | After batch completes, download all upscaled videos as a single ZIP file instead of clicking download 12 times individually. |
| **Complexity** | Medium |
| **Notes** | Generate ZIP server-side from Supabase Storage URLs. Stream the ZIP to the client to avoid memory issues (important given Heroku's 512MB limit). Alternatively, use client-side ZIP generation (JSZip) by fetching each video and adding to the archive -- but this has browser memory limits for large batches. Server-side streaming ZIP is preferred but must respect Heroku's 30-second timeout. Consider a background job that generates the ZIP and provides a download link when ready. |
| **Acceptance** | "Download All" button available when batch has completed videos. ZIP contains all completed upscaled videos with original filenames. Works for batches of 10+ videos. Progress indicator during ZIP generation. |

---

## Anti-Features

Things to deliberately NOT build. Including them adds complexity without proportional value or conflicts with the project's constraints.

### AF-1: Parallel API Submissions

**Do not build.** The PROJECT.md explicitly specifies "process one-by-one" for sequential processing. Submitting multiple videos to Freepik simultaneously would:
- Burn through credits faster, making credit exhaustion harder to detect and manage
- Risk hitting Freepik's rate limits (50 req/sec, but more importantly daily limits of 10-125)
- Complicate the pause/resume logic
- Add concurrency complexity for marginal time savings

**What to do instead:** Sequential processing with clear queue position indicators. If processing speed becomes a concern, this could be revisited in a future milestone with configurable concurrency (1-3 simultaneous).

### AF-2: Video Trimming/Splitting Before Upscale

**Do not build.** Freepik's video upscaler has an 8-second limit. It would be tempting to add a video trimmer that splits longer videos into 8-second segments, upscales each, then stitches them back together. This is a massive scope increase:
- FFmpeg integration (either client-side via ffmpeg.wasm or server-side)
- Segment management and reassembly
- Audio sync across segments
- Quality loss at segment boundaries

**What to do instead:** Validate video duration on upload and clearly inform the user that videos must be 8 seconds or shorter. Link to an external trimming tool if needed. If segment-and-stitch becomes a real need, scope it as a separate milestone.

### AF-3: Real-Time Credit Balance Display

**Do not build.** Continuously polling Freepik's API for the user's remaining credit balance adds complexity and may not even be possible (Freepik's API docs do not expose a credit balance endpoint). The credit exhaustion detection (D-1) handles the critical case reactively.

**What to do instead:** Detect credit exhaustion when it happens (from API error responses). Show estimated credit cost before submission if pricing data is available. Link to Freepik dashboard for balance checks.

### AF-4: Multi-API Backend Support

**Do not build.** Do not abstract the upscaling backend to support multiple APIs (Topaz, Neural Love, custom ComfyUI upscale, etc.) in this milestone. The existing SeedVR2 single-video upscale already uses ComfyUI. This milestone is specifically about Freepik API batch upscaling.

**What to do instead:** Build a clean Freepik service layer. If multi-backend support is needed later, the service interface pattern makes it possible to add alternative backends without rewriting the queue logic.

### AF-5: Upload Videos FROM Google Drive

**Do not build.** The PROJECT.md explicitly scopes this out: "Upload videos from Google Drive -- Planned for future milestone." This milestone uploads TO Google Drive only (output delivery).

**What to do instead:** Accept video uploads from the user's local machine only. The Google Drive -> Freepik direction can be added later by reading from Drive and feeding into the same queue.

### AF-6: Freepik Account Management

**Do not build.** No Freepik account creation, API key management UI, or credit purchase flow within the app. The Freepik API key is a backend environment variable (like OPENROUTER_API_KEY).

**What to do instead:** Store FREEPIK_API_KEY in backend .env. Provide a link to Freepik's dashboard for account/credit management. Surface credit exhaustion errors clearly so the user knows to go to Freepik to add credits.

### AF-7: Video Preview Comparison (Before/After)

**Do not build** in this milestone. A side-by-side or slider-based before/after comparison viewer is a nice-to-have but adds significant UI complexity (synchronized video playback, canvas rendering) that is not part of the batch workflow core.

**What to do instead:** Show the upscaled video in a standard player. Users can visually compare by opening the original in a separate tab. Consider this for a future "Video Viewer" enhancement.

---

## Feature Dependencies

```
TS-1: Multi-File Upload
  |
  +-- TS-2: Per-Video Settings (needs files to configure)
  |     |
  |     +-- TS-3: Sequential Queue Processing (needs files + settings)
  |           |
  |           +-- TS-4: Per-Video Status Tracking (needs queue running)
  |           |     |
  |           |     +-- TS-7: Batch Summary View (aggregates per-video status)
  |           |     +-- D-3: Batch History (needs completed batches)
  |           |
  |           +-- TS-5: Output Delivery (needs completed videos)
  |           |
  |           +-- TS-6: Error Handling + Retry (needs failures to handle)
  |           |     |
  |           |     +-- D-1: Credit Exhaustion Detection (specialized error)
  |           |           |
  |           |           +-- D-2: Resume After Recharge (needs pause state)
  |           |
  |           +-- D-4: Queue Reordering (needs pending items in queue)
  |           +-- D-5: Batch Download ZIP (needs completed outputs)
```

**Critical path:** TS-1 -> TS-2 -> TS-3 -> TS-4 -> TS-5 -> TS-6

This is the minimum viable flow: upload videos, configure settings, process them sequentially, track status, deliver outputs, handle errors.

**Parallel work possible:**
- D-4 (queue reordering) can be built in parallel with TS-4-TS-6 once the queue exists
- TS-7 (batch summary) is pure UI that can be built once TS-4 is in place
- D-1/D-2 (credit exhaustion) builds on top of TS-6 (error handling)

---

## MVP Recommendation

**Prioritize (Phase 1 -- Core Batch Flow):**
1. TS-1: Multi-file upload with validation (8-second limit check)
2. TS-2: Global settings panel with presets (defer per-video override to Phase 2)
3. TS-3: Sequential queue processing (database-backed, backend-driven)
4. TS-4: Per-video status tracking
5. TS-5: Output delivery to Supabase + Google Drive
6. TS-6: Error handling with retry
7. TS-7: Batch summary view

**Prioritize (Phase 2 -- Credit Management):**
1. D-1: Credit exhaustion detection with pause
2. D-2: Resume capability
3. Per-video settings override (from TS-2)

**Defer:**
- D-3: Batch history with re-run -- can use existing feed for now
- D-4: Queue reordering -- nice-to-have, not blocking
- D-5: Batch ZIP download -- individual downloads work fine initially

**Rationale:** The core batch flow (upload, configure, process, track, deliver, retry) must work end-to-end before adding credit management complexity. Credit pause/resume is the primary differentiator but depends on the core queue being solid first.

---

## Key Constraints Affecting Features

| Constraint | Impact on Features |
|-----------|-------------------|
| Freepik 8-second video limit | Must validate on upload (TS-1), clearly communicate to users |
| Freepik daily limits (10 free, 125 tier 1) | Sequential processing (TS-3), credit exhaustion detection (D-1) |
| Heroku 30-second timeout | Queue processing must be background/async, not request-scoped |
| Heroku 512MB memory | Cannot buffer large video files in memory; stream downloads |
| Freepik Video Upscaler API uncertainty | API endpoint documented in PROJECT.md but not found in public Freepik API docs; needs validation before implementation begins (LOW confidence) |
| Existing patterns | Must integrate with existing VideoJob model, feed sidebar, ProjectContext, Google Drive upload pattern |

---

## Sources

- [Freepik AI Video Upscaler product page](https://www.freepik.com/ai/video-upscaler) -- feature set and limitations
- [Freepik API documentation](https://docs.freepik.com/pricing) -- pricing model and rate limits
- [Freepik API endpoint index](https://docs.freepik.com/llms.txt) -- available API endpoints (video upscaler NOT listed as of 2026-03-11)
- [Magnific API](https://magnific.ai/api/) -- image-only API endpoints, no video
- [Topaz Video AI batch queue community request](https://community.topazlabs.com/t/much-better-batch-control-of-all-items-in-queue-required/80123) -- user demand for better queue control
- [LogRocket: UI patterns for async workflows](https://blog.logrocket.com/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines) -- progress tracking and partial failure UX patterns
- [Freepik AI Video Upscaler Product Hunt launch](https://hunted.space/product/freepik-ai-video-upscaler) -- user feedback and feature reception
- Existing codebase: `frontend/src/pages/VideoUpscale.tsx`, `backend/api/video_jobs.py`, `frontend/src/contexts/ProjectContext.tsx`, `backend/services/google_drive_service.py`

---

*Research completed: 2026-03-11*
