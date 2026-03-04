# Roadmap: sideOUTsticks Infrastructure Management

## Overview

This roadmap delivers admin-only infrastructure management for RunPod serverless workflows within the existing sideOUTsticks platform. The journey starts with access control (the hard prerequisite), builds up a complete network volume file management system (browse, transfer, mutate), adds HuggingFace direct-to-volume downloads (the highest-value differentiator), then delivers an independent Dockerfile editing and GitHub deployment pipeline. Two independent tracks emerge after admin auth: file management (Phases 2-5) and Dockerfile/deploy (Phases 6-7), which can execute in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Admin Access Control** - Restrict infrastructure features to admin users with server-enforced authorization
- [ ] **Phase 2: Network Volume File Browser** - Browse and navigate RunPod network volume files in a hierarchical tree
- [ ] **Phase 3: File Transfer** - Upload files to and download files from the RunPod network volume
- [ ] **Phase 4: File Operations** - Delete, move, and rename files and folders on the network volume
- [ ] **Phase 5: HuggingFace Integration** - Download models from HuggingFace directly to the RunPod network volume
- [ ] **Phase 6: Dockerfile Editor** - Edit workflow Dockerfiles in-browser with syntax highlighting
- [ ] **Phase 7: GitHub Integration** - Push Dockerfile changes to GitHub to trigger RunPod rebuilds

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
- [ ] 02-01: Backend S3 Foundation (Wave 1) — S3 client singleton, InfrastructureService with list_files(), GET /api/infrastructure/files endpoint with pagination
- [ ] 02-02: Frontend File Tree Component (Wave 2) — Custom tree UI with FileTreeNode and FileTree components, lazy loading, apiClient.listFiles() method
- [ ] 02-03: Integration and Polish (Wave 3) — Breadcrumb navigation, refresh functionality, enhanced health endpoint with S3 connectivity check

### Phase 3: File Transfer
**Goal**: Admin can move files between local machine and RunPod network volume in both directions
**Depends on**: Phase 2
**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04, UPLOAD-05, DWNLD-01, DWNLD-02, DWNLD-03, DWNLD-04
**Success Criteria** (what must be TRUE):
  1. Admin can upload a file from local machine to a chosen directory on the RunPod volume
  2. Uploads handle files up to 10GB using chunked/multipart transfer with a progress bar showing percentage and estimated time
  3. Uploads survive network interruptions gracefully (retry or resume without losing progress)
  4. Admin can download any file from the volume to local machine via presigned S3 URL (streaming, no backend buffering)
  5. Downloads work for files of any size without timeout and admin sees download initiation confirmation
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: File Operations
**Goal**: Admin can reorganize the network volume by deleting, moving, and renaming files and folders
**Depends on**: Phase 2
**Requirements**: FILEOP-01, FILEOP-02, FILEOP-03, FILEOP-04, FILEOP-05, FILEOP-06
**Success Criteria** (what must be TRUE):
  1. Admin can delete a file or folder with a confirmation dialog (recursive warning for folders)
  2. Critical system paths are protected and cannot be accidentally deleted
  3. Admin can move files between directories and rename files and folders on the volume
  4. Every file operation (delete, move, rename) shows clear success or failure feedback to the admin
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

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
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Dockerfile Editor
**Goal**: Admin can view and edit workflow Dockerfiles in-browser with a professional code editing experience
**Depends on**: Phase 1
**Requirements**: DOCKER-01, DOCKER-02, DOCKER-03, DOCKER-04, DOCKER-05, DOCKER-06, DOCKER-07
**Success Criteria** (what must be TRUE):
  1. Admin sees a list of Dockerfiles fetched from the GitHub repository
  2. Admin can open any Dockerfile in a Monaco-based in-browser editor with Dockerfile syntax highlighting and line numbers
  3. Editor supports undo/redo and indicates when the file has unsaved changes
  4. Admin can save changes by providing a custom commit message
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

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
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
Note: Phase 6 depends only on Phase 1 and can run in parallel with Phases 2-5 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Admin Access Control | 4/4 | ✅ Complete | 2026-03-04 |
| 2. Network Volume File Browser | 0/3 | Planned | - |
| 3. File Transfer | 0/3 | Not started | - |
| 4. File Operations | 0/2 | Not started | - |
| 5. HuggingFace Integration | 0/3 | Not started | - |
| 6. Dockerfile Editor | 0/3 | Not started | - |
| 7. GitHub Integration | 0/2 | Not started | - |
