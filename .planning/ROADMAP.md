# Roadmap: sideOUTsticks

## Milestones

- ✅ **v1.0 Infrastructure Management** — Phases 1-7 (shipped 2026-03-11)
- ✅ **v1.1 Batch Video Upscale** — Phases 10-13 (shipped 2026-03-13)
- 🚧 **v1.2 Workflow Builder** — Phases 14-17 (in progress)

## Phases

<details>
<summary>v1.0 Infrastructure Management (Phases 1-7) -- SHIPPED 2026-03-11</summary>

- [x] Phase 1: Admin Access Control (4/4 plans) -- completed 2026-03-04
- [x] Phase 2: Network Volume File Browser (4/4 plans) -- completed 2026-03-04
- [x] Phase 3: File Transfer (3/3 plans) -- completed 2026-03-04
- [x] Phase 4: File Operations (3/3 plans) -- completed 2026-03-04
- [x] Phase 5: HuggingFace Integration (3/3 plans) -- completed 2026-03-05
- [x] Phase 6: Dockerfile Editor (2/2 plans) -- completed 2026-03-05
- [x] Phase 6.1: File Tree Pagination (1/1 plan) -- completed 2026-03-08
- [x] Phase 6.2: Verification Documentation (1/1 plan) -- completed 2026-03-08
- [x] Phase 7: GitHub Integration (2/2 plans) -- completed 2026-03-09

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>v1.1 Batch Video Upscale (Phases 10-13) -- SHIPPED 2026-03-13</summary>

- [x] Phase 10: Foundation (3/3 plans) -- completed 2026-03-11
- [x] Phase 11: Batch Processing (2/2 plans) -- completed 2026-03-11
- [x] Phase 12: Output Delivery (2/2 plans) -- completed 2026-03-12
- [x] Phase 13: Frontend (3/3 plans) -- completed 2026-03-13

</details>

### v1.2 Workflow Builder

**Milestone Goal:** Enable admins to create new platform features from ComfyUI workflows without writing code — upload a workflow JSON, configure inputs visually, test it, and publish it as a live feature page.

- [x] **Phase 14: Foundation** - Database schema, backend models, CRUD API, workflow parser, and shared execution function (completed 2026-03-13)
- [x] **Phase 15: Builder UI** - Admin page with node inspector, variable configuration, dependency/model checks, metadata editor (completed 2026-03-14)
- [ ] **Phase 16: Test Runner and Dynamic Renderer** - DynamicWorkflowPage component shared between builder testing and production rendering
- [ ] **Phase 17: Navigation Integration** - Merge dynamic features into studios, homepage, routing, and feed sidebar

## Phase Details

### Phase 14: Foundation
**Goal**: Admin can upload a ComfyUI workflow JSON through the API and receive structured node/input data back; the database stores custom workflow configurations; a shared execution function exists that both the test runner and production renderer will call
**Depends on**: Nothing (first phase of v1.2; existing codebase provides auth, workflow service, dual backends)
**Requirements**: STORE-01, STORE-02, STORE-03, STORE-04, STORE-05, WB-01, WB-02, WB-03, WB-04, TEST-04
**Success Criteria** (what must be TRUE):
  1. Admin can POST a ComfyUI API-format JSON to the parse endpoint and receive back a list of nodes with their class_types and configurable inputs (link arrays filtered out); UI-format JSON is rejected with a clear error message
  2. Admin can create, read, update, delete, and list custom workflow configurations through the CRUD API; all write endpoints return 403 for non-admin users
  3. The custom_workflows Supabase table exists with JSONB columns for variable and section configs; workflow template files are saved to backend/workflows/custom/
  4. A single execute_dynamic_workflow function exists in the backend service layer that accepts a workflow config and user-provided parameters, and submits to ComfyUI via the existing WorkflowService — this is the shared code path that both test runner and renderer will use
**Plans**: 3 plans

Plans:
- [ ] 14-01-PLAN.md — Pydantic models, database migration, workflow parser with format detection and link filtering
- [ ] 14-02-PLAN.md — CRUD service operations, template file management, and shared execute_dynamic_workflow function
- [ ] 14-03-PLAN.md — API router with parse/CRUD/publish endpoints, main.py registration, and integration tests

### Phase 15: Builder UI
**Goal**: Admin can visually configure a complete custom workflow feature — select which node inputs become user variables, set field types and validation, check dependency/model status, and define feature metadata — all from a single builder page in the Infrastructure studio
**Depends on**: Phase 14
**Requirements**: WB-05, WB-06, WB-07, DEP-01, DEP-02, DEP-03, DEP-04, MDL-01, MDL-02, MDL-03, VAR-01, VAR-02, VAR-03, VAR-04, VAR-05, VAR-06, VAR-07, VAR-08, META-01, META-02, META-03, META-04, META-05
**Success Criteria** (what must be TRUE):
  1. Admin can upload a workflow JSON in the builder, see all nodes with their inputs in a node inspector, and click individual inputs to promote them to user-facing variables with auto-suggested field types based on ComfyUI metadata
  2. Admin can configure each variable with display label, UI input type (text, textarea, number, slider, file-image, file-audio, file-video, dropdown, toggle, resolution), defaults, min/max/step, validation rules, file handling mode, and placeholder mapping; variables can be reordered via drag-and-drop and organized into named sections
  3. Admin can see which custom node packages the workflow requires, which are already in the Dockerfile, and add missing packages with one click; admin can see which model files are referenced and whether each exists on the RunPod network volume
  4. Admin can set the feature name, slug, description, output type, target studio, icon (emoji), gradient colors, and toggle published/disabled state
  5. Optionally, admin can enrich node input metadata by connecting to a live ComfyUI server's /object_info endpoint
**Plans**: 6 plans

Plans:
- [ ] 15-01-PLAN.md — Backend node-registry and model-manifest endpoints + typed apiClient methods for builder operations
- [ ] 15-02-PLAN.md — TypeScript types (VariableConfig, SectionConfig, FeatureMetadata) + pure utility functions + unit tests (TDD)
- [ ] 15-03-PLAN.md — WorkflowBuilder component scaffold + Upload step + Inspect step with node inspector and variable promotion
- [ ] 15-04-PLAN.md — Variables step: type-specific field editors, drag-and-drop reordering, section management
- [ ] 15-05-PLAN.md — Dependencies step: custom node package checker vs Dockerfile, model file checker vs RunPod manifest
- [ ] 15-06-PLAN.md — Metadata step (name/slug/studio/gradient/publish toggle) + Infrastructure.tsx tab integration

### Phase 16: Test Runner and Dynamic Renderer
**Goal**: A single DynamicWorkflowPage component renders any custom workflow configuration into a working feature page with form inputs, file handling, job tracking, and output display — used both as the test panel inside the builder and as the production page for published features
**Depends on**: Phase 14, Phase 15
**Requirements**: TEST-01, TEST-02, TEST-03, DYN-03, DYN-04, DYN-05, DYN-07
**Success Criteria** (what must be TRUE):
  1. Admin can fill in test values for all configured variables inside the builder and execute a test run against ComfyUI with real-time progress feedback; test output (image, video, or audio) displays inline in the builder
  2. The DynamicWorkflowPage component renders the correct form layout (sections, labels, placeholders, help text) with proper input widgets for every configured field type including file uploads (upload-to-ComfyUI and base64 modes) and resolution pairs
  3. Submitting the dynamic form creates a tracked job via createJob, monitors it via startJobMonitoring, and displays the result — using the exact same execute_dynamic_workflow backend function as the test runner
  4. Dynamic workflow execution works with both ComfyUI and RunPod execution backends without any backend-specific logic in the renderer
**Plans**: 3 plans

Plans:
- [ ] 16-01-PLAN.md — Execute endpoint (backend models + RunPod service method + HTTP route + apiClient method)
- [ ] 16-02-PLAN.md — DynamicFormRenderer component + TestStep in WorkflowBuilder (6th step)
- [ ] 16-03-PLAN.md — DynamicWorkflowPage production component (job tracking + dual-backend + UnifiedFeed)

### Phase 17: Navigation Integration
**Goal**: Published custom workflows appear seamlessly in the app's navigation — inside their assigned studio, on the homepage, and with a correctly filtered generation feed — without modifying the StudioPageType union or requiring a rebuild
**Depends on**: Phase 16
**Requirements**: DYN-01, DYN-02, DYN-06, STORE-06
**Success Criteria** (what must be TRUE):
  1. When a custom workflow is published to a studio (e.g., Lipsync, Image, Video), it appears in that studio's sidebar navigation and on the Homepage within the studio's feature card — immediately, without a page reload or rebuild
  2. The app fetches all published custom workflow configs once at startup and merges them into the navigation; dynamic page state uses a parallel localStorage key separate from the static StudioPageType union
  3. The dynamic feature page includes a generation feed sidebar filtered to that workflow's pageContext, consistent with all existing static feature pages
**Plans**: TBD

Plans:
- [ ] 17-01: TBD
- [ ] 17-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 14 -> 15 -> 16 -> 17

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Admin Access Control | v1.0 | 4/4 | Complete | 2026-03-04 |
| 2. Network Volume File Browser | v1.0 | 4/4 | Complete | 2026-03-04 |
| 3. File Transfer | v1.0 | 3/3 | Complete | 2026-03-04 |
| 4. File Operations | v1.0 | 3/3 | Complete | 2026-03-04 |
| 5. HuggingFace Integration | v1.0 | 3/3 | Complete | 2026-03-05 |
| 6. Dockerfile Editor | v1.0 | 2/2 | Complete | 2026-03-05 |
| 6.1. File Tree Pagination | v1.0 | 1/1 | Complete | 2026-03-08 |
| 6.2. Verification Documentation | v1.0 | 1/1 | Complete | 2026-03-08 |
| 7. GitHub Integration | v1.0 | 2/2 | Complete | 2026-03-09 |
| 10. Foundation | v1.1 | 3/3 | Complete | 2026-03-11 |
| 11. Batch Processing | v1.1 | 2/2 | Complete | 2026-03-11 |
| 12. Output Delivery | v1.1 | 2/2 | Complete | 2026-03-12 |
| 13. Frontend | v1.1 | 3/3 | Complete | 2026-03-13 |
| 14. Foundation | v1.2 | 3/3 | Complete | 2026-03-13 |
| 15. Builder UI | v1.2 | 6/6 | Complete | 2026-03-14 |
| 16. Test Runner and Dynamic Renderer | v1.2 | 0/3 | Not started | - |
| 17. Navigation Integration | v1.2 | 0/2 | Not started | - |
