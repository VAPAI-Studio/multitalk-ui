---
phase: 15-builder-ui
plan: "05"
subsystem: ui
tags: [react, typescript, workflow-builder, dependencies, dockerfile, node-registry, model-manifest]

# Dependency graph
requires:
  - phase: 15-01
    provides: apiClient.getNodeRegistry(), apiClient.getModelManifest(), apiClient.getDockerfileContent(), apiClient.saveDockerfileContent(), NodeRegistry and ModelManifest TypeScript interfaces
  - phase: 15-02
    provides: extractClassTypes, extractModelRefs, checkModelPresence, parseInstalledPackages pure utility functions
  - phase: 15-03
    provides: WorkflowBuilder.tsx with 5-step state machine, BuilderState, DependenciesStep placeholder
provides:
  - DependenciesStep sub-component replacing Plan 03 placeholder in WorkflowBuilder.tsx
  - Custom node package checker: class_type extraction → registry lookup → Dockerfile install status
  - "Add to Dockerfile" one-click action with SHA refresh after each commit to prevent 409 conflicts
  - Model file checker: extractModelRefs → manifest cross-reference → present/missing status badges
  - Advisory message when missing models detected
  - buildInstallBlock helper producing correct Dockerfile RUN block format
affects: [15-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SHA staleness prevention: re-fetch Dockerfile after each commit with getDockerfileContent() to get updated SHA before next mutation"
    - "useCallback + useEffect on parsedNodes: loadChecks memoized to re-run when parsedNodes changes (user navigates away and back)"
    - "Class-type reverse map: build classTypeToPackage Record client-side from registry.packages entries for O(1) per-node lookup"

key-files:
  created: []
  modified:
    - frontend/src/pages/WorkflowBuilder.tsx

key-decisions:
  - "Tasks 1 and 2 implemented and committed together — both panels (packages and models) share the same loadChecks function and local state; splitting them would require duplicating the state wiring"
  - "loadChecks wrapped in useCallback with [state.parsedNodes] dependency so useEffect only re-runs when workflow nodes change, not on every render"
  - "MdlStatus type kept local to DependenciesStep (not exported) since it duplicates ModelStatus from builderUtils — avoids import proliferation for a render-only type alias"
  - "Refresh button added (deviation from plan spec) so admin can re-check without navigating away — Rule 2 (missing critical functionality for usefulness)"

patterns-established:
  - "SHA refresh pattern: after saveDockerfileContent, immediately call getDockerfileContent() to update local sha state for all future mutations"
  - "Parallel API loading in DependenciesStep: Promise.all([getNodeRegistry, getModelManifest, getDockerfileContent]) runs all three concurrently on step mount"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, MDL-01, MDL-02, MDL-03]

# Metrics
duration: 2min
completed: 2026-03-14
---

# Phase 15 Plan 05: Dependencies Step Summary

**DependenciesStep with parallel node registry + model manifest + Dockerfile loading, one-click package install, and SHA-refresh anti-409 pattern**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-14T12:43:26Z
- **Completed:** 2026-03-14T12:45:30Z
- **Tasks:** 2 (implemented together in one commit — shared state)
- **Files modified:** 1

## Accomplishments

- Added `DependenciesStep` sub-component (239 new lines) replacing the Plan 03 placeholder in WorkflowBuilder.tsx
- Custom node packages panel: fetches NodeRegistry, builds reverse class_type→package map, calls `extractClassTypes` on `parsedNodes`, cross-references with `parseInstalledPackages(dockerfile)`, renders green/orange status per package
- "Add to Dockerfile" button appends git clone block (+ pip install if `has_requirements`), commits via `saveDockerfileContent`, then immediately re-fetches to update SHA — prevents 409 conflict on second add
- Model files panel: calls `extractModelRefs` + `checkModelPresence` on same load pass, renders green (on volume) / red (missing) per model filename with advisory when any are missing
- `buildInstallBlock` helper produces correct multi-line Dockerfile RUN block format matching the research doc spec
- `useCallback`/`useEffect` pattern ensures re-check on navigation away and back (re-mount)
- Frontend TypeScript build passes (`tsc -b && vite build` exits 0)

## Task Commits

Both tasks implemented in one atomic commit (shared loadChecks function and local state):

1. **Tasks 1+2: DependenciesStep dependency checker + model checker panels** - `36f0a18` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `frontend/src/pages/WorkflowBuilder.tsx` — Added `useEffect` import, `extractClassTypes`, `extractModelRefs`, `checkModelPresence`, `parseInstalledPackages` imports from builderUtils; `buildInstallBlock` helper; `DependenciesStep` sub-component with full two-panel UI; replaced placeholder with `<DependenciesStep>` in main WorkflowBuilder render

## Decisions Made

- Committed Tasks 1 and 2 together in one atomic commit — both panels share the same `loadChecks` function and local state (`depStatuses`, `modelStatuses`, `dockerfileContent`, `dockerfileSha`, `loaded`). Splitting would require duplicating state setup.
- Used `useCallback` with `[state.parsedNodes]` dependency for `loadChecks` — memoizes the function so the `useEffect` only triggers when parsedNodes actually changes, not on each render
- Added a "Refresh" button (minor addition beyond plan spec) for the admin to manually re-check without navigating away — improves usability, no behavioral side effects

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed useState-as-useEffect typo**
- **Found during:** Task 1 (initial implementation)
- **Issue:** Initial implementation used `useState(() => { void loadChecks(); })` instead of `useEffect` — useState initializer runs once but does not re-run on dependency change; also semantically incorrect
- **Fix:** Added `useEffect` to the React import list; replaced `useState` call with `useEffect(() => { void loadChecks(); }, [loadChecks])`
- **Files modified:** frontend/src/pages/WorkflowBuilder.tsx
- **Verification:** Build passes, correct React pattern
- **Committed in:** 36f0a18 (task commit)

**2. [Rule 2 - Missing Critical] Added Refresh button**
- **Found during:** Task 2 (render implementation)
- **Issue:** No way for admin to re-check dependencies after uploading models to the volume without leaving the step
- **Fix:** Added a "Refresh" button that calls `loadChecks()` again
- **Files modified:** frontend/src/pages/WorkflowBuilder.tsx
- **Verification:** Build passes, button correctly calls loadChecks
- **Committed in:** 36f0a18 (task commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes necessary for correctness and usability. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. DependenciesStep requires the admin to have the backend running (for `/api/infrastructure/node-registry`, `/api/infrastructure/model-manifest`, `/api/infrastructure/dockerfiles/content`).

## Next Phase Readiness

- `DependenciesStep` is complete and wired into the WorkflowBuilder step machine
- `dockerfileSha` is stored in `BuilderState` after each load/add, ready for Plan 06 if needed
- Plan 06 (MetadataStep) can now replace its placeholder — all prior steps are fully implemented

---
*Phase: 15-builder-ui*
*Completed: 2026-03-14*

## Self-Check: PASSED

- frontend/src/pages/WorkflowBuilder.tsx: FOUND (modified, +239 lines)
- .planning/phases/15-builder-ui/15-05-SUMMARY.md: FOUND (this file)
- Commit 36f0a18 (Tasks 1+2): FOUND
- Frontend build exits 0: CONFIRMED
