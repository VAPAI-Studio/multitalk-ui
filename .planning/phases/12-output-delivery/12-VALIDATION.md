---
phase: 12
slug: output-delivery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x + pytest-asyncio |
| **Config file** | backend/tests/conftest.py |
| **Quick run command** | `cd backend && pytest tests/test_upscale_api.py -x` |
| **Full suite command** | `cd backend && pytest` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && pytest tests/test_upscale_api.py tests/test_upscale_job_service.py -x`
- **After every plan wave:** Run `cd backend && pytest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | DLVR-01 | unit | `pytest tests/test_upscale_api.py::test_delivery_supabase_upload -x` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | DLVR-01 | unit | `pytest tests/test_upscale_api.py::test_delivery_supabase_failure -x` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | DLVR-02 | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_upload -x` | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | DLVR-02 | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_failure_nonfatal -x` | ❌ W0 | ⬜ pending |
| 12-01-05 | 01 | 1 | DLVR-02 | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_skipped -x` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | DLVR-03 | unit | `pytest tests/test_upscale_api.py::test_batch_detail_includes_url -x` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | DLVR-04 | unit | `pytest tests/test_upscale_api.py::test_zip_job_creation -x` | ❌ W0 | ⬜ pending |
| 12-02-03 | 02 | 1 | DLVR-04 | unit | `pytest tests/test_upscale_api.py::test_zip_job_status -x` | ❌ W0 | ⬜ pending |
| 12-02-04 | 02 | 1 | DLVR-04 | unit | `pytest tests/test_upscale_api.py::test_zip_download -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_upscale_api.py` — new test functions for delivery behavior (DLVR-01, DLVR-02)
- [ ] `tests/test_upscale_api.py` — new test functions for ZIP endpoints (DLVR-04)
- [ ] `tests/test_upscale_job_service.py` — update for new upload status methods

*Existing infrastructure covers framework and shared fixtures — no new installs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Google Drive subfolder appears in user's Drive | DLVR-02 | Requires real Google OAuth + Drive API | 1. Create batch with project folder set 2. Complete upscaling 3. Check Drive subfolder for uploaded file |
| ZIP download in browser with correct filenames | DLVR-04 | End-to-end browser download behavior | 1. Complete batch with 2+ videos 2. Click "Download All" 3. Verify ZIP contains files with `_upscaled` suffix |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
