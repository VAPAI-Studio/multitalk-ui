---
phase: 17-navigation-integration
plan: 01
subsystem: api
tags: [fastapi, auth, custom-workflows, pytest, tdd]

# Dependency graph
requires:
  - phase: 14-custom-workflow-builder
    provides: custom_workflows.py endpoint with verify_admin on /published
  - phase: 16-test-runner-and-dynamic-renderer
    provides: execute endpoint using get_current_user as pattern reference
provides:
  - GET /api/custom-workflows/published accessible to all authenticated users (not admin-only)
  - non_admin_client fixture for testing non-admin endpoint access
  - TestPublishedEndpointAuth test class covering auth relaxation
affects: [17-navigation-integration, frontend-nav-loading, dynamic-workflow-routing]

# Tech tracking
tech-stack:
  added: []
  patterns: [admin_client fixture overrides both verify_admin and get_current_user for endpoints that use either dependency]

key-files:
  created: []
  modified:
    - backend/api/custom_workflows.py
    - backend/tests/test_custom_workflow_api.py

key-decisions:
  - "list_published_workflows uses Depends(get_current_user) not Depends(verify_admin) — published features must be accessible to all authenticated users on app load"
  - "admin_client fixture now overrides both verify_admin and get_current_user — admins are authenticated users and must be able to hit endpoints using either dependency"

patterns-established:
  - "Pattern: When relaxing endpoint auth from admin to authenticated, update test fixtures to override both verify_admin and get_current_user"

requirements-completed: [STORE-06]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 17 Plan 01: Navigation Integration Summary

**Relaxed /api/custom-workflows/published endpoint auth from verify_admin to get_current_user, unblocking frontend nav loading of published dynamic workflows for all authenticated users**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-14T14:49:03Z
- **Completed:** 2026-03-14T14:51:40Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Non-admin authenticated users can now GET /api/custom-workflows/published (HTTP 200)
- Unauthenticated requests to /published still return 401/403
- All other endpoints remain admin-only (no regressions)
- 24/24 tests in test_custom_workflow_api.py pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add non-admin test for /published endpoint (TDD RED)** - `b053889` (test)
2. **Task 2: Relax /published endpoint auth from verify_admin to get_current_user (TDD GREEN)** - `796971a` (feat)

**Plan metadata:** (docs commit below)

_Note: TDD tasks have two commits — RED (failing test) then GREEN (implementation)_

## Files Created/Modified
- `backend/api/custom_workflows.py` - Changed list_published_workflows dependency from verify_admin to get_current_user
- `backend/tests/test_custom_workflow_api.py` - Added non_admin_client fixture, TestPublishedEndpointAuth class; updated admin_client to also override get_current_user

## Decisions Made
- `list_published_workflows` uses `Depends(get_current_user)` not `Depends(verify_admin)` — published features are public-facing and must load for all authenticated users on app startup
- `admin_client` fixture updated to override both `verify_admin` and `get_current_user` — admins are authenticated users; fixtures must cover both dependency types when an endpoint switches between them

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated admin_client fixture to also override get_current_user**
- **Found during:** Task 2 (GREEN phase — running full test suite after endpoint change)
- **Issue:** Existing `TestCRUD.test_list_published` used `admin_client` which only overrides `verify_admin`. After changing the endpoint to `get_current_user`, admin_client no longer satisfied the dependency, returning 401 instead of 200.
- **Fix:** Added `app.dependency_overrides[get_current_user] = lambda: mock_admin` to the `admin_client` fixture so admins also satisfy authenticated-user endpoints.
- **Files modified:** `backend/tests/test_custom_workflow_api.py`
- **Verification:** All 24 tests in test_custom_workflow_api.py pass
- **Committed in:** `796971a` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for test correctness — admin fixture must cover both auth dependencies. No scope creep.

## Issues Encountered
- Pre-existing `test_github_service.py::TestSettingsGitHubFields::test_settings_github_token_default_empty` fails locally due to real GITHUB_TOKEN in .env — confirmed pre-existing before our changes, unrelated to this plan.

## Next Phase Readiness
- Backend is ready: /published endpoint accessible to non-admins
- Frontend can now call GET /api/custom-workflows/published on app load without getting 403
- Ready for Phase 17 Plan 02 (frontend navigation integration)

## Self-Check: PASSED

- `backend/api/custom_workflows.py` confirmed uses `Depends(get_current_user)` on /published endpoint
- `backend/tests/test_custom_workflow_api.py` confirmed has `TestPublishedEndpointAuth` class with `test_list_published_non_admin`
- Commits b053889 and 796971a verified present in git log

---
*Phase: 17-navigation-integration*
*Completed: 2026-03-14*
