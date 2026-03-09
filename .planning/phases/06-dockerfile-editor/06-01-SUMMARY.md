---
phase: 06-dockerfile-editor
plan: 01
subsystem: api
tags: [github, httpx, pydantic, fastapi, dockerfile, admin]

# Dependency graph
requires:
  - phase: 05-huggingface
    provides: infrastructure router, verify_admin pattern, settings/models patterns
provides:
  - GitHubService with get_file() and update_file() async methods via httpx
  - DockerfileContent and DockerfileSaveRequest Pydantic models
  - GET /api/infrastructure/dockerfiles/content — admin-only GitHub file fetch
  - PUT /api/infrastructure/dockerfiles/content — admin-only GitHub file commit
  - GITHUB_TOKEN/REPO/BRANCH/DOCKERFILE_PATH settings fields
affects:
  - 06-02 (frontend Monaco editor needs these endpoints)

# Tech tracking
tech-stack:
  added: []  # httpx was already in requirements.txt
  patterns:
    - GitHubService per-call AsyncClient (no shared state)
    - base64 encode/decode for GitHub Contents API
    - 409 SHA conflict mapped to actionable error message
    - TDD: failing tests written before implementation

key-files:
  created:
    - backend/services/github_service.py
    - backend/tests/test_github_service.py
  modified:
    - backend/config/settings.py
    - backend/models/infrastructure.py
    - backend/api/infrastructure.py
    - backend/.env.example

key-decisions:
  - "Per-call httpx.AsyncClient in GitHubService — no shared state, clean per-request lifecycle"
  - "409 conflict returns specific actionable message (stale SHA) — most common failure mode per research"
  - "GitHub credentials check (400) before any GitHub API call — fast fail with clear error"
  - "Frontend never passes repo/path — taken from settings only (prevents path injection)"

patterns-established:
  - "GitHubService: httpx.AsyncClient as async context manager inside each method"
  - "response.raise_for_status() called before processing — HTTPStatusError propagates to API layer"
  - "Admin endpoint pattern: check credentials -> instantiate service -> try/except HTTPStatusError"

requirements-completed: [DOCKER-01, DOCKER-07]

# Metrics
duration: 3min
completed: 2026-03-05
---

# Phase 06 Plan 01: GitHub Service and Dockerfile API Endpoints Summary

**GitHub proxy backend with admin-only GET/PUT endpoints for reading and committing Dockerfiles via httpx AsyncClient and fine-grained PAT**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-05T02:06:17Z
- **Completed:** 2026-03-05T02:09:27Z
- **Tasks:** 2 (TDD task + implementation task)
- **Files modified:** 6

## Accomplishments
- Created GitHubService with async get_file() and update_file() using httpx, base64 encode/decode, and per-call AsyncClient lifecycle
- Added 4 GitHub settings fields to Settings class (GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_DOCKERFILE_PATH)
- Added DockerfileContent and DockerfileSaveRequest Pydantic models to models/infrastructure.py
- Implemented GET + PUT /api/infrastructure/dockerfiles/content admin-only endpoints with 400/409/500 error handling
- Wrote 27 TDD tests covering all behaviors (import, init, get_file, update_file, settings fields, models)

## Task Commits

Each task was committed atomically:

1. **Task 1: GitHub service, settings, and models** - `a420c66` (feat)
2. **Task 2: API endpoints — GET and PUT /dockerfiles/content** - `2069ff7` (feat)

_Note: Task 1 used TDD pattern — tests written first (RED), then implementation (GREEN), committed together_

## Files Created/Modified
- `backend/services/github_service.py` - GitHubService class with get_file() and update_file() async methods
- `backend/tests/test_github_service.py` - 27 TDD tests covering GitHubService, settings fields, and models
- `backend/config/settings.py` - Added GITHUB_TOKEN/REPO/BRANCH/DOCKERFILE_PATH settings fields
- `backend/models/infrastructure.py` - Added DockerfileContent and DockerfileSaveRequest Pydantic models
- `backend/api/infrastructure.py` - Added GET + PUT /dockerfiles/content endpoints, httpx and GitHubService imports
- `backend/.env.example` - Added GitHub integration section with documentation

## Decisions Made
- Per-call httpx.AsyncClient inside each GitHubService method: no shared state, clean per-request lifecycle, safe for concurrent requests
- 409 conflict returns specific message "SHA conflict: the file was modified since you opened it. Reload and re-apply your changes." — most actionable error for the stale-SHA case
- Credentials check (400) before any API call: fast fail with clear error, not a mysterious 401 from GitHub
- GitHub path/repo never accepted from frontend: all config from settings only — prevents path injection attacks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing test failures in test_infrastructure_api.py (4 tests returning 401) — confirmed pre-existing before my changes via git stash verification. Out of scope per deviation rules.

## User Setup Required
Admin users need to configure in .env before using Dockerfile editor endpoints:
- `GITHUB_TOKEN` — Fine-grained PAT with Contents: read+write on the target repo
- `GITHUB_REPO` — "owner/repo" format
- `GITHUB_BRANCH` — Branch to read/commit (default: "main")
- `GITHUB_DOCKERFILE_PATH` — Exact file path within repo (e.g. "backend/runpod_handlers/Dockerfile")

## Next Phase Readiness
- Backend API is complete and tested — both endpoints ready for frontend integration
- Plan 06-02 can now build the Monaco editor frontend that calls GET /dockerfiles/content to load and PUT to save
- No blockers

---
*Phase: 06-dockerfile-editor*
*Completed: 2026-03-05*
