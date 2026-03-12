---
phase: 12-output-delivery
plan: 02
subsystem: api
tags: [zip-download, background-jobs, httpx, streaming-response, in-memory-store]

# Dependency graph
requires:
  - phase: 12-output-delivery
    provides: "output_storage_url populated on completed videos via Supabase delivery pipeline"
  - phase: 10-foundation
    provides: "UpscaleJobService, UpscaleBatch/UpscaleVideo models, upscale router"
provides:
  - "POST /upscale/batches/{batch_id}/download-zip for background ZIP job creation"
  - "GET /upscale/zip-jobs/{job_id}/status for polling ZIP build progress"
  - "GET /upscale/zip-jobs/{job_id}/download for streaming ZIP download with auto-cleanup"
  - "_ZIP_JOBS in-memory store with 10-minute TTL cleanup"
  - "_build_zip background task for downloading and packaging videos"
  - "ZipJobResponse and ZipJobStatusResponse Pydantic models"
affects: [13-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Background ZIP job with in-memory store and TTL cleanup (mirrors _HF_JOBS pattern)"
    - "StreamingResponse for large file downloads with Content-Disposition header"
    - "asyncio.create_task for non-blocking background ZIP generation"

key-files:
  created: []
  modified:
    - "backend/api/upscale.py"
    - "backend/models/upscale.py"
    - "backend/tests/test_upscale_api.py"

key-decisions:
  - "In-memory _ZIP_JOBS store (not DB-backed) consistent with HF download pattern and single-admin use case"
  - "10-minute TTL for ZIP job cleanup balances memory usage with download window"
  - "ZIP_STORED compression (no deflate) for speed since video files are already compressed"
  - "Cleanup on download: job removed from store after successful streaming to prevent memory leak"

patterns-established:
  - "Background job with in-memory store pattern reused from HF downloads for ZIP generation"
  - "create_zip_download -> _build_zip -> download_zip three-phase async flow for Heroku 30s timeout"

requirements-completed: [DLVR-04]

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 12 Plan 02: Batch ZIP Download Summary

**Background ZIP job with 3 API endpoints (create/poll/download), in-memory store with TTL cleanup, and 16 new tests using TDD**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T01:04:07Z
- **Completed:** 2026-03-12T01:07:32Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- Three new ZIP download endpoints: POST create job, GET poll status, GET streaming download
- Background _build_zip function downloads completed videos via httpx and packages into ZIP with {stem}_upscaled.mp4 filenames
- In-memory _ZIP_JOBS store with 10-minute TTL cleanup, matching established _HF_JOBS pattern
- 16 new tests covering creation, validation, status polling, download, cleanup, TTL, auth, filename format, error handling
- All 143 upscale tests pass with zero regressions

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for ZIP download** - `6d54b7e` (test)
2. **Task 1 GREEN: Implement ZIP download endpoints** - `49bf8c5` (feat)

## Files Created/Modified
- `backend/api/upscale.py` - Added _ZIP_JOBS store, _cleanup_expired_zip_jobs, _build_zip background task, 3 new endpoints (create_zip_download, get_zip_job_status, download_zip)
- `backend/models/upscale.py` - Added ZipJobResponse and ZipJobStatusResponse Pydantic models
- `backend/tests/test_upscale_api.py` - Added TestZipDownload class with 16 tests

## Decisions Made
- In-memory _ZIP_JOBS store (not DB-backed) consistent with HF download pattern -- acceptable for single-admin use case
- 10-minute TTL for ZIP job cleanup -- balances memory usage with reasonable download window
- ZIP_STORED compression (no deflate) -- video files are already compressed, avoiding CPU waste
- Job removed from store immediately after successful download -- prevents memory accumulation
- httpx.AsyncClient with 120s timeout and follow_redirects for Supabase public URL downloads

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tests passed on first implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 12 (Output Delivery) fully complete -- all 4 DLVR requirements satisfied
- Backend API complete for frontend integration in Phase 13
- Frontend can use: batch detail for individual video URLs, ZIP endpoints for batch download
- All endpoints require JWT auth, consistent with existing patterns

## Self-Check: PASSED

- All 3 modified files exist on disk
- Commit 6d54b7e (Task 1 RED) exists in git log
- Commit 49bf8c5 (Task 1 GREEN) exists in git log
- 143/143 tests pass

---
*Phase: 12-output-delivery*
*Completed: 2026-03-12*
