---
phase: 05-huggingface-integration
plan: 01
subsystem: infra
tags: [huggingface_hub, boto3, s3, asyncio, tqdm, background-jobs, pydantic]

# Dependency graph
requires:
  - phase: 04-file-operations
    provides: S3 multipart upload pattern and s3_client singleton used for upload pipeline

provides:
  - HuggingFace download service with in-memory job store
  - parse_hf_url for URL validation and repo/file extraction
  - start_hf_download_job async orchestrator for background HF-to-S3 pipeline
  - HFDownloadRequest and HFDownloadJobStatus Pydantic models
  - HF_TOKEN setting in backend config

affects:
  - 05-huggingface-integration (plans 02+, which add API endpoints consuming this service)

# Tech tracking
tech-stack:
  added:
    - huggingface_hub>=0.21.0 (HF file download, dry_run metadata check)
    - tqdm (progress tracking tqdm subclass for download bytes reporting)
  patterns:
    - asyncio.to_thread wraps blocking hf_hub_download to avoid event loop blocking
    - In-memory job store dict with uuid4 keys for single-admin process-lifetime state
    - 5MB S3 multipart upload with abort on failure (matches Phase 4 established pattern)
    - hf_token passed only to hf_hub_download, never stored in job state

key-files:
  created:
    - backend/services/hf_download_service.py
  modified:
    - backend/requirements.txt
    - backend/config/settings.py
    - backend/models/infrastructure.py

key-decisions:
  - "Regex lookahead used in parse_hf_url to correctly handle both 1-segment (bert-base-uncased) and 2-segment (stabilityai/stable-diffusion-xl-base-1.0) HuggingFace repo IDs"
  - "hf_token never stored in _HF_JOBS dict — passed directly to hf_hub_download only for security"
  - "tmp_dir always cleaned in finally block to prevent disk leaks on any failure path"
  - "local_dir=str(tmp_dir) in hf_hub_download skips HF default cache (~/.cache/huggingface/hub)"

patterns-established:
  - "HF error mapping: GatedRepoError, RepositoryNotFoundError, EntryNotFoundError all caught and converted to human-readable ValueError messages"
  - "Background job state: pending->downloading->uploading->done/error lifecycle with progress_pct 0-100 per phase"
  - "asyncio.to_thread pattern for blocking I/O operations in FastAPI async context"

requirements-completed: [HF-02, HF-03, HF-04, HF-05, HF-07]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 5 Plan 01: HuggingFace Download Service Summary

**HuggingFace-to-S3 download pipeline with in-memory job tracking: URL parsing, dry_run validation, asyncio.to_thread background download, and 5MB multipart S3 upload with abort-on-failure**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T23:15:21Z
- **Completed:** 2026-03-04T23:18:54Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Created `hf_download_service.py` with full 8-function download pipeline
- Added `huggingface_hub>=0.21.0` to requirements and `HF_TOKEN` to settings
- Added `HFDownloadRequest` and `HFDownloadJobStatus` Pydantic models to infrastructure models

## Task Commits

Each task was committed atomically:

1. **Task 1: Add huggingface_hub dependency and HF_TOKEN setting** - `ce26370` (chore)
2. **Task 2: Add HFDownloadRequest and HFDownloadJobStatus Pydantic models** - `f340382` (feat)
3. **Task 3: Create hf_download_service.py with full download pipeline** - `2d58d6c` (feat)

## Files Created/Modified

- `backend/services/hf_download_service.py` - Full HF download pipeline with in-memory job store, URL parser, multipart S3 upload, progress tracking tqdm subclass, and asyncio.to_thread background worker
- `backend/requirements.txt` - Added `huggingface_hub>=0.21.0`
- `backend/config/settings.py` - Added `HF_TOKEN: str = ""` after RUNPOD_S3_REGION
- `backend/models/infrastructure.py` - Added `HFDownloadRequest` and `HFDownloadJobStatus` models

## Decisions Made

- Used regex lookahead `(?=/(?:blob|resolve)/|$)` in `parse_hf_url` to correctly stop repo_id before the `/blob/` or `/resolve/` URL segment — handles both 1-segment and 2-segment HuggingFace repo IDs
- `hf_token` is passed directly to `hf_hub_download` and never stored in `_HF_JOBS` to avoid persisting credentials in memory longer than needed
- `local_dir=str(tmp_dir)` forces download to temporary directory, bypassing HF's global cache at `~/.cache/huggingface/hub`
- `tmpdir` always cleaned in `finally` block regardless of success or failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed regex pattern for single-segment HuggingFace repo IDs**
- **Found during:** Task 3 (Create hf_download_service.py)
- **Issue:** Original pattern `[^/]+/[^/]+` for `repo_id` greedily captured `bert-base-uncased/blob` as the repo_id instead of `bert-base-uncased`, because the pattern required exactly two `/`-separated segments without understanding `blob`/`resolve` as delimiters
- **Fix:** Changed to `(?:[^/]+/)?[^/]+(?=/(?:blob|resolve)/|$)` — lookahead stops at `/blob/` or `/resolve/` segment boundary, correctly matching 1-segment repos (`bert-base-uncased`) and 2-segment repos (`stabilityai/stable-diffusion-xl-base-1.0`)
- **Files modified:** `backend/services/hf_download_service.py`
- **Verification:** `parse_hf_url('https://huggingface.co/bert-base-uncased/blob/main/config.json')` returns `('bert-base-uncased', 'config.json')` correctly
- **Committed in:** `2d58d6c` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix essential for correctness — plan's own verification test case would have failed without it. No scope creep.

## Issues Encountered

- `tqdm` is a transitive dependency of `huggingface_hub` but was not installed in the venv until `pip install huggingface_hub` ran during verification. This resolved automatically when installing `huggingface_hub>=0.21.0`. No action needed in requirements.txt since `tqdm` is pulled in by `huggingface_hub`.

## User Setup Required

None - no external service configuration required. `HF_TOKEN` defaults to empty string and is optional.

## Next Phase Readiness

- `hf_download_service.py` is complete and tested — ready for Plan 05-02 which will add API endpoints (`POST /api/infrastructure/hf-download`, `GET /api/infrastructure/hf-download/{job_id}`) that call `parse_hf_url`, `validate_hf_url`, `new_job`, and `start_hf_download_job`
- `HFDownloadRequest` and `HFDownloadJobStatus` models are ready to be used in API request/response types
- No blockers

---
*Phase: 05-huggingface-integration*
*Completed: 2026-03-04*
