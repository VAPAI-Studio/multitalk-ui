# Feature Research: Infrastructure Management Admin Interface

**Research Date:** 2026-03-04
**Domain:** Infrastructure management tools for AI/ML serverless platforms
**Project Context:** Admin interface within sideOUTsticks (multitalk-ui) for managing RunPod network volume files and Dockerfile deployment pipelines

---

## Context Summary

sideOUTsticks is an AI media processing platform (lipsync, video generation, image editing) that uses RunPod serverless as a cloud execution backend. Currently, managing RunPod infrastructure (network volume files, Dockerfiles, model deployment) requires context switching to RunPod's web UI, GitHub, and HuggingFace. The goal is to build admin tools directly into the existing app so a single admin user can manage the entire workflow from one interface.

The target user is a technical admin (likely the platform owner or a small ops team) who needs to:
1. Browse and manage files on an S3-backed RunPod network volume
2. Download AI models from HuggingFace directly to the volume (no local intermediary)
3. Edit Dockerfiles in-browser with syntax highlighting
4. Push changes to GitHub to trigger automated RunPod rebuilds

---

## Table Stakes Features

These are features that any infrastructure file management tool must have. Without them, users will simply continue using the RunPod web UI, a terminal, or their IDE -- there is no reason to adopt this tool.

### TS-1: File Browser with Tree Navigation

**Description:** Hierarchical tree view of the RunPod network volume file system, showing folders and files with names, sizes, and modification dates.

**Why table stakes:** Every file management interface (Finder, Explorer, S3 consoles, RunPod's own UI) provides this. Users cannot manage files they cannot see. The RunPod web UI already has a basic version; ours must at least match it.

**Complexity:** Medium
- Backend: API endpoint wrapping S3 ListObjectsV2 (RunPod network volumes are S3-backed)
- Frontend: Tree component with expand/collapse, lazy loading for large directories
- Pagination required for directories with 1000+ files (S3 returns max 1000 keys per request)

**Dependencies:** RunPod API access or direct S3 access to the network volume; admin access control (TS-8)

**Acceptance criteria:**
- List files and folders at any path level
- Show file name, size (human-readable), and last modified date
- Expand/collapse folders without full page reload
- Handle volumes with 10,000+ files without crashing

---

### TS-2: File Upload to Network Volume

**Description:** Upload files from the admin's local machine to a specific path on the RunPod network volume.

**Why table stakes:** The primary use case for file management is getting models and configuration files onto the volume. Without upload, the tool has no write capability.

**Complexity:** Medium-High
- Must handle large files (AI models are often 2-10GB)
- Needs chunked/multipart upload to avoid timeouts
- Progress indicator required for long uploads
- Backend must proxy or sign uploads to S3

**Dependencies:** TS-1 (need to see where you're uploading to), admin access control (TS-8)

**Acceptance criteria:**
- Upload files up to 10GB
- Show upload progress percentage
- Allow selecting target directory
- Handle network interruptions gracefully (retry or resume)
- Validate file before upload starts (check available space if possible)

---

### TS-3: File Download from Network Volume

**Description:** Download files from the RunPod network volume to the admin's local machine.

**Why table stakes:** Admins need to inspect files, back up configurations, or retrieve outputs. Without download, the file browser is read-only and incomplete.

**Complexity:** Low-Medium
- Generate presigned S3 URL and redirect browser download
- Handle large files via streaming
- Consider ZIP download for multiple files

**Dependencies:** TS-1 (need to browse to find the file), admin access control (TS-8)

**Acceptance criteria:**
- Download individual files of any size
- Stream download (don't buffer entire file in backend memory)
- Show download initiation confirmation

---

### TS-4: File Delete Operations

**Description:** Delete files and empty folders on the RunPod network volume.

**Why table stakes:** Disk space on network volumes costs money ($0.10/GB/month). Admins must remove unused models and temporary files. Without delete, cleanup requires going to RunPod UI.

**Complexity:** Low
- S3 DeleteObject API call
- Confirmation dialog to prevent accidental deletion
- Recursive delete for non-empty folders (with explicit warning)

**Dependencies:** TS-1 (need to see files to delete them), admin access control (TS-8)

**Acceptance criteria:**
- Delete individual files with confirmation
- Delete folders (with recursive warning)
- Cannot accidentally delete critical system files (protect known paths)
- Show success/failure feedback

---

### TS-5: Dockerfile Editor with Syntax Highlighting

**Description:** In-browser code editor for Dockerfiles stored in the GitHub repository (under `backend/runpod_handlers/` or similar paths). Must have syntax highlighting, line numbers, and basic editing capabilities.

**Why table stakes:** The stated pain point is "context switching to IDE or GitHub UI to edit Dockerfiles." A plain textarea with no syntax highlighting is unusable for Dockerfile editing. Every cloud platform (AWS, GCP, Vercel) that offers in-browser editing provides at minimum syntax highlighting.

**Complexity:** Medium
- Use a proven editor component (CodeMirror or Monaco)
- Dockerfile syntax highlighting (FROM, RUN, COPY, ENV, etc.)
- Load file content from GitHub API
- Save triggers a commit + push (see TS-6)

**Dependencies:** GitHub API integration (TS-6), admin access control (TS-8)

**Acceptance criteria:**
- Load Dockerfile content from GitHub repository
- Syntax highlighting for Dockerfile commands
- Line numbers
- Basic editing (type, delete, copy/paste, undo/redo)
- Indicate unsaved changes
- Save with commit message

---

### TS-6: GitHub Push Integration

**Description:** When a Dockerfile is saved in the editor, automatically commit and push the change to the GitHub repository. This triggers the existing RunPod rebuild pipeline.

**Why table stakes:** The entire value proposition of the Dockerfile editor depends on being able to deploy changes. If admins have to manually push after editing, they might as well use their IDE. The PROJECT.md explicitly states: "Edit Dockerfile -> in-browser with syntax highlighting, Auto-deploy -> push to GitHub triggers RunPod rebuild."

**Complexity:** Medium-High
- GitHub API (Contents API or Git Data API) for creating commits
- PAT (Personal Access Token) or GitHub App for authentication
- Secure credential storage (never plaintext, never in frontend)
- Commit message composition (default + custom override)
- Handle merge conflicts (at minimum: detect and abort with message)

**Dependencies:** TS-5 (editor provides the content to push), secure credential management, admin access control (TS-8)

**Acceptance criteria:**
- Push changes to correct branch in GitHub repository
- Include meaningful commit message (auto-generated or user-provided)
- Handle authentication securely (token never exposed to frontend)
- Detect and report push failures (merge conflicts, auth failures)
- Show confirmation of successful push with link to commit

---

### TS-7: File Move and Rename

**Description:** Move files between directories and rename files on the RunPod network volume.

**Why table stakes:** Basic file management. Without move/rename, organizing models after download requires delete + re-upload, which is impractical for multi-GB files.

**Complexity:** Low
- S3 CopyObject + DeleteObject for move (S3 has no native move)
- For rename, same pattern (copy to new key, delete old key)
- For large files, use multipart copy

**Dependencies:** TS-1 (browse to find files), admin access control (TS-8)

**Acceptance criteria:**
- Rename files in place
- Move files between directories
- Handle large files (multipart copy for files >5GB)
- Show progress for large file moves

---

### TS-8: Admin Access Control

**Description:** Restrict all infrastructure management features to users with an admin role. Regular users should not see or access any of these features.

**Why table stakes:** Infrastructure management can delete production models, modify Dockerfiles, and trigger deployments. Exposing these to all users would be a critical security vulnerability. The PROJECT.md explicitly lists this as a constraint: "Infrastructure management features are admin-only."

**Complexity:** Medium
- Add admin role to user model (Supabase user_metadata or separate admin table)
- Backend middleware/dependency to check admin status on all admin endpoints
- Frontend: conditionally render admin navigation items
- Must work with existing Supabase JWT auth system

**Dependencies:** Existing authentication system (already implemented)

**Acceptance criteria:**
- Admin-only routes return 403 for non-admin users
- Admin UI elements hidden from non-admin users
- Admin status not solely controlled by frontend (server enforces)
- At least one mechanism to designate admins (e.g., Supabase user_metadata, environment variable whitelist, or admin table)

---

## Differentiating Features

These features would make this tool meaningfully better than the alternatives (RunPod UI, terminal, IDE). They justify building a custom interface rather than just using existing tools.

### D-1: HuggingFace Direct Download to Volume

**Description:** Paste a HuggingFace model URL (e.g., `https://huggingface.co/stabilityai/sdxl-turbo/blob/main/sd_xl_turbo_1.0.safetensors`), and the system downloads the model directly from HuggingFace to the RunPod network volume -- without routing through the admin's local machine or the backend server.

**Why differentiating:** This eliminates the biggest pain point: downloading multi-GB models locally, then re-uploading to RunPod. No existing tool in RunPod's interface does this. It turns a 30-60 minute process into a 2-5 minute one.

**Complexity:** High
- Parse HuggingFace URLs to extract repo, revision, and filename
- Use HuggingFace Hub API to get direct download URLs
- Trigger download on a RunPod pod (via a utility endpoint or ephemeral job) that writes directly to the network volume
- OR: Use a backend service that streams from HuggingFace to S3 without buffering the whole file
- Progress tracking for multi-GB downloads
- Handle gated models (require HuggingFace token)

**Dependencies:** TS-1 (select target directory), TS-8 (admin only), RunPod job submission capability (existing)

**Acceptance criteria:**
- Accept HuggingFace model URLs
- Download directly to specified path on volume (not via admin's machine)
- Show download progress
- Handle models up to 20GB
- Support gated/private models via HuggingFace token
- Resume interrupted downloads if possible

---

### D-2: Model-to-Workflow Assignment

**Description:** After downloading a model, assign it to specific workflows. This configures which RunPod endpoints use which models, stored as metadata that the admin can reference when editing Dockerfiles or deploying.

**Why differentiating:** Closes the loop between "I downloaded a model" and "my workflow uses this model." Currently this requires manually editing Dockerfiles and configuration files in multiple places.

**Complexity:** Medium
- Data model: mapping of model paths to workflow names
- Store in Supabase (admin-managed table)
- UI: Select model from file browser, assign to workflow(s) from dropdown
- Used as reference when editing Dockerfiles (show which models each workflow needs)

**Dependencies:** TS-1 (browse models), D-1 (download models), workflow configuration (existing `runpod_endpoints.py`)

**Acceptance criteria:**
- Assign one model to multiple workflows
- View which models are assigned to which workflows
- When editing a Dockerfile, see the list of required models for that workflow
- Persist assignments in database (not just local state)

---

### D-3: Base Template System for Dockerfiles

**Description:** Manage a base Dockerfile template that all workflow-specific Dockerfiles inherit from. Per-workflow customization adds only the delta (additional models, custom nodes, etc.) on top of the base.

**Why differentiating:** Reduces duplication across Dockerfiles. When a base dependency changes (e.g., ComfyUI version), update once rather than in every Dockerfile. The PROJECT.md explicitly calls this out: "Base template + per-workflow customization pattern."

**Complexity:** Medium-High
- Template inheritance system (base template with `{{WORKFLOW_CUSTOMIZATION}}` blocks)
- Preview generated Dockerfile before pushing
- Validate Dockerfile syntax before commit
- Store template hierarchy metadata

**Dependencies:** TS-5 (Dockerfile editor), TS-6 (GitHub push), admin access control (TS-8)

**Acceptance criteria:**
- Edit base template separately from per-workflow customizations
- Preview the merged/final Dockerfile
- Changes to base template reflect in all workflow Dockerfiles
- Per-workflow sections clearly demarcated
- Validate merged Dockerfile before push

---

### D-4: File Search and Filtering

**Description:** Search for files by name pattern (glob or substring) across the entire network volume. Filter by file type (e.g., `.safetensors`, `.ckpt`, `.pt`), size range, or modification date.

**Why differentiating:** RunPod's UI lacks search. When a volume has hundreds of models across nested directories, finding a specific file is painful. Search transforms file management from "navigate and hope" to "type and find."

**Complexity:** Medium
- Backend: S3 ListObjectsV2 with prefix + client-side filtering (S3 has no native search)
- For full search: index all file keys in memory or cache, filter by pattern
- Frontend: Search input with debounced results
- Filter dropdowns for common file extensions

**Dependencies:** TS-1 (file listing infrastructure)

**Acceptance criteria:**
- Search by filename substring
- Filter by file extension
- Results update as you type (debounced)
- Navigate to file's location in tree from search results
- Handle volumes with 10,000+ files without excessive latency

---

### D-5: Deployment Status Dashboard

**Description:** After pushing a Dockerfile change to GitHub, show the status of the resulting RunPod rebuild: triggered, building, deployed, failed. Optionally integrate with GitHub Actions or RunPod's build status API.

**Why differentiating:** Without this, the admin pushes a Dockerfile change and then has to switch to GitHub Actions or RunPod console to check if the build succeeded. This closes the deploy-monitor loop.

**Complexity:** Medium-High
- Poll GitHub Actions API for workflow run status (triggered by the push)
- OR poll RunPod endpoint health to detect when new version is live
- Show timeline: push -> build started -> build succeeded/failed -> deployed
- Optionally show build logs snippet

**Dependencies:** TS-6 (GitHub push triggers the build), RunPod health check (existing), GitHub Actions API

**Acceptance criteria:**
- Show build status after Dockerfile push
- Indicate success or failure
- Link to full build logs (GitHub Actions or RunPod console)
- Auto-refresh status until terminal state

---

### D-6: Bulk File Operations

**Description:** Select multiple files for bulk delete, move, or download (as ZIP). Essential for cleanup operations (removing old model versions) or reorganizing directory structures.

**Why differentiating:** RunPod's UI is single-file oriented. Cleaning up 20 old checkpoints requires 20 individual delete operations. Bulk operations are a major time saver.

**Complexity:** Medium
- Multi-select UI (checkboxes or shift-click)
- Bulk delete: batch S3 DeleteObjects (up to 1000 per request)
- Bulk move: sequential S3 CopyObject + DeleteObject
- Bulk download: Generate ZIP on-the-fly (or presigned URLs for each)

**Dependencies:** TS-1 (file browser with selection), TS-4 (delete), TS-3 (download), TS-7 (move)

**Acceptance criteria:**
- Select multiple files via checkboxes
- Bulk delete with single confirmation
- Bulk move to target directory
- Progress indicator for bulk operations
- Handle partial failures (some succeed, some fail)

---

## Anti-Features

These are capabilities we deliberately choose NOT to build. Including them would add complexity without proportional value, or would duplicate functionality better handled by existing tools.

### AF-1: Real-Time Collaborative Editing

**Do not build.** The PROJECT.md explicitly scopes this out: "Single admin use case, not needed." Adding WebSocket-based collaborative editing (like Google Docs or VS Code Live Share) would add massive complexity for zero benefit when there's a single admin user.

**Why excluded:** Single-user admin interface. No concurrent editing scenario exists.

---

### AF-2: Full Git Version Control UI

**Do not build.** No branch management, merge conflict resolution, diff viewer, or commit history browser. GitHub already handles this exceptionally well. The tool should commit and push -- nothing more.

**Why excluded:** The PROJECT.md states: "GitHub handles this, just edit and push." Building git UI features would be reimplementing GitHub poorly.

**What to do instead:** Provide a link to the GitHub commit/PR after each push. Let the admin use GitHub for history, diffs, and branch management.

---

### AF-3: RunPod Dashboard Recreation

**Do not build.** No GPU monitoring, endpoint scaling configuration, billing dashboard, or worker management. The tool handles file management and Dockerfile editing only.

**Why excluded:** The PROJECT.md states: "Only need file management and Dockerfile editing, not full RunPod features." RunPod's console does this well already.

**What to do instead:** Link to the relevant RunPod console page for endpoint management. Show basic health status (is the endpoint alive?) but nothing more.

---

### AF-4: Automated Model Optimization

**Do not build.** No automatic quantization, pruning, or format conversion of models after download.

**Why excluded:** The PROJECT.md states: "Manual download and assignment is sufficient." Model optimization is a specialized workflow that varies per model architecture and would require significant ML engineering.

---

### AF-5: In-Browser Terminal / SSH

**Do not build.** No shell access to RunPod pods from the admin interface.

**Why excluded:** Massive security surface area. Would require maintaining WebSocket connections to ephemeral pods, handling authentication, and dealing with session management. RunPod already provides this via their console. The benefit does not justify the security risk.

---

### AF-6: Multi-Tenant Admin

**Do not build.** No per-team or per-organization admin roles, no granular permissions (read vs write vs delete), no audit trail of admin actions.

**Why excluded:** Current scale is a single admin (or very small team). RBAC beyond "admin vs not-admin" adds complexity without current value. Can be revisited if the team grows.

**What to do instead:** Simple boolean admin check. Log admin actions to stdout (existing logging pattern) for basic audit trail.

---

### AF-7: Dockerfile Linting / Security Scanning

**Do not build.** No Hadolint integration, no Snyk container scanning, no best-practice enforcement.

**Why excluded:** The Dockerfiles are small, workflow-specific, and maintained by a single technical admin. The overhead of integrating linting tools exceeds the value for this use case. The admin can run these tools locally or in CI.

---

## Feature Dependency Map

```
TS-8: Admin Access Control
  |
  +-- TS-1: File Browser
  |     |
  |     +-- TS-2: File Upload
  |     +-- TS-3: File Download
  |     +-- TS-4: File Delete
  |     +-- TS-7: File Move/Rename
  |     +-- D-1: HuggingFace Direct Download
  |     |     |
  |     |     +-- D-2: Model-to-Workflow Assignment
  |     |
  |     +-- D-4: File Search/Filtering
  |     +-- D-6: Bulk Operations (depends on TS-3, TS-4, TS-7)
  |
  +-- TS-5: Dockerfile Editor
  |     |
  |     +-- TS-6: GitHub Push
  |     |     |
  |     |     +-- D-5: Deployment Status Dashboard
  |     |
  |     +-- D-3: Base Template System
```

## Implementation Priority Recommendation

**Phase 1 (Foundation):** TS-8 -> TS-1 -> TS-4 -> TS-3 -> TS-7
Build admin access control first, then the file browser with basic CRUD operations. This alone replaces the most common RunPod UI interactions.

**Phase 2 (Dockerfile Workflow):** TS-5 -> TS-6
Add the Dockerfile editor with GitHub push. This eliminates the IDE/GitHub context switch.

**Phase 3 (Upload & Download):** TS-2 -> D-1
File upload (for manual file placement) and HuggingFace direct download (the highest-value differentiator).

**Phase 4 (Polish):** D-4 -> D-6 -> D-2 -> D-3 -> D-5
Search, bulk operations, model assignment, template system, and deployment status. These improve efficiency but are not blocking.

## Complexity Summary

| Feature | Complexity | Category |
|---------|-----------|----------|
| TS-1: File Browser | Medium | Table Stakes |
| TS-2: File Upload | Medium-High | Table Stakes |
| TS-3: File Download | Low-Medium | Table Stakes |
| TS-4: File Delete | Low | Table Stakes |
| TS-5: Dockerfile Editor | Medium | Table Stakes |
| TS-6: GitHub Push | Medium-High | Table Stakes |
| TS-7: File Move/Rename | Low | Table Stakes |
| TS-8: Admin Access Control | Medium | Table Stakes |
| D-1: HuggingFace Download | High | Differentiator |
| D-2: Model Assignment | Medium | Differentiator |
| D-3: Base Template System | Medium-High | Differentiator |
| D-4: File Search | Medium | Differentiator |
| D-5: Deploy Status Dashboard | Medium-High | Differentiator |
| D-6: Bulk Operations | Medium | Differentiator |

## Key Technical Considerations

**RunPod Network Volume Access:** RunPod network volumes are S3-backed. The primary question is whether to access them via the RunPod API (which may have limited file management endpoints) or directly via S3 credentials. Direct S3 access provides more capability (ListObjectsV2, PutObject, DeleteObject, CopyObject, presigned URLs) but requires obtaining and securely managing S3 credentials for the volume. The RunPod API may only expose basic volume operations. This needs to be validated during implementation.

**HuggingFace Direct Download Architecture:** The key challenge is downloading HuggingFace models to the volume without routing through the backend server. Two approaches:
1. Submit a RunPod job that runs a download script on a pod with the network volume mounted
2. Stream from HuggingFace API directly to S3 via the backend (requires enough bandwidth but not local disk space)

Option 1 is more reliable for large files but requires a utility RunPod endpoint. Option 2 is simpler but puts load on the backend server.

**GitHub Integration Security:** The GitHub PAT (Personal Access Token) must be stored securely on the backend (encrypted in database or environment variable). It must never be sent to the frontend. All GitHub API calls happen server-side. Consider using a GitHub App (installation token) instead of a PAT for better security and audit trail.

**Editor Component Choice:** Monaco (VS Code's editor) is the most capable but adds ~2MB to bundle size. CodeMirror 6 is lighter (~200KB) and supports Dockerfile syntax. Given this is admin-only (not loaded for regular users), Monaco is acceptable if lazy-loaded. CodeMirror is preferred if bundle size is a concern.

---

*Research completed: 2026-03-04*
