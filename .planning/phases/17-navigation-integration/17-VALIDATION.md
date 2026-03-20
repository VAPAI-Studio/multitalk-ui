---
phase: 17
slug: navigation-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (backend) |
| **Config file** | backend/pytest.ini |
| **Quick run command** | `pytest backend/tests/ -x -q` |
| **Full suite command** | `pytest backend/ --cov` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build` (frontend TypeScript build gate)
- **After every plan wave:** Run `npm run build` + `pytest backend/tests/ -x -q`
- **Before `/gsd:verify-work`:** Full suite must be green + manual smoke test (publish workflow, reload as non-admin, verify nav)
- **Max feedback latency:** ~30 seconds (build + backend tests)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | STORE-06 | unit | `pytest backend/tests/test_custom_workflow_api.py -x -q` | ❌ Wave 0 | ⬜ pending |
| 17-01-02 | 01 | 1 | STORE-06 | build | `npm run build` | ✅ | ⬜ pending |
| 17-02-01 | 02 | 2 | DYN-01, DYN-02 | manual | n/a — sidebar/homepage visual | ❌ manual | ⬜ pending |
| 17-02-02 | 02 | 2 | DYN-06 | manual | n/a — feed sidebar visual | ❌ manual | ⬜ pending |
| 17-02-03 | 02 | 2 | DYN-01, DYN-02 | build | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_custom_workflow_api.py` — test that `GET /api/custom-workflows/published` returns HTTP 200 for non-admin authenticated user (currently returns 403 due to `verify_admin` dependency)

*No frontend test infrastructure gaps — this project has no frontend unit test suite.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dynamic workflow appears in sidebar nav under correct studio | DYN-01 | UI navigation — no frontend unit tests in project | Publish a workflow assigned to lipsync-studio; reload app as non-admin; verify workflow button appears in Lipsync Studio sidebar group |
| Dynamic workflow appears on Homepage within studio card | DYN-02 | UI visual — homepage card rendering | Same setup as above; navigate to Home; verify workflow appears in Lipsync studio card app icons and features list |
| Dynamic feature page feed filtered to workflow pageContext | DYN-06 | Feed behavior — requires running app + job | Navigate to dynamic workflow page; run a generation; verify feed sidebar shows only that workflow's jobs |
| App fetches published workflows on startup | STORE-06 | Network behavior — requires browser devtools | Open Network tab; reload app as non-admin; verify `GET /api/custom-workflows/published` returns 200 and workflow list |
| Stale slug in localStorage handled gracefully | STORE-06 | Startup error path | Manually set localStorage `vapai-dynamic-page` to a non-existent slug; reload app; verify app falls back to home gracefully |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
