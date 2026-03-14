---
phase: 16
slug: test-runner-and-dynamic-renderer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (backend) + vitest (frontend) |
| **Config file** | `backend/pytest.ini` / `frontend/vite.config.ts` |
| **Quick run command** | `cd backend && pytest tests/ -x -q` |
| **Full suite command** | `cd backend && pytest tests/ -v && cd frontend && npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && pytest tests/ -x -q`
- **After every plan wave:** Run `cd backend && pytest tests/ -v && cd frontend && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | TEST-01 | integration | `cd backend && pytest tests/test_comfyui_api.py -k dynamic -x -q` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | TEST-01 | manual | `curl -X POST /api/custom-workflows/{id}/execute` | N/A | ⬜ pending |
| 16-02-01 | 02 | 2 | DYN-03 | manual | Open WorkflowBuilder → TestStep tab, verify form renders | N/A | ⬜ pending |
| 16-02-02 | 02 | 2 | DYN-04 | manual | Upload a file in TestStep, check upload vs base64 mode | N/A | ⬜ pending |
| 16-02-03 | 02 | 2 | TEST-02 | manual | Submit test run, verify progress feedback, inline result | N/A | ⬜ pending |
| 16-03-01 | 03 | 2 | DYN-05 | manual | Navigate to DynamicWorkflowPage, verify all field types render | N/A | ⬜ pending |
| 16-03-02 | 03 | 2 | DYN-07 | manual | Submit via DynamicWorkflowPage with RunPod backend, check result | N/A | ⬜ pending |
| 16-03-03 | 03 | 2 | TEST-03 | manual | Verify DynamicWorkflowPage and TestStep use same backend endpoint | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_dynamic_workflow_execute.py` — stubs for TEST-01 (execute endpoint)
- [ ] Existing `backend/tests/conftest.py` — reuse shared fixtures

*Framework (pytest) is already installed in the backend.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TestStep renders form inside WorkflowBuilder | DYN-03 | React component rendering, no unit test framework set up for frontend | Open /admin/builder, go to step 6 (Test), verify variable inputs match variable_config |
| File upload mode sends filename to backend | DYN-04 | Requires live ComfyUI connection | Upload an image in upload mode, check network request has filename (not base64) |
| Base64 mode sends encoded data to backend | DYN-04 | Requires file reading in browser | Upload an image in base64 mode, check request body has base64 string |
| Real-time progress displays during test run | TEST-02 | Requires live WebSocket connection | Execute test, verify % progress updates appear inline |
| DynamicWorkflowPage renders all 10 field types | DYN-05 | Visual regression, no automated screenshots | Create workflow with each field type, open production page, verify all inputs appear |
| RunPod execution returns result to DynamicWorkflowPage | DYN-07 | Requires live RunPod endpoint | Toggle to RunPod, submit via dynamic page, verify result appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
