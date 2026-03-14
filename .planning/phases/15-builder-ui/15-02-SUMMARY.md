---
phase: 15-builder-ui
plan: "02"
subsystem: ui
tags: [typescript, vitest, tdd, builder, utilities, types]

# Dependency graph
requires:
  - phase: 15-01
    provides: ParsedNode, ModelManifest TypeScript interfaces in apiClient.ts
provides:
  - builderUtils.ts with 7 pure utility functions, 4 interfaces, VariableInputType union, 2 constant arrays
  - 27 unit tests validating all builder utility business logic
affects: [WorkflowBuilder, 15-03, 15-04, 15-05, 15-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD pure-function extraction, MODEL_FIELDS/MODEL_EXTENSIONS set-based detection, basename matching for model manifest lookup]

key-files:
  created:
    - frontend/src/lib/builderUtils.ts
    - frontend/src/test/builderUtils.test.ts
  modified: []

key-decisions:
  - "inferFieldType checks Array.isArray + all-string guard before string-extension checks to correctly classify dropdown arrays"
  - "MODEL_FIELDS set ported verbatim from backend scan_workflows.py to keep detection logic in sync"
  - "generateSlug mirrors Python backend generate_slug() exactly: lowercase → strip non-alnum → collapse whitespace/hyphens → trim"
  - "derivePlaceholderKey replaces non-alphanumeric with _ after upper-casing (not stripping), ensuring stable keys for any input_name"

patterns-established:
  - "Builder types pattern: VariableConfig, SectionConfig, FeatureMetadata defined in builderUtils.ts as the canonical contract for all step components"
  - "Placeholder detection pattern: value.startsWith('{{') to skip already-substituted values in extractModelRefs"

requirements-completed: [WB-06, DEP-01, DEP-03, MDL-01, MDL-02, META-01, VAR-05]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 15 Plan 02: Builder Utility Functions Summary

**7 pure TypeScript utility functions + 4 exported interfaces covering field type inference, model detection, slug generation, and placeholder keying for the Workflow Builder**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T12:26:37Z
- **Completed:** 2026-03-14T12:29:30Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Wrote 27 unit tests covering all pure utility functions before implementation (TDD RED state)
- Implemented builderUtils.ts with all 7 functions, 4 interfaces, VariableInputType union, MODEL_FIELDS/MODEL_EXTENSIONS sets, GRADIENT_PALETTE, and INPUT_TYPE_OPTIONS
- All 27 tests pass and frontend build exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for all pure utility functions** - `35f5ac3` (test)
2. **Task 2: Implement builderUtils.ts to make all tests GREEN** - `bb00193` (feat)

_Note: TDD plan — two commits per standard RED → GREEN flow_

## Files Created/Modified
- `frontend/src/lib/builderUtils.ts` - Pure utility functions and TypeScript types for the Workflow Builder
- `frontend/src/test/builderUtils.test.ts` - 27 unit tests validating all 7 pure functions

## Decisions Made
- `inferFieldType` checks `Array.isArray() && every(string)` before string-extension checks to ensure string arrays are classified as `dropdown`, not `text`
- `MODEL_FIELDS` set ported verbatim from backend `scan_workflows.py` to keep detection in sync
- `generateSlug` mirrors Python `generate_slug()` exactly: lowercase → strip non-alnum/space/hyphen → collapse whitespace+hyphens → trim hyphens
- `derivePlaceholderKey` uppercases `inputName` and replaces non-alphanumeric with `_` (not strips), producing stable keys for any input_name including those with dots/underscores

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `builderUtils.ts` exports are ready for import in WorkflowBuilder step components (15-03 through 15-06)
- All types (`VariableConfig`, `SectionConfig`, `FeatureMetadata`) are the canonical contracts; step components implement against them
- `GRADIENT_PALETTE` and `INPUT_TYPE_OPTIONS` ready for use in metadata and variable editors

---
*Phase: 15-builder-ui*
*Completed: 2026-03-14*
