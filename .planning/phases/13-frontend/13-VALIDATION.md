---
phase: 13
slug: frontend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 + @testing-library/react 16.3.2 |
| **Config file** | `frontend/vitest.config.ts` (verify exists; create if missing in Wave 0) |
| **Quick run command** | `cd frontend && npm test -- --run` |
| **Full suite command** | `cd frontend && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm test -- --run`
- **After every plan wave:** Run `cd frontend && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green + build succeeds + backend tests pass
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | INFR-03 | manual | Verify studioConfig entry + StudioPage map | N/A | ⬜ pending |
| 13-01-02 | 01 | 1 | UPLD-01 | unit | `cd frontend && npm test -- --run tests/BatchVideoUpscale.test.tsx` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | UPLD-02 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 1 | UPLD-03 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 1 | UPLD-04 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-02-03 | 02 | 1 | STAT-01 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-02-04 | 02 | 1 | STAT-02, STAT-03 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-03-01 | 03 | 2 | STAT-04 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-03-02 | 03 | 2 | STAT-05 | unit | Same file | ❌ W0 | ⬜ pending |
| 13-BE-01 | 01 | 1 | UPLD-01 | unit (backend) | `cd backend && pytest tests/test_upscale_api.py -x` | Extend existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/vitest.config.ts` — verify exists; create if missing
- [ ] `frontend/src/__tests__/BatchVideoUpscale.test.tsx` — test stubs covering UPLD-01 through STAT-05
- [ ] `backend/tests/test_upscale_api.py` — extend with upload-video endpoint test

*Existing backend test infrastructure covers pytest. Frontend may need Vitest config setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Page accessible from homepage/sidebar | INFR-03 | Navigation integration requires full app rendering | 1. Load app → verify sidebar shows "Batch Video Upscale" 2. Click → page renders 3. Homepage card navigates correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
