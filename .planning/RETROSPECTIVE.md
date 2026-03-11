# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Infrastructure Management

**Shipped:** 2026-03-11
**Phases:** 9 | **Plans:** 23 | **Requirements:** 44/44

### What Was Built
- Admin-only infrastructure management section with Supabase role-based access control
- Network volume file browser with S3 hierarchical tree, lazy loading, and pagination
- Bidirectional file transfer: chunked multipart upload (10GB) and streaming download
- File operations (delete/move/rename/create-folder) with PROTECTED_PATHS guards
- HuggingFace direct-to-S3 streaming downloads with background job tracking
- Monaco Dockerfile editor with GitHub commit and optional deploy triggers

### What Worked
- **Two parallel tracks** (file management + Dockerfile/deploy) allowed efficient phase ordering
- **Audit-then-fix loop**: Running `/gsd:audit-milestone` identified VOL-04 pagination gap and missing VERIFICATIONs, which were closed cleanly by decimal phases (6.1, 6.2)
- **Streaming patterns**: Replaced temp-disk approaches with streaming S3 uploads — solved both HF downloads and large file transfers elegantly
- **refreshId prop pattern**: Solved the key= remount problem that was causing double API calls and losing FileTree expanded state
- **Human checkpoints at phase boundaries**: Caught real issues (S3 credential type, HF hub breaking changes) that automated verification couldn't

### What Was Inefficient
- **RunPod S3 API limitations discovered late**: copy_object and batch delete unsupported — forced streaming workarounds in Phase 4 that could have been planned upfront if S3 compatibility had been researched earlier
- **HuggingFace hub breaking changes** (v1.x XET backend, ProgressTqdm name kwarg): Required 3 hotfixes during Phase 5 execution — better pre-research of dependency compatibility would have saved time
- **Vitest + jsdom ESM/CJS conflict**: Emerged in Phase 2, not fully resolved until Phase 6.1 (jsdom downgrade) — test infrastructure should be validated before writing tests
- **Phase 5 P03 took ~90 minutes** (longest plan) due to HF hub compatibility issues — outlier that inflated the overall timeline

### Patterns Established
- **Service layer tuple returns**: `(success, data, error)` — consistent error handling across all infrastructure services
- **PROTECTED_PATHS frozenset**: Module-level constant guarding critical S3 paths from mutations
- **Per-call httpx.AsyncClient**: No shared state in GitHub service — clean per-request lifecycle
- **Opt-in destructive operations**: Deploy toggle, folder delete, rename all default to False/unchecked
- **Admin role from app_metadata** (not user_metadata): Prevents self-promotion attacks
- **Partial success handling**: GitHub commit can succeed while release creation fails — return both states

### Key Lessons
1. **Validate external API compatibility early**: RunPod S3 doesn't support standard S3 operations (copy_object, batch delete, presigned URLs). Research these constraints before planning, not during execution.
2. **Pin major dependency versions in research phase**: huggingface_hub 1.x introduced breaking changes that required 3 hotfixes. Lock versions or test against latest before Phase 1.
3. **Test infrastructure before writing tests**: jsdom ESM/CJS conflicts wasted time across multiple phases. Validate vitest config with a smoke test first.
4. **Audit-then-fix is the right pattern**: The v1.0 audit caught real gaps (VOL-04 pagination, missing verifications) that would have shipped as defects. Decimal phases (6.1, 6.2) closed them cleanly.
5. **Streaming beats temp-disk for large files**: Direct streaming (HF→S3, S3→browser) handles unlimited file sizes and eliminates cleanup concerns.

### Cost Observations
- Model mix: quality profile (opus for planning/execution)
- Timeline: 6 days (2026-03-04 → 2026-03-09)
- Notable: 23 plans completed with consistent velocity; Phase 5 P03 was the outlier (~90min vs ~5min average)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 6 days | 9 | Established audit→fix loop with decimal phases |

### Cumulative Quality

| Milestone | Requirements | Coverage | Audit Score |
|-----------|-------------|----------|-------------|
| v1.0 | 44/44 | All E2E flows verified | 36/37 → 44/44 after gap closure |

### Top Lessons (Verified Across Milestones)

1. External API compatibility must be validated in research phase, not discovered during execution
2. Audit-then-fix with decimal phases is an effective quality gate before milestone completion
