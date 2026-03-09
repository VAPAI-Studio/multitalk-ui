# Pitfalls Research: Infrastructure Management for sideOUTsticks

**Research Date:** 2026-03-04
**Domain:** File browser, code editor, and GitHub integration for RunPod infrastructure management
**Downstream Consumer:** Roadmap/planning — prevention strategies for each phase

---

## Pitfall 1: Treating the Network Volume File Browser Like a Local Filesystem

**What goes wrong:** Teams build file browsers against S3-backed storage (like RunPod network volumes) as if they are local filesystems with instant operations. S3 is an object store with eventual consistency for listing operations, no true directory concept (prefixes simulate folders), and latency on operations that users expect to be instant (rename, move). The UI freezes or returns stale results when navigating deep folder structures containing thousands of model files (safetensors, checkpoints, LoRA weights often numbering 10,000+ files across nested directories).

**Warning signs:**
- File listing calls take >2 seconds after initial load
- "Rename" or "move" operations take noticeably longer than expected (they are copy + delete under the hood in S3)
- Users see stale directory listings after uploads complete
- Frontend paginated list shows inconsistent item counts between refreshes
- Delete operations appear to succeed but files reappear on refresh

**Prevention strategy:**
- Design the file browser API with explicit pagination and cursor-based listing from day one (not offset-based)
- Implement server-side caching of directory listings with cache invalidation on mutation operations
- Use a loading/skeleton UI for directory contents rather than blocking render
- Implement optimistic UI updates: when user deletes/renames a file, immediately update the frontend list and reconcile on next fetch
- Make "move" and "rename" async operations with progress indicators since they are copy+delete on S3
- Limit initial listing depth to 1 level; lazy-load subdirectories on expand

**Phase:** Phase 1 (Network Volume File Browser) — must be addressed in initial API design

---

## Pitfall 2: Blocking the UI During Large File Transfers to RunPod Volumes

**What goes wrong:** HuggingFace model downloads (safetensors, GGUF files) commonly range from 2-15 GB per file. Teams implement download-to-volume as a synchronous backend request that either times out (60-second default in the existing apiClient) or blocks the user from doing anything else. The FastAPI endpoint holds the request open while streaming gigabytes, consuming server resources and hitting Heroku's 30-second request timeout.

**Warning signs:**
- HTTP 504 Gateway Timeout errors on large model downloads
- Heroku H12 Request Timeout errors in logs
- Users refreshing the page thinking the download is stuck, causing duplicate downloads
- Backend memory consumption spikes during file transfers
- Frontend timeout at 60 seconds (current apiClient.ts timeout) kills in-progress transfers

**Prevention strategy:**
- Model downloads must be fire-and-forget async jobs, not synchronous HTTP requests
- Create a `download_jobs` table or reuse the existing job tracking pattern to track download progress
- Backend endpoint accepts the HuggingFace URL, validates it, creates a job record, and returns immediately with a job ID
- A background task (asyncio.create_task or a queue worker) handles the actual download, streaming directly from HuggingFace to the RunPod volume without buffering the full file in memory
- Frontend polls the job status (or uses SSE) to show download progress with percentage, speed, and ETA
- Implement cancellation support so users can abort a stuck download
- Never proxy large files through the backend; use presigned URLs or direct server-to-server transfer where possible

**Phase:** Phase 1 (File Upload/Download + HuggingFace Direct Download) — architectural decision needed before any implementation

---

## Pitfall 3: Building the Dockerfile Editor Without Understanding the Existing Template Pattern

**What goes wrong:** The project already has a "base template + per-workflow customization" pattern for Dockerfiles, stored in GitHub. Teams build a generic code editor that lets users edit arbitrary Dockerfile content, then discover that edits break the base template inheritance, or that the editor does not understand which lines come from the base template (read-only) vs. which are per-workflow customizations (editable). Users overwrite shared base layers, causing all workflow images to rebuild from scratch.

**Warning signs:**
- Users accidentally editing base template content that should be shared across workflows
- Docker builds taking 30+ minutes because base layer cache was invalidated by a small change
- Merge conflicts when multiple workflows customize the same base template section
- No visual distinction in the editor between inherited content and customizable content
- Push to GitHub triggers rebuild of all workflow images instead of just the changed one

**Prevention strategy:**
- Before building the editor, document the exact structure of the Dockerfile template pattern: what is the base template, how do per-workflow customizations layer on top, and which sections are mutable
- Design the editor UI to show base template content as read-only (grayed out or locked) with clearly marked editable sections
- Validate Dockerfile syntax before allowing push (use a Dockerfile linter like hadolint or at minimum validate basic FROM/RUN/COPY structure)
- Implement a preview/diff view showing what changed before pushing to GitHub
- Consider a structured form-based approach for common customizations (add model path, add pip package) rather than free-text Dockerfile editing, reducing the risk of syntax errors

**Phase:** Phase 2 (Dockerfile Editor) — design decision needed before UI implementation

---

## Pitfall 4: Storing GitHub Tokens Insecurely

**What goes wrong:** The GitHub integration requires push access to the repository containing Dockerfiles. Teams store the GitHub Personal Access Token (PAT) or GitHub App credentials in the same `.env` file alongside other secrets, log it in error messages (the existing codebase already has this pattern with RunPod API keys per CONCERNS.md), or worse, store it in the database or expose it to the frontend. A leaked GitHub token with push access allows arbitrary code execution in the CI/CD pipeline.

**Warning signs:**
- GitHub PAT appears in backend error logs or Heroku log drain
- Token stored in Supabase database rather than environment variables
- Frontend code contains or receives the GitHub token
- Token has overly broad scopes (repo:admin instead of just contents:write on a single repo)
- No token rotation strategy; same token used for months

**Prevention strategy:**
- Use a GitHub App with minimal scopes (contents:write on the specific repository only) instead of a personal access token
- Store credentials exclusively in environment variables (Heroku config vars for production), never in the database
- Implement the secret redaction pattern recommended in CONCERNS.md before adding the GitHub integration
- The backend GitHub service must never include tokens in error messages, log entries, or API responses
- Add the GitHub token to a deny-list in any structured logging implementation
- Document token rotation procedure and set calendar reminders
- Frontend must never receive or handle GitHub credentials; all Git operations happen server-side

**Phase:** Phase 2 (GitHub Integration) — must be resolved before any code that touches GitHub credentials

---

## Pitfall 5: The GitHub Push Triggering Uncontrolled RunPod Rebuilds

**What goes wrong:** The Dockerfile editor pushes to GitHub, which triggers a CI/CD pipeline that rebuilds and deploys the RunPod serverless endpoint. If there is no confirmation step, a user making rapid iterative edits triggers multiple concurrent builds. RunPod endpoint deployments can take 10-20 minutes per workflow, and concurrent deployments can leave endpoints in an inconsistent state where some requests go to the old version and some to the new.

**Warning signs:**
- Multiple GitHub Actions runs queued for the same workflow within minutes
- RunPod endpoint returning mixed results (old handler vs new handler)
- Build costs spiking because every small edit triggers a full Docker rebuild
- Users confused about which version is deployed
- No way to roll back a bad deployment

**Prevention strategy:**
- Add a confirmation dialog before push: show the diff, list which workflows will be affected, and require explicit user confirmation
- Implement a debounce mechanism: allow multiple edits but only push after a configurable delay (e.g., "Save Draft" vs "Deploy")
- Track deployment state in the UI: show which version is currently deployed, which is building, and whether it succeeded or failed
- Implement deployment locking: prevent new pushes while a build is in progress for the same workflow
- Add a rollback mechanism: store the previous Dockerfile version so users can revert if a deployment breaks
- Consider a "staging" branch pattern: push to a staging branch, validate the build, then promote to production branch

**Phase:** Phase 2 (GitHub Integration) — must be designed into the push workflow from the start

---

## Pitfall 6: Admin Access Control Bolted On After Features Are Built

**What goes wrong:** The new features (file browser, Dockerfile editor, GitHub push) are built first, then admin-only access control is added as an afterthought. The existing codebase has no role-based access control (CONCERNS.md confirms RLS is disabled and there is no admin role). Retrofitting access control after endpoints exist leads to missed routes, inconsistent enforcement, and a false sense of security where some admin endpoints are protected but others are forgotten.

**Warning signs:**
- Some infrastructure management endpoints accessible without admin check
- `get_current_user()` dependency does not distinguish admin from regular user
- No database field or Supabase metadata marking users as admin
- Frontend shows admin UI elements to non-admin users (just hidden behind a feature flag, not access-controlled)
- Test suite does not verify that non-admin users are rejected from admin endpoints

**Prevention strategy:**
- Define the admin role mechanism before building any infrastructure management feature: add an `is_admin` field to user metadata in Supabase, or use Supabase custom claims
- Create a `get_admin_user()` FastAPI dependency that extends `get_current_user()` with an admin check, returning 403 Forbidden for non-admins
- Apply `get_admin_user()` to every infrastructure management endpoint from the very first endpoint created
- Frontend must check admin status before rendering infrastructure management UI (not just hiding elements with CSS)
- Write tests that verify non-admin users receive 403 on all admin endpoints
- Consider a middleware approach that protects all routes under `/api/admin/` prefix, so new endpoints automatically inherit protection

**Phase:** Phase 1 (before any infrastructure feature) — foundational requirement

---

## Pitfall 7: File Browser Not Handling RunPod Volume Concurrency

**What goes wrong:** The RunPod network volume is shared across multiple serverless workers and potentially multiple workflow endpoints. While a user is browsing files or uploading a model, a RunPod worker may be reading the same files for inference, or another admin session may be modifying the same directory. Teams build the file browser assuming exclusive access, leading to operations that fail silently or corrupt files when concurrent access occurs.

**Warning signs:**
- File deletion succeeds in UI but RunPod worker fails with "file not found" mid-inference
- Upload appears complete but file is truncated (worker was reading during write)
- Directory listing shows files that were just deleted (caching + concurrent modification)
- Two admin sessions move the same file to different locations simultaneously

**Prevention strategy:**
- Display clear warnings when modifying files that are part of active workflow configurations (cross-reference the model assignment database)
- Implement advisory locking at the application level: when an admin starts a file operation, mark the path as "in use" and prevent concurrent modifications
- Never delete model files that are currently assigned to active workflows without explicit confirmation
- Add a "models in use" indicator in the file browser that shows which files are referenced by workflow configurations
- Design uploads to use a temporary location (upload to `.tmp/` prefix, then atomic rename on completion) to prevent workers from reading partial files
- Consider making destructive operations (delete, move) require a second confirmation if the file is large or referenced by workflows

**Phase:** Phase 1 (File Operations) — must be considered during file operation API design

---

## Pitfall 8: Monolithic API Client Growing Unmanageable

**What goes wrong:** The existing `apiClient.ts` is already 1,181 lines (flagged in CONCERNS.md). Adding file browser methods (list, upload, download, move, rename, delete), Dockerfile editor methods (load, save, push), and GitHub integration methods (status, push, rollback) will push it well past 1,500 lines. The file becomes impossible to review, test, or maintain. Every new feature adds to a single God object.

**Warning signs:**
- `apiClient.ts` exceeding 1,500 lines
- Merge conflicts on every PR because multiple features modify the same file
- Methods with completely different error handling patterns coexisting in the same class
- Difficulty writing focused unit tests because the class has too many responsibilities
- Import of apiClient pulls in types and utilities for features the importing component does not use

**Prevention strategy:**
- Before adding infrastructure management methods, refactor `apiClient.ts` into a modular structure: `apiClient/base.ts` (core request/retry/cache logic), `apiClient/jobs.ts` (job tracking), `apiClient/infrastructure.ts` (file browser + Dockerfile), `apiClient/github.ts` (GitHub operations)
- Each module exports functions that use the shared base client
- Re-export from `apiClient/index.ts` for backward compatibility
- Alternatively, create a separate `infraClient.ts` for all infrastructure management API calls
- Set a maximum file size linting rule (e.g., 500 lines per file) to prevent future growth

**Phase:** Phase 1 (before adding any new API methods) — refactoring prerequisite

---

## Pitfall 9: Code Editor Integration Bloating the Frontend Bundle

**What goes wrong:** Adding an in-browser code editor with Dockerfile syntax highlighting typically means adding Monaco Editor (~4 MB) or CodeMirror (~500 KB-1.5 MB with extensions). The existing frontend already has large un-code-split files (CONCERNS.md). Adding a heavyweight editor library without lazy loading causes initial page load to balloon, affecting all users even if they never use the Dockerfile editor (which is admin-only).

**Warning signs:**
- Frontend bundle size increases by >1 MB after adding editor
- Time to interactive increases by >2 seconds
- All users (including non-admin regular users) download the editor library on page load
- Vite build warnings about chunk size exceeding recommended limits

**Prevention strategy:**
- Use `React.lazy()` and `Suspense` to lazy-load the editor component only when the admin navigates to the Dockerfile editor page
- Choose CodeMirror 6 over Monaco Editor for smaller bundle size (CodeMirror with Dockerfile syntax is ~200 KB gzipped vs Monaco at ~1.5 MB gzipped)
- If using Monaco, configure custom build to include only Dockerfile language support, excluding unused languages
- Gate the editor route behind admin check so the code split chunk is never even fetched for non-admin users
- Measure bundle size before and after adding the editor; set a budget (e.g., max 200 KB increase for non-admin routes)

**Phase:** Phase 2 (Dockerfile Editor) — architecture decision before choosing the editor library

---

## Pitfall 10: HuggingFace Download Assuming Simple URL Patterns

**What goes wrong:** Teams implement HuggingFace download by parsing a URL like `https://huggingface.co/org/model/blob/main/model.safetensors` and constructing a download link. But HuggingFace has multiple URL patterns (models, datasets, spaces), gated models requiring authentication tokens, large file storage (LFS) with redirect chains, and rate limiting. The download feature works for public models but fails silently for gated models (Llama, Mistral), returns HTML instead of binary for incorrect URL parsing, or gets rate-limited after a few downloads.

**Warning signs:**
- Downloads returning HTML content (the HuggingFace web page) instead of binary model data
- Gated model downloads failing with 401 or 403 without a clear error message
- Downloads succeeding for small files but failing for large (>5 GB) files due to LFS redirect handling
- Rate limiting after downloading 3-5 models in succession
- URL parsing breaking when model names contain special characters or nested paths

**Prevention strategy:**
- Use the `huggingface_hub` Python library for server-side downloads instead of raw HTTP requests; it handles authentication, LFS, and URL resolution correctly
- Support optional HuggingFace token input for gated models (stored securely as an environment variable, never in the database)
- Validate the HuggingFace URL server-side before starting the download: check that the repository exists, the file exists, and whether it requires authentication
- Implement proper error messages: "This model requires a HuggingFace token", "File not found", "Rate limited, retry in X minutes"
- Handle LFS files correctly: `huggingface_hub` automatically follows LFS pointers
- Add a download queue (max 1-2 concurrent downloads) to avoid rate limiting

**Phase:** Phase 1 (HuggingFace Direct Download) — use the right library from the start

---

## Pitfall 11: Model Assignment Disconnected from Workflow Execution

**What goes wrong:** Teams build a model assignment UI that lets admins associate downloaded models with workflows, but the assignment metadata lives in a separate database table that is not consulted during actual workflow execution. The RunPod handler has model paths hardcoded or configured via environment variables, and changing the assignment in the UI does not actually change which model the workflow uses. Users think they switched models but get results from the old one.

**Warning signs:**
- Model assignment UI shows Model B assigned, but workflow still uses Model A
- No mechanism to propagate assignment changes to the RunPod handler configuration
- Assignment stored in Supabase but RunPod handler reads from local filesystem path or Dockerfile COPY statement
- No validation that the assigned model file actually exists on the network volume
- Assignment change has no visible effect until the next Docker rebuild

**Prevention strategy:**
- Map out the complete flow: where does the RunPod handler get its model path? Is it from an environment variable, a Dockerfile COPY path, a volume mount path, or hardcoded?
- Design model assignment to modify the actual configuration that the handler reads, whether that means updating an environment variable in the RunPod endpoint config, modifying the Dockerfile, or writing a config file to the network volume
- Validate on assignment that the model file exists at the expected path on the network volume
- Show the user the current effective model (what the handler is actually using) alongside the assigned model
- If assignment requires a Docker rebuild, make this clear in the UI: "Assigning this model will trigger a rebuild (~15 minutes)"

**Phase:** Phase 1 (Model Assignment) + Phase 2 (Dockerfile Editor) — spans both phases, needs upfront design

---

## Pitfall 12: Not Testing Infrastructure Features Against Real RunPod Volumes

**What goes wrong:** The existing codebase already has a "RunPod integration not fully tested" concern (CONCERNS.md). Adding file browser, download, and management features that interact with RunPod's API and S3-backed volumes without integration tests means bugs are only discovered in production. Mock-based tests pass but real operations fail due to RunPod API quirks, S3 eventual consistency, or permission issues.

**Warning signs:**
- All tests pass but file listing returns empty in production
- Upload tests pass with mock but fail with actual RunPod volume due to size limits or path restrictions
- Delete operation works in tests but RunPod API returns 403 due to volume permissions
- HuggingFace download tests mock the download but never verify the file lands on the volume

**Prevention strategy:**
- Create a dedicated test RunPod volume (small, cheap) for integration testing
- Write a small set of smoke tests that run against the real RunPod API: list files, upload a small file, download it, delete it, verify deletion
- Run these smoke tests in CI on a schedule (not on every PR, but nightly or weekly)
- Add a health check endpoint for the infrastructure features: `GET /api/admin/health` that verifies RunPod volume access, GitHub token validity, and HuggingFace connectivity
- Use the existing contract testing pattern (`backend/tests/workflows/test_contract_*.py`) as a model for infrastructure integration contracts

**Phase:** All phases — start integration testing from Phase 1

---

## Summary: Phase Mapping

| Phase | Pitfalls to Address |
|-------|-------------------|
| **Pre-Phase 1** | #6 (Admin Access Control), #8 (API Client Refactoring) |
| **Phase 1: File Browser + Downloads** | #1 (S3 Object Store), #2 (Large File Transfers), #7 (Volume Concurrency), #10 (HuggingFace URLs), #11 (Model Assignment Flow), #12 (Integration Testing) |
| **Phase 2: Dockerfile Editor + GitHub** | #3 (Template Pattern), #4 (GitHub Token Security), #5 (Uncontrolled Rebuilds), #9 (Editor Bundle Size) |
| **Cross-Phase** | #11 (Model Assignment spans Phase 1 + 2), #12 (Testing spans all phases) |

---

*Research completed: 2026-03-04*
