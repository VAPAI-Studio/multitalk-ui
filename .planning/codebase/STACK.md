# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- TypeScript 5.8.3 - Frontend development with React and type safety
- Python 3.11+ - Backend API and AI workflow orchestration

**Secondary:**
- JavaScript/JSX - Generated from TypeScript, used in frontend bundles
- SQL - PostgreSQL migrations and schema management in Supabase

## Runtime

**Environment:**
- Node.js 20.x+ (frontend development and build)
- Python 3.11+ (backend with FastAPI/Uvicorn)

**Package Manager:**
- npm 10.x+ (frontend dependencies)
- pip (Python virtual environment)
- Lockfile: `frontend/package-lock.json` present

## Frameworks

**Core:**
- FastAPI 0.104.1+ - Backend REST API framework with async support
- React 19.1.1 - Frontend UI library for component-based rendering
- Vite 7.1.2 - Frontend build tool and dev server

**Testing:**
- pytest 7.4.0+ - Backend test framework with async support (pytest-asyncio)
- pytest-cov - Code coverage measurement
- pytest-mock - Mock/patch utilities for unit testing

**Build/Dev:**
- TypeScript 5.8.3 - Type-safe JavaScript compilation
- Uvicorn 0.24.0+ - ASGI application server with uvloop/httptools support
- Gunicorn 21.2.0+ - Production Python application server
- TailwindCSS 3.4.17 - Utility-first CSS framework
- PostCSS 8.5.6 - CSS processing with Autoprefixer
- ESLint 9.33.0 - JavaScript/TypeScript linting
- Autoprefixer 10.4.21 - CSS vendor prefix automation

## Key Dependencies

**Critical:**
- Pydantic 2.5.1+ - Data validation and serialization (backend)
- Pydantic-settings 2.1.0+ - Environment configuration management
- httpx 0.25.2+ - Async HTTP client (backend service integrations)
- Supabase-py 2.3.0+ - PostgreSQL database and Storage access
- websockets 12.0+ - WebSocket support for real-time ComfyUI updates

**Infrastructure:**
- python-dotenv 1.0.0+ - Environment variable loading from .env files
- python-multipart 0.0.6+ - Multipart form data parsing
- google-api-python-client 2.100.0+ - Google Drive API interaction
- google-auth 2.23.0+ - Service account authentication for Google APIs
- cachetools 5.3.0+ - Caching utilities for API responses
- aiohttp 3.9.0+ - Async HTTP library for parallel requests
- email-validator 2.0.0+ - Email format validation
- Pillow 10.2.0+ - Image processing and manipulation
- jszip 3.10.1+ - ZIP file creation in browser (frontend)
- Three.js 0.183.1+ - 3D graphics for splat viewer (frontend)

**Frontend Additional:**
- @sparkjsdev/spark 0.1.10 - UI component utilities
- react-dom 19.1.1 - React rendering for DOM
- @types/react 19.1.10 - TypeScript definitions for React
- @types/react-dom 19.1.7 - TypeScript definitions for React DOM
- @types/node 20.11.0 - TypeScript definitions for Node.js
- @types/three 0.183.1 - TypeScript definitions for Three.js
- @vitejs/plugin-react 5.0.0 - Vite React plugin with fast refresh
- typescript-eslint 8.39.1 - TypeScript-aware ESLint rules
- eslint-plugin-react-hooks 5.2.0 - React hooks linting
- eslint-plugin-react-refresh 0.4.20 - Vite refresh plugin linting

## Configuration

**Environment:**
- Backend: `.env` file with variable loading via `python-dotenv` and Pydantic `BaseSettings`
- Frontend: Vite environment variables via `VITE_*` prefixes in `.env` files
- Production (Heroku): Environment variables set via Heroku Config Vars (no .env file needed)
- Fallback: Legacy `SUPABASE_KEY` for backward compatibility with newer key names

**Build:**
- `frontend/vite.config.ts` - Vite build configuration with React plugin
- `frontend/tsconfig.json` - TypeScript compiler options with references to app/node configs
- `frontend/tsconfig.app.json` - App-specific TypeScript configuration
- `frontend/tsconfig.node.json` - Node-specific TypeScript configuration
- `backend/config/settings.py` - Pydantic Settings class with environment variable mapping
- `backend/config/runpod_endpoints.py` - Workflow-specific RunPod endpoint configuration

## Platform Requirements

**Development:**
- Local ComfyUI server or cloud-based endpoint for workflow execution
- Supabase account with PostgreSQL database and storage buckets
- Optional: Google Drive service account credentials for drive integration
- Optional: RunPod API key and endpoint IDs for serverless execution
- Optional: OpenRouter API key for image editing features
- Optional: Kohya SS installation for model training features

**Production:**
- Heroku (deployed backend and frontend)
- Supabase (PostgreSQL database, authentication, storage)
- ComfyUI server or RunPod serverless endpoints (workflow execution)
- Optional: Google Drive Shared Drive access
- Optional: RunPod serverless infrastructure

## Database

**Primary Database:**
- PostgreSQL (via Supabase) - Relational data storage
- Service role key - Server operations (bypasses RLS)
- Anon key - Client operations (enforces RLS)

**Storage:**
- Supabase Storage - S3-compatible object storage for videos, images, datasets
- Buckets: `multitalk-videos`, `edited-images`, and custom project buckets

## Authentication

**Frontend:**
- JWT tokens stored in localStorage (`vapai-auth-token`)
- Token refresh mechanism with Supabase backend
- Bearer token included in API request headers

**Backend:**
- Supabase authentication (email/password)
- JWT validation on protected endpoints
- Allowed email domains: `vapai.studio`, `sideoutsticks.com`

---

*Stack analysis: 2026-03-04*
