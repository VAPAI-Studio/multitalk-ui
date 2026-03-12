---
phase: 10
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.0+ with pytest-asyncio (auto mode) |
| **Config file** | `backend/pytest.ini` (exists) |
| **Quick run command** | `pytest tests/test_upscale_*.py tests/test_freepik_*.py tests/test_batch_*.py -x -v` |
| **Full suite command** | `pytest --cov=services --cov=api --cov-report=term-missing` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_upscale_*.py tests/test_freepik_*.py tests/test_batch_*.py -x -v`
- **After every plan wave:** Run `pytest --cov=services --cov=api --cov-report=term-missing`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | INFR-01 | unit | `pytest tests/test_upscale_job_service.py -x` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | SETT-01, SETT-02 | unit | `pytest tests/test_upscale_models.py -x` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | INFR-02, QUEU-01 | unit (mocked) | `pytest tests/test_freepik_service.py -x` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | QUEU-02 | integration | `pytest tests/test_batch_processing.py -x` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 2 | INFR-04 | unit | `pytest tests/test_batch_recovery.py -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_upscale_models.py` — Pydantic model validation (defaults, ranges, Literal types) for SETT-01, SETT-02
- [ ] `tests/test_freepik_service.py` — FreepikUpscalerService with mocked httpx (submit, poll, error handling) for INFR-02, QUEU-01
- [ ] `tests/test_upscale_job_service.py` — CRUD operations with mocked Supabase client for INFR-01
- [ ] `tests/test_upscale_api.py` — API endpoint tests with TestClient (auth, validation, background task) for QUEU-02
- [ ] `tests/test_batch_recovery.py` — Startup recovery logic (find interrupted batches, resume) for INFR-04
- [ ] `tests/conftest.py` — May need additional fixtures for Supabase mock, Freepik mock

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Freepik API real submission | QUEU-01 | Requires live API key + credits | Submit a test video via API endpoint; verify task_id returned and status polled to COMPLETED |
| Server restart recovery | INFR-04 | Requires actual process restart | Start a batch, kill server mid-processing, restart, verify batch resumes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

*Phase: 10-foundation*
*Validation strategy created: 2026-03-11*
