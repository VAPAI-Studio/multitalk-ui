# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VAPAI Studio is a full-stack application for AI-powered video and audio processing with multi-character conversations. The application integrates with ComfyUI for workflow execution and Supabase for authentication and data storage.

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

The app executes AI workflows via ComfyUI:
1. User uploads media through frontend
2. Frontend sends to backend API endpoint
3. Backend loads workflow JSON from `frontend/public/workflows/`
4. Backend modifies workflow with user inputs (image paths, prompts, etc.)
5. Backend sends workflow to ComfyUI server via WebSocket
6. Backend polls for completion, retrieves output
7. Output stored in Supabase Storage, URL returned to frontend

ComfyUI server URL is configurable in the UI header.

### Environment Configuration

**Backend (.env):**
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` - Required for auth and storage
- `OPENROUTER_API_KEY` - For AI model API calls
- `COMFYUI_SERVER_URL` - Default ComfyUI server
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


@new_feature_guide.md
@api_doc.md
@backend/setup_supabase_auth.md
@TODO.md