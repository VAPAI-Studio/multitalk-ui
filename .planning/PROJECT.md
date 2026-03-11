# sideOUTsticks - AI Media Processing Platform

## What This Is

sideOUTsticks (multitalk-ui) is a full-stack web application for AI-powered video and audio processing with integrated infrastructure management. It provides multiple AI-driven features (lipsync, video generation, image editing, style transfer) with a unified job tracking system and dual execution backends (local ComfyUI and cloud-based RunPod serverless). Admin users can manage RunPod infrastructure — browse network volume files, transfer models, edit Dockerfiles, and deploy — all without leaving the app.

## Core Value

Enable self-service infrastructure management for RunPod serverless workflows without leaving the application, making model deployment and Dockerfile editing as seamless as running a generation.

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

### Active

<!-- Requirements for next milestone (to be defined via /gsd:new-milestone) -->

(None yet — define requirements for next milestone)

### Out of Scope

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

**Current State (post v1.0):**
- Shipped v1.0 Infrastructure Management with 14,269 LOC Python + 28,415 LOC TypeScript
- Tech stack: FastAPI, React/TypeScript, Supabase, S3 (RunPod), GitHub API, Monaco Editor
- 9 phases, 23 plans, 44 requirements all satisfied
- All 7 E2E flows verified (login→infra, browse, upload, download, file ops, HF download, Dockerfile edit+deploy)

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

---
*Last updated: 2026-03-11 after v1.0 milestone*
