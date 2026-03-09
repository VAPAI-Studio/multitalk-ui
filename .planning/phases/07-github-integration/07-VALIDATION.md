---
phase: 7
slug: github-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio |
| **Config file** | backend/tests/conftest.py |
| **Quick run command** | `cd backend && pytest tests/test_github_service.py -x` |
| **Full suite command** | `cd backend && pytest` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && pytest tests/test_github_service.py -x`
- **After every plan wave:** Run `cd backend && pytest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | GIT-02 | unit | `pytest tests/test_github_service.py::TestGitHubServiceCreateRelease -x` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | GIT-02 | unit | `pytest tests/test_github_service.py::TestGitHubServiceCreateRelease -x` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | GIT-01, GIT-02 | unit | `pytest tests/test_github_service.py -x` | ✅ | ⬜ pending |
| 07-02-01 | 02 | 1 | GIT-05, GIT-06 | manual | N/A (frontend) | N/A | ⬜ pending |
| 07-02-02 | 02 | 1 | GIT-03 | unit | `pytest tests/test_github_service.py::TestSettingsGitHubFields -x` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_github_service.py::TestGitHubServiceCreateRelease` — tests for create_release() method (GIT-02, GIT-05, GIT-06)
- [ ] Test for 422 duplicate tag error handling
- [ ] Test for partial success scenario (commit OK, release fails)

*Existing test infrastructure covers GIT-01, GIT-03, GIT-04.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deploy toggle UI shows in DockerfileEditor | GIT-05 | Frontend visual component | Open Dockerfile editor, verify "Deploy to RunPod" checkbox visible |
| Success/error toast messages display correctly | GIT-05, GIT-06 | Frontend visual feedback | Save with deploy on, verify confirmation message; simulate error, verify error message |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
