# Requirements: sideOUTsticks Infrastructure Management

**Defined:** 2026-03-04
**Core Value:** Enable self-service infrastructure management for RunPod serverless workflows without leaving the application

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Admin Access Control

- [x] **ADMIN-01**: Admin user can access infrastructure management pages
- [x] **ADMIN-02**: Non-admin users cannot see or access infrastructure management features
- [x] **ADMIN-03**: Admin role is determined by Supabase user metadata flag
- [x] **ADMIN-04**: Backend API endpoints enforce admin-only access with 403 responses for non-admins

### Network Volume File Browser

- [x] **VOL-01**: Admin can view hierarchical tree of files and folders on RunPod network volume
- [x] **VOL-02**: File browser displays file name, size (human-readable), and last modified date
- [x] **VOL-03**: Admin can expand and collapse folders without page reload
- [x] **VOL-04**: File browser handles directories with 10,000+ files without crashing (pagination)
- [x] **VOL-05**: Admin can navigate to any path level in the volume

### File Upload

- [x] **UPLOAD-01**: Admin can upload files from local machine to RunPod network volume
- [x] **UPLOAD-02**: File upload supports files up to 10GB using chunked/multipart upload
- [x] **UPLOAD-03**: Upload progress indicator shows percentage and estimated time remaining
- [x] **UPLOAD-04**: Admin can select target directory before uploading
- [x] **UPLOAD-05**: Upload handles network interruptions gracefully (retry or resume)

### File Download

- [x] **DWNLD-01**: Admin can download files from RunPod network volume to local machine
- [x] **DWNLD-02**: Download uses presigned S3 URLs with streaming (no backend buffering)
- [x] **DWNLD-03**: Admin receives download initiation confirmation
- [x] **DWNLD-04**: Download works for files of any size without timeout

### File Operations

- [x] **FILEOP-01**: Admin can delete individual files with confirmation dialog
- [x] **FILEOP-02**: Admin can delete folders with recursive deletion warning
- [x] **FILEOP-03**: Critical system paths are protected from accidental deletion
- [x] **FILEOP-04**: Admin can move files between directories on the volume
- [x] **FILEOP-05**: Admin can rename files and folders
- [x] **FILEOP-06**: File operations show success/failure feedback to admin

### HuggingFace Integration

- [ ] **HF-01**: Admin can paste HuggingFace model URL into download interface
- [x] **HF-02**: System validates HuggingFace URL before starting download
- [x] **HF-03**: System downloads HuggingFace model directly to RunPod network volume (no local intermediary)
- [x] **HF-04**: Download progress shows percentage and file size being downloaded
- [x] **HF-05**: HuggingFace downloads run as background jobs (not blocking HTTP requests)
- [ ] **HF-06**: Admin can select target directory on volume for downloaded model
- [x] **HF-07**: System handles HuggingFace authentication for gated models

### Dockerfile Editor

- [ ] **DOCKER-01**: Admin can view list of Dockerfiles from GitHub repository
- [ ] **DOCKER-02**: Admin can open Dockerfile in in-browser code editor
- [ ] **DOCKER-03**: Code editor displays Dockerfile syntax highlighting (FROM, RUN, COPY, ENV, etc.)
- [ ] **DOCKER-04**: Code editor shows line numbers
- [ ] **DOCKER-05**: Code editor supports undo/redo operations
- [ ] **DOCKER-06**: Editor indicates when file has unsaved changes
- [ ] **DOCKER-07**: Admin can save Dockerfile changes with custom commit message

### GitHub Integration

- [ ] **GIT-01**: System commits Dockerfile changes to GitHub repository
- [ ] **GIT-02**: System pushes commit to correct branch (triggers RunPod rebuild)
- [ ] **GIT-03**: GitHub credentials stored securely (encrypted, server-side only)
- [ ] **GIT-04**: System detects merge conflicts and aborts with error message
- [ ] **GIT-05**: Admin receives confirmation when push succeeds
- [ ] **GIT-06**: System provides meaningful error message if push fails

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dockerfile Templates

- **TMPL-01**: System provides base Dockerfile template
- **TMPL-02**: Admin can create per-workflow customizations on top of base template
- **TMPL-03**: System shows diff between base and customized template

### Model Management

- **MODEL-01**: Admin can assign downloaded models to specific workflows
- **MODEL-02**: Admin can view which models are used by which workflows
- **MODEL-03**: System warns before deleting models that are assigned to workflows

### Advanced File Operations

- **BULK-01**: Admin can select multiple files for bulk operations
- **BULK-02**: Admin can delete multiple files in one operation
- **BULK-03**: Admin can move multiple files to different directory
- **SEARCH-01**: Admin can search files by name
- **SEARCH-02**: Admin can filter files by type or modification date
- **FOLDER-01**: Admin can create new folders on network volume

### Auditing

- **AUDIT-01**: System logs all file operations (who, what, when)
- **AUDIT-02**: System logs all Dockerfile edits and GitHub pushes
- **AUDIT-03**: Admin can view audit log with filters

### Deployment Tracking

- **DEPLOY-01**: System shows GitHub commit status (pending/success/failure)
- **DEPLOY-02**: System shows RunPod rebuild progress after GitHub push
- **DEPLOY-03**: Admin receives notification when rebuild completes

### Editor Enhancements

- **EDIT-01**: Editor shows diff view before committing changes
- **EDIT-02**: System validates Dockerfile syntax before allowing commit
- **EDIT-03**: Editor supports multiple tabs for editing multiple Dockerfiles

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time collaborative editing | Single admin use case, no multi-user editing needed |
| Version control UI (history, branches, PRs) | GitHub already provides this, just edit and push |
| Full RunPod dashboard recreation | Only need file management and Dockerfile editing, not metrics/logs/billing |
| Automated model optimization or conversion | Manual download and deployment is sufficient |
| RunPod job orchestration | Out of scope - app already has job tracking for AI workflows |
| Direct S3 bucket management | Only managing RunPod network volume, not arbitrary S3 buckets |
| File preview/rendering (images, PDFs) | Not needed for model files and Dockerfiles |
| Drag-and-drop file upload from desktop | Standard file picker is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ADMIN-01 | Phase 1 | Complete |
| ADMIN-02 | Phase 1 | Complete |
| ADMIN-03 | Phase 1 | Complete |
| ADMIN-04 | Phase 1 | Complete |
| VOL-01 | Phase 2 | Complete |
| VOL-02 | Phase 2 | Complete |
| VOL-03 | Phase 2 | Complete |
| VOL-04 | Phase 2 | Complete |
| VOL-05 | Phase 2 | Complete |
| UPLOAD-01 | Phase 3 | Complete |
| UPLOAD-02 | Phase 3 | Complete |
| UPLOAD-03 | Phase 3 | Complete |
| UPLOAD-04 | Phase 3 | Complete |
| UPLOAD-05 | Phase 3 | Complete |
| DWNLD-01 | Phase 3 | Complete |
| DWNLD-02 | Phase 3 | Complete |
| DWNLD-03 | Phase 3 | Complete |
| DWNLD-04 | Phase 3 | Complete |
| FILEOP-01 | Phase 4 | Complete |
| FILEOP-02 | Phase 4 | Complete |
| FILEOP-03 | Phase 4 | Complete |
| FILEOP-04 | Phase 4 | Complete |
| FILEOP-05 | Phase 4 | Complete |
| FILEOP-06 | Phase 4 | Complete |
| HF-01 | Phase 5 | Pending |
| HF-02 | Phase 5 | Complete |
| HF-03 | Phase 5 | Complete |
| HF-04 | Phase 5 | Complete |
| HF-05 | Phase 5 | Complete |
| HF-06 | Phase 5 | Pending |
| HF-07 | Phase 5 | Complete |
| DOCKER-01 | Phase 6 | Pending |
| DOCKER-02 | Phase 6 | Pending |
| DOCKER-03 | Phase 6 | Pending |
| DOCKER-04 | Phase 6 | Pending |
| DOCKER-05 | Phase 6 | Pending |
| DOCKER-06 | Phase 6 | Pending |
| DOCKER-07 | Phase 6 | Pending |
| GIT-01 | Phase 7 | Pending |
| GIT-02 | Phase 7 | Pending |
| GIT-03 | Phase 7 | Pending |
| GIT-04 | Phase 7 | Pending |
| GIT-05 | Phase 7 | Pending |
| GIT-06 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
