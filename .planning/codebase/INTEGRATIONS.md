# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**AI Workflow Execution:**
- ComfyUI - Self-hosted workflow server for image/video generation
  - SDK/Client: httpx async HTTP client
  - Connection: `COMFYUI_SERVER_URL` (default: https://comfy.vapai.studio)
  - Auth: Optional `COMFY_API_KEY` for authenticated endpoints
  - WebSocket: Real-time progress monitoring via `/ws?clientId={uuid}`
  - Usage: Core workflow engine for all image/video AI operations

**Cloud Serverless Execution:**
- RunPod Serverless - Cloud-based ComfyUI workflow execution (optional)
  - SDK/Client: httpx async HTTP client to https://api.runpod.io/v2
  - Connection: `RUNPOD_API_KEY` environment variable
  - Feature Flag: `ENABLE_RUNPOD` (default: false)
  - Config: `backend/config/runpod_endpoints.py` maps workflows to endpoint IDs
  - Usage: Alternative execution backend when local ComfyUI unavailable
  - Endpoints: Workflow-specific serverless handlers pre-deployed on RunPod

**AI Image Processing:**
- OpenRouter API - Multi-model AI image editing and generation
  - SDK/Client: httpx async HTTP client
  - Auth: `OPENROUTER_API_KEY` environment variable
  - Model: google/gemini-2.5-flash-image-preview (for image editing)
  - Usage: Image editing endpoint via `/api/image-edit`
  - Base URL: https://openrouter.ai/api/v1

**World Labs (Video AI):**
- World Labs API - Advanced video generation and manipulation
  - SDK/Client: httpx async HTTP client
  - Auth: `WORLDLABS_API_KEY` environment variable
  - Usage: WAN I2V and advanced video workflows
  - Status: Configured but details in `backend/services/worldlabs_service.py`

## Data Storage

**Databases:**
- Supabase PostgreSQL
  - Connection: `SUPABASE_URL` endpoint
  - Service Role Key: `SUPABASE_SERVICE_ROLE_KEY` (server-side, bypasses RLS)
  - Anon Key: `SUPABASE_ANON_KEY` (client-side, enforces RLS)
  - Legacy Key: `SUPABASE_KEY` (deprecated, used as fallback)
  - Client: Supabase Python library `supabase>=2.3.0`
  - Tables: video_jobs, image_jobs, users, workflows, datasets, projects, etc.
  - Authentication: Supabase built-in email provider
  - RLS: Row-level security policies (currently disabled per comments in code)

**File Storage:**
- Supabase Storage (S3-compatible object storage)
  - Buckets:
    - `multitalk-videos` - Video outputs and inputs
    - `edited-images` - Image editing outputs
    - Project-specific buckets - Google Drive integrations
  - Access: Via Supabase Python SDK with service role key
  - Operations: Upload, download, delete, list files
  - Signed URLs: Auto-generated for public access with expiration

**Caching:**
- Frontend: Browser localStorage for auth tokens
- Frontend: Simple in-memory cache (30s TTL) for API responses in apiClient
- Backend: cachetools library for optional response caching (not actively used)
- Database: Supabase query optimization with indexes

## Authentication & Identity

**Auth Provider:**
- Supabase Authentication
  - Email/password authentication via Supabase auth service
  - JWT tokens issued by Supabase
  - Token storage: localStorage (`vapai-auth-token`)
  - Refresh mechanism: ApiClient attempts refresh on 401
  - User metadata: Extensible user profile in auth.users table
  - Allowed domains: vapai.studio, sideoutsticks.com (configurable)

**Frontend Implementation:**
- AuthContext (React) - Global auth state management
- Protected routes - Conditional rendering based on auth status
- Token header injection - Bearer token added to all API requests

**Backend Implementation:**
- `backend/core/auth.py` - JWT validation and user extraction
- `backend/api/auth.py` - Auth endpoints: register, login, me, logout
- `get_current_user()` - FastAPI dependency for protected routes
- Email domain validation on registration

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry or error tracking service configured
- TODO: Error tracking service integration (mentioned in TODO.md)

**Logs:**
- Backend: Standard Python logging to stdout (Heroku-friendly)
- Frontend: Browser console logs (development)
- ComfyUI: Internal ComfyUI logs on execution server

## CI/CD & Deployment

**Hosting:**
- Heroku - Primary production deployment platform
  - Detection: Check for DYNO environment variable
  - Environment: Heroku config vars instead of .env
  - Port: Dynamically assigned via PORT env var
  - Buildpack: Node.js (frontend) + Python (backend)

**Version Control:**
- Git repository with branches: main (production), dev (integration), feature/* (development)

**CI Pipeline:**
- GitHub Actions (configured but workflow file location not verified)
- Tests: pytest for backend

## Environment Configuration

**Required env vars (Backend):**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY` - Supabase authentication
- `OPENROUTER_API_KEY` - For image editing features
- `COMFYUI_SERVER_URL` - ComfyUI server endpoint (default provided)
- Heroku deployment: Set via Heroku dashboard or CLI

**Required env vars (Frontend):**
- `VITE_API_BASE_URL` - Backend API base URL (auto-detected based on environment)
- Vite automatically injects VITE_* prefixed variables at build time

**Optional env vars (Backend):**
- `ENABLE_RUNPOD` - Enable RunPod serverless (false by default)
- `RUNPOD_API_KEY` - RunPod API credentials
- `RUNPOD_ENDPOINT_*` - Workflow-specific RunPod endpoints (e.g., RUNPOD_ENDPOINT_VIDEOLIPSYNC)
- `WORLDLABS_API_KEY` - World Labs API credentials
- `GOOGLE_DRIVE_CREDENTIALS_FILE` or `GOOGLE_DRIVE_CREDENTIALS_JSON` - Drive access
- `GOOGLE_DRIVE_SHARED_DRIVE_ID` - Shared Drive ID for uploads
- Debug flags: `DEBUG=true`

**Optional env vars (Frontend):**
- `VITE_ENABLE_DEBUG` - Enable debug mode
- `VITE_ENABLE_ANALYTICS` - Enable analytics (placeholder)

**Secrets location:**
- Development: `.env` file (not committed to git)
- Production (Heroku): Heroku Config Vars dashboard
- Google Drive credentials: Service account JSON (file path or inline JSON string)

## Webhooks & Callbacks

**Incoming:**
- None detected - No webhook endpoints configured

**Outgoing:**
- None detected - No outgoing webhook calls

**Real-time Communication:**
- WebSocket to ComfyUI `/ws?clientId={uuid}` - Receive job progress events
- Message types: status, execution_start, executing, progress, executed, execution_success, execution_error, execution_interrupted
- Frontend listens for completion and progress updates

## Job Execution Flow

**ComfyUI Workflow Execution:**
1. Frontend uploads media to ComfyUI input folder via `/upload/image` endpoint
2. Frontend calls backend API (e.g., `/api/multitalk/submit`) with parameters
3. Backend loads workflow template from `backend/workflows/` directory
4. Backend submits workflow to ComfyUI via `POST /prompt`
5. ComfyUI returns `prompt_id`
6. Backend creates job record in Supabase (video_jobs or image_jobs table)
7. Frontend monitors progress via WebSocket connection to ComfyUI
8. On completion, backend retrieves outputs from ComfyUI `/history/{prompt_id}`
9. Backend uploads output files to Supabase Storage
10. Job marked as completed in database with signed URLs

**RunPod Serverless Execution (Optional):**
1. Feature enabled via `ENABLE_RUNPOD=true`
2. User toggles execution backend in UI (ExecutionBackendContext)
3. Backend routes to RunPod instead of ComfyUI using `backend/services/runpod_service.py`
4. Submits workflow parameters (not full JSON) to workflow-specific endpoint
5. Polls RunPod `/status/{job_id}` for completion
6. Same output upload process to Supabase Storage

## Google Drive Integration

**Configuration:**
- Service account credentials (file path or JSON string in env var)
- Shared Drive ID for centralized project storage
- Google Drive API v3 via `google-api-python-client>=2.100.0`

**Operations:**
- List files and folders in shared drive
- Create/upload project datasets
- Organize training files by project
- Connection: `backend/core/google_drive.py` singleton client
- Service: `backend/services/google_drive_service.py`

**API Endpoint:**
- `POST /api/google-drive/upload` - Upload files to Drive
- `GET /api/google-drive/files` - List Drive contents
- `GET /api/google-drive/projects` - List projects (folders)

## Workflow Management

**Workflow Storage:**
- Templates stored in `backend/workflows/` (version controlled)
- Subdirectories organize by workflow type (ComfyUI, ImageStudio, etc.)
- Placeholder system: `{{PARAMETER_NAME}}` replaced at runtime

**Workflow Types (Current):**
- lipsync-one - Single person video generation
- lipsync-multi - Multi-person conversation generation
- video-lipsync - Lip-sync for existing video
- image-edit - AI image editing
- character-caption - Dataset generation
- wan-i2v - Image-to-video conversion
- style-transfer - Artistic style transfer
- image-studio - Advanced image generation workflows

---

*Integration audit: 2026-03-04*
