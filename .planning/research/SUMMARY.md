# Project Research Summary

**Project:** sideOUTsticks -- Infrastructure Management Admin Interface
**Domain:** Admin tooling for AI/ML serverless infrastructure (RunPod network volume management, Dockerfile CI/CD, HuggingFace model acquisition)
**Researched:** 2026-03-04
**Confidence:** MEDIUM-HIGH

## Executive Summary

This project adds an infrastructure management layer to the existing sideOUTsticks AI media platform. The goal is to eliminate context switching between RunPod's web UI, GitHub, HuggingFace, and local IDEs by consolidating file browsing (S3-backed RunPod volumes), code editing (Dockerfiles with syntax highlighting), and GitHub push-to-deploy into a single admin-only interface within the existing React + FastAPI application. The target user is a single technical admin (or very small ops team), not end users -- this simplifies many design decisions around concurrency, RBAC, and real-time collaboration (all scoped out as anti-features).

The recommended approach is backend-centric: all external service interactions (RunPod S3, GitHub API, HuggingFace Hub) happen server-side through new FastAPI services, with the React frontend providing the UI layer via Monaco Editor for code editing, react-arborist for the file tree, and react-resizable-panels for the IDE layout. The existing patterns (API routers delegating to services, Supabase auth, Pydantic models, job tracking) extend naturally to these new features with minimal architectural deviation. The most impactful differentiator is HuggingFace direct-to-volume downloads, which eliminates a 30-60 minute manual process.

The key risks are: (1) RunPod network volume S3 access may not be available via direct API -- this needs early validation as it underpins all file operations, (2) large file transfers (2-15 GB models) will hit Heroku's 30-second timeout if not implemented as async background jobs from the start, (3) GitHub push integration can trigger uncontrolled RunPod rebuilds without a confirmation/debounce mechanism, and (4) admin access control must be the very first thing built, not bolted on after features exist. All four risks have clear mitigation strategies documented in the research.

## Key Findings

### Recommended Stack

The stack additions integrate cleanly with the existing React 18 + TypeScript + Vite + TailwindCSS frontend and FastAPI + Python backend. No architectural departures are needed -- the new features follow existing patterns (API router -> service -> external API, Supabase auth, job tracking).

**Core technologies:**
- `@monaco-editor/react` (v4.6.x): In-browser code editor -- industry standard (VS Code engine), first-class Dockerfile syntax highlighting, diff view for pre-commit review, rich API for themes and keybindings
- `react-arborist` (v3.4.x): File tree component -- purpose-built for file browser UIs, headless rendering (works with TailwindCSS), drag-and-drop, virtualized for large directories, keyboard accessible
- `react-resizable-panels`: IDE panel layout -- lightweight (~5KB), handles sidebar + editor + preview split pane pattern
- `aiofiles` (Python): Async file I/O for FastAPI -- prevents blocking the event loop during file operations
- `PyGithub` (v2.x) or `githubkit`: GitHub API interaction from backend -- PyGithub is established (10K+ stars), githubkit is async-first (better FastAPI fit)
- `boto3`/`aiobotocore`: S3 access for RunPod volumes -- standard AWS SDK, full control over list/put/get/delete/multipart operations
- `huggingface_hub` (Python): HuggingFace model downloads -- handles auth, LFS, URL resolution, gated models correctly (do NOT use raw HTTP)

**Critical exclusions (do NOT use):**
- No Ace Editor (legacy), no CodeMirror 5 (superseded), no WebContainers (overkill), no isomorphic-git (unnecessary complexity), no Ant Design tree (TailwindCSS conflicts), no frontend-direct GitHub API calls (security risk)

### Expected Features

**Must have (table stakes -- without these, users stay in RunPod/GitHub/IDE):**
- TS-1: File browser with tree navigation (S3 ListObjectsV2, pagination, lazy loading)
- TS-2: File upload to volume (chunked/multipart for models up to 10GB)
- TS-3: File download from volume (presigned URLs, streaming)
- TS-4: File delete with confirmation
- TS-5: Dockerfile editor with syntax highlighting (Monaco)
- TS-6: GitHub push integration (commit + push triggers RunPod rebuild)
- TS-7: File move and rename
- TS-8: Admin access control (all features admin-only, server-enforced)

**Should have (differentiators that justify building this vs. using existing tools):**
- D-1: HuggingFace direct download to volume (highest-value feature -- eliminates the biggest pain point)
- D-2: Model-to-workflow assignment
- D-3: Base template system for Dockerfiles (base + per-workflow customization)
- D-4: File search and filtering
- D-5: Deployment status dashboard (build status after push)
- D-6: Bulk file operations (multi-select delete/move/download)

**Defer (explicitly scoped out as anti-features):**
- Real-time collaborative editing (single admin, not needed)
- Full Git UI (branches, merge conflicts, history -- GitHub does this better)
- RunPod dashboard recreation (GPU monitoring, scaling, billing)
- Automated model optimization (quantization, pruning)
- In-browser terminal/SSH
- Multi-tenant admin RBAC (beyond admin/not-admin)
- Dockerfile linting/security scanning

### Architecture Approach

The system decomposes into six components with clear boundaries: File Browser (read-only listing), File Operations (mutations), HuggingFace Download (server-to-server transfer with job tracking), Dockerfile Editor (Monaco + GitHub read/write), GitHub Integration Service (backend-only, all git operations server-side), and Admin Access Control (FastAPI dependency extending existing auth). All external service communication flows through the backend -- the frontend never directly contacts GitHub, S3, or HuggingFace.

**Major components:**
1. **Network Volume File Browser** -- Lists S3-backed volume contents via backend API; frontend renders tree with react-arborist; cursor-based pagination for large directories
2. **File Operations Service** -- Upload (multipart streaming), download (presigned URLs), move/rename (S3 copy+delete), delete; all through FastAPI endpoints proxying to S3
3. **HuggingFace Direct Download** -- Async background job that streams from HF CDN to S3 without buffering; uses `huggingface_hub` library; job tracking via existing pattern
4. **Dockerfile Editor** -- Monaco editor loading content from GitHub via backend; save triggers commit+push; diff preview before deploy
5. **GitHub Integration Service** -- Backend-only service wrapping GitHub API (Contents API for read/write); PAT or GitHub App credentials stored as env vars; never exposed to frontend
6. **Admin Access Control** -- New `get_admin_user()` FastAPI dependency; `is_admin` in Supabase user_metadata; frontend AuthContext gets `isAdmin` derived property; all admin routes return 403 for non-admins

### Critical Pitfalls

1. **S3 is not a filesystem** -- RunPod volumes are object stores with eventual consistency, no true directories, and copy+delete for "move." Design the file browser API with cursor-based pagination, optimistic UI updates, and async move/rename operations from day one.
2. **Large file transfers will timeout** -- Multi-GB HuggingFace downloads and uploads cannot be synchronous HTTP requests. Heroku has a 30-second timeout. All large transfers must be fire-and-forget async jobs with polling-based progress tracking. Never buffer entire files in backend memory.
3. **Admin access must come first** -- The codebase has no existing RBAC. Building features before access control leads to missed endpoints and false security. Create `get_admin_user()` dependency before the first admin endpoint exists. Use a `/api/admin/` prefix with middleware protection.
4. **GitHub push triggers uncontrolled rebuilds** -- Without a confirmation dialog and deployment locking, rapid Dockerfile edits trigger multiple concurrent RunPod rebuilds (10-20 minutes each). Add diff preview, explicit deploy confirmation, and "Save Draft" vs "Deploy" distinction.
5. **API client is already 1,181 lines** -- Adding volume, Dockerfile, and GitHub methods will push it past 1,500 lines. Refactor `apiClient.ts` into modular structure before adding new methods (or create separate `infraClient.ts`).

## Implications for Roadmap

Based on combined research, the project has two independent tracks after a shared foundation phase, plus a polish phase. The dependency graph is clear:

### Phase 0: Prerequisites and Refactoring
**Rationale:** Admin access control is a hard prerequisite for all infrastructure features (all four research files agree). The API client refactoring prevents the existing tech debt from compounding.
**Delivers:** Admin role mechanism, `get_admin_user()` FastAPI dependency, `isAdmin` in AuthContext, refactored `apiClient.ts` into modular structure, admin navigation scaffolding in sidebar
**Addresses:** TS-8 (Admin Access Control)
**Avoids:** Pitfall #6 (access control bolted on after), Pitfall #8 (monolithic API client)

### Phase 1: Network Volume File Management
**Rationale:** The file browser is the foundation for all volume operations (uploads, downloads, HuggingFace downloads, model assignment all depend on being able to see and navigate files). S3 access validation is also the biggest technical risk and should be proven early.
**Delivers:** File browser with tree navigation, file upload (chunked), download (presigned URLs), delete, move/rename. Basic CRUD for RunPod network volume files.
**Addresses:** TS-1, TS-2, TS-3, TS-4, TS-7
**Avoids:** Pitfall #1 (S3 vs filesystem assumptions), Pitfall #7 (volume concurrency)
**Uses:** react-arborist, react-resizable-panels, boto3/aiobotocore, aiofiles

### Phase 2: HuggingFace Integration
**Rationale:** The highest-value differentiator. Depends on Phase 1 (volume service for S3 writes, file browser for destination selection). Introduces async job pattern for large transfers.
**Delivers:** HuggingFace URL input, server-to-server download to volume, progress tracking, gated model support, download queue
**Addresses:** D-1 (HuggingFace Direct Download), D-2 (Model-to-Workflow Assignment initial version)
**Avoids:** Pitfall #2 (blocking UI during large transfers), Pitfall #10 (HuggingFace URL complexity)
**Uses:** huggingface_hub (Python), existing job tracking pattern

### Phase 3: Dockerfile Editor and GitHub Integration
**Rationale:** Independent of Phases 1-2 (only needs Phase 0 admin auth). Can run in parallel with Phase 2 if resources allow. Tightly couples editor and GitHub push since the editor's value depends on deploy capability.
**Delivers:** Monaco-based Dockerfile editor with syntax highlighting, GitHub read/write via backend, commit + push, diff preview before deploy, deployment confirmation dialog
**Addresses:** TS-5 (Dockerfile Editor), TS-6 (GitHub Push), D-3 (Base Template System initial version)
**Avoids:** Pitfall #3 (template pattern misunderstanding), Pitfall #4 (GitHub token security), Pitfall #5 (uncontrolled rebuilds), Pitfall #9 (editor bundle bloat -- use React.lazy)
**Uses:** @monaco-editor/react, PyGithub or githubkit, GitHub App authentication

### Phase 4: Polish and Differentiators
**Rationale:** These features improve efficiency but are not blocking. They depend on the infrastructure from Phases 1-3 being stable.
**Delivers:** File search and filtering, bulk operations (multi-select delete/move), deployment status dashboard (GitHub Actions status after push), complete model-to-workflow assignment with validation
**Addresses:** D-4 (File Search), D-5 (Deploy Status Dashboard), D-6 (Bulk Operations), D-2 (Model Assignment complete)
**Avoids:** Pitfall #11 (model assignment disconnected from execution)

### Phase Ordering Rationale

- **Phase 0 before everything** because all research files independently flag admin access as a prerequisite, and the PITFALLS research specifically warns against bolting it on later (Pitfall #6)
- **Phase 1 before Phase 2** because HuggingFace downloads write to the volume (needs volume service) and the admin needs to see downloaded files (needs file browser)
- **Phase 3 can parallel Phase 2** because Dockerfile editing only needs admin auth (Phase 0), not volume management. This is explicitly noted in the Architecture research dependency graph
- **Phase 4 last** because search, bulk ops, and deploy status are quality-of-life improvements on top of working infrastructure, not core functionality

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** RunPod S3 access validation is critical -- need to confirm direct S3 credentials are available for network volumes. If not, architecture falls back to a "file management pod" approach which is significantly more complex. Run a spike/proof-of-concept before detailed planning.
- **Phase 2:** HuggingFace download architecture has two viable approaches (RunPod job vs backend streaming). Need to prototype both to determine which works within Heroku constraints.
- **Phase 3:** The existing Dockerfile template inheritance pattern needs documentation before building the editor. The exact structure (base template + per-workflow overrides) is mentioned in project docs but not fully specified.

Phases with standard patterns (skip deep research):
- **Phase 0:** Admin access control via Supabase user_metadata is well-documented, standard FastAPI dependency injection pattern. No research needed.
- **Phase 4:** File search, bulk operations, and status dashboards are standard CRUD patterns with established UI patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended libraries are industry standards with large communities. Version numbers need verification (knowledge cutoff May 2025). |
| Features | HIGH | Feature scope is well-defined with explicit anti-features. Feature dependency map is clear. Based on project documentation and domain analysis. |
| Architecture | MEDIUM-HIGH | Component decomposition and data flows are well-defined. The one uncertainty is RunPod S3 API availability -- this could force a significant architecture change for the volume service. |
| Pitfalls | HIGH | 12 pitfalls identified with concrete warning signs and prevention strategies. Many are based on known patterns in the existing codebase (CONCERNS.md referenced). |

**Overall confidence:** MEDIUM-HIGH

The downgrade from HIGH is due to the single critical unknown: whether RunPod provides direct S3 API access to network volumes. This underpins the entire file management track (Phases 1-2).

### Gaps to Address

- **RunPod S3 API access:** Must be validated before Phase 1 planning. If direct S3 is unavailable, the file management architecture needs redesign (pod-based approach). Run a proof-of-concept during Phase 0.
- **Heroku constraints for large transfers:** Heroku dynos have 512MB memory and 30-second timeouts. HuggingFace downloads and large file uploads need to be designed around these limits. Consider direct-to-S3 presigned URL uploads that bypass Heroku entirely.
- **Dockerfile template inheritance structure:** The exact base-template-to-workflow-override mechanism needs documentation before Phase 3. This affects how the editor separates read-only (base) from editable (workflow-specific) sections.
- **GitHub App vs PAT decision:** GitHub Apps provide better security (fine-grained permissions, auto-expiring tokens) but more setup complexity. Decision needed before Phase 3.
- **Library version verification:** All npm/PyPI versions cited are approximate (knowledge cutoff May 2025). Verify latest stable versions before adding dependencies.

## Sources

### Primary (HIGH confidence)
- Project codebase analysis (CLAUDE.md, new_feature_guide.md, WORKFLOW_SYSTEM.md, TESTING.md) -- existing architecture patterns, established conventions
- ComfyUI API documentation -- integration patterns already in use
- Monaco Editor and react-arborist official documentation -- library capabilities and API

### Secondary (MEDIUM confidence)
- Community consensus on library choices (npm download counts, GitHub stars, community posts)
- S3 API patterns for object storage file management
- GitHub API documentation for Contents API and commit creation
- HuggingFace Hub library documentation for model downloads

### Tertiary (LOW confidence)
- RunPod network volume S3 API availability -- inferred from "S3-backed" description, not confirmed with RunPod documentation
- Exact library version numbers -- based on knowledge through May 2025, need verification
- Heroku-specific constraints for large file handling -- general knowledge, specific limits may have changed

---
*Research completed: 2026-03-04*
*Ready for roadmap: yes*
