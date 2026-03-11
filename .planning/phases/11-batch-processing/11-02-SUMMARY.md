---
phase: 11-batch-processing
plan: 02
subsystem: batch-upscale-api
tags: [tdd, retry-logic, error-handling, batch-processing, api-endpoints]

dependency_graph:
  requires:
    - phase: 11-01
      provides: ProcessingResult, _classify_error, ReorderPayload, batch-processing-service-methods
    - phase: 10-03
      provides: _process_batch, _process_single_video, _get_batch_for_processing
  provides:
    - Enhanced _process_single_video returning ProcessingResult with error classification
    - _process_video_with_retry with exponential backoff for transient errors
    - Credit exhaustion pause in _process_batch
    - Batch status re-check loop (prevents duplicate task races)
    - POST /batches/{id}/resume endpoint
    - POST /batches/{id}/videos/{vid}/retry endpoint
    - PATCH /batches/{id}/reorder endpoint
  affects: [12-storage-delivery]

tech_stack:
  added: []
  patterns: [retry-with-backoff, credit-exhaustion-pause, batch-status-recheck, terminal-state-relaunch]

key_files:
  created: []
  modified:
    - backend/api/upscale.py
    - backend/tests/test_batch_processing.py
    - backend/tests/test_upscale_api.py

key-decisions:
  - "_process_single_video returns ProcessingResult directly (no wrapper conversion), integrating _classify_error at point of failure"
  - "Exponential backoff uses BASE_DELAY * 2^attempt (2s, 4s) for simplicity and predictability"
  - "Batch status re-check uses _get_batch_for_processing (same helper) after each video to detect external pause/cancel"
  - "Retry endpoint relaunches _process_batch for terminal batches (completed/failed) so there is always a background task running"

patterns-established:
  - "ProcessingResult as return type for all video processing functions"
  - "Retry wrapper pattern: attempt loop with early return on non-retryable failures"
  - "Credit exhaustion: pause_all_pending_videos + pause_batch + break pattern"
  - "Terminal batch relaunch: check status in (completed, failed) then update + create_task"

requirements-completed: [ERRR-01, ERRR-02, ERRR-03, ERRR-04, ERRR-05, QUEU-03]

metrics:
  duration: 4 min
  tasks_completed: 2
  tests_added: 26
  tests_total: 145
  completed: "2026-03-11T18:44:30Z"
---

# Phase 11 Plan 02: Batch Processing Loop and API Endpoints Summary

**Retry-with-backoff processing loop, credit exhaustion batch pause, and 3 new API endpoints (resume, retry, reorder) completing Phase 11 batch processing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T18:40:21Z
- **Completed:** 2026-03-11T18:44:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `_process_single_video` now returns `ProcessingResult` with error classification via `_classify_error`, enabling the processing loop to make intelligent decisions per failure type
- `_process_video_with_retry` retries transient errors up to 2 times with 2s/4s exponential backoff, records retry_count per attempt
- `_process_batch` pauses batch and all pending videos on credit exhaustion, and re-checks batch status each iteration to prevent duplicate task races
- Three new API endpoints: resume (paused->processing), retry (failed video->pending with relaunch), reorder (update queue positions)
- Full test suite: 145 tests across 6 test files, zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Enhance _process_single_video and add _process_video_with_retry**
   - `3e3e2b6` (test) - Failing tests for retry logic, error classification, credit pause
   - `75d397b` (feat) - ProcessingResult return type, retry-with-backoff, credit pause in batch loop

2. **Task 2: Add resume, retry, and reorder API endpoints**
   - `374bda5` (test) - Failing tests for resume, retry, reorder API endpoints
   - `6211612` (feat) - Resume, retry, reorder API endpoints for batch operations

## Files Created/Modified
- `backend/api/upscale.py` - Enhanced processing loop with retry/credit pause + 3 new API endpoints
- `backend/tests/test_batch_processing.py` - 19 tests: error classification, retry logic, credit exhaustion, batch status check
- `backend/tests/test_upscale_api.py` - 27 tests: existing CRUD + resume, retry, reorder endpoints

## Decisions Made
1. **ProcessingResult at point of failure**: `_process_single_video` calls `_classify_error` directly at each failure point rather than using a wrapper, keeping the classification close to where the error occurs.
2. **Simple exponential backoff**: `BASE_DELAY * 2^attempt` (2s, 4s) is predictable and testable. No jitter added -- the use case is a single sequential processor, not concurrent clients.
3. **Batch status re-check after each video**: Uses `_get_batch_for_processing` to re-fetch batch status after each video completes. If status is no longer "processing" (e.g., externally paused), the loop exits gracefully.
4. **Terminal batch relaunch on retry**: When retrying a failed video in a completed/failed batch, the endpoint sets batch to "processing" and creates a new `_process_batch` background task so processing resumes automatically.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 11 (Batch Processing) is now fully complete
- All batch processing, error handling, retry, and queue management features implemented
- Ready for Phase 12 (Storage & Delivery) which will handle output upload to Supabase Storage and Google Drive

## Self-Check: PASSED

- All 3 modified files exist on disk
- All 4 commits verified in git log
- 145/145 tests pass across full Phase 10+11 suite

---
*Phase: 11-batch-processing*
*Completed: 2026-03-11*
