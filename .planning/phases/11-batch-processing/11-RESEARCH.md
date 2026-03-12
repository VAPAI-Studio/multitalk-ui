# Phase 11: Batch Processing - Research

**Researched:** 2026-03-11
**Domain:** Retry logic with exponential backoff, Freepik credit exhaustion detection, batch pause/resume, queue reordering, error classification
**Confidence:** HIGH (architecture extends existing Phase 10 code; patterns are well-established in the codebase)

## Summary

Phase 11 transforms the Phase 10 single-video-at-a-time batch processor into a robust system with intelligent error handling. The current `_process_batch` loop in `backend/api/upscale.py` already processes videos sequentially and marks individual videos as failed, but it treats all failures identically and has no retry, pause, or reorder capability. This phase adds three capabilities: (1) transient error retry with exponential backoff, (2) credit exhaustion detection that pauses the entire batch, and (3) queue reordering for pending videos.

The existing code provides an excellent foundation. The `_process_single_video` function already returns `bool` for success/failure and the `_process_batch` loop already uses `get_next_pending_video` (ordered by `queue_position`). The `FreepikUpscalerService` already separates HTTP errors by type (`HTTPStatusError`, `TimeoutException`, `RequestError`). The database schema already has `retry_count`, `pause_reason`, `paused_at`, and `last_heartbeat` columns -- all created in Phase 10's forward-looking migration. The work is purely about extending the processing logic and adding two new API endpoints.

**Primary recommendation:** Modify `_process_single_video` to return a structured result (not just bool) that classifies failures as transient vs. credit-exhaustion vs. permanent. Add retry logic with 2 retries and exponential backoff for transient failures. Add credit exhaustion detection in `_process_batch` that pauses all remaining videos and the batch. Add resume and reorder endpoints to the API router. No new database migration needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEU-03 | User can reorder pending videos in the queue via drag-and-drop | New API endpoint `PATCH /batches/{batch_id}/reorder` that accepts ordered list of video IDs and updates `queue_position` values; `get_next_pending_video` already uses `ORDER BY queue_position` so reordering is transparent to the processor |
| ERRR-01 | Failed videos show error message and a retry button | New API endpoint `POST /batches/{batch_id}/videos/{video_id}/retry` that resets a failed video to pending (status, error_message, retry_count); error_message already stored on `upscale_videos` |
| ERRR-02 | Transient errors (network, 5xx) auto-retry up to 2 times with backoff | Modify `_process_single_video` to detect transient errors and retry with exponential backoff (2s, 4s); `retry_count` column already exists on `upscale_videos`; classify 5xx/timeout/RequestError as transient |
| ERRR-03 | Credit exhaustion detected and batch pauses automatically | Modify `_process_batch` to check `_process_single_video` result; on credit exhaustion, set all remaining pending videos to 'paused', batch to 'paused' with `pause_reason='credit_exhaustion'` |
| ERRR-04 | User sees clear notification explaining the pause with guidance | `pause_reason` column already exists; API returns it in batch detail response; frontend (Phase 13) will read and display it |
| ERRR-05 | User can resume a paused batch and processing continues from where it left off | New API endpoint `POST /batches/{batch_id}/resume` that sets paused videos back to pending, batch to processing, and launches `_process_batch` via `asyncio.create_task` |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | >=0.25.2 (installed) | Freepik API HTTP client with typed exceptions | Already used by FreepikUpscalerService; `HTTPStatusError.response.status_code` enables error classification |
| asyncio (stdlib) | Built-in | `asyncio.sleep` for backoff delays, `create_task` for resume | Already used in `_process_batch` and polling |
| FastAPI | >=0.104.1 (installed) | New API endpoints for resume, retry, reorder | Already the app framework |
| supabase-py | >=2.3.0 (installed) | Batch/video state updates for pause/resume/reorder | Already used by UpscaleJobService |
| pydantic | >=2.5.1 (installed) | New request models for reorder payload | Already used for all API models |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dataclasses (stdlib) | Built-in | Structured result from `_process_single_video` | Replace bool return with typed result containing failure classification |
| enum (stdlib) | Built-in | `FailureType` enum for error classification | Clean classification of transient vs credit vs permanent failures |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual retry loop | tenacity library | tenacity adds a dependency for a 10-line retry loop; manual is simpler and already matches codebase patterns |
| dataclass for result | NamedTuple | Both work; dataclass is more explicit and matches Python patterns in the codebase |
| Enum for failure type | String literals | Enum prevents typos and enables exhaustive matching; Literal type also acceptable per Phase 10 precedent |

**Installation:**
```bash
# No new packages needed -- everything is already installed
```

## Architecture Patterns

### Recommended Project Structure

```
backend/
├── api/
│   └── upscale.py              # + resume, retry, reorder endpoints; + enhanced _process_single_video
├── models/
│   └── upscale.py              # + ReorderPayload, ProcessingResult, FailureType
├── services/
│   └── upscale_job_service.py  # + pause_batch, resume_batch, reorder_videos, retry_video methods
└── tests/
    ├── test_batch_processing.py  # + retry tests, credit exhaustion tests
    ├── test_upscale_api.py       # + resume, retry, reorder endpoint tests
    └── test_upscale_job_service.py # + pause, resume, reorder service tests
```

### Pattern 1: Structured Processing Result

**What:** Replace the boolean return from `_process_single_video` with a dataclass that classifies the failure.
**When to use:** Every call to `_process_single_video` in `_process_batch`.
**Example:**
```python
# Source: New pattern for Phase 11
from dataclasses import dataclass
from typing import Optional, Literal

FailureType = Literal["transient", "credit_exhaustion", "permanent"]

@dataclass
class ProcessingResult:
    success: bool
    failure_type: Optional[FailureType] = None
    error_message: Optional[str] = None
    should_pause_batch: bool = False
```

### Pattern 2: Error Classification from HTTP Status

**What:** Classify Freepik API errors into transient, credit exhaustion, or permanent based on HTTP status code and response body.
**When to use:** Inside `_process_single_video` after a Freepik API failure.
**Example:**
```python
# Source: Based on Freepik API docs + industry patterns
def _classify_error(error_message: str) -> FailureType:
    """Classify an error as transient, credit_exhaustion, or permanent."""
    msg = error_message.lower()

    # Credit exhaustion: HTTP 402 (Payment Required) or 429 with quota message
    if "http error 402" in msg or "http 402" in msg:
        return "credit_exhaustion"
    if "429" in msg and ("quota" in msg or "limit" in msg or "exceeded" in msg):
        return "credit_exhaustion"

    # Transient: 5xx errors, timeouts, network errors
    if any(code in msg for code in ["500", "502", "503", "504"]):
        return "transient"
    if "timed out" in msg or "timeout" in msg:
        return "transient"
    if "request failed" in msg or "connection" in msg:
        return "transient"

    # Everything else is permanent (400, 401, 403, validation errors)
    return "permanent"
```

### Pattern 3: Retry with Exponential Backoff in Processing Loop

**What:** Wrap `_process_single_video` with retry logic that retries transient failures up to 2 times.
**When to use:** Inside `_process_batch` for each video.
**Example:**
```python
# Source: Standard exponential backoff pattern
MAX_RETRIES = 2
BASE_DELAY = 2  # seconds

async def _process_video_with_retry(video: dict, batch: dict) -> ProcessingResult:
    """Process a video with retry logic for transient errors."""
    job_service = UpscaleJobService()
    retry_count = video.get("retry_count", 0)

    for attempt in range(MAX_RETRIES + 1):
        result = await _process_single_video(video, batch)

        if result.success:
            return result

        if result.failure_type == "credit_exhaustion":
            # No retry -- pause the whole batch
            return result

        if result.failure_type == "transient" and attempt < MAX_RETRIES:
            # Exponential backoff: 2s, 4s
            delay = BASE_DELAY * (2 ** attempt)
            await asyncio.sleep(delay)
            retry_count += 1
            await job_service.update_video_retry_count(video["id"], retry_count)
            # Reset video to processing for next attempt
            await job_service.update_video_status(video["id"], "processing")
            continue

        # Permanent error or max retries exhausted
        return result

    return result  # Shouldn't reach here, but safety
```

### Pattern 4: Batch Pause on Credit Exhaustion

**What:** When credit exhaustion is detected, pause all remaining pending videos and the batch itself.
**When to use:** Inside `_process_batch` after receiving a credit exhaustion result.
**Example:**
```python
# Source: Extends existing _process_batch pattern
async def _process_batch(batch_id: str) -> None:
    job_service = UpscaleJobService()

    try:
        batch = await _get_batch_for_processing(job_service, batch_id)
        if not batch:
            await job_service.update_batch_status(batch_id, "failed", error_message="Batch not found")
            return

        while True:
            video = await job_service.get_next_pending_video(batch_id)
            if not video:
                await job_service.update_batch_status(batch_id, "completed")
                break

            await job_service.update_batch_heartbeat(batch_id)
            result = await _process_video_with_retry(video, batch)

            if result.should_pause_batch:
                # Credit exhaustion: pause all remaining videos and the batch
                await job_service.pause_all_pending_videos(batch_id)
                await job_service.pause_batch(batch_id, pause_reason="credit_exhaustion")
                break

    except Exception as e:
        print(f"[UPSCALE] Batch {batch_id} processing error: {e}")
        await job_service.update_batch_status(batch_id, "failed", error_message=str(e))
```

### Pattern 5: Queue Reorder via Position Update

**What:** Accept an ordered list of video IDs and assign new `queue_position` values.
**When to use:** API endpoint called from frontend drag-and-drop.
**Example:**
```python
# Source: Supabase update pattern from UpscaleJobService
async def reorder_videos(self, batch_id: str, video_ids: list[str]) -> bool:
    """
    Reorder pending videos by updating queue_position based on array order.
    Only pending videos can be reordered. Already-processed videos keep their positions.
    """
    try:
        for position, video_id in enumerate(video_ids):
            self.supabase.table("upscale_videos") \
                .update({"queue_position": position}) \
                .eq("id", video_id) \
                .eq("batch_id", batch_id) \
                .eq("status", "pending") \
                .execute()
        return True
    except Exception:
        return False
```

### Pattern 6: Resume Paused Batch

**What:** Set paused videos back to pending, batch back to processing, and launch background task.
**When to use:** Resume API endpoint.
**Example:**
```python
# Source: Combines existing batch start pattern with pause recovery
@router.post("/batches/{batch_id}/resume", response_model=BatchResponse)
async def resume_batch(batch_id: str, user=Depends(get_current_user)):
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)

    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.get("status") != "paused":
        raise HTTPException(400, f"Batch is '{batch.get('status')}', must be 'paused' to resume")

    # Set all paused videos back to pending
    await service.unpause_videos(batch_id)
    # Clear pause metadata and set batch to processing
    await service.update_batch_status(batch_id, "processing")
    await service.clear_pause_metadata(batch_id)

    asyncio.create_task(_process_batch(batch_id))
    return BatchResponse(success=True, batch_id=batch_id, status="processing")
```

### Anti-Patterns to Avoid

- **Retrying credit exhaustion errors:** HTTP 402/429-with-quota errors will always fail until credits are added. Retrying wastes time and causes repeated failures. Detect and pause immediately.
- **Retrying inside FreepikUpscalerService:** The service is a clean API wrapper. Retry logic belongs in the batch processor layer that has access to the retry count and batch pause controls.
- **Pausing individual videos on credit exhaustion:** If one video hits credit exhaustion, ALL remaining videos will also fail. Pause them all at once rather than letting each fail individually.
- **Reordering non-pending videos:** Videos that are processing, completed, or failed should not be reorderable. The reorder endpoint must filter to `status = 'pending'` only.
- **Using database-level retry mechanisms:** The retry count and backoff are application-level concerns. The database just stores `retry_count` for observability.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry with backoff | Complex retry framework, tenacity decorator | Simple for-loop with `asyncio.sleep(BASE_DELAY * 2**attempt)` | Only 2 retries with fixed backoff; 10 lines of code vs. a library dependency |
| Error classification | Giant if/else chains in multiple places | Single `_classify_error(msg)` function called from one place | Centralizes all error classification logic; easy to update when Freepik's error format is confirmed |
| Batch pause | Manual update of each video individually | `UpscaleJobService.pause_all_pending_videos(batch_id)` using single Supabase query with `.eq("status", "pending")` | One DB query instead of N; atomic semantics |
| Queue reordering | Client-side position calculation | Server-side position assignment from ordered video_ids array | Server is authoritative; prevents race conditions; validates ownership |

**Key insight:** Phase 11 adds no new external dependencies. Every capability is implemented by extending existing functions and adding new service methods that follow the established Supabase CRUD pattern.

## Common Pitfalls

### Pitfall 1: Not Distinguishing Credit Exhaustion from Rate Limiting
**What goes wrong:** Treating HTTP 429 "Too Many Requests" (rate limit) the same as HTTP 402 "Payment Required" (credits exhausted). Rate limiting is transient (wait and retry); credit exhaustion is not.
**Why it happens:** Both are "too many requests" conceptually. The Freepik API may use 429 for both rate limiting and quota exhaustion (like OpenAI does).
**How to avoid:** Classify based on HTTP status code AND response body content. 429 + "rate limit" -> transient. 429 + "quota exceeded" or "limit exceeded" or "insufficient credits" -> credit exhaustion. 402 -> always credit exhaustion. Build the classifier to be safely extensible -- unknown 429 variants default to transient (retry is safe).
**Warning signs:** Single `if status_code == 429` branch without body inspection.

### Pitfall 2: Retry Loop Resets Video Status Incorrectly
**What goes wrong:** After a transient failure retry, the video's `started_at` timestamp is reset, or the `error_message` from the failed attempt is left on the video record when the retry succeeds.
**Why it happens:** The existing `update_video_status` sets `started_at` when status becomes "processing" and `error_message` when provided.
**How to avoid:** On retry, only reset `status` to "processing" without overwriting `started_at`. On successful retry, clear `error_message`. Increment `retry_count` on each retry attempt.
**Warning signs:** `update_video_status(video_id, "processing")` called during retry -- this sets `started_at` again.

### Pitfall 3: Resume Creates Duplicate Background Tasks
**What goes wrong:** User calls resume on a batch that is already processing (race condition between pause and resume). Two `_process_batch` tasks run concurrently on the same batch, causing duplicate Freepik submissions.
**Why it happens:** Resume endpoint doesn't check if a background task is already running (it only checks batch status in DB).
**How to avoid:** The resume endpoint already validates `batch.status == 'paused'`. The `_process_batch` function should also check batch status at the start of each iteration. If status is no longer "processing" (e.g., paused by another mechanism), exit the loop gracefully.
**Warning signs:** No status check inside the `while True` loop in `_process_batch`.

### Pitfall 4: Reorder Endpoint Allows Reordering During Processing
**What goes wrong:** User reorders queue while a video is actively processing. The currently-processing video finishes, and `get_next_pending_video` picks up a video the user didn't intend.
**Why it happens:** Reorder modifies `queue_position` on pending videos while the batch processor is running.
**How to avoid:** This is actually safe by design: `get_next_pending_video` queries for `status = 'pending'` ordered by `queue_position` at query time, so any reorder of pending videos takes effect immediately. The currently-processing video is unaffected because its status is "processing", not "pending". Document this as expected behavior.
**Warning signs:** N/A -- this is safe, but could be confusing if not documented.

### Pitfall 5: Pause Leaves the Currently-Processing Video Hanging
**What goes wrong:** Credit exhaustion is detected after a video fails. The `pause_all_pending_videos` call pauses all pending videos, but the video that triggered the credit exhaustion was already marked as failed (not paused). The failed video has consumed a credit that could have been saved.
**Why it happens:** The credit exhaustion is detected AFTER the Freepik API returns an error -- the credit may or may not have been consumed depending on when the error occurred.
**How to avoid:** This is the correct behavior. The video that triggered credit exhaustion should be marked as "failed" (because it did fail). Only PENDING videos that haven't been submitted yet should be paused. The `pause_reason` on the batch tells the user why, and they can retry the failed video after adding credits.
**Warning signs:** Trying to "undo" the failed video by setting it to paused.

## Code Examples

### Enhanced _process_single_video with Error Classification

```python
# Source: Extends existing backend/api/upscale.py pattern
from dataclasses import dataclass
from typing import Optional, Literal

FailureType = Literal["transient", "credit_exhaustion", "permanent"]

@dataclass
class ProcessingResult:
    success: bool
    failure_type: Optional[FailureType] = None
    error_message: Optional[str] = None
    should_pause_batch: bool = False

def _classify_error(error_message: str) -> FailureType:
    """Classify a Freepik error into transient, credit_exhaustion, or permanent."""
    msg = error_message.lower()

    # Credit exhaustion indicators
    if "402" in msg:
        return "credit_exhaustion"
    if "429" in msg and any(word in msg for word in ["quota", "limit exceeded", "insufficient", "credit", "budget"]):
        return "credit_exhaustion"

    # Transient indicators (safe to retry)
    if any(code in msg for code in ["500", "502", "503", "504"]):
        return "transient"
    if "timed out" in msg or "timeout" in msg:
        return "transient"
    if "request failed" in msg or "connection" in msg:
        return "transient"
    if "429" in msg:
        # Generic 429 without quota keywords = rate limiting (transient)
        return "transient"

    # Permanent (400, 401, 403, validation, unknown)
    return "permanent"

async def _process_single_video(video: dict, batch: dict) -> ProcessingResult:
    """Process a single video. Returns structured result with failure classification."""
    job_service = UpscaleJobService()
    freepik = FreepikUpscalerService()
    video_id = video["id"]
    batch_id = batch["id"]

    await job_service.update_video_status(video_id, "processing")

    # Submit to Freepik
    success, task_id, error = await freepik.submit_task(
        video_url=video["input_storage_url"],
        resolution=batch.get("resolution", "2k"),
        creativity=batch.get("creativity", 0),
        sharpen=batch.get("sharpen", 0),
        grain=batch.get("grain", 0),
        fps_boost=batch.get("fps_boost", False),
        flavor=batch.get("flavor", "vivid"),
    )

    if not success:
        failure_type = _classify_error(error or "")
        await job_service.update_video_status(video_id, "failed", error_message=error)
        await job_service.increment_failed_count(batch_id)
        return ProcessingResult(
            success=False,
            failure_type=failure_type,
            error_message=error,
            should_pause_batch=(failure_type == "credit_exhaustion"),
        )

    await job_service.update_video_status(video_id, "processing", freepik_task_id=task_id)

    # Poll until complete
    status, output_url, poll_error = await freepik.poll_until_complete(task_id)

    if status == "COMPLETED":
        await job_service.update_video_status(video_id, "completed", output_url=output_url)
        await job_service.increment_completed_count(batch_id)
        return ProcessingResult(success=True)

    err_msg = poll_error or f"Freepik task ended with status: {status}"
    failure_type = _classify_error(err_msg)
    await job_service.update_video_status(video_id, "failed", error_message=err_msg)
    await job_service.increment_failed_count(batch_id)
    return ProcessingResult(
        success=False,
        failure_type=failure_type,
        error_message=err_msg,
        should_pause_batch=(failure_type == "credit_exhaustion"),
    )
```

### New UpscaleJobService Methods

```python
# Source: Extends backend/services/upscale_job_service.py

async def pause_all_pending_videos(self, batch_id: str) -> bool:
    """Set all pending videos in a batch to 'paused' status."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.supabase.table("upscale_videos")
            .update({"status": "paused"})
            .eq("batch_id", batch_id)
            .eq("status", "pending")
            .execute()
        )
        return True
    except Exception:
        return False

async def pause_batch(self, batch_id: str, pause_reason: str) -> bool:
    """Set batch to 'paused' with reason and timestamp."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            self.supabase.table("upscale_batches")
            .update({
                "status": "paused",
                "paused_at": now,
                "pause_reason": pause_reason,
            })
            .eq("id", batch_id)
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False

async def unpause_videos(self, batch_id: str) -> bool:
    """Set all paused videos in a batch back to 'pending' status."""
    try:
        result = (
            self.supabase.table("upscale_videos")
            .update({"status": "pending"})
            .eq("batch_id", batch_id)
            .eq("status", "paused")
            .execute()
        )
        return True
    except Exception:
        return False

async def clear_pause_metadata(self, batch_id: str) -> bool:
    """Clear paused_at and pause_reason on a batch."""
    try:
        result = (
            self.supabase.table("upscale_batches")
            .update({
                "paused_at": None,
                "pause_reason": None,
            })
            .eq("id", batch_id)
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False

async def reorder_videos(self, batch_id: str, video_ids: list) -> bool:
    """
    Reorder pending videos by updating queue_position based on array order.
    Only updates videos that are in 'pending' status.
    """
    try:
        for position, video_id in enumerate(video_ids):
            self.supabase.table("upscale_videos") \
                .update({"queue_position": position}) \
                .eq("id", video_id) \
                .eq("batch_id", batch_id) \
                .eq("status", "pending") \
                .execute()
        return True
    except Exception:
        return False

async def retry_video(self, video_id: str) -> bool:
    """Reset a failed video to pending status for retry."""
    try:
        result = (
            self.supabase.table("upscale_videos")
            .update({
                "status": "pending",
                "error_message": None,
                "freepik_task_id": None,
                "completed_at": None,
            })
            .eq("id", video_id)
            .eq("status", "failed")
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False

async def update_video_retry_count(self, video_id: str, retry_count: int) -> bool:
    """Update the retry_count on a video."""
    try:
        result = (
            self.supabase.table("upscale_videos")
            .update({"retry_count": retry_count})
            .eq("id", video_id)
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False
```

### New API Endpoints

```python
# Source: Extends backend/api/upscale.py

@router.post("/batches/{batch_id}/resume", response_model=BatchResponse)
async def resume_batch(batch_id: str, user=Depends(get_current_user)):
    """Resume a paused batch. Sets paused videos to pending and starts processing."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.get("status") != "paused":
        raise HTTPException(400, f"Batch is '{batch.get('status')}', must be 'paused' to resume")

    await service.unpause_videos(batch_id)
    await service.clear_pause_metadata(batch_id)
    await service.update_batch_status(batch_id, "processing")
    asyncio.create_task(_process_batch(batch_id))
    return BatchResponse(success=True, batch_id=batch_id, status="processing")

@router.post("/batches/{batch_id}/videos/{video_id}/retry")
async def retry_video(batch_id: str, video_id: str, user=Depends(get_current_user)):
    """Retry a single failed video (resets to pending)."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    success = await service.retry_video(video_id)
    if not success:
        raise HTTPException(400, "Video not found or not in 'failed' status")

    # Decrement failed count since video is going back to pending
    await service._increment_batch_field(batch_id, "failed_videos")  # Need a decrement method
    return {"success": True, "video_id": video_id, "status": "pending"}

@router.patch("/batches/{batch_id}/reorder")
async def reorder_queue(batch_id: str, payload: ReorderPayload, user=Depends(get_current_user)):
    """Reorder pending videos in the queue."""
    service = UpscaleJobService()
    batch = await service.get_batch(batch_id, user.id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    success = await service.reorder_videos(batch_id, payload.video_ids)
    if not success:
        raise HTTPException(500, "Failed to reorder videos")
    return {"success": True}
```

### New Pydantic Model for Reorder

```python
# Source: Add to backend/models/upscale.py

class ReorderPayload(BaseModel):
    """Payload for reordering pending videos in a batch."""
    video_ids: List[str] = Field(..., description="Ordered list of video IDs (new queue order)")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All failures treated identically | Classify into transient/credit/permanent | Phase 11 | Enables retry and pause decisions |
| `_process_single_video` returns bool | Returns `ProcessingResult` dataclass | Phase 11 | Caller can make informed decisions |
| No retry on failure | 2 retries with exponential backoff for transient errors | Phase 11 | Handles network blips without user intervention |
| Batch fails on any error | Batch pauses on credit exhaustion, continues on transient | Phase 11 | Preserves pending videos instead of failing them all |

**Deprecated/outdated:**
- Nothing deprecated in this phase. All Phase 10 patterns are extended, not replaced.

## Open Questions

1. **Exact Freepik credit exhaustion HTTP status code**
   - What we know: Standard practice is HTTP 402 (Payment Required) or 429 with "quota exceeded" body. Freepik docs list 200, 400, 401, 500, 503 for the image upscaler endpoint. 402 is not documented but is standard for payment-required APIs.
   - What's unclear: Whether Freepik returns 402, 429-with-body, or something else when credits are exhausted.
   - Recommendation: Build the classifier to handle 402 AND 429-with-quota-keywords. The classifier is a single function (`_classify_error`) that can be updated once the actual error is observed in production. Default unknown errors to "permanent" (safe -- won't cause infinite retries).

2. **Should retry_video endpoint restart batch processing?**
   - What we know: If a batch is "completed" (some videos succeeded, some failed), and the user retries a failed video, the video is set to pending but nothing processes it.
   - What's unclear: Should the retry endpoint also launch `_process_batch` if the batch status is "completed" or "failed"?
   - Recommendation: Yes, the retry endpoint should set batch status back to "processing" and launch `_process_batch` if the batch is in a terminal state (completed/failed). This way the retried video gets picked up by `get_next_pending_video`.

3. **Decrement failed_videos count on retry**
   - What we know: `_increment_batch_field` exists but no decrement counterpart. When a failed video is retried, `failed_videos` count should decrease by 1.
   - What's unclear: Whether to add a generic `_decrement_batch_field` or a specific `decrement_failed_count` method.
   - Recommendation: Add `decrement_failed_count(batch_id)` using the same read-then-write pattern as `_increment_batch_field` but subtracting 1 (with floor at 0).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.0+ with pytest-asyncio (auto mode) |
| Config file | `backend/pytest.ini` (exists) |
| Quick run command | `cd backend && source venv/bin/activate && pytest tests/test_batch_processing.py tests/test_upscale_api.py tests/test_upscale_job_service.py -x -v` |
| Full suite command | `cd backend && source venv/bin/activate && pytest --cov=services --cov=api --cov-report=term-missing` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEU-03 | Reorder pending videos via PATCH endpoint | unit + API | `pytest tests/test_upscale_api.py::TestReorderQueue -x` | Wave 0 |
| ERRR-01 | Retry failed video via POST endpoint | unit + API | `pytest tests/test_upscale_api.py::TestRetryVideo -x` | Wave 0 |
| ERRR-02 | Transient errors auto-retry with backoff (2 retries) | unit | `pytest tests/test_batch_processing.py::TestRetryLogic -x` | Wave 0 |
| ERRR-03 | Credit exhaustion pauses batch and pending videos | unit | `pytest tests/test_batch_processing.py::TestCreditExhaustion -x` | Wave 0 |
| ERRR-04 | Pause reason recorded in database (API returns it) | unit | `pytest tests/test_upscale_job_service.py::TestPauseBatch -x` | Wave 0 |
| ERRR-05 | Resume paused batch continues from pending videos | unit + API | `pytest tests/test_upscale_api.py::TestResumeBatch -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && source venv/bin/activate && pytest tests/test_batch_processing.py tests/test_upscale_api.py tests/test_upscale_job_service.py -x -v`
- **Per wave merge:** `cd backend && source venv/bin/activate && pytest --cov=services --cov=api --cov-report=term-missing`
- **Phase gate:** Full suite green (all 84 existing + new tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_batch_processing.py::TestRetryLogic` -- transient retry with backoff, max retries exhausted, retry count incremented
- [ ] `tests/test_batch_processing.py::TestCreditExhaustion` -- credit exhaustion pauses batch, pauses pending videos, records pause_reason
- [ ] `tests/test_batch_processing.py::TestErrorClassification` -- _classify_error for 402, 429+quota, 5xx, timeout, 400, unknown
- [ ] `tests/test_upscale_job_service.py::TestPauseBatch` -- pause_batch, pause_all_pending_videos, clear_pause_metadata
- [ ] `tests/test_upscale_job_service.py::TestUnpauseVideos` -- unpause_videos sets paused videos back to pending
- [ ] `tests/test_upscale_job_service.py::TestReorderVideos` -- reorder_videos updates queue_position on pending videos
- [ ] `tests/test_upscale_job_service.py::TestRetryVideo` -- retry_video resets failed video to pending
- [ ] `tests/test_upscale_job_service.py::TestUpdateVideoRetryCount` -- update_video_retry_count
- [ ] `tests/test_upscale_api.py::TestResumeBatch` -- resume endpoint validates paused status, launches processing
- [ ] `tests/test_upscale_api.py::TestRetryVideo` -- retry endpoint validates ownership, resets video
- [ ] `tests/test_upscale_api.py::TestReorderQueue` -- reorder endpoint validates ownership, updates positions

*(Existing test infrastructure (conftest fixtures, mock patterns) covers all Phase 11 needs)*

## Sources

### Primary (HIGH confidence)
- Codebase: `backend/api/upscale.py` -- Existing `_process_single_video`, `_process_batch`, `_get_batch_for_processing` functions
- Codebase: `backend/services/upscale_job_service.py` -- Existing CRUD methods, Supabase query patterns
- Codebase: `backend/services/freepik_service.py` -- Error classification via `httpx.HTTPStatusError`, `httpx.TimeoutException`, `httpx.RequestError`
- Codebase: `backend/models/upscale.py` -- Existing Pydantic models, `BatchStatus`, `VideoStatus` Literal types
- Codebase: `backend/migrations/007_add_upscale_batches.sql` -- Columns already exist: `retry_count`, `pause_reason`, `paused_at`, `last_heartbeat`
- Codebase: `backend/tests/` -- Existing test patterns: `@patch("api.upscale.UpscaleJobService")`, `AsyncMock`, `_close_coro` for create_task

### Secondary (MEDIUM confidence)
- [Freepik Image Upscaler POST API](https://docs.freepik.com/api-reference/image-upscaler-creative/post-image-upscaler) -- HTTP 200, 400, 401, 500, 503 documented
- [Freepik Rate Limits](https://docs.freepik.com/ratelimits) -- 10 hits/s sustained, 50 hits/s burst
- [Freepik Pricing](https://docs.freepik.com/pricing) -- Credit-based model with monthly cap
- [Python HTTPX Retry Patterns](https://scrapeops.io/python-web-scraping-playbook/python-httpx-retry-failed-requests/) -- Manual retry loop patterns

### Tertiary (LOW confidence)
- Freepik credit exhaustion error format -- NOT publicly documented; assumed HTTP 402 or 429 with quota message based on industry standards. Classifier designed to handle both.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies, all patterns extend Phase 10 code
- Architecture: HIGH -- `_process_single_video` and `_process_batch` already exist; this phase adds classification and retry logic
- Error classification: MEDIUM -- Freepik's credit exhaustion error format is not publicly documented; classifier handles 402 AND 429-with-quota-keywords
- Pitfalls: HIGH -- 5 phase-specific pitfalls identified from code analysis and batch processing experience
- Database: HIGH -- All columns already exist from Phase 10's forward-looking migration

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain; Freepik error format is the only uncertainty, and classifier is designed to be extensible)
