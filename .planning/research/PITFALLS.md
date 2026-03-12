# Domain Pitfalls: Batch Video Upscale with Freepik API

**Domain:** Batch video upscaling via external credit-based API on Heroku-hosted FastAPI app
**Researched:** 2026-03-11
**Milestone:** v1.1 Batch Video Upscale
**Overall confidence:** HIGH (based on codebase analysis, existing patterns, official Heroku/Supabase docs, and Freepik API documentation)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or broken user experience at the architectural level.

---

### Pitfall 1: Batch State Lost on Heroku Dyno Restart

**What goes wrong:** The app currently uses in-memory job stores for background processing (see `hf_download_service.py` lines 22-23: `_HF_JOBS: dict[str, dict] = {}`). If the same pattern is used for the batch upscale queue, all batch state -- which videos are pending, which is currently processing, what the overall batch progress is -- vanishes whenever Heroku restarts the dyno. Heroku performs at least one daily restart ("dyno cycling"), plus restarts on deploy, config var changes, or scaling events. A user who queues 10 videos goes to bed, and wakes up to find 3 completed, 7 vanished, and no record of the batch ever existing.

**Why it happens:** The in-memory pattern was acceptable for HuggingFace downloads because that was a single-admin, opportunistic use case. Batch video upscale is a multi-user, mission-critical workflow where users expect reliability. The architectural shortcut that worked for v1.0 infrastructure management becomes a critical flaw for v1.1.

**Consequences:**
- Users lose queued videos mid-batch with no recovery path
- Credit spent on completed-but-untracked videos is wasted (no record of output URLs)
- Resuming after restart is impossible because the batch context is gone
- Pause-and-notify feature is meaningless if the "paused" state does not survive restart

**Warning signs:**
- Using `dict` or module-level variables to track batch/queue state
- No database table for batch metadata (only individual video jobs)
- Background tasks launched via `asyncio.create_task()` without persistence
- Tests pass locally but production users report "disappeared" jobs

**Prevention:**
- Store ALL batch and queue state in Supabase from the start: a `batches` table (batch_id, user_id, status, total_videos, completed_count, paused_at, resumed_at) and a `batch_videos` table (batch_video_id, batch_id, video_index, status, freepik_task_id, input_url, output_url, error_message, credits_used)
- The batch processing loop must be re-entrant: on startup, query for batches with status "processing" or "paused" and resume them
- Use `@app.on_event("startup")` to scan for orphaned batches and either resume or mark them as "interrupted"
- Each state transition (pending -> uploading -> submitted -> processing -> completed/failed) must be a database write BEFORE the next action

**Detection:** Check if batch state survives `heroku ps:restart`. If not, this pitfall is active.

**Phase:** Phase 1 (Database Schema + Batch Service) -- foundational, must be the first thing built

---

### Pitfall 2: Heroku 30-Second Timeout Killing Batch Submission Requests

**What goes wrong:** The user uploads 10 videos, the frontend sends them to the backend, and the backend tries to validate all files, upload each to Freepik, and start the batch -- all within a single HTTP request. This request easily exceeds Heroku's hard 30-second router timeout (H12 error). The request is terminated mid-processing, and the user sees a generic error. Some videos may have been submitted to Freepik but the response never reaches the client, creating orphaned tasks consuming credits.

**Why it happens:** The existing workflow submission pattern (see `runpod_service.py`, `comfyui_service.py`) handles single-item submissions that complete in <5 seconds. Developers apply the same single-request pattern to batch operations without accounting for the multiplicative time cost.

**Consequences:**
- H12 timeout errors for batches larger than 2-3 videos
- Orphaned Freepik tasks consuming credits without tracking
- Inconsistent state: some videos submitted, others not, user does not know which
- Users retry the submission, creating duplicate Freepik tasks and burning more credits

**Warning signs:**
- Batch submission endpoint does more than accept-and-acknowledge
- No immediate HTTP response with batch ID before processing begins
- Freepik API calls happening inside the request handler (not in a background task)
- Any single endpoint exceeding 5-second response time

**Prevention:**
- The batch submission endpoint must follow a fire-and-forget pattern:
  1. Accept the video list and parameters (validate input format only)
  2. Create the batch record and individual video records in Supabase with status "pending"
  3. Return immediately with the batch ID (response time <1 second)
  4. Launch the batch processing loop as a background task
- Frontend receives the batch ID instantly and starts polling for status
- Each video upload to Freepik happens sequentially in the background task, not in the request handler
- The background task updates the database after each individual video submission

**Detection:** Time the batch submission endpoint. If it takes more than 2 seconds for 5+ videos, this pitfall is active.

**Phase:** Phase 1 (API Design) -- the endpoint contract must be fire-and-forget from day one

---

### Pitfall 3: Credit Exhaustion Detection as an Afterthought

**What goes wrong:** The batch processor submits videos to Freepik one by one. Video #6 out of 10 fails with a credit exhaustion error (likely HTTP 402 or 429 with a specific error body). But the error handling treats this like any other failure -- marks video #6 as "failed" and moves to video #7, which also fails, and #8, and so on. The user sees 6 individual failures instead of one clear "credits exhausted -- batch paused" message. Worse, each failed submission may still consume an API request against rate limits.

**Why it happens:** Credit exhaustion is a fundamentally different error category from other API failures (network timeout, invalid parameters, server error). It affects ALL remaining videos in the batch, not just the current one. Treating it as a per-video error loses the ability to pause-and-resume intelligently.

**Consequences:**
- Remaining credits wasted on guaranteed-to-fail API calls
- User sees N individual error messages instead of one actionable "credits exhausted" notification
- No resume capability because the system does not distinguish "paused due to credits" from "failed due to error"
- Rate limit quota consumed by submissions that will be rejected

**Warning signs:**
- Error handling uses a generic `except Exception` for all Freepik API errors
- No distinct batch status for "paused_credit_exhaustion"
- The batch processor does not check remaining credits before each submission
- No notification mechanism when the batch pauses

**Prevention:**
- Classify Freepik API errors into three categories:
  1. **Retryable** (429 rate limit, 500/502/503 server errors) -- retry with exponential backoff
  2. **Credit exhaustion** (402 or specific error code/message) -- pause the entire batch, notify user
  3. **Permanent failure** (400 bad request, 422 validation error) -- mark this video as failed, continue to next
- Add a `paused_credit_exhaustion` status to the batch, distinct from `paused` (user-initiated) and `failed`
- Before each submission, optionally check a credits-remaining endpoint if Freepik provides one
- When credit exhaustion is detected:
  1. Update batch status to `paused_credit_exhaustion`
  2. Store the index of the next video to process (resume point)
  3. Send a notification to the user (store in database, show in UI on next poll)
  4. Provide a "Resume" button that re-checks credits and continues from where it paused

**Detection:** Simulate credit exhaustion in tests by mocking a 402 response on video #3 of a 5-video batch. Verify the batch pauses and videos #4-5 remain "pending" (not "failed").

**Phase:** Phase 2 (Credit Management) -- but the error classification must be designed in Phase 1's Freepik service

---

### Pitfall 4: Downloading Upscaled Videos Into Backend Memory Before Uploading

**What goes wrong:** When Freepik completes a video upscale, the result is available as a download URL. The backend downloads the full upscaled video into memory (using `httpx.get()` returning `.content`), then uploads it to Supabase Storage, then uploads it again to Google Drive. The existing `storage_service.py` does exactly this pattern (line 98: `video_content = video_response.content`) and the `google_drive_service.py` uses `MediaInMemoryUpload` (line 235). A 4K upscaled video can be 50-200 MB. Processing 3-4 such videos concurrently on Heroku's 512 MB memory limit causes OOM crashes (R14/R15 errors), killing the dyno and all running batch operations.

**Why it happens:** The existing upload pattern was designed for ComfyUI outputs that are typically small (5-20 MB). Video upscaling outputs are an order of magnitude larger. The same code patterns that work for small files cause memory exhaustion for large files.

**Consequences:**
- R14 (Memory Quota Exceeded) warnings, then R15 (Memory Quota Vastly Exceeded) dyno kills
- All in-progress requests fail when the dyno crashes
- Other users' operations are affected (not just the upscale user)
- If batch state is in-memory, all progress is lost (compounds Pitfall 1)

**Warning signs:**
- `video_response.content` used to download large files (loads entire response into memory)
- `MediaInMemoryUpload` used for Google Drive uploads of large files
- Memory usage spikes during video download/upload operations
- R14 errors in Heroku logs during batch processing

**Prevention:**
- Stream the upscaled video download using `httpx` streaming: `async with client.stream("GET", url) as response: async for chunk in response.aiter_bytes(chunk_size=1_048_576):`
- For Supabase Storage: use streaming upload or write to a temporary file and upload from disk (Heroku dynos have ~4 GB ephemeral disk space, far more than memory)
- For Google Drive: replace `MediaInMemoryUpload` with `MediaFileUpload` using a temporary file, or use `MediaIoBaseUpload` with a streaming wrapper
- Process batch videos strictly one at a time (never concurrent downloads/uploads)
- Add memory monitoring: log process memory before and after each video processing cycle
- Set a maximum file size guard: if the upscaled video exceeds a configurable limit (e.g., 300 MB), warn the user or refuse the operation

**Detection:** Monitor Heroku memory usage during upscale processing. If memory exceeds 400 MB during a single video download, this pitfall is active.

**Phase:** Phase 3 (Output Delivery) -- but the streaming architecture decision must be made in Phase 1

---

### Pitfall 5: Dual-Destination Upload Without Atomicity

**What goes wrong:** Each completed video must be uploaded to both Supabase Storage (for in-app viewing) and Google Drive (for project delivery). The implementation uploads to Supabase first, succeeds, then uploads to Google Drive, which fails (network timeout, Google API rate limit, Drive quota exceeded). Now the video exists in Supabase but not in Drive. The system marks the video as "completed" because the Supabase upload worked, but the user's Google Drive project folder is missing the video. Or worse: Supabase upload fails, Google Drive upload succeeds, and the video is in Drive but not viewable in the app.

**Why it happens:** Distributed systems cannot guarantee atomicity across two independent storage services without a coordination mechanism. Developers treat the dual upload as a simple sequential operation, but partial failures create inconsistent state.

**Consequences:**
- Videos missing from one storage destination with no indication to the user
- Manual intervention required to fix inconsistent state
- If the video is marked "completed" after the first upload, retrying only uploads to the second destination is complex
- Google Drive failures may be transient but are not retried

**Warning signs:**
- Sequential upload to Supabase then Drive with a single "completed" status at the end
- No per-destination upload status tracking
- No retry mechanism for the second upload if the first succeeds
- Google Drive errors logged but not surfaced to the user

**Prevention:**
- Track upload status per destination: `supabase_upload_status` and `drive_upload_status` columns on the batch_videos table
- Mark the video as "completed" only when BOTH uploads succeed (or when Drive is not configured)
- Implement independent retry for each destination: if Supabase succeeds but Drive fails, retry Drive without re-downloading the video
- Use a temporary file on disk as an intermediary: download once, upload to both destinations from the temp file, then clean up
- Add a "repair" mechanism: an endpoint or background job that finds videos with partial upload status and retries the missing destination
- Make Google Drive upload optional (graceful degradation): if Drive is not configured or the user has no project context, skip Drive upload without failing the entire operation

**Detection:** Simulate a Google Drive API failure during upload. Verify that the video appears in Supabase and that Drive upload is retried on the next processing cycle.

**Phase:** Phase 3 (Output Delivery) -- the per-destination status tracking must be in the database schema from Phase 1

---

## Moderate Pitfalls

Mistakes that cause degraded experience, wasted resources, or technical debt.

---

### Pitfall 6: Polling Freepik Status Too Aggressively or Too Lazily

**What goes wrong:** Freepik's video upscaler is async: you submit a task and poll for completion. Two failure modes exist. **Too aggressive:** Polling every 1-2 seconds burns through rate limits (Freepik allows 50 hits/second burst, 10 hits/second sustained) and provides no benefit since video upscaling takes minutes. With a batch of 10 videos, aggressive polling generates 600+ requests per minute. **Too lazy:** Polling every 60 seconds means the user waits up to 60 seconds after completion before seeing their result, and the batch sits idle between videos unnecessarily.

**Why it happens:** The existing ComfyUI polling in `startJobMonitoring` (frontend) and RunPod polling (3-second intervals per PROJECT.md) were tuned for fast operations. Developers copy these intervals without considering that Freepik video upscaling takes 2-10 minutes per video.

**Consequences:**
- Aggressive: Rate limit exhaustion (429 errors), Freepik may throttle or block the API key
- Aggressive: Unnecessary load on Heroku dyno spending CPU on HTTP requests
- Lazy: Poor user experience, batch throughput reduced due to idle time between videos
- Both: Credits potentially wasted if rate limits interfere with task submission

**Prevention:**
- Use exponential backoff polling: start at 5-second intervals, increase to 10, 20, 30 seconds, cap at 30 seconds
- Alternatively, use adaptive polling: poll at 5-second intervals for the first 30 seconds, then 15-second intervals thereafter
- If Freepik supports webhooks (the image upscaler has an optional `webhook_url` parameter), investigate whether the video upscaler supports them too -- this eliminates polling entirely
- Track the average processing time per resolution/settings combination and use it to estimate when to start polling
- Backend does the polling (not the frontend), updating the database. Frontend polls the backend at a reasonable interval (3-5 seconds) for UI updates

**Detection:** Count Freepik API status-check calls per video. If >50 calls per video, polling is too aggressive. If average idle time after completion is >30 seconds, polling is too lazy.

**Phase:** Phase 2 (Freepik Service Implementation)

---

### Pitfall 7: Frontend Upload of Large Video Files Hitting Heroku Timeout

**What goes wrong:** Users select 10 videos (each 50-100 MB) for batch upload. The frontend sends them to the backend in a single multipart POST request. Heroku's 30-second timeout kills the upload before all files transfer. Even if sent as individual uploads, each large video upload can exceed 30 seconds on slower connections.

**Why it happens:** The existing file upload patterns handle small images (<10 MB) and audio files. Video files for upscaling are substantially larger, and batch upload multiplies the problem.

**Consequences:**
- Upload failures for batches with large or numerous videos
- Users unsure which files were received and which were not
- Retry uploads the entire batch, including already-uploaded files

**Prevention:**
- Upload videos individually, not as a batch: frontend sends each video as a separate upload request, tracking upload progress per video
- Use chunked/resumable uploads for large videos (Supabase Storage supports TUS protocol for resumable uploads up to 50 GB)
- Store uploaded videos in a staging area (Supabase Storage or temp bucket) before batch submission
- The batch submission request sends only the storage references (URLs or paths), not the actual video data
- Frontend shows per-video upload progress with the ability to retry individual failed uploads
- Set file size limits: validate on the frontend before upload begins (e.g., max 500 MB per video, max 2 GB total batch)

**Detection:** Test uploading a 100 MB video file through the backend on Heroku. If it returns H12, this pitfall is active.

**Phase:** Phase 1 (Frontend Upload Component + Backend Upload Endpoint)

---

### Pitfall 8: Freepik API Documentation Gap for Video Upscaler

**What goes wrong:** Research shows that Freepik's API documentation (docs.freepik.com) extensively covers the image upscaler endpoints but has limited or no public documentation for a dedicated video upscaler API endpoint. The PROJECT.md references `api.freepik.com/v1/ai/video-upscaler` as the endpoint, but this may be based on internal knowledge, early API access, or an endpoint that is not yet publicly documented. Building against an undocumented or beta API means the endpoint behavior, error codes, rate limits, and pricing may change without notice.

**Why it happens:** Freepik launched the video upscaler as a UI product (freepik.com/ai/video-upscaler) powered by Topaz technology. The API access may be newer or restricted to certain tiers. The llms-full.txt documentation dump does not mention a video upscaler endpoint.

**Consequences:**
- API endpoint URL, parameters, or response format may differ from assumptions
- Credit consumption per video may be higher than expected (frame-based pricing for video can be 10-50x more than a single image upscale)
- Rate limits specific to the video upscaler may be stricter than the general API rate limits
- Breaking changes without deprecation notices (beta/undocumented APIs have no stability guarantees)

**Prevention:**
- Before writing any code, verify the exact API contract: make a manual test call to `api.freepik.com/v1/ai/video-upscaler` with a real API key and a test video
- Document the actual request/response format, error codes, and credit consumption from the test
- Build the Freepik service layer with an abstraction that isolates API-specific details (endpoint URL, parameter names, response parsing) so changes can be absorbed in one place
- Implement a health check endpoint that verifies the Freepik video upscaler API is accessible and the API key is valid
- Add defensive parsing for the API response: do not assume field names or structure, validate and log unexpected responses
- Pin to a specific API version if Freepik supports versioning

**Detection:** The very first integration task should be a standalone script that submits a test video and polls to completion. If this fails, escalate before building the full service.

**Phase:** Phase 0 (Pre-implementation validation) -- must be verified before any development begins

---

### Pitfall 9: Batch Processing Loop Not Surviving Background Task Failures

**What goes wrong:** The batch processor runs as a Python `asyncio.create_task()` background task. If any unhandled exception occurs (network error, JSON parse error, unexpected API response structure), the entire task crashes. The batch is now stuck: some videos processed, the rest in "pending" forever. No error is logged because the task's exception is only raised if you `await` it, and fire-and-forget tasks do not do this.

**Why it happens:** Python's `asyncio.create_task()` silently swallows exceptions from unawaited tasks (only emitting a warning on garbage collection). The existing HuggingFace download service wraps the blocking function in `asyncio.to_thread()` which provides better exception isolation, but a pure-async batch loop has this vulnerability.

**Consequences:**
- Batch silently stops processing with no error visible to the user
- "Pending" videos remain pending indefinitely
- Python emits "Task exception was never retrieved" warning to stderr, which may not be monitored
- User has no way to restart or resume the batch because the system thinks it is still "processing"

**Warning signs:**
- `asyncio.create_task()` called without storing the task reference
- No `try/except` wrapping the entire batch processing loop
- No "heartbeat" or "last_updated_at" timestamp on the batch record
- No stale-batch detection on server startup

**Prevention:**
- Wrap the entire batch processing loop in a top-level `try/except Exception` that catches ALL errors, logs them, and updates the batch status to "error" in the database
- Store the task reference and add a `done_callback` that checks for exceptions: `task.add_done_callback(lambda t: handle_task_error(t, batch_id))`
- Update a `last_heartbeat` timestamp on the batch record every processing cycle (every 30-60 seconds)
- Add a startup check that finds batches with status "processing" but `last_heartbeat` older than 5 minutes, and either resumes or marks them as "interrupted"
- Each individual video processing step should have its own try/except so one video failure does not crash the loop
- Log every state transition with batch_id and video_id for debugging

**Detection:** Kill the batch processing task mid-execution (e.g., raise an exception in a mock). Verify that the batch is marked as "error" or "interrupted" and can be resumed.

**Phase:** Phase 2 (Batch Processing Loop) -- but the heartbeat column must be in the Phase 1 schema

---

### Pitfall 10: Rate Limit Handling Conflated with Credit Exhaustion

**What goes wrong:** Freepik has two distinct limit systems: (1) rate limits (requests per second/day: 10 hits/s sustained, 50 hits/s burst; RPD varies by plan) and (2) credit-based pricing (per-frame costs). Developers treat both as the same error and either retry credit exhaustion (wasteful, will never succeed without adding credits) or pause-on-rate-limit (unnecessarily halts the batch when a simple backoff would resolve it).

**Why it happens:** Both manifest as HTTP error responses (likely 429 for rate limits, 402 or a custom error for credits). Without parsing the response body or distinguishing the error codes, the handler cannot tell which limit was hit.

**Consequences:**
- Rate limit hit: batch pauses and notifies user to "add credits" (wrong -- just needs to wait)
- Credit exhaustion: batch retries every 30 seconds for hours (wrong -- needs user action)
- RPD (requests per day) limit exhaustion at 125/day (Tier 1): batch fails entirely with no explanation

**Prevention:**
- Parse the Freepik error response to distinguish rate limit (temporary) from credit exhaustion (requires user action) from RPD exhaustion (wait until tomorrow)
- Implement three distinct handlers:
  1. **Rate limit (per-second):** Exponential backoff, retry automatically (max 3 retries)
  2. **Credit exhaustion:** Pause batch, notify user, wait for explicit resume
  3. **RPD exhaustion:** Pause batch, calculate time until reset (midnight?), auto-resume or notify user
- Track the daily request count locally to preemptively avoid RPD exhaustion (if at 120/125, pause and warn rather than hitting the 126th request and getting blocked)
- Store the last rate limit error timestamp to calculate safe retry windows

**Detection:** Mock three different error responses (429 rate limit, 402 no credits, 429 daily limit exceeded) and verify each triggers the correct handler.

**Phase:** Phase 2 (Freepik Service Error Handling)

---

### Pitfall 11: No Idempotency on Batch Resume

**What goes wrong:** The user pauses a batch (or credits are exhausted), adds credits, and clicks "Resume." The resume logic reprocesses the batch from the beginning or from the wrong index, re-submitting videos that were already completed. This wastes credits on duplicate upscaling and creates duplicate outputs in Supabase Storage and Google Drive.

**Why it happens:** The resume logic queries for videos with status "pending" but does not account for videos that were submitted to Freepik but not yet polled to completion (status "submitted" or "processing"). On resume, these in-flight videos are treated as pending and re-submitted.

**Consequences:**
- Double credit consumption for already-submitted videos
- Duplicate files in Supabase Storage and Google Drive
- Conflicting Freepik task IDs: old task completes after new task is submitted, causing state confusion

**Prevention:**
- Use granular per-video statuses: `pending`, `uploading`, `submitted` (has Freepik task_id), `processing` (Freepik confirmed in progress), `completed`, `failed`, `skipped`
- On resume: only process videos with status `pending`. Videos with status `submitted` or `processing` should be polled (not re-submitted)
- Store the `freepik_task_id` on each video record immediately after submission. If a task_id exists, never re-submit -- only poll
- Make video submission idempotent: before submitting, check if a Freepik task_id already exists for this video. If yes, poll instead of submitting
- Add a "retry failed" action distinct from "resume paused" -- retry re-submits only videos with status `failed`

**Detection:** Pause and resume a batch. Check Freepik API call count against expected count. If any video is submitted twice, this pitfall is active.

**Phase:** Phase 2 (Batch Processing Logic + Resume Implementation)

---

## Minor Pitfalls

Mistakes that cause friction, confusion, or minor bugs.

---

### Pitfall 12: Signed URLs Expiring Before User Downloads Upscaled Videos

**What goes wrong:** The existing `storage_service.py` creates Supabase signed URLs with 7-day expiry (line 145). If a batch completes on Monday and the user tries to download the videos on the following Monday, the signed URLs have expired. The video exists in storage but the URL in the database is dead.

**Prevention:**
- Use public URLs for completed upscaled videos (they are the user's content, not sensitive)
- Or use longer-lived signed URLs (30 days)
- Or implement on-demand URL regeneration: when a user requests a video, check if the URL is expired and generate a new signed URL

**Phase:** Phase 3 (Output Delivery)

---

### Pitfall 13: Batch UI Not Distinguishing Video States Clearly

**What goes wrong:** The batch shows a progress bar (e.g., "5/10 complete") but does not distinguish between videos that are pending, submitted-but-waiting, actively processing, completed, failed, or skipped. Users cannot tell if the batch is stuck or just slow. They cannot identify which specific video failed or why.

**Prevention:**
- Show per-video status with individual progress indicators (icon or color per status)
- Display the current action: "Uploading video 3..." vs "Waiting for Freepik to process video 3..." vs "Downloading result for video 3..."
- Show estimated time remaining based on average processing time of completed videos
- Allow clicking on a failed video to see the specific error message
- Show credit consumption: "X credits used so far, estimated Y credits remaining for this batch"

**Phase:** Phase 4 (Frontend UI)

---

### Pitfall 14: Google Drive Folder Picker Context Lost Between Sessions

**What goes wrong:** The app has an existing ProjectContext with folder picker in the header (per PROJECT.md). Users select a Google Drive folder for one batch, navigate away, come back, and the folder selection is gone. They submit a new batch without realizing no Drive folder is selected, and videos are uploaded to Supabase only (or worse, the upload fails silently because the Drive folder ID is null).

**Prevention:**
- Persist the Drive folder selection in the batch record at submission time (not just in localStorage or context)
- Validate that the Drive folder exists and is accessible before starting the batch
- Show the selected Drive folder prominently in the batch submission form
- If no Drive folder is selected, clearly indicate that videos will be saved to Supabase only (not silently skip Drive)
- Allow changing the Drive destination for future videos in a batch without re-processing completed ones

**Phase:** Phase 3 (Output Delivery) + Phase 4 (Frontend UI)

---

### Pitfall 15: Batch Cleanup Not Handling Partial State

**What goes wrong:** A user deletes a batch from the UI. The deletion removes the batch record and video records from the database but does not clean up: (1) the original uploaded videos in the staging area, (2) the completed upscaled videos in Supabase Storage, (3) the upscaled videos in Google Drive, or (4) in-progress Freepik tasks that are still processing. Orphaned files accumulate, consuming storage quota. Orphaned Freepik tasks continue to run and consume credits.

**Prevention:**
- Implement cascade cleanup: deleting a batch should cancel any in-progress Freepik tasks (if the API supports cancellation), delete staging files, and optionally delete output files (with user confirmation)
- Do not auto-delete output files -- ask the user: "Delete output files too, or keep them?"
- Track Freepik task IDs in the database so they can be cancelled on batch deletion
- Add a periodic cleanup job that finds orphaned staging files (uploads older than 24 hours with no associated batch) and deletes them

**Phase:** Phase 4 (Polish and Cleanup)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| **Phase 0: API Validation** | #8 (Freepik API docs gap) | Manual test call before writing any code |
| **Phase 1: Database + Upload** | #1 (State persistence), #2 (30s timeout), #7 (Large file upload) | Database-first design, fire-and-forget endpoints, chunked upload |
| **Phase 2: Freepik Integration** | #3 (Credit exhaustion), #6 (Polling strategy), #9 (Background task failure), #10 (Rate vs credit errors), #11 (Idempotent resume) | Error classification, exponential backoff, heartbeat, granular status |
| **Phase 3: Output Delivery** | #4 (Memory exhaustion), #5 (Dual-destination atomicity), #12 (URL expiry), #14 (Drive folder context) | Streaming downloads, per-destination status, temp files |
| **Phase 4: Frontend UI** | #13 (State visibility), #15 (Cleanup) | Per-video status display, cascade cleanup |

---

## Existing Codebase Risk Amplifiers

These are not new pitfalls but existing patterns that amplify the risks above.

| Existing Pattern | Where | Risk for v1.1 |
|------------------|-------|---------------|
| In-memory job store | `hf_download_service.py:22` | Amplifies Pitfall 1 if copied |
| Full-file-in-memory download | `storage_service.py:98` | Amplifies Pitfall 4 if reused for upscaled videos |
| `MediaInMemoryUpload` for Drive | `google_drive_service.py:235` | Amplifies Pitfall 4 for Drive uploads |
| 60-second httpx timeout | `storage_service.py:28` | May be too short for downloading 4K upscaled videos |
| No streaming upload to Supabase | `storage_service.py:116` | Standard upload limited to 6 MB; upscaled videos will be 50-200 MB |
| Single `comfy_job_id` keying | `video_job_service.py:163` | Need different keying for Freepik (freepik_task_id, not comfy_job_id) |

---

## Sources

- Heroku request timeout documentation: [Request Timeout | Heroku Dev Center](https://devcenter.heroku.com/articles/request-timeout)
- Heroku H12 prevention: [Preventing H12 Errors | Heroku Dev Center](https://devcenter.heroku.com/articles/preventing-h12-errors-request-timeouts)
- Freepik API rate limits: [Rate limiting - Freepik API](https://docs.freepik.com/ratelimits)
- Freepik image upscaler API (closest documented analog): [Upscale image - Freepik API](https://docs.freepik.com/api-reference/image-upscaler-creative/post-image-upscaler)
- Supabase storage upload limits: [File Limits | Supabase Docs](https://supabase.com/docs/guides/storage/uploads/file-limits)
- Supabase resumable uploads: [Storage v3: Resumable Uploads](https://supabase.com/blog/storage-v3-resumable-uploads)
- Google Drive resumable uploads: [Manage Uploads | Google for Developers](https://developers.google.com/drive/api/guides/manage-uploads)
- FastAPI background tasks limitations: [Background Tasks - FastAPI](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- Codebase analysis: `hf_download_service.py`, `storage_service.py`, `google_drive_service.py`, `video_job_service.py`, `runpod_service.py`, `config/settings.py`

---

*Research completed: 2026-03-11*
