# sideOUTsticks - AI Media Processing Platform

## What This Is

sideOUTsticks (multitalk-ui) is a full-stack web application for AI-powered video and audio processing. It provides multiple AI-driven features (lipsync, video generation, image editing, style transfer) with a unified job tracking system and dual execution backends (local ComfyUI and cloud-based RunPod serverless). The platform now needs admin tools to manage RunPod infrastructure - specifically network volume files and Dockerfile deployment pipelines - eliminating context switching to RunPod's web interface.

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

### Active

<!-- New infrastructure management features to build -->

- [ ] **Network Volume File Browser** — Browse files/folders on S3-backed RunPod network volume
- [ ] **File Upload/Download** — Transfer files between local machine and RunPod volume
- [ ] **File Operations** — Move, rename, and delete files on RunPod volume
- [ ] **HuggingFace Direct Download** — Paste HuggingFace model URL, download directly to RunPod volume
- [ ] **Model Assignment** — Assign downloaded models to specific workflows
- [ ] **Dockerfile Editor** — In-browser code editor with syntax highlighting for workflow Dockerfiles
- [ ] **GitHub Integration** — Automatic push to GitHub triggering RunPod rebuild pipeline
- [ ] **Base Template System** — Manage base Dockerfile template with per-workflow customization
- [ ] **Admin Access Control** — Restrict infrastructure management to admin users only

### Out of Scope

- Real-time collaborative editing — Single admin use case, not needed
- Version control UI for Dockerfiles — GitHub handles this, just edit and push
- RunPod dashboard recreation — Only need file management and Dockerfile editing, not full RunPod features
- Automated model optimization — Manual download and assignment is sufficient

## Context

**Technical Environment:**
- FastAPI backend (Python 3.11+) with React/TypeScript frontend
- Supabase for auth and storage, ComfyUI for local workflow execution
- RunPod serverless with S3-backed network volumes for cloud execution
- Dockerfiles stored in GitHub with automatic build triggers on push
- Base template + per-workflow customization pattern for Docker images

**Current Pain Points:**
- Context switching to RunPod web interface for file/Dockerfile management
- Slow navigation and limited file operations in RunPod UI
- No bulk operations or search functionality
- Manual process to download HuggingFace models to network volume

**Desired Workflow:**
1. Download HuggingFace model → directly to RunPod volume (no local intermediary)
2. Assign model to workflows → configure which workflows use the model
3. Edit Dockerfile → in-browser with syntax highlighting
4. Auto-deploy → push to GitHub triggers RunPod rebuild

**Existing Infrastructure:**
- RunPod API integration already exists (`backend/services/runpod_service.py`)
- Network volumes are S3-backed and shared across workflows
- GitHub repository contains Dockerfiles (`backend/runpod_handlers/`)
- Dockerfiles follow base template + customization pattern

## Constraints

- **Authentication**: Must use existing Supabase JWT authentication system
- **Security**: GitHub credentials and commit access must be securely managed (no plaintext tokens)
- **Access Control**: Infrastructure management features are admin-only (not for regular users)
- **Tech Stack**: Must integrate with existing FastAPI backend and React frontend
- **Compatibility**: RunPod API integration must handle rate limits and API constraints
- **Network Volume**: S3-backed RunPod volume is shared across multiple workflows

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin-only access | Infrastructure management is sensitive, should be restricted to admins | — Pending |
| GitHub-based deployment | Leverage existing GitHub → RunPod pipeline rather than direct RunPod builds | — Pending |
| In-browser Dockerfile editor | Keep workflow in the app, no need to switch to IDE or GitHub UI | — Pending |
| HuggingFace direct download | Eliminate local download → upload cycle for large models | — Pending |

---
*Last updated: 2026-03-04 after initialization*
