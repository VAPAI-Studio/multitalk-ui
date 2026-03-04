# Architecture Research: Infrastructure Management Tools

**Research Date:** 2026-03-04
**Dimension:** Architecture
**Question:** How are infrastructure management tools typically structured? What are major components?
**Milestone Context:** How do file browser, code editor, and GitHub integration features integrate with existing FastAPI + React architecture?

---

## 1. Component Inventory

The infrastructure management features decompose into six distinct components. Each is described with its boundaries, responsibilities, and integration surface.

### Component A: Network Volume File Browser

**Purpose:** Browse, navigate, and display the file/folder hierarchy of the RunPod S3-backed network volume.

**Boundaries:**
- Frontend: React tree/list view component rendering directory contents. Handles navigation, selection, breadcrumb trail.
- Backend: FastAPI endpoint that proxies file listing requests to RunPod's network volume. RunPod network volumes are S3-backed, so the backend uses either RunPod's volume management API or direct S3 `ListObjectsV2` calls.
- Does NOT perform file mutations (upload/delete/move are separate components).

**Inputs:** Directory path (string), pagination cursor (optional).
**Outputs:** Array of file/folder entries (name, type, size, modified date, path).

**Integration with existing architecture:**
- New API router: `backend/api/volume_browser.py` registered in `main.py`
- New service: `backend/services/volume_service.py` handling S3/RunPod volume API calls
- New frontend page: `frontend/src/pages/VolumeBrowser.tsx` (admin page)
- Follows existing pattern: API router delegates to service, service returns `(success, data, error)` tuples

---

### Component B: File Operations Service

**Purpose:** Execute mutations on the network volume: upload files from local machine, download files to local machine, move/rename files, delete files.

**Boundaries:**
- Frontend: Action buttons/menus in file browser UI. Upload uses drag-and-drop or file picker. Download triggers browser download.
- Backend: FastAPI endpoints for each operation. Uploads go through backend (multipart form) which streams to S3/volume. Downloads serve presigned S3 URLs or stream through backend.
- Large file handling: Multipart upload for files > 100MB. Chunked transfer encoding.

**Inputs:** Source path, destination path (for move), file bytes (for upload), file metadata.
**Outputs:** Operation result (success/error), updated file entry.

**Integration with existing architecture:**
- Extends `backend/api/volume_browser.py` or separate `backend/api/volume_ops.py`
- Uses `httpx.AsyncClient` for S3/RunPod API calls (same pattern as `runpod_service.py`)
- Upload endpoint follows existing `backend/api/storage.py` multipart pattern
- Reuses existing auth dependency `get_current_user` plus new admin check

---

### Component C: HuggingFace Direct Download

**Purpose:** Download models directly from HuggingFace to the RunPod network volume, avoiding the local-machine intermediary.

**Boundaries:**
- Frontend: Input field for HuggingFace URL/model ID, destination path selector (from file browser), download progress indicator.
- Backend: FastAPI endpoint that receives HF URL + destination path, then orchestrates server-to-server transfer. Backend streams from HuggingFace CDN directly to S3/volume. No data flows through the user's browser.
- Progress tracking: Backend creates an async job (similar to existing job tracking pattern) and frontend polls for progress.

**Inputs:** HuggingFace model URL or `org/model` identifier, destination path on volume, optional filename override.
**Outputs:** Job ID for tracking, completion status with file path.

**Integration with existing architecture:**
- New service: `backend/services/huggingface_service.py` for HF API interaction and streaming download
- Uses async streaming with `httpx.AsyncClient` for large model downloads (multi-GB)
- Job tracking: Can reuse existing Supabase job tables (new job type) or simpler in-memory tracking for admin operations
- New endpoint in volume operations router

---

### Component D: Dockerfile Editor

**Purpose:** In-browser code editor for viewing and modifying Dockerfile content for each workflow's RunPod handler.

**Boundaries:**
- Frontend: Code editor component with syntax highlighting (using Monaco Editor or CodeMirror). Displays Dockerfile content, allows editing, shows diff preview before save.
- Backend: FastAPI endpoints to read/write Dockerfile content. Dockerfiles are stored in a GitHub repository, so "read" fetches from GitHub API and "write" commits changes via GitHub API.
- Does NOT build Docker images. Does NOT deploy to RunPod directly. Push-to-GitHub triggers the existing CI/CD pipeline.

**Inputs:** Workflow name (to identify which Dockerfile), file content (on save).
**Outputs:** Dockerfile content (on read), commit result (on save/push).

**Integration with existing architecture:**
- Frontend: New page `frontend/src/pages/DockerfileEditor.tsx` with embedded code editor
- Code editor library: Add Monaco Editor (`@monaco-editor/react`) or CodeMirror to `frontend/package.json`
- Backend: New service `backend/services/github_service.py` for GitHub API interaction
- Backend: New router `backend/api/dockerfile.py` for read/write endpoints
- Template management: Backend reads base template + per-workflow overrides from GitHub

---

### Component E: GitHub Integration Service

**Purpose:** Manage GitHub repository interaction for Dockerfile storage and CI/CD triggering. Read files, create commits, push changes.

**Boundaries:**
- Backend only (no direct frontend-to-GitHub communication).
- Uses GitHub REST API v3 (or GraphQL v4) via `httpx.AsyncClient`.
- Handles: file read (`GET /repos/.../contents/...`), file update/create (`PUT /repos/.../contents/...`), commit creation.
- Stores GitHub Personal Access Token (PAT) or GitHub App credentials securely in environment variables.
- Push triggers existing GitHub Actions / RunPod webhook pipeline (no new CI/CD setup needed).

**Inputs:** Repository path, file path, file content, commit message.
**Outputs:** Commit SHA, file content, push result.

**Integration with existing architecture:**
- New config: `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` in `backend/config/settings.py`
- New service: `backend/services/github_service.py`
- Used by: Dockerfile Editor (Component D) backend endpoints
- Security: Token stored as env var (same pattern as `RUNPOD_API_KEY`, `OPENROUTER_API_KEY`)
- Never exposed to frontend; all GitHub operations go through backend API

---

### Component F: Admin Access Control

**Purpose:** Restrict infrastructure management features to admin users only.

**Boundaries:**
- Backend: New FastAPI dependency `get_admin_user()` that extends existing `get_current_user()` with admin role check.
- Frontend: Conditional rendering of admin navigation items. Admin status checked via user metadata from AuthContext.
- Admin determination: Supabase user_metadata field `is_admin: true` or email-domain-based (e.g., specific emails).

**Inputs:** JWT token (existing), user metadata.
**Outputs:** Authorized admin user or 403 Forbidden.

**Integration with existing architecture:**
- Extends `backend/core/auth.py` with new `get_admin_user` dependency
- Admin check queries Supabase `auth.users` metadata or a dedicated `admin_users` table
- Frontend: AuthContext already provides user object; add `isAdmin` derived property
- Navigation: `studioConfig.ts` gets new admin studio entry (conditionally rendered)

---

## 2. Data Flow

### File Browser Flow

```
User (Browser)
  |
  | GET /api/volume/browse?path=/models
  v
Frontend (VolumeBrowser.tsx)
  |
  | HTTP GET via apiClient.ts
  v
Backend (volume_browser.py router)
  |
  | Admin auth check (get_admin_user dependency)
  v
Backend (volume_service.py)
  |
  | S3 ListObjectsV2 or RunPod Volume API
  v
RunPod Network Volume (S3-backed)
  |
  | Returns: file list (key, size, last_modified)
  v
Backend transforms to FileEntry[] response
  |
  v
Frontend renders tree/list view
```

**Direction:** Frontend --> Backend --> RunPod/S3. Unidirectional request-response.

### File Upload Flow

```
User selects file(s)
  |
  | POST /api/volume/upload (multipart/form-data)
  | body: file bytes + destination_path
  v
Backend (volume_ops.py router)
  |
  | Admin auth check
  | Stream chunks (avoid loading entire file in memory)
  v
Backend (volume_service.py)
  |
  | S3 PutObject / Multipart Upload
  v
RunPod Network Volume
  |
  | Returns: success + file metadata
  v
Backend returns FileEntry response
  |
  v
Frontend updates file browser view
```

**Direction:** Frontend --> Backend --> S3. Streaming upload.

### HuggingFace Download Flow

```
User pastes HF URL + selects destination
  |
  | POST /api/volume/hf-download
  | body: { hf_url, destination_path }
  v
Backend (volume_ops.py router)
  |
  | Admin auth check
  | Creates download job record
  v
Backend (huggingface_service.py) [async background task]
  |
  | 1. Resolve HF model files (HF API)
  | 2. Stream download from HF CDN
  | 3. Stream upload to S3/volume
  v
HuggingFace CDN  -->  RunPod Network Volume (S3)
                      (server-to-server, no browser involvement)
  |
  | Progress updates stored in job record
  v
Frontend polls GET /api/volume/hf-download/{job_id}/status
  |
  v
UI shows progress bar
```

**Direction:** Backend orchestrates HF --> S3 transfer. Frontend only sends command and polls status.

### Dockerfile Edit and Deploy Flow

```
User opens Dockerfile Editor
  |
  | GET /api/dockerfile/{workflow_name}
  v
Backend (dockerfile.py router)
  |
  | Admin auth check
  v
Backend (github_service.py)
  |
  | GitHub API: GET /repos/{owner}/{repo}/contents/{path}
  v
GitHub Repository
  |
  | Returns: file content (base64 encoded), SHA
  v
Backend decodes, returns content string
  |
  v
Frontend renders in Monaco/CodeMirror editor

... User edits ...

User clicks "Save & Deploy"
  |
  | PUT /api/dockerfile/{workflow_name}
  | body: { content, commit_message }
  v
Backend (dockerfile.py router)
  |
  | Admin auth check
  v
Backend (github_service.py)
  |
  | GitHub API: PUT /repos/{owner}/{repo}/contents/{path}
  | (includes file SHA for conflict detection)
  v
GitHub Repository
  |
  | Commit created, push triggers CI/CD
  v
GitHub Actions / RunPod webhook
  |
  | Automatic Docker build + deploy
  v
RunPod Serverless Endpoint updated

Backend returns { success, commit_sha }
  |
  v
Frontend shows "Deployed successfully" with commit link
```

**Direction:** Frontend <--> Backend <--> GitHub --> RunPod (async CI/CD).

### State Management Flow (Frontend)

```
AuthContext (existing)
  |
  | Provides: user, token, isAdmin (new property)
  v
App.tsx
  |
  | Conditional admin navigation in sidebar
  | (only if user.isAdmin === true)
  v
Admin Pages (VolumeBrowser, DockerfileEditor)
  |
  | Use apiClient for all backend calls
  | Admin endpoints return 403 for non-admin users
  v
Volume state managed locally in page components
(no new React Context needed - admin pages are independent)
```

---

## 3. Integration Surface with Existing Architecture

### Backend Integration Points

| Existing Layer | New Addition | Integration Method |
|---|---|---|
| `main.py` (router registration) | `volume_browser.py`, `volume_ops.py`, `dockerfile.py` routers | `app.include_router(router, prefix="/api")` |
| `config/settings.py` | New env vars: `GITHUB_TOKEN`, `GITHUB_REPO_*`, `RUNPOD_VOLUME_*`, S3 credentials | Add properties to `Settings` class |
| `core/auth.py` | `get_admin_user()` dependency | New function using existing `get_current_user()` + admin check |
| `services/` directory | `volume_service.py`, `github_service.py`, `huggingface_service.py` | New service classes following existing `(success, data, error)` tuple pattern |
| `models/` directory | `volume.py` (FileEntry, UploadRequest, etc.) | New Pydantic models following existing naming patterns |

### Frontend Integration Points

| Existing Layer | New Addition | Integration Method |
|---|---|---|
| `lib/studioConfig.ts` | Admin studio config entry | New studio with conditional visibility based on `isAdmin` |
| `lib/apiClient.ts` | Volume/Dockerfile/GitHub API methods | Add methods to existing `ApiClient` class |
| `contexts/AuthContext.tsx` | `isAdmin` property on user state | Derive from user metadata in existing auth state |
| `App.tsx` | Admin page routing | Add to `validPages` type and conditional rendering |
| `package.json` | Monaco Editor dependency | `npm install @monaco-editor/react` |

### External Service Integration Points

| Service | Access Method | Credentials |
|---|---|---|
| RunPod Network Volume (S3) | `boto3` or `httpx` with S3-compatible API | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT_URL` for RunPod S3 |
| GitHub API | `httpx.AsyncClient` to `api.github.com` | `GITHUB_TOKEN` (PAT or App token) |
| HuggingFace Hub | `httpx.AsyncClient` to `huggingface.co` | `HF_TOKEN` (optional, for gated models) |

---

## 4. Suggested Build Order

The components have clear dependencies that dictate build order. Each phase below can be completed and tested independently before starting the next.

### Phase 1: Foundation (Admin Access + Volume Service)

**Build:** Component F (Admin Access Control) + Component A (File Browser) core backend

**Rationale:** Admin access control is a prerequisite for all other components. The volume service establishes the S3/RunPod connection that file operations, HuggingFace downloads, and model assignment all depend on.

**Dependencies:** None (uses existing auth system as base).

**Deliverables:**
1. `get_admin_user()` backend dependency
2. `isAdmin` frontend property in AuthContext
3. `volume_service.py` with S3 list/browse operations
4. `volume_browser.py` API router with browse endpoint
5. Basic `VolumeBrowser.tsx` page with directory listing
6. Admin navigation entry in `studioConfig.ts`

**Testing checkpoint:** Admin user can browse network volume directory tree. Non-admin users get 403.

---

### Phase 2: File Operations

**Build:** Component B (File Operations Service)

**Rationale:** Once browsing works, add mutations: upload, download, move, rename, delete. These are self-contained operations on the same S3 backend.

**Dependencies:** Phase 1 (volume service + admin auth + file browser UI).

**Deliverables:**
1. Upload endpoint with multipart streaming
2. Download endpoint (presigned URL or stream)
3. Move/rename endpoint
4. Delete endpoint (with confirmation)
5. UI actions in file browser (context menu, drag-and-drop upload)

**Testing checkpoint:** Admin can upload a file, see it in the browser, rename it, move it to a different directory, download it, and delete it.

---

### Phase 3: HuggingFace Integration

**Build:** Component C (HuggingFace Direct Download)

**Rationale:** Builds on the volume service (Phase 1) and file operations (Phase 2). Adds server-to-server streaming and async job tracking.

**Dependencies:** Phase 1 (volume service for S3 write), Phase 2 (file browser for destination selection and verification).

**Deliverables:**
1. `huggingface_service.py` with model resolution and streaming download
2. HF download endpoint with async background task
3. Progress tracking (job-based or in-memory)
4. UI: HF URL input, destination selector, progress bar
5. Model assignment metadata (which workflows use which models)

**Testing checkpoint:** Admin pastes a HuggingFace model URL, selects destination folder, initiates download, sees progress, and finds the file in the volume browser after completion.

---

### Phase 4: GitHub Integration + Dockerfile Editor

**Build:** Component E (GitHub Integration) + Component D (Dockerfile Editor)

**Rationale:** These two components are tightly coupled (editor reads/writes via GitHub service). They are independent of the volume management components (Phases 1-3), so they could theoretically be built in parallel with Phase 2-3, but sequential ordering is simpler for a single developer.

**Dependencies:** Phase 1 (admin auth only). Does NOT depend on Phases 2-3.

**Deliverables:**
1. `github_service.py` with read/write/commit operations
2. `dockerfile.py` API router for Dockerfile CRUD
3. Base template + per-workflow override reading
4. `DockerfileEditor.tsx` page with Monaco Editor
5. Save & commit with auto-push to trigger CI/CD
6. Diff preview before committing
7. Commit history viewer (last N commits for the Dockerfile)

**Testing checkpoint:** Admin opens a workflow's Dockerfile, edits it, previews the diff, commits with a message, and sees the commit appear in GitHub. RunPod rebuild triggers automatically.

---

### Dependency Graph

```
Phase 1: Admin Access + Volume Browse
    |
    +---> Phase 2: File Operations
    |         |
    |         +---> Phase 3: HuggingFace Download
    |
    +---> Phase 4: GitHub + Dockerfile Editor
              (independent of Phases 2-3)
```

**Critical path:** Phase 1 --> Phase 2 --> Phase 3 (volume management track)
**Parallel track:** Phase 1 --> Phase 4 (Dockerfile track, can run alongside Phase 2-3)

---

## 5. Technical Decisions and Patterns

### S3 Access Strategy

RunPod network volumes are S3-compatible. Two approaches:

**Option A: Direct S3 Access (Recommended)**
- Use `boto3` or `aiobotocore` with RunPod's S3 endpoint
- Full control over operations (list, put, get, delete, multipart upload)
- Better performance for large file transfers
- Requires S3 credentials (access key, secret key, endpoint URL)

**Option B: RunPod Pod-Based Access**
- Spin up a temporary pod with volume mounted
- Execute file operations via SSH/exec
- More complex, slower, costly (pod compute charges)
- Only needed if S3 API is not available

Decision should be validated: confirm RunPod provides direct S3 credentials for network volumes.

### Code Editor Library

**Monaco Editor (Recommended)**
- Same editor as VS Code, rich feature set
- Dockerfile syntax highlighting built-in
- `@monaco-editor/react` package (well maintained, 1.5M+ weekly downloads)
- Adds ~2MB to bundle (acceptable for admin-only page, can be lazy-loaded)

**Alternative: CodeMirror 6**
- Lighter weight (~500KB)
- Good Dockerfile support via language package
- More modular, but more setup required

### Background Task Pattern for HF Downloads

Large model downloads (multi-GB) cannot be synchronous HTTP requests. Options:

**Option A: FastAPI BackgroundTasks (Simple, Recommended for MVP)**
- Use `BackgroundTasks` from FastAPI
- Store progress in in-memory dict (admin is single-user, no persistence needed)
- Frontend polls a status endpoint
- Limitation: Progress lost on server restart

**Option B: Celery/Redis Task Queue (Production-grade)**
- More robust, survives restarts
- Overkill for single-admin use case
- Adds infrastructure dependencies (Redis)

**Recommendation:** Start with Option A. Migrate to Option B only if multiple admins or reliability becomes critical.

### Admin Role Storage

**Option A: Supabase user_metadata (Recommended)**
- Store `{ "is_admin": true }` in existing `auth.users.raw_user_meta_data`
- No new tables needed
- Set via Supabase dashboard or migration
- AuthContext already reads user metadata

**Option B: Dedicated admin_users table**
- Separate table with user IDs
- More flexible (roles, permissions)
- Overkill for current binary admin/non-admin requirement

---

## 6. Risk Areas

### Network Volume S3 Access Uncertainty

RunPod's S3 API availability for network volumes needs validation. If direct S3 access is not available, the fallback is a "file management pod" approach which significantly complicates the architecture.

**Mitigation:** Validate S3 access first (Phase 1 spike). If unavailable, consider a lightweight persistent pod approach with a file management API.

### Large File Upload Memory Pressure

Uploading multi-GB model files through the FastAPI backend could exhaust server memory if not streamed properly.

**Mitigation:** Use streaming uploads with `httpx` and `python-multipart`. Never load entire file into memory. Set upload size limits in Nginx/proxy layer.

### GitHub API Rate Limits

GitHub API has rate limits (5000 requests/hour for authenticated users). Dockerfile reads/writes are low-volume but should be cached.

**Mitigation:** Cache Dockerfile content on read (invalidate on write). Single admin user won't hit limits under normal use.

### Heroku Deployment Constraints

Heroku dynos have 30-second request timeout and 512MB memory. Large file uploads and HuggingFace downloads will exceed these.

**Mitigation:** HF downloads use background tasks (not HTTP request duration). File uploads may need chunked approach or direct-to-S3 presigned URL pattern (frontend uploads directly to S3, bypassing Heroku).

---

## Quality Gate Checklist

- [x] Components clearly defined with boundaries (6 components with explicit inputs/outputs/boundaries)
- [x] Data flow direction explicit (5 detailed flow diagrams with directional arrows)
- [x] Build order implications noted (4 phases with dependency graph and critical path)

---

*Research completed: 2026-03-04*
