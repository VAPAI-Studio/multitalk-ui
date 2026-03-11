# Roadmap: sideOUTsticks Infrastructure Management

## Overview

This roadmap delivers admin-only infrastructure management for RunPod serverless workflows within the existing sideOUTsticks platform. The journey starts with access control (the hard prerequisite), builds up a complete network volume file management system (browse, transfer, mutate), adds HuggingFace direct-to-volume downloads (the highest-value differentiator), then delivers an independent Dockerfile editing and GitHub deployment pipeline. Two independent tracks emerge after admin auth: file management (Phases 2-5) and Dockerfile/deploy (Phases 6-7), which can execute in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Admin Access Control** - Restrict infrastructure features to admin users with server-enforced authorization
- [x] **Phase 2: Network Volume File Browser** - Browse and navigate RunPod network volume files in a hierarchical tree
- [x] **Phase 3: File Transfer** - Upload files to and download files from the RunPod network volume (completed 2026-03-04)
- [x] **Phase 4: File Operations** - Delete, move, and rename files and folders on the network volume (completed 2026-03-04)
- [x] **Phase 5: HuggingFace Integration** - Download models from HuggingFace directly to the RunPod network volume (completed 2026-03-05)
- [x] **Phase 6: Dockerfile Editor** - Edit workflow Dockerfiles in-browser with syntax highlighting (completed 2026-03-05)
- [x] **Phase 7: GitHub Integration** - Push Dockerfile changes to GitHub to trigger RunPod rebuilds (completed 2026-03-09)

## Phase Details

### Phase 1: Admin Access Control
**Goal**: Only admin users can access infrastructure management; all other users are completely excluded
**Depends on**: Nothing (first phase)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04
**Success Criteria** (what must be TRUE):
  1. Admin user sees an "Infrastructure" section in the app navigation and can access it
  2. Non-admin user cannot see infrastructure navigation items and gets a 403 if they try API endpoints directly
  3. Admin role is read from Supabase user_metadata and available in the frontend AuthContext as an `isAdmin` property
  4. All `/api/infrastructure/` backend endpoints reject non-admin requests with 403 status before any business logic runs
**Plans**: 4 plans in 2 waves

Plans:
- [x] 01-01: Backend User Role Foundation (Wave 1) - Extend User model with role field, update /auth/me to extract and return role from Supabase metadata
- [x] 01-02: Backend Infrastructure API Router (Wave 2) - Create admin-protected /api/infrastructure router with health endpoint, register in main.py, document admin role implementation
- [x] 01-03: Frontend Auth Integration (Wave 2) - Extend AuthContext with isAdmin property, add Infrastructure studio to studioConfig with adminOnly flag
- [x] 01-04: Frontend Navigation & Page (Wave 2) - Filter studios by admin status, add Infrastructure page routing, create placeholder component (+ bug fixes for complete access control)

### Phase 2: Network Volume File Browser
**Goal**: Admin can see and navigate every file and folder on the RunPod network volume from within the app
**Depends on**: Phase 1
**Requirements**: VOL-01, VOL-02, VOL-03, VOL-04, VOL-05
**Success Criteria** (what must be TRUE):
  1. Admin sees a hierarchical file tree showing folders and files on the RunPod network volume
  2. Each file entry shows name, human-readable size, and last modified date
  3. Admin can expand and collapse folders inline without page reload (lazy-loaded from S3)
  4. File browser handles directories with 10,000+ files without crashing by paginating results
  5. Admin can navigate to any depth level in the volume hierarchy via breadcrumb or tree clicks
**Plans**: 3 plans in 3 waves

Plans:
- [x] 02-01: Backend S3 Foundation (Wave 1) — S3 client singleton, InfrastructureService with list_files(), GET /api/infrastructure/files endpoint with pagination
- [x] 02-02: Frontend File Tree Component (Wave 2) — Custom tree UI with FileTreeNode and FileTree components, lazy loading, apiClient.listFiles() method
- [x] 02-03: Integration and Polish (Wave 3) — Breadcrumb navigation, refresh functionality, enhanced health endpoint with S3 connectivity check

### Phase 3: File Transfer
**Goal**: Admin can move files between local machine and RunPod network volume in both directions
**Depends on**: Phase 2
**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04, UPLOAD-05, DWNLD-01, DWNLD-02, DWNLD-03, DWNLD-04
**Success Criteria** (what must be TRUE):
  1. Admin can upload a file from local machine to a chosen directory on the RunPod volume
  2. Uploads handle files up to 10GB using chunked/multipart transfer with a progress bar showing percentage and estimated time
  3. Uploads survive network interruptions gracefully (abort on failure prevents orphaned S3 parts; per-part retry on network error)
  4. Admin can download any file from the volume to local machine via authenticated backend streaming proxy (RunPod S3 does not support presigned URLs — streaming is the only viable approach)
  5. Downloads work for files of any size without timeout; admin sees download initiation confirmation
**Plans**: 3 plans in 2 waves

Plans:
- [x] 03-01-PLAN.md — Backend multipart upload API (init/part/complete/abort) + streaming download endpoint (Wave 1)
- [x] 03-02-PLAN.md — Frontend FileUpload component with XHR chunked progress + Infrastructure page wiring (Wave 2)
- [x] 03-03-PLAN.md — FileTreeNode download button + apiClient.downloadFile() + human checkpoint (Wave 2)

### Phase 4: File Operations
**Goal**: Admin can reorganize the network volume by deleting, moving, and renaming files and folders
**Depends on**: Phase 2
**Requirements**: FILEOP-01, FILEOP-02, FILEOP-03, FILEOP-04, FILEOP-05, FILEOP-06
**Success Criteria** (what must be TRUE):
  1. Admin can delete a file or folder with a confirmation dialog (recursive warning for folders)
  2. Critical system paths are protected and cannot be accidentally deleted
  3. Admin can move files between directories and rename files and folders on the volume
  4. Every file operation (delete, move, rename) shows clear success or failure feedback to the admin
**Plans**: 3 plans in 3 waves

Plans:
- [x] 04-01-PLAN.md — Backend service layer: PROTECTED_PATHS, delete_object, delete_folder, move_object, move_folder (Wave 1)
- [x] 04-02-PLAN.md — Backend API endpoints: DELETE /files, DELETE /folders, POST /files/move, POST /folders/move (Wave 2)
- [x] 04-03-PLAN.md — Frontend: apiClient methods + FileTreeNode Delete/Rename/Move buttons with confirmation modals (Wave 3)

### Phase 5: HuggingFace Integration
**Goal**: Admin can download AI models from HuggingFace directly to the RunPod network volume without a local intermediary
**Depends on**: Phase 3, Phase 4
**Requirements**: HF-01, HF-02, HF-03, HF-04, HF-05, HF-06, HF-07
**Success Criteria** (what must be TRUE):
  1. Admin can paste a HuggingFace model URL and the system validates it before starting download
  2. The model downloads directly from HuggingFace to the RunPod volume (server-to-server, no local download step)
  3. Download runs as a background job with progress tracking (percentage and file size) visible in the UI
  4. Admin can choose the target directory on the volume for the downloaded model
  5. System handles gated models by accepting HuggingFace authentication tokens
**Plans**: 3 plans in 3 waves

Plans:
- [x] 05-01-PLAN.md — Backend service + models + settings: hf_download_service.py, HFDownloadRequest/HFDownloadJobStatus models, HF_TOKEN setting, huggingface_hub dependency (Wave 1)
- [x] 05-02-PLAN.md — Backend API endpoints: POST /hf-download (start job) + GET /hf-download/{job_id} (poll status), wired into infrastructure router (Wave 2)
- [x] 05-03-PLAN.md — Frontend: apiClient methods + HFDownload component with progress polling + wired into Infrastructure page (Wave 3, has checkpoint)

### Phase 6: Dockerfile Editor
**Goal**: Admin can view and edit the workflow Dockerfile in-browser with a professional code editing experience
**Depends on**: Phase 1
**Requirements**: DOCKER-01, DOCKER-02, DOCKER-03, DOCKER-04, DOCKER-05, DOCKER-06, DOCKER-07
**Success Criteria** (what must be TRUE):
  1. Admin sees the configured Dockerfile fetched from GitHub (single file, path set in GITHUB_DOCKERFILE_PATH env var)
  2. Admin can edit the Dockerfile in a Monaco-based in-browser editor with Dockerfile syntax highlighting and line numbers
  3. Editor supports undo/redo (Monaco built-in) and indicates when the file has unsaved changes
  4. Admin can save changes by providing a custom commit message; change is committed to GitHub
**Plans**: 2 plans in 2 waves

Plans:
- [x] 06-01-PLAN.md — Backend: GitHubService (httpx), settings (GITHUB_TOKEN/REPO/BRANCH/DOCKERFILE_PATH), Pydantic models, GET+PUT /dockerfiles/content endpoints (Wave 1)
- [x] 06-02-PLAN.md — Frontend: @monaco-editor/react install, DockerfileEditor component (load/dirty-track/commit), apiClient methods, Infrastructure.tsx wiring + human checkpoint (Wave 2)

### Phase 6.1: File Tree Pagination (INSERTED — gap closure)
**Goal**: Close VOL-04 gap — admin can page through directories with more than 200 items; fix double API call on file operations
**Depends on**: Phase 6
**Requirements**: VOL-04
**Gap Closure**: Closes gaps from v1.0 audit (VOL-04 partial, double-call tech debt)
**Success Criteria** (what must be TRUE):
  1. Admin sees a "Load more" control when a directory has more than 200 items
  2. Clicking "Load more" appends the next page of items to the existing tree without losing expanded state
  3. File operations (delete/rename/move) trigger exactly one GET /files reload, not two
**Plans**: 1 plan in 1 wave

Plans:
- [x] 06.1-01-PLAN.md — FileTree + FileTreeNode pagination state and Load more buttons; Infrastructure.tsx refreshId fix replacing key remount (Wave 1)

### Phase 6.2: Verification Documentation (INSERTED — gap closure)
**Goal**: Create missing VERIFICATION.md files for phases 02, 03, and 06 — all were human-verified via checkpoint but lack formal documentation
**Depends on**: Phase 6
**Requirements**: None (documentation only — supports audit completeness)
**Gap Closure**: Closes 3 "unverified phase" flags from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. Phase 02 has VERIFICATION.md documenting code evidence for VOL-01 through VOL-05
  2. Phase 03 has VERIFICATION.md documenting code evidence for UPLOAD-01 through DWNLD-04
  3. Phase 06 has VERIFICATION.md documenting code evidence for DOCKER-01 through DOCKER-07
**Plans**: 1 plan in 1 wave

Plans:
- [x] 06.2-01-PLAN.md — Create VERIFICATION.md for phases 02, 03, and 06 with code-level evidence for all requirements (Wave 1) [SUMMARY](06.2-01-SUMMARY.md)

### Phase 7: GitHub Integration
**Goal**: Dockerfile changes commit and push to GitHub, triggering RunPod rebuilds, with secure credential handling
**Depends on**: Phase 6
**Requirements**: GIT-01, GIT-02, GIT-03, GIT-04, GIT-05, GIT-06
**Success Criteria** (what must be TRUE):
  1. Saving a Dockerfile in the editor commits the change to the correct GitHub branch
  2. The commit pushes to GitHub and triggers the RunPod rebuild pipeline
  3. GitHub credentials are stored securely server-side (encrypted, never exposed to frontend)
  4. System detects merge conflicts and aborts with a clear error message instead of silently corrupting the file
  5. Admin receives confirmation on successful push and a meaningful error message if push fails
**Plans**: 2 plans in 2 waves

Plans:
- [x] 07-01-PLAN.md — Backend: GitHubService.create_release() method, DockerfileSaveRequest.trigger_deploy field, extended save_dockerfile endpoint with optional release creation (Wave 1) [SUMMARY](07-01-SUMMARY.md)
- [x] 07-02-PLAN.md — Frontend: Deploy toggle checkbox in DockerfileEditor, apiClient.saveDockerfile() with triggerDeploy param, enhanced status messages + human checkpoint (Wave 2) [SUMMARY](07-02-SUMMARY.md)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 6.1 -> 6.2 -> 7
Note: Phase 6 depends only on Phase 1 and can run in parallel with Phases 2-5 if desired.
Note: Phases 6.1 and 6.2 are gap closure phases inserted after audit; they can run in parallel.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Admin Access Control | 4/4 | Complete | 2026-03-04 |
| 2. Network Volume File Browser | 4/4 | Complete | 2026-03-04 |
| 3. File Transfer | 3/3 | Complete   | 2026-03-04 |
| 4. File Operations | 3/3 | Complete   | 2026-03-04 |
| 5. HuggingFace Integration | 3/3 | Complete   | 2026-03-05 |
| 6. Dockerfile Editor | 2/2 | Complete   | 2026-03-05 |
| 6.1. File Tree Pagination | 1/1 | Complete    | 2026-03-08 |
| 6.2. Verification Documentation | 1/1 | Complete | 2026-03-08 |
| 7. GitHub Integration | 2/2 | Complete | 2026-03-09 |
