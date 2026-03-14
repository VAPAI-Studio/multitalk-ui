---
phase: 15-builder-ui
plan: "01"
subsystem: api
tags: [fastapi, typescript, infrastructure, custom-workflows, node-registry, model-manifest]

# Dependency graph
requires:
  - phase: 14-foundation
    provides: custom_workflows API, infrastructure.py router, verify_admin pattern
provides:
  - GET /api/infrastructure/node-registry endpoint (admin-only)
  - GET /api/infrastructure/model-manifest endpoint (admin-only)
  - TypeScript interfaces for custom workflow builder operations
  - apiClient typed methods: parseWorkflow, createCustomWorkflow, updateCustomWorkflow, getNodeRegistry, getModelManifest
affects: [15-02, 15-03, 15-04, 15-05, 15-06, WorkflowBuilder frontend component]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-endpoint Depends(verify_admin) on new infrastructure endpoints (consistent with existing pattern)"
    - "Inline json/Path imports inside endpoint functions to avoid module-level import pollution"
    - "TypeScript interfaces exported from apiClient.ts for consumer type safety"

key-files:
  created: []
  modified:
    - backend/api/infrastructure.py
    - frontend/src/lib/apiClient.ts

key-decisions:
  - "Inline json and Path imports inside endpoint functions rather than top-level module imports (keeps infrastructure.py consistent)"
  - "Typed interfaces exported from apiClient.ts (not separate types file) to co-locate with usage"
  - "getDockerfileContent and saveDockerfileContent added as properly-typed wrappers alongside existing getDockerfile/saveDockerfile methods"

patterns-established:
  - "All new infrastructure endpoints follow per-endpoint verify_admin dependency pattern"
  - "Builder API methods use typed generic request<T>() calls throughout"

requirements-completed: [DEP-02, MDL-02]

# Metrics
duration: 7min
completed: 2026-03-14
---

# Phase 15 Plan 01: Builder Wiring Summary

**Two admin-only static config endpoints on infrastructure.py plus 12 typed apiClient builder methods wiring frontend WorkflowBuilder to node_registry.json and model_manifest.json**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-14T00:02:33Z
- **Completed:** 2026-03-14T00:09:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `GET /api/infrastructure/node-registry` and `GET /api/infrastructure/model-manifest` to infrastructure router, both admin-only via `Depends(verify_admin)`, returning static JSON config files from `backend/runpod_config/`
- Added 12 exported TypeScript interfaces to apiClient.ts covering full custom workflow CRUD, parse, publish/unpublish, node registry, and model manifest shapes
- Added 12 typed apiClient methods: `parseWorkflow`, `createCustomWorkflow`, `listCustomWorkflows`, `getCustomWorkflow`, `updateCustomWorkflow`, `deleteCustomWorkflow`, `publishCustomWorkflow`, `unpublishCustomWorkflow`, `getNodeRegistry`, `getModelManifest`, `getDockerfileContent`, `saveDockerfileContent`
- Frontend TypeScript build passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add node-registry and model-manifest endpoints** - `9851654` (feat)
2. **Task 2: Add builder API methods to apiClient.ts** - `7ce1425` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `backend/api/infrastructure.py` - Added `get_node_registry` and `get_model_manifest` GET endpoints at bottom of file, following existing `Depends(verify_admin)` and inline Path pattern
- `frontend/src/lib/apiClient.ts` - Added 12 exported TypeScript interfaces + 12 typed class methods for custom workflow builder operations

## Decisions Made

- Inline `json` and `Path` imports inside the endpoint functions rather than adding them to top-level module imports — keeps the file consistent with the existing `save_dockerfile` pattern which also uses local imports
- TypeScript interfaces co-located in `apiClient.ts` rather than a separate `types/` file — keeps them immediately accessible to callers without an extra import path
- Added `getDockerfileContent` and `saveDockerfileContent` as properly-typed wrappers that mirror the existing `getDockerfile` / `saveDockerfile` methods — the plan spec included these and they add typed clarity for infrastructure callers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - both files were straightforward additions with zero ambiguity.

## User Setup Required

None - no external service configuration required. Both new endpoints use the same `verify_admin` dependency already wired in the running backend.

## Next Phase Readiness

- `/api/infrastructure/node-registry` and `/api/infrastructure/model-manifest` are live and admin-accessible
- `apiClient.parseWorkflow`, `apiClient.createCustomWorkflow`, and all builder methods are typed and ready for WorkflowBuilder component (plan 15-02+)
- Frontend build is green — no blockers for Wave 1 continuation

---
*Phase: 15-builder-ui*
*Completed: 2026-03-14*

## Self-Check: PASSED

- backend/api/infrastructure.py: FOUND
- frontend/src/lib/apiClient.ts: FOUND
- .planning/phases/15-builder-ui/15-01-SUMMARY.md: FOUND
- Commit 9851654 (Task 1): FOUND
- Commit 7ce1425 (Task 2): FOUND
