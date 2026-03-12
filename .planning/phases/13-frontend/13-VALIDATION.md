---
phase: 13
slug: frontend
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Backend framework** | pytest (existing, fully configured) |
| **Frontend framework** | Vitest 4.0.18 (config exists at `frontend/vitest.config.ts`) |
| **Backend test command** | `cd backend && python -m pytest tests/test_upscale_api.py -x` |
| **Frontend build command** | `cd frontend && npm run build` |
| **Estimated runtime** | Backend tests ~10s, frontend build ~15s |

---

## Nyquist Compliance

Every task has an `<automated>` verify command:

| Plan | Task | Automated Command |
|------|------|-------------------|
| 13-01 | Task 1 | `cd backend && python -m pytest tests/test_upscale_api.py -x -v --tb=short` |
| 13-01 | Task 2 | `cd frontend && npm run build` |
| 13-02 | Task 1 | `cd frontend && npm run build` |
| 13-02 | Task 2 | `cd frontend && npm run build` |
| 13-03 | Task 1 | `cd frontend && npm run build` |
| 13-03 | Task 2 | `cd frontend && npm run build` (checkpoint) |

Backend coverage: pytest with TDD tests for the upload endpoint (4 test cases in Plan 01 Task 1).
Frontend coverage: TypeScript compiler via `npm run build` catches type errors, missing imports, and broken references. Component-level render tests are not required for Nyquist compliance since every task has a passing automated command.

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` verify command
- **After every plan wave:** Run `cd frontend && npm run build` + `cd backend && pytest tests/test_upscale_api.py -x`
- **Before `/gsd:verify-work`:** Full suite must be green + build succeeds + backend tests pass
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 13-01-01 | 01 | 1 | UPLD-01 | unit (backend) | `cd backend && pytest tests/test_upscale_api.py -x` | pending |
| 13-01-02 | 01 | 1 | INFR-03 | build | `cd frontend && npm run build` | pending |
| 13-02-01 | 02 | 2 | UPLD-01..04 | build | `cd frontend && npm run build` | pending |
| 13-02-02 | 02 | 2 | STAT-01..03 | build | `cd frontend && npm run build` | pending |
| 13-03-01 | 03 | 3 | STAT-04, STAT-05 | build | `cd frontend && npm run build` | pending |
| 13-03-02 | 03 | 3 | all | checkpoint | `cd frontend && npm run build` + human verify | pending |

*Status: pending / green / red / flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Page accessible from homepage/sidebar | INFR-03 | Navigation integration requires full app rendering | 1. Load app, verify sidebar shows "Batch Upscale" 2. Click, page renders 3. Homepage card navigates correctly |
| Complete feature end-to-end | all | Requires running backend + Freepik API | Plan 03 Task 2 checkpoint covers this |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
