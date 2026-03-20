---
phase: 16-test-runner-and-dynamic-renderer
plan: "01"
subsystem: backend-api
tags: [execute-endpoint, custom-workflows, runpod, tdd, api]
dependency_graph:
  requires: [14-02, 15-06]
  provides: [execute-endpoint, execute-dynamic-workflow-runpod]
  affects: [16-02, 16-03]
tech_stack:
  added: []
  patterns: [lazy-import-runpod-service, per-endpoint-auth-not-admin]
key_files:
  created:
    - backend/tests/test_dynamic_workflow_execute.py
  modified:
    - backend/models/custom_workflow.py
    - backend/services/custom_workflow_service.py
    - backend/services/runpod_service.py
    - backend/api/custom_workflows.py
    - frontend/src/lib/apiClient.ts
decisions:
  - lazy import of RunPodService inside execute_dynamic_workflow_runpod avoids circular imports at module level
  - test mock targets services.runpod_service.RunPodService (not services.custom_workflow_service.RunPodService) due to lazy import pattern
  - execute endpoint uses get_current_user (not verify_admin) — authenticated users can execute published features
  - submit_built_workflow added to RunPodService to avoid double template loading in dynamic workflow path
metrics:
  duration: 3min
  completed: 2026-03-14
  tasks_completed: 3
  files_modified: 6
---

# Phase 16 Plan 01: Execute Endpoint Summary

**One-liner:** POST /api/custom-workflows/{id}/execute HTTP route exposing execute_dynamic_workflow (ComfyUI) and execute_dynamic_workflow_runpod (RunPod) with matching apiClient.ts typed method.

## What Was Built

Added the single shared execution HTTP route that both the TestStep (Plan 02) and DynamicWorkflowPage (Plan 03) will call. The endpoint branches on `execution_backend` ('comfyui' or 'runpod') and delegates to the appropriate service method.

### Backend Changes

**backend/models/custom_workflow.py**
- Added `ExecuteWorkflowRequest` model: `parameters`, `base_url`, `client_id`, `execution_backend` (Literal['comfyui','runpod'], default 'comfyui')
- Added `ExecuteWorkflowResponse` model: `success`, `prompt_id`, `execution_backend`, `error`

**backend/services/runpod_service.py**
- Added `submit_built_workflow(workflow_json)` method: submits a pre-built workflow dict directly to RunPod endpoint, avoiding double template loading

**backend/services/custom_workflow_service.py**
- Added `execute_dynamic_workflow_runpod(workflow_config, user_params)`: builds workflow via WorkflowService then submits via RunPodService.submit_built_workflow; returns (success, job_id, error)

**backend/api/custom_workflows.py**
- Added `POST /{workflow_id}/execute` endpoint: authenticated (not admin-only), fetches workflow, branches on execution_backend, returns ExecuteWorkflowResponse
- Returns 404 when workflow not found, 500 on execution failure
- Imports `get_current_user` alongside existing `verify_admin`

### Frontend Changes

**frontend/src/lib/apiClient.ts**
- Added `ExecuteCustomWorkflowPayload` interface (exported)
- Added `ExecuteCustomWorkflowResponse` interface (exported)
- Added `executeCustomWorkflow(id, payload)` method on ApiClient class

### Tests

**backend/tests/test_dynamic_workflow_execute.py** (5 tests, all GREEN)
- `test_execute_workflow_comfyui`: comfyui path returns 200 with prompt_id
- `test_execute_workflow_runpod`: runpod path returns 200 with job_id
- `test_execute_workflow_not_found`: unknown workflow_id returns 404
- `test_execute_workflow_requires_auth`: unauthenticated request returns 401
- `test_execute_dynamic_workflow_runpod_service`: service method builds and submits to RunPod

## Commits

| Hash | Message |
|------|---------|
| 40378d5 | test(16-01): add failing test scaffold for execute endpoint |
| ecc3f5a | feat(16-01): implement POST /custom-workflows/{id}/execute endpoint |
| 40c90f0 | feat(16-01): add executeCustomWorkflow method to apiClient.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test mock target for lazy RunPodService import**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test used `patch("services.custom_workflow_service.RunPodService")` but RunPodService is lazily imported inside the method body, so the module attribute doesn't exist at patch time
- **Fix:** Changed patch target to `patch("services.runpod_service.RunPodService")` — patches the class at its definition location
- **Files modified:** backend/tests/test_dynamic_workflow_execute.py
- **Commit:** ecc3f5a (included in same commit)

## Self-Check: PASSED

All created/modified files confirmed present:
- FOUND: backend/tests/test_dynamic_workflow_execute.py
- FOUND: backend/models/custom_workflow.py
- FOUND: backend/services/custom_workflow_service.py
- FOUND: backend/api/custom_workflows.py
- FOUND: frontend/src/lib/apiClient.ts

All commits confirmed:
- FOUND: 40378d5 (RED test scaffold)
- FOUND: ecc3f5a (GREEN implementation)
- FOUND: 40c90f0 (apiClient.ts)
