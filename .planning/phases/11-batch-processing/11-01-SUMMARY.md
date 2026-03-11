---
phase: 11-batch-processing
plan: 01
subsystem: batch-upscale-service
tags: [tdd, service-layer, error-classification, batch-processing]

dependency_graph:
  requires: [10-01, 10-02, 10-03]
  provides: [ProcessingResult, _classify_error, ReorderPayload, batch-processing-service-methods]
  affects: [11-02]

tech_stack:
  added: []
  patterns: [dataclass-for-processing-result, regex-error-classification, read-then-write-decrement]

key_files:
  created: []
  modified:
    - backend/models/upscale.py
    - backend/services/upscale_job_service.py
    - backend/tests/test_upscale_models.py
    - backend/tests/test_upscale_job_service.py

decisions:
  - Used Python dataclass (not Pydantic) for ProcessingResult since it is an internal processing type, not a request/response model
  - Used compiled regex for credit keyword matching in _classify_error for performance
  - pause_all_pending_videos and unpause_videos return True on success even with zero matched rows (bulk operation semantics)

metrics:
  duration: 4 min
  tasks_completed: 2
  tests_added: 35
  tests_total: 83
  completed: "2026-03-11T18:37:00Z"
---

# Phase 11 Plan 01: Service Layer and Type Contracts Summary

TDD-built error classification types and 8 new UpscaleJobService methods for batch pause/resume/reorder/retry operations.

## Tasks Completed

| Task | Name | Commit | Tests |
|------|------|--------|-------|
| 1 | ProcessingResult, _classify_error, ReorderPayload | d2ae2d2 (RED), 53c12c8 (GREEN) | 19 new |
| 2 | 8 new UpscaleJobService methods | 19a9fea (RED), 61aefa7 (GREEN) | 16 new |

## What Was Built

### Task 1: Error Classification and Models

Added to `backend/models/upscale.py`:
- **FailureType** Literal: `"transient"`, `"credit_exhaustion"`, `"permanent"`
- **ProcessingResult** dataclass: `success`, `failure_type`, `error_message`, `should_pause_batch`
- **_classify_error(error_message)** function: Classifies errors by HTTP status codes and keywords
  - 402 -> credit_exhaustion
  - 429 + quota/limit/insufficient/credit/budget -> credit_exhaustion
  - 500/502/503/504 -> transient
  - timeout/connection -> transient
  - generic 429 -> transient (rate limit, retryable)
  - everything else -> permanent
- **ReorderPayload** Pydantic model: `video_ids: List[str]`

### Task 2: Batch Processing Service Methods

Added 8 async methods to `backend/services/upscale_job_service.py` under "Batch Processing Support" section:

1. **pause_all_pending_videos(batch_id)** - Set all pending videos to paused
2. **pause_batch(batch_id, pause_reason)** - Set batch status=paused with paused_at and pause_reason
3. **unpause_videos(batch_id)** - Set all paused videos back to pending
4. **clear_pause_metadata(batch_id)** - Clear paused_at and pause_reason on batch
5. **reorder_videos(batch_id, video_ids)** - Update queue_position for each video ID in order
6. **retry_video(video_id)** - Reset failed video to pending (only works on failed videos)
7. **update_video_retry_count(video_id, retry_count)** - Set retry_count on a video
8. **decrement_failed_count(batch_id)** - Decrement failed_videos by 1, floor at 0

## Test Results

- **Model tests**: 54 total (35 existing + 19 new) -- all pass
- **Service tests**: 29 total (13 existing + 16 new) -- all pass
- **Combined**: 83 tests, zero regressions, zero failures

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Dataclass over Pydantic for ProcessingResult**: ProcessingResult is an internal processing type passed between functions, not a request/response model. Dataclass is lighter weight and more appropriate.
2. **Compiled regex for credit keywords**: Pre-compiled `_CREDIT_KEYWORDS` pattern for efficient repeated matching in `_classify_error`.
3. **Bulk operation return semantics**: `pause_all_pending_videos` and `unpause_videos` return `True` on successful execution even if zero rows matched (the operation succeeded; there were just no rows to update).

## Self-Check: PASSED

- All 4 modified files exist on disk
- All 4 commits verified in git log
- All new types importable from models.upscale
- 83/83 tests pass
