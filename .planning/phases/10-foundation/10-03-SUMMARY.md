---
phase: 10-foundation
plan: 03
subsystem: api, services
tags: [fastapi, asyncio, lifespan, background-task, upscale, freepik, tdd]

# Dependency graph
requires:
  - phase: 10-01
    provides: "Pydantic models (UpscaleSettings, CreateBatchPayload, AddVideoPayload, BatchResponse, BatchDetailResponse, UpscaleBatch)"
  - phase: 10-02
    provides: "FreepikUpscalerService (submit, poll), UpscaleJobService (CRUD, status transitions, recovery queries)"
provides:
  - "5 API endpoints at /api/upscale/* for batch CRUD and processing control"
  - "Background processing functions (_process_batch, _process_single_video) connecting Freepik API to DB status"
  - "Lifespan-based startup recovery that resumes interrupted batches on server restart"
  - "25 tests: 15 API endpoint, 5 batch processing, 5 startup recovery"
affects: [11-batch-processing, 12-output-delivery, 13-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: ["asynccontextmanager lifespan for startup recovery", "asyncio.create_task for non-blocking background processing", "FastAPI dependency_overrides for test auth mocking", "Coroutine close in mock create_task to prevent unawaited warnings"]

key-files:
  created:
    - backend/api/upscale.py
    - backend/tests/test_upscale_api.py
    - backend/tests/test_batch_processing.py
    - backend/tests/test_batch_recovery.py
  modified:
    - backend/main.py

key-decisions:
  - "Used _get_batch_for_processing helper (no user_id filter) for background tasks that lack user context"
  - "Lifespan recovery wrapped in try/except -- recovery errors are non-fatal so the app always starts"
  - "Mock asyncio.create_task closes coroutines in tests to prevent unawaited coroutine warnings"

patterns-established:
  - "API router with Depends(get_current_user) for all endpoints; TestClient uses dependency_overrides"
  - "Background batch processing: get_next_pending -> process_single_video -> heartbeat -> loop"
  - "Lifespan startup recovery: query for stuck batches, fail current video, resume via create_task"

requirements-completed: [QUEU-01, QUEU-02, INFR-04]

# Metrics
duration: 15min
completed: 2026-03-11
---

# Phase 10 Plan 03: API Router, Background Processing, and Startup Recovery Summary

**FastAPI upscale router with 5 endpoints, background Freepik processing via asyncio.create_task, and lifespan-based startup recovery for interrupted batches**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-11T17:35:22Z
- **Completed:** 2026-03-11T17:50:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built 5 API endpoints (create batch, add video, start processing, get detail, list batches) with full auth protection
- Implemented background batch processing that submits to Freepik, polls to completion, and updates DB status without blocking the request handler
- Added lifespan context manager that finds and resumes interrupted batches on server restart, marking stuck videos as failed first
- 25 new tests passing (84 total across all Phase 10 test files), all with TDD workflow

## Task Commits

Each task was committed atomically:

1. **Task 1: Create API router and background processing function** (TDD)
   - `9dfe099` (test) - Failing tests for upscale API endpoints and batch processing
   - `0f6fb7b` (feat) - Upscale API router with background batch processing
2. **Task 2: Add lifespan startup recovery and register router** (TDD)
   - `bb3cf82` (test) - Failing tests for startup recovery of interrupted batches
   - `13af3d2` (feat) - Lifespan startup recovery for interrupted upscale batches

## Files Created/Modified
- `backend/api/upscale.py` - API router with 5 endpoints and background processing functions (_process_batch, _process_single_video)
- `backend/main.py` - Added lifespan context manager, UpscaleJobService import, asyncio import, registered upscale router
- `backend/tests/test_upscale_api.py` - 15 tests for API endpoints with mocked auth and service dependencies
- `backend/tests/test_batch_processing.py` - 5 tests for _process_single_video and _process_batch background functions
- `backend/tests/test_batch_recovery.py` - 5 tests for lifespan startup recovery of interrupted batches

## Decisions Made
- Used a _get_batch_for_processing helper that queries by batch_id only (no user_id filter) because background tasks run without user context
- Wrapped lifespan recovery in try/except so a database error during recovery does not prevent the app from starting
- In tests, mock asyncio.create_task closes the coroutine it receives to prevent pytest unawaited coroutine warnings

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unawaited coroutine warning in test**
- **Found during:** Task 1 (API endpoint tests GREEN phase)
- **Issue:** Mock asyncio.create_task received a real coroutine but never scheduled or closed it, causing pytest PytestUnraisableExceptionWarning
- **Fix:** Made mock create_task close the coroutine via coro.close() side_effect
- **Files modified:** backend/tests/test_upscale_api.py
- **Verification:** All 20 Task 1 tests pass without warnings
- **Committed in:** 0f6fb7b (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix was necessary to prevent test failures from unraisable warnings. No scope creep.

## Issues Encountered
None beyond the unawaited coroutine warning documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 API endpoints ready for frontend integration (Phase 13)
- Background processing architecture supports multi-video sequential loop (Phase 11 will extend _process_batch)
- Startup recovery handles server restarts (Phase 11 may add more sophisticated retry logic)
- Full Phase 10 suite: 84 tests passing across 6 test files

## Self-Check: PASSED
