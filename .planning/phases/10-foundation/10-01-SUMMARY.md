---
phase: 10-foundation
plan: 01
subsystem: database, api
tags: [pydantic, postgresql, freepik, migration, upscale]

# Dependency graph
requires:
  - phase: none
    provides: "First plan of v1.1; existing codebase provides patterns"
provides:
  - "upscale_batches and upscale_videos database tables with full schema for Phases 10-12"
  - "Pydantic models: UpscaleSettings, CreateBatchPayload, AddVideoPayload, BatchResponse, UpscaleVideo, UpscaleBatch, BatchDetailResponse"
  - "FREEPIK_API_KEY and related config fields in Settings"
  - "35 passing validation tests for all upscale models"
affects: [10-02, 10-03, 11-batch-processing, 12-output-delivery, 13-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Pydantic Literal types for status enums", "Idempotent DDL with IF NOT EXISTS for table creation", "Forward-looking schema with NULL-defaulted columns for future phases"]

key-files:
  created:
    - backend/models/upscale.py
    - backend/migrations/007_add_upscale_batches.sql
    - backend/tests/test_upscale_models.py
  modified:
    - backend/config/settings.py

key-decisions:
  - "Used individual columns for upscale settings (not JSONB) for DB-level defaults and queryability"
  - "Included all Phase 10-12 columns in initial migration to avoid future ALTER TABLE migrations"
  - "Used Literal types instead of Enum for BatchStatus/VideoStatus for simpler serialization"

patterns-established:
  - "Upscale settings model with validated ranges (ge/le) and Literal constraints"
  - "Forward-looking migration: include columns for future phases with NULL defaults"

requirements-completed: [INFR-01, INFR-02, SETT-01, SETT-02]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 10 Plan 01: Database Schema, Pydantic Models, and Settings Summary

**Upscale data foundation with 2-table schema, 9 Pydantic models, Freepik config, and 35 validation tests using TDD**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T16:01:51Z
- **Completed:** 2026-03-11T17:05:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created upscale_batches and upscale_videos tables with full schema covering Phases 10-12 including heartbeat, pause/resume, and dual-destination upload tracking columns
- Built 9 Pydantic models (UpscaleSettings, BatchStatus, VideoStatus, CreateBatchPayload, AddVideoPayload, BatchResponse, UpscaleVideo, UpscaleBatch, BatchDetailResponse) with validated ranges and defaults matching SETT-02
- Added FREEPIK_API_KEY, FREEPIK_API_BASE_URL, FREEPIK_POLL_INTERVAL, and FREEPIK_TASK_TIMEOUT to Settings
- 35 tests pass covering defaults, valid ranges, invalid values, required fields, and model instantiation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database migration and Pydantic models** (TDD)
   - `ac360f6` (test) - Failing tests for upscale Pydantic models
   - `1e1d07c` (feat) - Upscale Pydantic models and database migration
2. **Task 2: Add Freepik configuration to Settings** - `d50203a` (feat)

## Files Created/Modified
- `backend/models/upscale.py` - 9 Pydantic models for batch video upscaling with validated settings and status types
- `backend/migrations/007_add_upscale_batches.sql` - Idempotent migration creating upscale_batches and upscale_videos tables with 6 indexes
- `backend/tests/test_upscale_models.py` - 35 tests covering defaults, validation, constraints, and model instantiation
- `backend/config/settings.py` - Added 4 Freepik configuration fields after HF_TOKEN section

## Decisions Made
- Used individual columns for upscale settings (resolution, creativity, sharpen, grain, fps_boost, flavor) instead of a JSONB column for DB-level defaults and queryability
- Included all columns for Phases 10-12 in the initial migration (last_heartbeat, pause_reason, paused_at, supabase_upload_status, drive_upload_status, retry_count, output_drive_file_id) -- they default to NULL and cost nothing
- Used Pydantic Literal types for BatchStatus and VideoStatus instead of Python Enum for simpler JSON serialization

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Database schema ready for FreepikUpscalerService and UpscaleJobService (Plan 10-02)
- Pydantic models ready for API router type contracts (Plan 10-03)
- Settings ready for Freepik API client initialization (Plan 10-02)
- All models and types importable from `models.upscale`

## Self-Check: PASSED

All 4 files verified present. All 3 commits verified in git log.

---
*Phase: 10-foundation*
*Completed: 2026-03-11*
