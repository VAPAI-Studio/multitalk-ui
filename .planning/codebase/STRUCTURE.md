# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
multitalk-ui/
├── backend/                          # FastAPI server (Python)
│   ├── main.py                       # FastAPI app entry point, router registration
│   ├── config/
│   │   └── settings.py               # Centralized settings from environment variables
│   ├── core/
│   │   ├── supabase.py               # Supabase client singleton + authentication
│   │   └── auth.py                   # JWT verification utilities
│   ├── api/                          # API endpoint handlers
│   │   ├── auth.py                   # Authentication endpoints (register, login, refresh, etc.)
│   │   ├── image_jobs.py             # Image job CRUD endpoints
│   │   ├── video_jobs.py             # Video job CRUD endpoints
│   │   ├── comfyui.py                # ComfyUI API proxy (submit, status, etc.)
│   │   ├── feed.py                   # Unified job feed endpoint
│   │   ├── runpod.py                 # RunPod execution endpoints
│   │   ├── storage.py                # Storage/upload endpoints
│   │   ├── image_edit.py             # Image edit feature endpoints
│   │   ├── multitalk.py              # Lipsync feature endpoints
│   │   ├── flux_trainer.py           # Flux model training endpoints
│   │   ├── lora_trainer.py           # LoRA fine-tuning endpoints
│   │   ├── google_drive.py           # Google Drive integration
│   │   ├── datasets.py               # Dataset management endpoints
│   │   └── virtual_set.py            # Virtual set feature endpoints
│   ├── services/                     # Business logic layer
│   │   ├── comfyui_service.py        # ComfyUI server communication
│   │   ├── workflow_service.py       # Template loading and parameter substitution
│   │   ├── image_job_service.py      # Image job lifecycle management
│   │   ├── video_job_service.py      # Video job lifecycle management
│   │   ├── storage_service.py        # Supabase Storage operations (upload/download)
│   │   ├── runpod_service.py         # RunPod serverless API calls
│   │   ├── google_drive_service.py   # Google Drive folder/file operations
│   │   ├── flux_trainer_service.py   # Flux training orchestration
│   │   ├── dataset_service.py        # Dataset operations
│   │   ├── thumbnail_service.py      # Video thumbnail generation
│   │   ├── openrouter_service.py     # OpenRouter API calls for AI features
│   │   └── worldlabs_service.py      # WorldLabs 3D API integration
│   ├── models/                       # Pydantic data models
│   │   ├── image_job.py              # ImageJob, CreateImageJobPayload, etc.
│   │   ├── video_job.py              # VideoJob, CreateVideoJobPayload, etc.
│   │   ├── user.py                   # User, UserRegister, TokenResponse, etc.
│   │   ├── training_job.py           # TrainingJob models
│   │   ├── workflow.py               # Workflow metadata models
│   │   ├── dataset.py                # Dataset models
│   │   ├── comfyui.py                # ComfyUI status/queue models
│   │   ├── google_drive.py           # Google Drive models
│   │   ├── storage.py                # Storage models
│   │   ├── image_edit.py             # Image edit request models
│   │   └── virtual_set.py            # Virtual set models
│   ├── workflows/                    # ComfyUI workflow templates (JSON)
│   │   ├── WANI2V.json               # WAN Image-to-Video workflow
│   │   ├── ImageEdit.json            # AI image editing workflow
│   │   ├── Lipsync.json              # Lipsync generation workflow
│   │   ├── StyleTransfer.json        # Style transfer workflow
│   │   ├── CreateImage/              # Flux image generation workflows
│   │   │   └── FluxLora.json
│   │   ├── Flux/                     # Additional Flux templates
│   │   │   └── FluxLora.json
│   │   ├── ImageStudio/              # Image studio templates
│   │   │   └── (various workflow files)
│   │   └── ImageGrid.json            # Image grid generation
│   ├── runpod_handlers/              # RunPod handler templates (reference only, not deployed)
│   │   └── handler_template.py       # Template for creating RunPod handlers
│   ├── migrations/                   # Database migrations
│   │   └── 004_add_runpod_support.sql # Migration for RunPod fields
│   ├── tests/                        # Test suite
│   │   ├── test_workflows_static.py  # Workflow JSON validation
│   │   ├── test_workflow_service.py  # WorkflowService unit tests
│   │   ├── test_comfyui_api.py       # ComfyUI API endpoint tests
│   │   └── workflows/                # Workflow contract tests
│   │       ├── test_contract_*.py
│   │       └── __init__.py
│   ├── sql/                          # Raw SQL files (for reference)
│   │   └── migrations/
│   ├── scripts/                      # Utility scripts
│   ├── .env.example                  # Environment variable template
│   ├── requirements.txt              # Python dependencies
│   ├── requirements-dev.txt          # Development/testing dependencies
│   └── setup_supabase_auth.md        # Supabase setup instructions

├── frontend/                         # React + TypeScript + Vite
│   ├── src/
│   │   ├── main.tsx                  # Vite entry point, provider setup
│   │   ├── App.tsx                   # Main app component, page routing, sidebar
│   │   ├── index.css                 # Global CSS
│   │   ├── vite-env.d.ts             # Vite type definitions
│   │   ├── pages/                    # Feature page components
│   │   │   ├── Homepage.tsx          # Home page with studio switcher
│   │   │   ├── Lipsync.tsx           # Main lipsync feature (renders LipsyncOnePerson/LipsyncMultiPerson)
│   │   │   ├── LipsyncOnePerson.tsx  # Single person lipsync (imports Lipsync with variant)
│   │   │   ├── LipsyncMultiPerson.tsx # Multi person lipsync (imports Lipsync with variant)
│   │   │   ├── VideoLipsync.tsx      # Video lipsync feature
│   │   │   ├── ImageEdit.tsx         # Image editing feature
│   │   │   ├── StyleTransfer.tsx     # Style transfer feature
│   │   │   ├── CreateImage.tsx       # Image generation with LoRA
│   │   │   ├── ImageGrid.tsx         # Image grid generation
│   │   │   ├── WANI2V.tsx            # WAN Image-to-Video feature
│   │   │   ├── WANMove.tsx           # WAN camera movement feature
│   │   │   ├── LTX2I2V.tsx           # LTX2 Image-to-Video feature
│   │   │   ├── NanoBanana.tsx        # Nano Banana image editing
│   │   │   ├── CameraAngle.tsx       # Camera angle manipulation
│   │   │   ├── CharacterCaption.tsx  # Character captioning for training
│   │   │   ├── LoraTrainer.tsx       # LoRA fine-tuning interface
│   │   │   ├── FluxLora.tsx          # Flux model training
│   │   │   ├── AudioStemSeparator.tsx # Audio stem separation
│   │   │   ├── VirtualSet.tsx        # Virtual set generation
│   │   │   └── GenerationFeed.tsx    # Legacy job history view
│   │   ├── components/               # Reusable UI components
│   │   │   ├── AuthPage.tsx          # Login/register UI
│   │   │   ├── ComfyUIStatus.tsx     # ComfyUI server status indicator
│   │   │   ├── ExecutionBackendToggle.tsx # ComfyUI vs RunPod toggle
│   │   │   ├── ConsoleToggle.tsx     # Developer console toggle
│   │   │   ├── ThemeToggle.tsx       # Dark/light mode toggle
│   │   │   ├── ProjectSelector.tsx   # Google Drive folder selector
│   │   │   ├── StudioPage.tsx        # Generic studio page wrapper
│   │   │   ├── UnifiedFeed.tsx       # Real-time job feed with filtering
│   │   │   ├── SplatViewer.tsx       # 3D splat viewer for virtual sets
│   │   │   ├── FeedGridItem.tsx      # Individual job card in feed
│   │   │   ├── GenerationFeed.tsx    # Legacy feed component
│   │   │   ├── PathAnimator/         # SVG path animation utility
│   │   │   ├── utils.ts              # ComfyUI monitoring, WebSocket, health check utilities
│   │   │   ├── theme.css             # Theme CSS (dark/light mode)
│   │   │   └── App.css               # App-level styling
│   │   ├── contexts/                 # React Context providers
│   │   │   ├── AuthContext.tsx       # Authentication state (user, token, login/logout)
│   │   │   ├── ExecutionBackendContext.tsx # ComfyUI vs RunPod preference
│   │   │   ├── ProjectContext.tsx    # Google Drive project selection
│   │   │   └── ThemeContext.tsx      # Dark/light theme state
│   │   ├── lib/                      # Utility libraries & services
│   │   │   ├── apiClient.ts          # Centralized HTTP client with retry/caching
│   │   │   ├── supabase.ts           # Type definitions for jobs (no direct Supabase client)
│   │   │   ├── jobTracking.ts        # Job creation/update/completion API functions
│   │   │   ├── studioConfig.ts       # Studio and app configuration (sidebar structure)
│   │   │   ├── environment.ts        # Auto-detect prod/dev, set API base URL
│   │   │   ├── fixStuckJob.ts        # Recovery utility for failed/stuck jobs
│   │   │   ├── imageUtils.ts         # Image processing helpers
│   │   │   ├── storageUtils.ts       # Storage/download utilities
│   │   │   ├── exportUtils.ts        # Export/download functionality
│   │   │   ├── workflowUtils.ts      # Workflow template loading utilities
│   │   │   ├── datasetUtils.ts       # Dataset operations
│   │   │   └── logger.ts             # Structured logging
│   │   ├── hooks/                    # Custom React hooks
│   │   │   ├── useSmartResolution.ts # Resolution management (multiples of 32)
│   │   │   ├── (additional hooks as needed)
│   │   │   └── __init__.ts
│   │   ├── types/                    # TypeScript type definitions
│   │   │   ├── index.ts              # Exported types
│   │   │   └── (additional type files)
│   │   ├── constants/                # App constants
│   │   │   ├── workflowNames.ts      # Workflow name mappings
│   │   │   └── (additional constants)
│   │   ├── config/                   # Configuration files
│   │   │   └── environment.ts        # Environment-specific config (auto-detection)
│   │   └── assets/                   # Static assets (images, icons, etc.)
│   ├── public/                       # Static files served by Vite
│   │   └── workflows/                # ComfyUI workflow templates (PUBLIC, for reference only)
│   │       └── (Note: Actual workflows now in backend/workflows/)
│   ├── index.html                    # Vite HTML entry point
│   ├── package.json                  # Node dependencies
│   ├── package-lock.json             # Dependency lockfile
│   ├── vite.config.ts                # Vite configuration
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── eslintrc.json (or .eslintrc)  # ESLint configuration
│   └── .env.example                  # Environment variable template
│
├── docs/                             # Documentation
│   ├── RUNPOD_WORKFLOW_SETUP.md      # RunPod deployment guide
│   └── (additional documentation)
│
├── .github/
│   └── workflows/                    # GitHub Actions CI/CD
│       └── test.yml                  # Test automation workflow
│
├── .planning/
│   └── codebase/                     # Codebase analysis documents (this project)
│       ├── ARCHITECTURE.md
│       └── STRUCTURE.md
│
├── CLAUDE.md                         # Project instructions for Claude
├── new_feature_guide.md              # Guide for creating new features
├── WORKFLOW_SYSTEM.md                # Workflow system documentation
├── TESTING.md                        # Testing strategy and examples
├── api_doc.md                        # ComfyUI API reference
├── TODO.md                           # Roadmap and todo list
├── runbackend.sh                     # Backend startup script
└── README.md                         # Project overview
```

## Directory Purposes

**backend/**
- Central server handling all API requests, business logic, and external integrations
- Single source of truth for Supabase data access (RLS rules enforced here)
- Manages ComfyUI and RunPod workflow execution
- Stores workflow templates (not in frontend)

**backend/api/**
- All FastAPI routes organized by feature domain
- Each file is an APIRouter registered in main.py
- Validates requests, delegates to services, returns responses
- Dependency injection for authentication and service instantiation

**backend/services/**
- Pure business logic with no HTTP concerns
- Each service is a class that manages a feature domain
- Services accept dependencies, return (success, data, error) tuples
- No direct FastAPI/HTTP knowledge

**backend/models/**
- Pydantic models for request/response validation and serialization
- Shared between API (input validation) and services (type safety)
- Includes payload models (CreateImageJobPayload) and response models (ImageJobResponse)

**backend/workflows/**
- ComfyUI workflow JSON templates with {{PLACEHOLDER}} syntax
- Loaded by WorkflowService at runtime, never sent to frontend
- Organized by feature (ImageStudio/, CreateImage/, etc.) or at root level
- Single source of truth for workflow definitions

**backend/core/**
- Shared infrastructure utilities
- Supabase client singleton for database/auth/storage
- Authentication/authorization functions
- Used by all other backend modules

**backend/config/**
- Environment configuration using Pydantic BaseSettings
- Centralizes all environment variable reading
- Provides fallback values and validation
- Used by all backend services

**frontend/src/pages/**
- Feature-level React components (one per AI feature)
- Handle user input, form state, job submission
- Integrate with contexts (Auth, ExecutionBackend) and API client
- Call job tracking functions to manage job lifecycle
- Include UnifiedFeed sidebar for real-time job monitoring

**frontend/src/components/**
- Reusable UI components used across multiple pages
- Utilities for ComfyUI integration (health check, WebSocket monitoring)
- Theme and layout components
- Modal dialogs and form inputs

**frontend/src/lib/**
- Non-React utility functions and services
- apiClient handles all HTTP communication (retry, cache, token refresh)
- jobTracking functions for job CRUD operations
- Environment detection and configuration
- Storage and dataset utilities

**frontend/src/contexts/**
- React Context providers for global state
- AuthContext: User authentication, token management
- ExecutionBackendContext: ComfyUI vs RunPod preference
- ThemeContext: Dark/light mode
- ProjectContext: Google Drive folder selection

**frontend/src/hooks/**
- Custom React hooks
- useSmartResolution: Video/image dimension management
- Additional feature-specific hooks as needed

**frontend/src/config/**
- Frontend configuration
- environment.ts: Auto-detect production vs development, set API URL
- Not hardcoded, respects environment variables

## Key File Locations

**Entry Points:**

**Backend:**
- `backend/main.py` (lines 1-68): FastAPI app creation, CORS config, router registration
- Health check endpoints: /health, /api/health (line 46-52)

**Frontend:**
- `frontend/src/main.tsx` (lines 1-27): React app mount, provider setup
- `frontend/src/App.tsx` (lines 101-300+): Main app component with page routing, sidebar navigation

**Configuration:**

- `backend/config/settings.py` (lines 1-94): All environment variables, feature flags (ENABLE_RUNPOD)
- `frontend/src/config/environment.ts` (lines 1-72): Auto-detect prod/dev, API URL normalization
- `frontend/src/lib/studioConfig.ts` (lines 1-200+): Studio structure definition, app registry

**Core Logic:**

**Authentication (Backend):**
- `backend/api/auth.py`: Register, login, refresh token, password reset endpoints
- `backend/core/auth.py`: JWT verification, user dependency injection
- `backend/core/supabase.py`: Supabase client singleton with key fallback logic

**Authentication (Frontend):**
- `frontend/src/contexts/AuthContext.tsx`: Token management, refresh logic, login/logout
- `frontend/src/lib/apiClient.ts` (lines 96-130): Token injection on requests, 401 handling

**Job Tracking:**
- `backend/services/image_job_service.py`: Create, update, complete image jobs
- `backend/services/video_job_service.py`: Create, update, complete video jobs
- `frontend/src/lib/jobTracking.ts`: Frontend API wrappers for job operations
- `frontend/src/components/utils.ts`: ComfyUI monitoring, WebSocket, RunPod polling

**Workflow System:**
- `backend/services/workflow_service.py` (lines 1-230): Load templates, substitute parameters, validate
- `backend/api/comfyui.py`: Submit workflow to ComfyUI via WorkflowService
- `frontend/src/lib/workflowUtils.ts`: Fetch workflow definitions (legacy, deprecated)

**Execution Backends:**
- ComfyUI: `backend/services/comfyui_service.py` (GET /queue, /system_stats)
- RunPod: `backend/services/runpod_service.py` (submit parameters, poll status)
- Frontend toggle: `frontend/src/components/ExecutionBackendToggle.tsx`
- Context: `frontend/src/contexts/ExecutionBackendContext.tsx`
- Configuration: `backend/config/settings.py` (ENABLE_RUNPOD, RUNPOD_ENDPOINT_*)

**Storage Operations:**
- `backend/services/storage_service.py` (lines 1-150+): Download from ComfyUI, upload to Supabase
- `backend/api/storage.py`: Storage endpoints (upload video, get URL)
- `frontend/src/lib/storageUtils.ts`: Frontend storage helpers

**Feed/History:**
- `backend/api/feed.py`: Unified endpoint for image + video jobs
- `frontend/src/pages/GenerationFeed.tsx`: Legacy history view
- `frontend/src/components/UnifiedFeed.tsx`: Real-time job feed with filtering

## Naming Conventions

**Files:**

- Backend API route files: `snake_case.py` (auth.py, image_jobs.py, comfyui.py)
- Backend service files: `snake_case_service.py` (image_job_service.py, workflow_service.py)
- Backend model files: `snake_case.py` (image_job.py, video_job.py, user.py)
- Frontend components: `PascalCase.tsx` (Lipsync.tsx, ImageEdit.tsx, UnifiedFeed.tsx)
- Frontend utilities: `camelCase.ts` (jobTracking.ts, studioConfig.ts, apiClient.ts)
- Frontend contexts: `PascalCase.tsx` (AuthContext.tsx, ExecutionBackendContext.tsx)
- Frontend hooks: `camelCase.ts` (useSmartResolution.ts)

**Directories:**

- Backend: `lowercase_underscore` (api, services, models, core, config, workflows, migrations, tests, runpod_handlers)
- Frontend: `lowercase` (pages, components, lib, hooks, contexts, types, constants, config, assets)

**Variables & Functions:**

**Backend (Python):**
- Functions: `snake_case()`
- Classes: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Private methods: `_snake_case()`
- Async functions: `async def snake_case():`

**Frontend (TypeScript):**
- Functions: `camelCase()` or `PascalCase()` for components
- Variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` or `camelCase`
- Interfaces: `PascalCase`
- Type unions: `'pending' | 'processing' | 'completed'`

**Database & API:**
- Table names: `snake_case` (image_jobs, video_jobs, users)
- Column names: `snake_case` (user_id, created_at, comfy_job_id)
- API routes: `/snake_case` or `/snake-case` (POST /api/image-jobs, GET /api/feed)
- Query params: `snake_case` (workflow_name, user_id)

## Where to Add New Code

**New Feature Page:**
- Primary code: `frontend/src/pages/YourFeatureName.tsx`
- Register in: `frontend/src/lib/studioConfig.ts` (add AppConfig + StudioConfig entry)
- Update: `frontend/src/App.tsx` (add to validPages type, add navigation button, add route)
- Backend API: `backend/api/your_feature.py` (new router if needed)
- Services: `backend/services/your_feature_service.py` (if needs business logic)
- Models: `backend/models/your_feature.py` (request/response validation)
- Job tracking: Use existing image_jobs or video_jobs endpoints if job-based
- Sidebar feed: Include UnifiedFeed component with appropriate pageContext filter

**New Job Type (e.g., Audio Job):**
- Models: `backend/models/audio_job.py` (AudioJob, CreateAudioJobPayload, etc.)
- Service: `backend/services/audio_job_service.py` (CRUD operations)
- API: `backend/api/audio_jobs.py` (endpoints: POST, GET, PUT)
- Registration: Add router in `backend/main.py` (app.include_router(audio_jobs.router))
- Frontend: Use via `frontend/src/lib/jobTracking.ts` functions
- Database: Create tables (audio_jobs, workflows with audio workflow types)

**New Utility Function:**
- Shared backend: `backend/services/shared_name_service.py` or `backend/core/helper.py`
- Shared frontend: `frontend/src/lib/helperName.ts`
- Component-specific: `frontend/src/components/utils.ts` (if used by multiple components)
- Page-specific: Within page file (if used only by that page)

**New Custom Hook:**
- Location: `frontend/src/hooks/useFeatureName.ts`
- Pattern: Export function returning object of state/callbacks
- Used by: Import in page components that need the hook

**New Configuration:**
- Backend: Add to `backend/config/settings.py` as property
- Frontend: Add to `frontend/src/config/environment.ts`
- Environment variable: Document in `.env.example` files

**New Context Provider:**
- Location: `frontend/src/contexts/FeatureContext.tsx`
- Pattern: Create context, define interface, export Provider component + useHook
- Registration: Add to main.tsx provider chain (wrap AuthProvider, ThemeProvider, etc.)
- Usage: Import hook in components that need context

## Special Directories

**backend/workflows/**
- Purpose: ComfyUI workflow JSON templates (not code)
- Generated: No (manually created by exporting from ComfyUI UI)
- Committed: Yes (version control workflow definitions)
- Organization: Root level or organized by feature (ImageStudio/, CreateImage/, etc.)
- Pattern: {{PLACEHOLDER}} for dynamic values; loaded at runtime by WorkflowService

**backend/migrations/**
- Purpose: Database schema changes (SQL scripts)
- Generated: No (manually written)
- Committed: Yes (track schema evolution)
- Applied: Manually run against Supabase before/after deployments
- Naming: numbered (001_, 002_, 003_, 004_)

**backend/tests/**
- Purpose: Automated test suite
- Generated: No (manually written)
- Committed: Yes (test code is source code)
- Organization: Mirror backend structure (test_workflows_static.py, test_workflow_service.py, etc.)
- Execution: `pytest` command runs all tests

**backend/runpod_handlers/**
- Purpose: Reference template for RunPod handler deployment
- Generated: No (template for reference)
- Committed: Yes (for reference/documentation)
- Used: Copy as template when deploying workflows to RunPod
- Note: Actual handlers deployed to RunPod servers (not in this repo)

**frontend/public/**
- Purpose: Static files served by Vite
- Generated: No (static assets)
- Committed: Yes (part of app)
- Served: Without bundling
- Note: Workflows moved to backend/workflows/, public/workflows/ is legacy/deprecated

**.planning/codebase/**
- Purpose: Codebase analysis documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: Yes (created by codebase mapper)
- Committed: Yes (consumed by other GSD commands)
- Used by: `/gsd:plan-phase` and `/gsd:execute-phase`
- Format: Markdown, following standard templates
