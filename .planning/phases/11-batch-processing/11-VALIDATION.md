---
phase: 11
slug: batch-processing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.0+ with pytest-asyncio (auto mode) |
| **Config file** | `backend/pytest.ini` |
| **Quick run command** | `cd backend && source venv/bin/activate && pytest tests/test_batch_processing.py tests/test_upscale_api.py tests/test_upscale_job_service.py -x -v` |
| **Full suite command** | `cd backend && source venv/bin/activate && pytest --cov=services --cov=api --cov-report=term-missing` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && source venv/bin/activate && pytest tests/test_batch_processing.py tests/test_upscale_api.py tests/test_upscale_job_service.py -x -v`
- **After every plan wave:** Run `cd backend && source venv/bin/activate && pytest --cov=services --cov=api --cov-report=term-missing`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | ERRR-02 | unit | `pytest tests/test_batch_processing.py::TestErrorClassification -x` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | ERRR-02 | unit | `pytest tests/test_batch_processing.py::TestRetryLogic -x` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | ERRR-03, ERRR-04 | unit | `pytest tests/test_batch_processing.py::TestCreditExhaustion -x` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | ERRR-04 | unit | `pytest tests/test_upscale_job_service.py::TestPauseBatch -x` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | ERRR-05 | unit | `pytest tests/test_upscale_job_service.py::TestUnpauseVideos -x` | ❌ W0 | ⬜ pending |
| 11-02-03 | 02 | 1 | QUEU-03 | unit | `pytest tests/test_upscale_job_service.py::TestReorderVideos -x` | ❌ W0 | ⬜ pending |
| 11-02-04 | 02 | 1 | ERRR-01 | unit | `pytest tests/test_upscale_job_service.py::TestRetryVideo -x` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 2 | ERRR-05 | unit + API | `pytest tests/test_upscale_api.py::TestResumeBatch -x` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 2 | ERRR-01 | unit + API | `pytest tests/test_upscale_api.py::TestRetryVideo -x` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 2 | QUEU-03 | unit + API | `pytest tests/test_upscale_api.py::TestReorderQueue -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_batch_processing.py` — stubs for TestErrorClassification, TestRetryLogic, TestCreditExhaustion
- [ ] `tests/test_upscale_job_service.py` — stubs for TestPauseBatch, TestUnpauseVideos, TestReorderVideos, TestRetryVideo, TestUpdateVideoRetryCount
- [ ] `tests/test_upscale_api.py` — stubs for TestResumeBatch, TestRetryVideo, TestReorderQueue

*Existing test infrastructure (conftest fixtures, mock patterns) covers all Phase 11 needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Freepik credit exhaustion detection | ERRR-03 | Exact error format undocumented | Trigger with exhausted credits; verify classifier maps to `credit_exhaustion` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
