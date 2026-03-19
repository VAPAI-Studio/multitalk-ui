# Project Research Summary

**Project:** sideOUTsticks — v1.2 Workflow Builder (Admin No-Code Feature Creator)
**Domain:** Admin tooling for dynamic feature creation in an AI media processing platform
**Researched:** 2026-03-13
**Confidence:** HIGH

## Executive Summary

The v1.2 Workflow Builder is an admin-only no-code tool that converts ComfyUI API-format workflow JSON into live, published feature pages — without any code generation, filesystem writes, or frontend rebuilds. The platform already has a mature foundation: a centralized `WorkflowService` with `{{PLACEHOLDER}}` substitution, studio-based navigation (`studioConfig.ts`), a unified generation feed, dual execution backends (ComfyUI + RunPod), and a consistent job-tracking system. The builder adds a thin configuration layer on top: admins upload a workflow JSON, map node inputs to typed form fields (text, textarea, slider, number, file-upload, dropdown, toggle, resolution pair), group them into sections, test-run the result, and publish — whereupon the `DynamicWorkflowRenderer` component serves the feature page to all users immediately.

The recommended approach is config-driven rendering via a JSONB schema in Supabase (`custom_workflows` table), not code generation. A `DynamicWorkflowRenderer` component reads the published config and renders the form at runtime using the exact same `apiClient.submitWorkflow()` → `createJob()` → `startJobMonitoring()` pipeline as every static feature page. The test runner inside the builder IS the renderer — they share one `execute_dynamic_workflow()` code path to guarantee that passing the builder test means passing in production. Navigation hydration is handled by fetching published workflow configs once at app startup and merging them into the `studios` array, not by adding dynamic IDs to any TypeScript union type.

The two highest-risk areas are routing architecture and code path divergence. The `StudioPageType` TypeScript union (currently hardcoded) must not be polluted with runtime database IDs — dynamic page state must live in a parallel localStorage key. And the test runner must never diverge from the production renderer's parameter handling, or test-passes will give false confidence. Both risks are fully preventable by following the patterns described in ARCHITECTURE.md and PITFALLS.md before writing any feature code.

---

## Key Findings

### Recommended Stack

The Workflow Builder requires exactly 4 new frontend npm packages; the backend needs zero new dependencies. All workflow execution, file storage, auth, and job tracking reuse existing infrastructure without modification. See [STACK.md](.planning/research/STACK.md) for full version details and rationale.

**Core technologies:**
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (stable v6/v10): drag-and-drop field reordering — chosen over react-beautiful-dnd (deprecated) and @dnd-kit/react (pre-1.0, React 19 issues) for accessibility, composability, and React 19 compatibility
- `emoji-picker-react` v4.18.0: emoji icon picker for feature card configuration — lighter than `emoji-mart` (~80KB vs ~170KB), actively maintained as of Feb 2026
- Gradient selection via a predefined palette of Tailwind classes (zero library cost) — `react-colorful` deferred unless custom hex colors are required in a later milestone
- Backend: FastAPI + Pydantic v2 + supabase-py — all existing, no new packages needed
- Database: new `custom_workflows` Supabase table with JSONB columns for `variable_configs` and `section_configs` — consistent with existing table patterns

### Expected Features

See [FEATURES.md](.planning/research/FEATURES.md) for the full feature landscape including the competitor analysis table.

**Must have (table stakes — v1.2 Core):**
- Workflow JSON upload and node parsing (TS-1) — universal entry point; every comparable tool starts here
- Variable configuration: map node inputs to typed form fields (TS-2) — core builder UX
- Six core field display types + toggle + resolution pair (TS-3) — covers all 19 existing workflow placeholder types
- Section grouping: assign variables to named, reorderable sections (TS-4) — required for polished output
- Test run within the builder, sharing renderer code path (TS-5) — non-negotiable before publish
- Publish to studio: instant navigation appearance, no rebuild (TS-6) — the feature's purpose
- Auto-detect field types from ComfyUI type system (D-2) — low cost, high time savings

**Should have (v1.2 Polish, after first publish works):**
- Manage published features: edit, unpublish, delete CRUD (TS-7)
- Live preview panel showing the rendered feature page in real time (D-1)
- Feed + dual execution backend integration confirmed working (D-3)
- Seed field with randomize button (D-4) — common enough to include early
- Resolution pair composite type enforcing multiples-of-32 (D-5)

**Defer (v2+):**
- Conditional field logic (show/hide based on other field values)
- `object_info`-based validation against a live ComfyUI instance
- Workflow versioning (upload a new version of a published workflow)
- Visual node graph editor or viewer
- Multi-admin / per-user workflow builder access

**Critical path:** TS-1 → TS-2 → TS-3 → TS-4 → TS-5 → TS-6 (minimum viable loop)

### Architecture Approach

The architecture is an extension of the existing layered pattern: a new `WorkflowBuilderPage` (admin UI) plus a `DynamicWorkflowRenderer` component (generic feature page). `StudioPage.tsx` is modified to fall through to `DynamicWorkflowRenderer` when an app ID is not found in the static `appComponents` map. Navigation hydration fetches published workflow configs once at startup and merges them into the studio config in memory. All execution goes through existing endpoints — there is no new submission code path. See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for the full component diagram, data flows, and SQL schema.

**Major components:**

| Component | Status | Responsibility |
|-----------|--------|----------------|
| `WorkflowBuilderPage` | NEW | Admin UI: upload JSON, configure variables/sections, test-run, publish |
| `WorkflowBuilder/NodeInspector` | NEW | Display parsed ComfyUI nodes and configurable inputs |
| `WorkflowBuilder/VariableConfigurator` | NEW | Map node inputs to widget types, labels, validation |
| `WorkflowBuilder/WorkflowTestPanel` | NEW | Inline test runner (shares `execute_dynamic_workflow` with renderer) |
| `DynamicWorkflowRenderer` | NEW | Generic feature page driven by JSONB config from database |
| `studioConfig.ts` | MODIFIED | Add `fetchDynamicApps()` + `mergeStudiosWithDynamicApps()` |
| `StudioPage.tsx` | MODIFIED | Fallback to `DynamicWorkflowRenderer` when app ID not in static map |
| `App.tsx` | MODIFIED | Fetch and merge dynamic apps on auth; parallel dynamic page state in localStorage |
| `custom_workflows` table | NEW | JSONB-backed config store; RLS enabled; `published` index |
| `custom_workflow_service.py` | NEW | Parse nodes, build params, validate, test-run (calls existing WorkflowService) |
| `api/custom_workflows.py` | NEW | CRUD + parse + test-run endpoints; all write ops gated by `verify_admin` |

**Suggested build order** (per ARCHITECTURE.md):
1. Database migration (`005_add_custom_workflows.sql`)
2. Backend service + Pydantic models
3. Backend API endpoints
4. `DynamicWorkflowRenderer` (enables end-to-end testing before builder UI exists)
5. Navigation hydration (`studioConfig.ts` + `App.tsx`)
6. `StudioPage.tsx` fallback (one-line change)
7. `WorkflowBuilder` UI (NodeInspector + VariableConfigurator)
8. Test runner panel
9. Publish flow + navigation refresh

### Critical Pitfalls

See [PITFALLS.md](.planning/research/PITFALLS.md) for all 13 pitfalls with codebase-specific file references and line numbers.

**Top 5 — phase blocking:**

1. **`StudioPageType` union does not cover runtime database IDs (Pitfall #1)** — Adding `| string` to the TypeScript union kills compile-time safety on all static pages and breaks the `validPages.includes()` guard. Prevention: maintain a parallel `dynamicPage` state in a separate localStorage key; never merge dynamic slugs into the static union. Must be resolved in Phase 1 before any routing work.

2. **UI-format vs API-format ComfyUI JSON upload (Pitfall #2)** — Admins default to saving the visual editor format (Ctrl+S in ComfyUI), which is incompatible with `WorkflowService`. Prevention: detect format immediately on upload using the presence of `nodes` + `links` top-level keys; reject with a clear message pointing to "Save (API Format)." Must be in the parser from day one.

3. **Test runner diverges from renderer code path (Pitfall #6)** — If the test runner and production renderer use different parameter preparation or submission logic, test-passes give false confidence. Prevention: implement a single `execute_dynamic_workflow(config, params, comfy_url, job_context=None)` function that both paths call. Enforce this in the backend service layer before building either the test runner or the renderer.

4. **Dynamic workflow configs fetched inline on every navigation (Pitfall #4)** — Loading the config inside `StudioPage.tsx` or `DynamicWorkflowRenderer` on every render causes a flash-of-loading on every navigation and repeated database fetches. Prevention: fetch all published configs once at app startup (in `AuthContext` or a `WorkflowConfigContext`); `StudioPage` reads from in-memory map synchronously. Background polling every 60 seconds handles updates.

5. **`comfy_job_id` vs `job_id` field naming mismatch (Pitfall #12)** — The codebase has two conflicting job payload interfaces; using the legacy `job_id` field stores no `comfy_job_id`, so the monitoring loop never finds the job and it stays permanently in "processing." Prevention: use only `CreateVideoJobPayload` / `CreateImageJobPayload` (new interfaces) for all dynamic workflow jobs. Verify in Phase 1 database schema work.

---

## Implications for Roadmap

Based on the dependency graph in FEATURES.md and the suggested build order in ARCHITECTURE.md, the natural phase structure is:

### Phase 1: Foundation — Schema, Parser, and Shared Execution
**Rationale:** Everything else depends on the database schema, the workflow JSON parser, and the single shared execution code path. Pitfalls #1, #2, #6, #8, #10, and #12 are all Phase 1 concerns. Getting these right prevents rewrites in later phases.
**Delivers:** Migration `005_add_custom_workflows.sql`, `custom_workflow_service.py` with `parse_workflow_nodes()`, a single `execute_dynamic_workflow()` function, correct `comfy_job_id` usage, UI-format detection in the parser, separate routing state model for dynamic pages, backend API endpoints for CRUD and parse.
**Addresses:** TS-1 (workflow JSON upload + parse), routing model for dynamic pages
**Avoids:** Pitfalls #1, #2, #6, #8, #10, #12
**Research flag:** Well-documented patterns — standard Supabase migration + Python JSON parsing + FastAPI layered architecture. No additional research needed.

### Phase 2: Dynamic Renderer + Navigation Hydration
**Rationale:** The `DynamicWorkflowRenderer` can be built and tested independently of the builder UI by manually inserting rows into the database. This unblocks end-to-end testing of the rendering pipeline before any admin UI exists. Navigation hydration (`studioConfig.ts` + `App.tsx`) and the `StudioPage.tsx` fallback unlock the complete user journey.
**Delivers:** `DynamicWorkflowRenderer.tsx` rendering all 8 field types from JSONB config, navigation hydration at startup, `StudioPage` fallback, dynamic page localStorage validation on startup.
**Addresses:** TS-3 (six core field types), TS-6 (publish to studio — renderer side), D-3 (feed + dual backend integration), D-4 (seed + randomize), D-5 (resolution pair)
**Avoids:** Pitfalls #4, #5, #7, #9, #11
**Research flag:** Standard patterns for all components. No additional research needed.

### Phase 3: Workflow Builder Admin UI
**Rationale:** With the renderer working, the builder UI can be built and validated end-to-end immediately — every "publish" tested against a live renderer. The builder phases map to the five sub-panels: NodeInspector → VariableConfigurator → SectionGrouping → TestPanel → PublishFlow.
**Delivers:** `WorkflowBuilder.tsx` with all sub-components, publish flow wired to navigation refresh, draft state (saved but unpublished), emoji + gradient picker using `@dnd-kit/sortable` for field reordering and `emoji-picker-react` for icon selection.
**Addresses:** TS-2 (variable configuration), TS-4 (section grouping), TS-5 (test run), TS-6 (publish to studio — builder side), D-1 (live preview), D-2 (auto-detect field types)
**Uses:** `@dnd-kit/core` + `@dnd-kit/sortable`, `emoji-picker-react`, gradient preset palette (no library)
**Avoids:** Pitfall #7 (nonexistent studio target — builder dropdown sources from static `studios` array)
**Research flag:** Standard patterns. The `@dnd-kit` sortable preset usage pattern is documented in STACK.md. No additional research needed.

### Phase 4: Feature Management (CRUD) + Config Staleness Handling
**Rationale:** Once the first feature is published, the admin immediately needs to edit, unpublish, and delete. Stale config handling (Pitfall #13) and localStorage invalidation after deletion (Pitfall #9) must be addressed before real users hit published workflows.
**Delivers:** Management list view (TS-7) with edit/unpublish/delete, config versioning with 60-second background poll, localStorage orphan cleanup on startup, deletion confirmation with active-job check.
**Addresses:** TS-7 (manage published features)
**Avoids:** Pitfalls #9, #13
**Research flag:** Standard patterns. No additional research needed.

### Phase Ordering Rationale

- **Phase 1 must come first** because the database schema and shared execution function are dependencies for every other phase. Pitfalls #1, #6, #8, and #12 are architectural decisions that cannot be retrofitted.
- **Phase 2 before Phase 3** because a working renderer lets Phase 3 do real end-to-end testing without guessing at the rendering output. It also validates the navigation hydration architecture before the builder UI generates dynamic app IDs.
- **Phase 3 before Phase 4** because there must be at least one published feature to manage. Phase 4 handles the full lifecycle that only exists once Phase 3 is complete.
- **Anti-features excluded from all phases:** visual node graph editor, code generation, per-user builder access, conditional field logic, `object_info` blocking validation. These are explicitly out of scope for v1.2 per FEATURES.md.

### Research Flags

Phases with well-documented patterns (no additional research needed):
- **Phase 1:** Supabase migrations, Python JSON parsing, FastAPI layered architecture — all established in existing codebase patterns
- **Phase 2:** React component rendering, job tracking, navigation state — all existing platform patterns replicated
- **Phase 3:** `@dnd-kit/sortable` usage patterns documented in STACK.md with working code examples; emoji picker is a drop-in
- **Phase 4:** CRUD UI patterns, polling with TTL — standard web patterns with no new libraries

No phases require `/gsd:research-phase` during planning. All unknowns are resolved by the research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All npm versions verified against live registry on 2026-03-13; peer dependency compatibility confirmed; React 19 compatibility checked for all 4 packages; backend zero-new-deps confirmed against existing requirements.txt |
| Features | HIGH | Features derived from direct codebase analysis of existing feature pages + official ComfyUI datatypes docs + competitor analysis of ViewComfy and ComfyUI App Builder; acceptance criteria defined for all table stakes |
| Architecture | HIGH | Based on direct codebase analysis of `studioConfig.ts`, `StudioPage.tsx`, `App.tsx`, `workflow_service.py`, `jobTracking.ts`, `supabase.ts` — not inference from external sources; SQL schema fully specified |
| Pitfalls | HIGH | All 13 pitfalls reference specific file paths and line numbers in the existing codebase; ComfyUI format confusion verified against GitHub issue #1335; Supabase JSONB validation verified against official docs |

**Overall confidence:** HIGH

### Gaps to Address

- **Heroku filesystem ephemerality (workflow file storage):** Option A (write custom workflow JSON to `backend/workflows/custom/`) works locally but the Heroku filesystem is ephemeral — files do not survive a restart. For the dev/local phase, Option A is fine. Before deploying to Heroku production, migrate to Option B (store JSON in Supabase Storage and add a `load_template_from_db()` path to `WorkflowService`). Flag as a pre-production task, not a v1.2 blocker for local development.

- **`pg_jsonschema` CHECK constraint on JSONB columns:** Pitfall #5 recommends a Supabase `pg_jsonschema` extension CHECK constraint to enforce the `VariableConfig` schema at the database level. Validate that `pg_jsonschema` is available in the project's Supabase tier before relying on it — if not available, the Zod frontend validation becomes the sole schema enforcement layer and the implementation plan should document this clearly.

- **Admin role detection pattern (`isAdmin` / `verify_admin`):** The existing `api/infrastructure.py` uses a `verify_admin` dependency. The exact implementation (Supabase user metadata field, hardcoded email list, or role table) needs to be confirmed before building the `api/custom_workflows.py` router. Reuse the exact same pattern without re-implementing admin detection.

---

## Sources

### Primary (HIGH confidence)

**From STACK.md:**
- [dnd-kit/core npm](https://www.npmjs.com/package/@dnd-kit/core) — v6.3.1 verified, peerDeps confirmed
- [dnd-kit React 19 Issue #1654](https://github.com/clauderic/dnd-kit/issues/1654) — React 19 issues isolated to `@dnd-kit/react` (pre-1.0), not `@dnd-kit/core` v6
- [emoji-picker-react npm](https://www.npmjs.com/package/emoji-picker-react) — v4.18.0, last updated 2026-02-07
- [ComfyUI Datatypes Documentation](https://docs.comfy.org/custom-nodes/backend/datatypes) — STRING, INT, FLOAT, BOOLEAN, COMBO type metadata with min/max/step/multiline
- [ComfyUI Workflow JSON Spec](https://docs.comfy.org/specs/workflow_json) — API format structure, node/link distinction

**From FEATURES.md:**
- [ComfyUI App Builder announcement](https://blog.comfy.org/p/from-workflow-to-app-introducing) — field grouping, rename, reorder, App Mode patterns
- [ViewComfy GitHub](https://github.com/ViewComfy/ViewComfy) — field types supported: text, numbers, dropdowns, sliders, checkboxes, images, videos, audio
- [ViewComfy blog](https://www.viewcomfy.com/blog/turn-a-comfyui-workflow-into-an-app) — workflow-to-app process (upload → configure → deploy)
- Existing codebase: `frontend/src/lib/studioConfig.ts`, `backend/services/workflow_service.py`, `backend/workflows/*.json`

**From ARCHITECTURE.md:**
- Direct codebase analysis: `studioConfig.ts`, `StudioPage.tsx`, `App.tsx`, `AuthContext.tsx`, `ExecutionBackendContext.tsx`, `jobTracking.ts`, `apiClient.ts`, `workflow_service.py`, `api/infrastructure.py`, `api/comfyui.py`

**From PITFALLS.md:**
- Direct codebase analysis with file paths and line numbers: `frontend/src/lib/studioConfig.ts` (StudioPageType union line 335), `frontend/src/App.tsx` (validPages line 112), `frontend/src/lib/supabase.ts` (CreateJobPayload vs CreateVideoJobPayload interfaces lines 44, 71)
- [ComfyUI Issue #1335](https://github.com/comfyanonymous/ComfyUI/issues/1335) — UI-format vs API-format confusion
- [Supabase pg_jsonschema docs](https://supabase.com/docs/guides/database/extensions/pg_jsonschema) — JSONB schema validation at DB level
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — row-level security for `custom_workflows` table

### Secondary (MEDIUM confidence)

- [The ComfyUI Production Playbook — Cohorte Projects](https://www.cohorte.co/blog/the-comfyui-production-playbook) — production pitfalls and patterns
- [InvokeAI Workflow Implementation](https://invoke-ai.github.io/InvokeAI/contributing/frontend/workflows/) — LinearView field template patterns for linearizing graph into form
- [Dynamic Form Builder System Design — Medium](https://shivambhasin29.medium.com/mastering-frontend-system-design-building-a-dynamic-form-builder-from-scratch-0dfdd78d31d6) — field schema design (id, type, label, validation, conditional logic)
- [Dynamic Configurations in React Apps — Medium](https://medium.com/@bjvalmaseda/dynamic-configurations-in-react-apps-bypass-the-rebuild-with-express-0269e86eb61d) — bypass rebuild with runtime config pattern

---

*Research completed: 2026-03-13*
*Ready for roadmap: yes*
