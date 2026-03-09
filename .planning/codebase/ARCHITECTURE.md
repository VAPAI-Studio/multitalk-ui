# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Layered Client-Server Architecture with Studio-based Frontend Organization

**Key Characteristics:**
- **Backend-as-BFF (Backend for Frontend)**: Backend serves as API layer for all frontend operations; frontend never connects directly to Supabase
- **Studio-based Frontend Routing**: Apps organized into logical studio groups (Lipsync Studio, Image Studio, etc.) with centralized configuration
- **Job-centric Data Model**: All AI operations (image/video generation) modeled as jobs with unified tracking across backends (ComfyUI + RunPod)
- **Dual Execution Backends**: Users can toggle between local ComfyUI or cloud-based RunPod serverless execution with feature flag control
- **Centralized Workflow Templates**: ComfyUI workflows stored on backend with parameter substitution system
- **Authentication-First**: JWT-based auth via Supabase with automatic token refresh in frontend API client

## Layers

**Presentation Layer (Frontend - React + TypeScript):**
- Purpose: User interface and user interactions, state management
- Location: `frontend/src/`
- Contains: Page components, UI components, context providers, custom hooks
- Depends on: API Client (Backend), Local Storage, Context providers
- Used by: Browser clients (React app)

**API Communication Layer (Frontend):**
- Purpose: Centralized HTTP communication with retry/caching logic
- Location: `frontend/src/lib/apiClient.ts`
- Contains: Request/response handling, token refresh, automatic retries, response caching (30s TTL for feed data)
- Depends on: AuthContext (for token retrieval), Environment configuration
- Used by: All page components and service functions

**Routing & State Management (Frontend):**
- Purpose: Application navigation, page state, user preferences, execution backend selection
- Location: `frontend/src/App.tsx`, `frontend/src/contexts/`, `frontend/src/lib/studioConfig.ts`
- Contains: Current page tracking (localStorage), studio/app definitions, execution backend context, auth context
- Depends on: Local storage, API client
- Used by: All pages and components

**Middleware Layer (Backend - FastAPI):**
- Purpose: CORS handling, request validation, error handling
- Location: `backend/main.py`
- Contains: Router registration, CORS configuration, health checks
- Depends on: All API routers
- Used by: Frontend clients

**API Endpoints Layer (Backend):**
- Purpose: HTTP request/response handling, request validation, authentication
- Location: `backend/api/*.py` (auth.py, image_jobs.py, video_jobs.py, comfyui.py, feed.py, runpod.py, etc.)
- Contains: FastAPI route handlers, request/response models, dependency injection
- Depends on: Services layer, Core utilities (auth, supabase)
- Used by: Frontend API client

**Business Logic Layer (Backend - Services):**
- Purpose: Core business logic, external API orchestration, data transformation
- Location: `backend/services/*.py` (comfyui_service.py, image_job_service.py, video_job_service.py, storage_service.py, runpod_service.py, workflow_service.py, etc.)
- Contains: Job creation/update logic, ComfyUI/RunPod integration, storage operations, workflow template processing
- Depends on: Data models, Core utilities, External APIs (Supabase, ComfyUI, RunPod)
- Used by: API endpoints

**Data Models Layer (Backend):**
- Purpose: Request/response validation, type definitions, database schema contracts
- Location: `backend/models/*.py` (image_job.py, video_job.py, user.py, workflow.py, etc.)
- Contains: Pydantic models for validation and serialization
- Depends on: Python types, Pydantic
- Used by: API endpoints, Services

**Core Utilities Layer (Backend):**
- Purpose: Shared functionality across layers
- Location: `backend/core/` (supabase.py, auth.py)
- Contains: Supabase client singleton, JWT authentication, user verification
- Depends on: External libraries (supabase-py, FastAPI)
- Used by: All other layers

**Configuration Layer (Backend & Frontend):**
- Purpose: Environment-specific settings and initialization
- Location: `backend/config/settings.py`, `frontend/src/config/environment.ts`
- Contains: Environment variables, API URLs, feature flags (ENABLE_RUNPOD), storage buckets
- Depends on: Environment variables, .env files (backend only)
- Used by: All layers

**Workflow Engine (Backend):**
- Purpose: ComfyUI workflow template management and execution parameter handling
- Location: `backend/services/workflow_service.py`, `backend/workflows/`
- Contains: Template loading, placeholder substitution, validation
- Depends on: File system, JSON parsing
- Used by: ComfyUI API endpoints, services

## Data Flow

**Image/Video Generation Flow:**

1. User uploads files and parameters in frontend page component
2. Frontend validates input and submits to backend API endpoint (e.g., `POST /api/image-jobs/`)
3. API endpoint validates request, calls service layer
4. Service layer:
   - Determines execution backend (ComfyUI vs RunPod based on context)
   - Creates job record in Supabase with status 'pending'
   - For ComfyUI: Loads workflow template, substitutes parameters, submits to ComfyUI server
   - For RunPod: Calls RunPod service to submit parameters to workflow-specific endpoint
5. Backend returns job ID to frontend
6. Frontend starts job monitoring via WebSocket (ComfyUI) or polling (RunPod)
7. On completion, backend uploads output to Supabase Storage, updates job record with output URLs
8. Frontend displays result and updates UnifiedFeed

**Authentication Flow:**

1. User registers/logs in via `POST /api/auth/register` or `/api/auth/login`
2. Backend creates Supabase auth user, returns access token + refresh token
3. Frontend stores tokens in localStorage, updates AuthContext
4. Subsequent API requests include `Authorization: Bearer {token}` header
5. On 401 response, API client calls `refreshAccessToken()` via AuthContext callback
6. AuthContext exchanges refresh token for new access token via `POST /api/auth/refresh`
7. API client retries original request with new token (once)

**Job Status Tracking Flow:**

1. Frontend creates local job record via `createJob(payload)` which calls backend API
2. Backend creates job in `image_jobs` or `video_jobs` table with status='pending'
3. Frontend starts monitoring: `startJobMonitoring(jobId, comfyUrl, callback)`
   - For ComfyUI: Opens WebSocket to receive real-time execution events
   - For RunPod: Polls `/api/runpod/status/{job_id}` every 3 seconds
4. On execution progress, callback updates UI with status message
5. On completion, service uploads output to Supabase Storage
6. Service updates job record with output URLs and status='completed'
7. Frontend receives completion event, displays result
8. User can view job in UnifiedFeed (shows jobs filtered by workflow type)

**State Management Flow:**

1. AuthContext holds authentication state (user, token, login/logout functions)
2. ExecutionBackendContext holds user preference for ComfyUI vs RunPod (persisted in localStorage + Supabase metadata)
3. ProjectContext holds Google Drive folder selection for saving outputs
4. App.tsx maintains current page and ComfyUI URL (persisted in localStorage)
5. studioConfig.ts defines studio/app structure (not stateful, loaded from config)

## Key Abstractions

**Job (Video/Image):**
- Purpose: Represents a single AI generation task
- Examples: `backend/models/video_job.py`, `backend/models/image_job.py`
- Pattern: Each job type has creation/update/completion payloads; services manage job lifecycle
- Fields: id (UUID), user_id, workflow_id, status, inputs (images/videos/audio), outputs (storage URLs), execution_backend (comfyui/runpod), timestamps

**Workflow Template:**
- Purpose: Parameterized ComfyUI workflow with placeholder substitution
- Examples: `backend/workflows/WANI2V.json`, `backend/workflows/ImageEdit.json`
- Pattern: Uses {{PLACEHOLDER}} syntax for dynamic values; service loads, validates, substitutes at runtime
- Process: Template → Load → Substitute parameters → Validate → Submit to ComfyUI

**Studio & App Config:**
- Purpose: Organize applications into logical groups for navigation and homepage display
- Examples: `frontend/src/lib/studioConfig.ts`
- Pattern: Static configuration defining studio hierarchy, icons, gradients, feature flags
- Usage: App.tsx uses this to render sidebar and homepage

**ApiClient:**
- Purpose: Centralized HTTP communication with resilience patterns
- Examples: `frontend/src/lib/apiClient.ts`
- Pattern: Singleton instance with cache, retry logic (3 attempts), token refresh on 401
- Features: 60-second timeout, 30-second cache TTL for feed data, concurrent refresh prevention

**Service Pattern:**
- Purpose: Business logic encapsulation for a feature domain
- Examples: ImageJobService, VideoJobService, ComfyUIService, StorageService
- Pattern: Services accept dependencies (Supabase client, httpx client), return tuples of (success, data, error)
- Error Handling: Never raise exceptions for expected failures; return error in tuple instead

## Entry Points

**Frontend:**
- Location: `frontend/src/main.tsx`
- Triggers: App starts, browser loads index.html
- Responsibilities: Mounts React app with providers (AuthProvider, ThemeProvider), renders App.tsx

**Frontend App:**
- Location: `frontend/src/App.tsx`
- Triggers: AuthProvider hydrates, checks localStorage for saved page
- Responsibilities: Renders sidebar, main content area based on currentPage state, manages page navigation, loads saved ComfyUI URL

**Backend:**
- Location: `backend/main.py`
- Triggers: Server starts (via uvicorn)
- Responsibilities: Creates FastAPI app, configures CORS, registers all API routers (auth, image_jobs, video_jobs, comfyui, feed, runpod, etc.)

**Feature Pages:**
- Location: `frontend/src/pages/*.tsx` (Lipsync.tsx, ImageEdit.tsx, WANI2V.tsx, etc.)
- Triggers: User clicks sidebar button or navigates via App state change
- Responsibilities: Render UI, handle file uploads, submit to backend API, monitor job progress, display results

## Error Handling

**Strategy:** Graceful degradation with user-friendly error messages; never block workflow execution on non-critical failures

**Patterns:**

**Frontend:**
- API request failures: apiClient.request() catches errors, retries (3x), then returns with error; components display error message to user
- AbortError during cleanup: jobTracking.ts catches AbortError from fetch, silently ignores (component unmounting)
- Timeout handling: 60-second fetch timeout; on timeout, error message displayed, user can retry
- Token refresh failure: AuthContext logs out user, clears storage, user redirected to login

**Backend:**
- Validation errors: Pydantic models validate input; invalid requests return 422 with field errors
- Service errors: Services return (False, None, error_message) tuples instead of raising; endpoints convert to HTTPException with 400/500 status
- Job tracking failures: If database write fails, processing continues (job is "tracked but not persisted"); error logged but not shown to user
- External API failures (ComfyUI, RunPod): Return error to frontend; frontend displays message, user can retry or contact support

**Job Failures:**
- ComfyUI node execution error: WebSocket event received, job marked as failed, error message stored in database
- RunPod execution error: Polling detects error status, job marked as failed, error message stored
- Storage upload failure: Job marked as failed with error message; user sees "Generation failed, try again"

## Cross-Cutting Concerns

**Logging:**
- Backend: print() statements logged to stdout/Heroku logs; services log before/after major operations
- Frontend: console.log() for development debugging; errors logged to browser console; structured error context in errorMsg variables

**Validation:**
- Backend: Pydantic models validate all API inputs; email domain whitelist for registration; file type/size checks in storage service
- Frontend: File picker input types restrict uploads; manual validation of prompts/dimensions before submission; ComfyUI health check before job submission

**Authentication:**
- Backend: JWT verification via Supabase; FastAPI dependency `get_current_user()` extracts user from Bearer token
- Frontend: AuthContext manages token lifecycle; apiClient injects Bearer token on all requests; automatic refresh on 401
- Cross-cutting: Supabase client initialized with token from auth layer; job records linked to user_id for access control

**Execution Backend Selection:**
- Frontend: ExecutionBackendContext holds user preference (persisted in localStorage + Supabase user_metadata)
- Backend: ExecutionBackendToggle component shows toggle only if ENABLE_RUNPOD=true
- Service layer: Image/VideoJobService checks execution_backend field, routes to ComfyUI or RunPod handler
- ComfyUI flow: Load template → submit via /prompt → monitor via WebSocket
- RunPod flow: Look up workflow-specific endpoint → submit parameters only → poll for status

**Cross-Environment Configuration:**
- Backend: Single settings.py loads from .env (dev) or Heroku config vars (prod); DYNO env var used to detect Heroku
- Frontend: environment.ts detects production vs development by hostname + Vite mode; uses VITE_API_BASE_URL if set, else auto-detects backend URL
- Both: Favor explicit environment variables over auto-detection for flexibility
