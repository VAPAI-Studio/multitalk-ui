# sideOUTsticks - AI Media Processing Platform

## What This Is

sideOUTsticks (multitalk-ui) is a full-stack web application for AI-powered video and audio processing with integrated infrastructure management. It provides multiple AI-driven features (lipsync, video generation, image editing, style transfer) with a unified job tracking system and dual execution backends (local ComfyUI and cloud-based RunPod serverless). Admin users can manage RunPod infrastructure — browse network volume files, transfer models, edit Dockerfiles, and deploy — all without leaving the app.

## Core Value

Provide a unified platform for AI-powered media processing where users can generate, edit, upscale, and manage their content end-to-end — from creation through post-processing to organized storage.

## Current Milestone: v1.2 Workflow Builder

**Goal:** Enable admins to create new platform features from ComfyUI workflows without writing code — upload a workflow JSON, configure inputs visually, test it, and publish it as a live feature page.

**Target features:**
- Admin-only workflow builder page in Infrastructure studio
- Upload ComfyUI workflow JSON and parse all nodes/inputs
- Configure which inputs become user-facing variables (text, slider, file upload, dropdown, toggle, resolution)
- Test-run workflows directly from the builder
- Publish features to any studio — instant appearance in navigation, no rebuild needed
- Dynamic renderer that turns database configurations into feature pages
- Full integration with existing job tracking, dual backends (ComfyUI + RunPod), and generation feed

## Requirements

### Validated

<!-- Shipped features working in production -->

- ✓ **AI Video/Audio Processing** — Lipsync (single/multi-person), video lipsync, image-to-video generation — existing
- ✓ **Image Processing** — AI-powered image editing, character captioning, style transfer — existing
- ✓ **Dual Execution Backends** — User toggle between local ComfyUI and cloud RunPod serverless — existing
- ✓ **Job Tracking System** — Unified async job tracking with status updates across all workflows — existing
- ✓ **Authentication** — Supabase JWT-based auth with automatic token refresh — existing
- ✓ **Generation Feed** — Unified feed showing all user generations with filtering — existing
- ✓ **ComfyUI Workflow System** — Backend workflow templates with parameter substitution — existing
- ✓ **Supabase Storage** — File storage for videos, images, and user uploads — existing
- ✓ **Admin Access Control** — Supabase role-based admin enforcement with 403 protection — v1.0
- ✓ **Network Volume File Browser** — S3 hierarchical tree with lazy loading and pagination (200+ items) — v1.0
- ✓ **File Upload/Download** — Chunked multipart upload (10GB) and streaming download — v1.0
- ✓ **File Operations** — Delete, move, rename, create folder with PROTECTED_PATHS guards — v1.0
- ✓ **HuggingFace Direct Download** — Streaming direct-to-S3 download with background job tracking — v1.0
- ✓ **Dockerfile Editor** — Monaco in-browser editor with syntax highlighting and dirty-state tracking — v1.0
- ✓ **GitHub Integration** — Commit to GitHub with optional deploy trigger via GitHub Releases — v1.0
- ✓ **Batch Video Upscale** — Freepik API integration with queue management, pause/resume, ZIP download — v1.1 (90% — history/re-run deferred)

### Active

<!-- Requirements for v1.2 Workflow Builder -->

- [ ] Custom workflow database schema and CRUD API
- [ ] Workflow JSON parser with node/input extraction
- [ ] Admin builder UI with node inspector and variable configuration
- [ ] Test runner for workflows within the builder
- [ ] Dynamic renderer component for published workflows
- [ ] Navigation integration (studios, homepage, routing)

### Out of Scope

- Upload videos from Google Drive — Planned for future milestone
- Real-time collaborative editing — Single admin use case, not needed
- Version control UI for Dockerfiles — GitHub handles this, just edit and push
- RunPod dashboard recreation — Only need file management and Dockerfile editing, not full RunPod features
- Automated model optimization — Manual download and assignment is sufficient
- Offline mode — Real-time connectivity to S3 and GitHub is core to infrastructure management
- Model Assignment to Workflows — Deferred to v2 (MODEL-01 through MODEL-03)
- Base Dockerfile Template System — Deferred to v2 (TMPL-01 through TMPL-03)
- Bulk File Operations — Deferred to v2 (BULK-01 through BULK-03)
- File Search — Deferred to v2 (SEARCH-01, SEARCH-02)
- Audit Logging — Deferred to v2 (AUDIT-01 through AUDIT-03)
- Deployment Tracking — Deferred to v2 (DEPLOY-01 through DEPLOY-03)

## Context

**Current State (post v1.0, starting v1.1):**
- Shipped v1.0 Infrastructure Management with 14,269 LOC Python + 28,415 LOC TypeScript
- Tech stack: FastAPI, React/TypeScript, Supabase, S3 (RunPod), GitHub API, Monaco Editor
- 9 phases, 23 plans, 44 requirements all satisfied
- Google Drive integration exists: ProjectContext with folder picker in header, service account auth, upload/list/folder operations
- Freepik API: Video Upscaler at `api.freepik.com/v1/ai/video-upscaler` — async task-based (POST to create, GET to poll), supports resolution/creativity/sharpen/grain/fps_boost/flavor params
- Freepik rate limits: Free=10/day, Tier 1=125/day. Frame-based pricing. Statuses: CREATED → IN_PROGRESS → COMPLETED/FAILED

**Technical Environment:**
- FastAPI backend (Python 3.11+) with React/TypeScript frontend
- Supabase for auth and storage, ComfyUI for local workflow execution
- RunPod serverless with S3-backed network volumes for cloud execution
- Dockerfiles stored in GitHub with automatic build triggers via Releases
- Admin-only infrastructure section gated by Supabase app_metadata role

**Known Tech Debt:**
- Download buffers full file in browser memory before save dialog (>1GB limitation)
- In-memory HF download job store — jobs lost on server restart
- Infrastructure router self-prefixes (inconsistent with other routers in main.py)
- DockerfileEditor has no internal auth guard (relies on parent page)

## Constraints

- **Authentication**: Must use existing Supabase JWT authentication system
- **Security**: GitHub credentials and commit access stored securely server-side (encrypted, never exposed to frontend)
- **Access Control**: Infrastructure management features are admin-only (app_metadata role)
- **Tech Stack**: Must integrate with existing FastAPI backend and React frontend
- **RunPod S3 Limitations**: No copy_object, no delete_objects batch, no presigned URLs — streaming workarounds required
- **Heroku**: 30-second request timeout and 512MB memory limit affects large file transfers

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin-only access via app_metadata | Prevents self-promotion; requires service_role key to set | ✓ Good |
| GitHub-based deployment via Releases | Leverage existing GitHub → RunPod pipeline; timestamp tags avoid duplicates | ✓ Good |
| Monaco in-browser Dockerfile editor | No context switching; defaultValue+key pattern preserves native undo/redo | ✓ Good |
| HuggingFace streaming to S3 | No temp disk required; unlimited file size; replaced initial hf_hub_download approach | ✓ Good |
| S3 streaming workarounds for RunPod | copy_object/batch delete unsupported; per-key loops with streaming get/put | ✓ Good (necessary) |
| XHR for upload progress | fetch API lacks upload.onprogress; XHR provides real per-byte tracking | ✓ Good |
| refreshId prop pattern | Replaces key= remount; preserves FileTree expanded state across operations | ✓ Good |
| In-memory HF job store | Simple for admin use (single user); lost on restart is acceptable tradeoff | ⚠️ Revisit if multi-admin |
| 5MB multipart chunk size | S3 minimum; consistent across upload and HF download pipelines | ✓ Good |
| PROTECTED_PATHS frozenset | Guards ComfyUI/ and venv/ from all mutations; prevents accidental model deletion | ✓ Good |

| Freepik API for video upscaling | External API with credit-based pricing; not ComfyUI — separate service layer needed | ✓ Good |
| Sequential batch processing | One video at a time to Freepik; avoids rate limit bursts and simplifies credit tracking | ✓ Good |
| Pause-and-notify on credit exhaustion | Better UX than silent failure; user can add credits and resume | ✓ Good |
| Output to Supabase + Google Drive | Dual storage: Supabase for in-app viewing, Drive for organized project delivery | ✓ Good |
| Dynamic renderer for custom workflows | Database-stored config, not code generation; instant publish without rebuild | — Pending |
| JSONB for variable/section configs | Flexible schema evolution; no join tables for admin-managed config | — Pending |
| Test runner shares code path with renderer | Guarantees consistency; if test works, production works | — Pending |

---
*Last updated: 2026-03-13 after v1.2 milestone start*
