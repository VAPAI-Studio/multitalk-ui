# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sideOUTsticks is a full-stack application for AI-powered video and audio processing with multi-character conversations. The application integrates with ComfyUI for workflow execution and Supabase for authentication and data storage.

## Development Commands

### Backend (FastAPI)

```bash
# Setup
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration

# Run development server
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000

# Test authentication
python test_auth.py
```

### Frontend (React + TypeScript + Vite)

```bash
# Setup
cd frontend
npm install

# Run development server (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

### Testing

```bash
# Backend tests
cd backend
pip install -r requirements-dev.txt  # First time only
pytest                                # Run all tests
pytest --cov                         # With coverage

# Run specific test layers
pytest tests/test_workflows_static.py  # Static validation
pytest tests/test_workflow_service.py  # Service unit tests
pytest tests/test_comfyui_api.py       # API integration
pytest tests/workflows/                # Workflow contracts
```

**See [TESTING.md](TESTING.md) for complete testing guide.**

### Running Full Stack

Open two terminals:
- Terminal 1: Backend on port 8000
- Terminal 2: Frontend on port 5173

## Architecture

### Backend Structure

The backend follows a layered architecture:

```
backend/
├── main.py                 # FastAPI app entry point, router registration
├── api/                    # API endpoints (route handlers)
│   ├── auth.py            # Authentication endpoints
│   ├── multitalk.py       # MultiTalk video generation
│   ├── style_transfer.py  # Style transfer endpoints
│   └── ...
├── models/                 # Pydantic models for request/response validation
├── services/              # Business logic layer
│   ├── comfyui_service.py # ComfyUI workflow execution
│   ├── storage_service.py # Supabase storage operations
│   └── ...
├── core/                   # Core utilities
│   ├── supabase.py        # Supabase client singleton
│   └── auth.py            # JWT authentication utilities
└── config/
    └── settings.py        # Application settings from environment
```

**Key architectural patterns:**
- API routes in `api/` handle HTTP, delegate to services
- Services in `services/` contain business logic, interact with external APIs
- Models define data validation and serialization
- Core utilities provide shared functionality (DB client, auth)

### Frontend Structure

The frontend is a single-page application with navigation state:

```
frontend/src/
├── App.tsx                # Main app with auth guard, navigation, header
├── main.tsx              # Entry point with AuthProvider
├── contexts/
│   └── AuthContext.tsx   # Global auth state (login, logout, user)
├── components/           # Reusable UI components
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── ComfyUIStatus.tsx
│   └── ...
├── config/
│   └── environment.ts    # Auto-detects dev/prod, configures API URL
└── [Feature].tsx         # Page-level components (MultiTalkOnePerson, etc.)
```

**Key architectural patterns:**
- App.tsx manages page navigation state (stored in localStorage)
- AuthContext provides authentication state globally via React Context
- Environment config automatically detects dev (localhost:8000) vs prod (Heroku)
- Page components are loaded conditionally based on navigation state

### Authentication Flow

1. Frontend checks localStorage for token on load
2. If token exists, AuthContext verifies it with `/api/auth/me`
3. If invalid/missing, user sees Login/Register screens
4. On login, token stored in localStorage, AuthContext updates
5. Protected API calls include `Authorization: Bearer {token}` header
6. Backend `get_current_user()` dependency validates JWT via Supabase

### ComfyUI Integration

The app executes AI workflows via ComfyUI using a centralized workflow system:
1. User uploads media through frontend
2. Frontend sends parameters to backend API endpoint
3. Backend loads workflow template from `backend/workflows/`
4. Backend fills template with user parameters (filenames, prompts, dimensions, etc.)
5. Backend validates and sends workflow to ComfyUI server
6. Backend monitors for completion, retrieves output
7. Output stored in Supabase Storage, URL returned to frontend

ComfyUI server URL is configurable in the UI header.

**See [WORKFLOW_SYSTEM.md](WORKFLOW_SYSTEM.md) for detailed documentation on the workflow system, including how to create and use workflow templates.**

### RunPod Serverless Integration

The app supports dual execution backends — users can choose between local ComfyUI or cloud-based RunPod serverless:

**Features:**
- **User Toggle**: Each user can switch between ComfyUI (local) and RunPod (cloud) execution
- **Feature Flag**: `ENABLE_RUNPOD=true` to enable (disabled by default)
- **Single Credential**: Global RunPod API key (not per-user)
- **Single Endpoint**: One universal ComfyUI endpoint handles all workflows
- **Unified Monitoring**: Same job tracking system for both backends

**Architecture:**

One RunPod serverless endpoint runs ComfyUI. All workflows use this same endpoint:
1. Backend loads the workflow template and fills parameters (same as local ComfyUI path)
2. Backend sends the **full workflow JSON** to the universal RunPod endpoint
3. The universal handler (`backend/runpod_handlers/universal_handler.py`) forwards it to internal ComfyUI
4. Models live on the **network volume** (not in the Docker image) — managed via the Infrastructure file browser
5. Only Dockerfile changes are needed when adding new **custom nodes**

**How it works:**
1. User selects execution backend via toggle (🖥️ Local / ☁️ Cloud)
2. Frontend checks ExecutionBackendContext for user preference
3. For RunPod: Backend loads workflow template, fills params, sends full JSON to `RUNPOD_ENDPOINT_ID`
4. RunPod handler passes workflow JSON to its internal ComfyUI instance
5. Jobs tracked in database with `execution_backend` field
6. RunPod jobs polled every 3s (similar to ComfyUI monitoring)
7. Outputs returned as base64, uploaded to Supabase Storage

**Configuration (.env):**
```bash
# Feature flag (default: false)
ENABLE_RUNPOD=true

# RunPod credentials
RUNPOD_API_KEY=your-runpod-api-key

# Universal ComfyUI serverless endpoint — one endpoint for all workflows
RUNPOD_ENDPOINT_ID=your-universal-comfyui-endpoint-id

# Optional timeout (default: 600 seconds)
RUNPOD_TIMEOUT=600
```

**Deployment Process:**

1. Deploy `backend/runpod_handlers/universal_handler.py` to a RunPod serverless endpoint
   - Handler accepts `{"input": {"workflow": {...full ComfyUI workflow JSON...}}}`
   - Handler runs ComfyUI internally, polls for completion, returns base64 outputs
2. Mount the network volume to the endpoint — models are managed via the Infrastructure file browser
3. For new custom nodes: update the Dockerfile, rebuild and redeploy the single endpoint
4. Set `RUNPOD_ENDPOINT_ID` in `.env` to the deployed endpoint ID

**Database Schema:**
- `execution_backend` ENUM ('comfyui', 'runpod') - tracks which backend was used
- `runpod_job_id` TEXT - RunPod job ID (null for ComfyUI jobs)
- `runpod_endpoint_id` TEXT - RunPod endpoint used

**Frontend:**
- `ExecutionBackendContext` - manages user preference (persisted in localStorage + Supabase user_metadata)
- `ExecutionBackendToggle` - UI toggle component in header
- Toggle only shows if RunPod is enabled and configured

**API Endpoints:**
- `POST /api/runpod/submit-workflow` - Submit workflow to RunPod (loads template, fills params, sends full JSON)
- `GET /api/runpod/status/{job_id}` - Check RunPod job status
- `POST /api/runpod/cancel/{job_id}` - Cancel RunPod job
- `GET /api/runpod/health` - Check RunPod configuration

**Backend Implementation:**
- `backend/services/runpod_service.py` - Builds workflow JSON via WorkflowService, submits to RUNPOD_ENDPOINT_ID
- `backend/api/runpod.py` - API routes for RunPod operations
- `backend/runpod_handlers/universal_handler.py` - Deployable handler (proxies workflow JSON to local ComfyUI)

**Migration:**
Run `backend/migrations/004_add_runpod_support.sql` to add required database fields.

### Environment Configuration

**Backend (.env):**
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` - Required for auth and storage
- `OPENROUTER_API_KEY` - For AI model API calls
- `COMFYUI_SERVER_URL` - Default ComfyUI server
- `ENABLE_RUNPOD` - Feature flag for RunPod integration (default: false)
- `RUNPOD_API_KEY` - RunPod API key (required if ENABLE_RUNPOD=true)
- `RUNPOD_ENDPOINT_ID` - RunPod endpoint ID (required if ENABLE_RUNPOD=true)
- `RUNPOD_TIMEOUT` - RunPod request timeout in seconds (default: 600)
- Heroku deployment: Uses Heroku config vars instead of .env

**Frontend:**
- `VITE_API_BASE_URL` - Override API URL (optional)
- Auto-detects environment: localhost → `http://localhost:8000/api`, deployed → Heroku backend
- See `frontend/src/config/environment.ts` for detection logic

### Supabase Setup

Authentication requires Supabase configuration:
- Go to Supabase Dashboard → Authentication → Providers
- Enable Email provider
- Disable "Confirm email" for development
- See `backend/setup_supabase_auth.md` for detailed instructions

### Branch Workflow

- `main` - Production-ready code
- `dev` - Integration branch for testing features
- `feature-*` - Feature branches created from `dev`

Create feature branches from dev, merge back to dev for testing, then dev to main for release.

## Related Documentation

For specialized topics, see these additional guides:

- **[new_feature_guide.md](new_feature_guide.md)** - Comprehensive guide for creating new AI workflow features with step-by-step instructions, component patterns, and integration requirements
- **[WORKFLOW_SYSTEM.md](WORKFLOW_SYSTEM.md)** - Complete documentation on the centralized workflow system, including template creation, parameter substitution, API usage, and migration guide
- **[TESTING.md](TESTING.md)** - Comprehensive testing guide covering all test layers, running tests, writing tests, workflow testing, and CI/CD integration
- **[api_doc.md](api_doc.md)** - Complete ComfyUI server API reference documenting all REST endpoints, WebSocket integration, and workflow execution patterns
- **[backend/setup_supabase_auth.md](backend/setup_supabase_auth.md)** - Supabase authentication setup instructions including provider configuration and troubleshooting
- **[TODO.md](TODO.md)** - Project roadmap and planned improvements across security, testing, performance, and features

### Current Features

As of the latest update, the application includes these features:

- **Lipsync 1 Person** - Generate realistic talking videos from a single person image with custom audio (Model: Multitalk and Infinite Talk with WAN 2.1)
- **Lipsync Multi Person** - Create conversations between multiple people with synchronized audio and video (Model: Multitalk and Infinite Talk with WAN 2.1)
- **Video Lipsync** - Add perfect lip-synchronization to existing videos with new audio tracks (Model: Infinite Talk with WAN 2.1)
- **Image Edit** - Edit and enhance images using AI-powered editing with natural language instructions (Model: Nano Banana)
- **Character Caption** - Generate detailed captions for character images to create training datasets for LoRA models (Model: JoyCaption Beta 2)
- **WAN I2V** - Transform images into captivating videos with AI-powered image-to-video generation (Model: WAN I2V)
- **Style Transfer** - Transfer artistic styles between images using AI (Model: Flux with USO Style Reference)
- **Generation Feed** - View and manage all generations across all features in one unified interface

---

Use context7 to check for up-to-date documentation when needed for implementing new libraries or frameworks, or adding features using them.


@new_feature_guide.md
@WORKFLOW_SYSTEM.md
@TESTING.md
@api_doc.md
@backend/setup_supabase_auth.md
@TODO.md
