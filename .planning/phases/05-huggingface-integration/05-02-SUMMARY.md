---
phase: 05-huggingface-integration
plan: 02
subsystem: infra
tags: [fastapi, background-tasks, admin-api, huggingface, rest-endpoints]

# Dependency graph
requires:
  - phase: 05-huggingface-integration
    plan: 01
    provides: hf_download_service.py with parse_hf_url, validate_hf_url, new_job, get_hf_job, start_hf_download_job

provides:
  - POST /api/infrastructure/hf-download endpoint (admin-only, async job creation)
  - GET /api/infrastructure/hf-download/{job_id} endpoint (admin-only, dict lookup poll)

affects:
  - 05-huggingface-integration (plan 03, which builds the frontend UI for these endpoints)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - FastAPI BackgroundTasks for fire-and-return async job dispatch
    - Per-endpoint Depends(verify_admin) matches existing infrastructure.py pattern
    - URL validation before job creation returns 400 on bad URL/gated model

key-files:
  created: []
  modified:
    - backend/api/infrastructure.py

key-decisions:
  - "BackgroundTasks added to existing fastapi import line (not a separate import) to match project import style"
  - "hf_token resolved per-request (payload.hf_token > settings.HF_TOKEN > None) and passed to background task but never returned in any response field"
  - "404 message for expired/missing jobs explicitly mentions server restart to set admin expectations about in-memory store lifetime"

# Metrics
duration: 92s
completed: 2026-03-04
---

# Phase 5 Plan 02: HuggingFace Download API Endpoints Summary

**Two admin-only REST endpoints exposing the HF download service: POST /hf-download starts async job and returns job_id immediately; GET /hf-download/{job_id} polls status via dict lookup**

## Performance

- **Duration:** 92s
- **Started:** 2026-03-04T23:21:44Z
- **Completed:** 2026-03-04T23:23:16Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `BackgroundTasks` to the existing `from fastapi import` line in `infrastructure.py`
- Imported `parse_hf_url`, `validate_hf_url`, `new_job`, `get_hf_job`, `start_hf_download_job` from `hf_download_service`
- Imported `HFDownloadRequest`, `HFDownloadJobStatus` from `models.infrastructure`
- Implemented `POST /api/infrastructure/hf-download`: validate URL (400 on error), create in-memory job, fire background task, return `{success, job_id, filename, s3_key}` immediately
- Implemented `GET /api/infrastructure/hf-download/{job_id}`: dict lookup, 404 with clear message if job not found
- Both endpoints protected by `Depends(verify_admin)` matching existing per-endpoint pattern
- Smoke test confirmed: invalid URL → 401 (auth fails before URL parse), missing job → 401 (auth fails first). No 500 errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add HF download endpoints to infrastructure.py** - `6aaa6a0` (feat)
2. **Task 2: Smoke-test the API layer** - verification only, no file changes

## Files Created/Modified

- `backend/api/infrastructure.py` - Added `BackgroundTasks` import, 5 service function imports, 2 model imports, and two new endpoint functions (79 lines net addition)

## Decisions Made

- `BackgroundTasks` added to existing `from fastapi import` line (not a new import block) to maintain import style consistency with rest of file
- `hf_token` is resolved from `payload.hf_token or settings.HF_TOKEN or None` — per-request token takes priority over the global setting, allowing admins to use temporary tokens for gated models without changing server config
- `hf_token` is never included in any response field, only passed to the background task where it goes directly to `hf_hub_download`
- 404 message for missing/expired jobs says "It may have expired (server restart clears in-memory jobs)" to give admins clear context

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] `backend/api/infrastructure.py` exists and modified
- [x] Routes `/api/infrastructure/hf-download` and `/api/infrastructure/hf-download/{job_id}` confirmed present
- [x] Commit `6aaa6a0` exists
- [x] Import succeeds without errors
- [x] Smoke test: POST bad URL → 401, GET missing job → 401 (no 500 errors)

---
*Phase: 05-huggingface-integration*
*Completed: 2026-03-04*
