# Coding Conventions

**Analysis Date:** 2025-03-04

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `LipsyncOnePerson.tsx`, `AuthContext.tsx`)
- Utilities and services: camelCase (e.g., `apiClient.ts`, `workflow_service.py`)
- API routes: lowercase with underscores (e.g., `comfyui.py`, `image_jobs.py`)
- Page components stored in: `frontend/src/pages/` and `frontend/src/contexts/`
- Reusable UI components: `frontend/src/components/`

**Functions:**
- Frontend: camelCase (e.g., `handlePageChange`, `startJobMonitoring`, `fileToBase64`)
- Backend: snake_case (e.g., `get_current_user`, `upload_audio`, `load_template`)
- Async functions: prefix with `async` keyword, no naming distinction
- Event handlers: prefix with `handle` (e.g., `handleBackdropClick`, `handleEscape`)

**Variables:**
- Frontend: camelCase (e.g., `isSubmitting`, `comfyUrl`, `workflowService`)
- Backend: snake_case (e.g., `template_name`, `audio_filename`, `client_ip`)
- Constants: SCREAMING_SNAKE_CASE (used for template placeholders like `{{VIDEO_FILENAME}}`)
- Boolean flags: prefix with `is` or `has` (e.g., `isAuthenticated`, `hasMultipleApps`)

**Types:**
- TypeScript interfaces: PascalCase, suffix with `Type` (e.g., `AuthContextType`, `User`)
- Pydantic models: PascalCase, descriptive names (e.g., `MultiTalkParametersRequest`, `ComfyUIStatusResponse`)
- Generic types: prefix with plural when appropriate (e.g., `users: User[]`)

## Code Style

**Formatting:**
- Frontend: ESLint + TypeScript with no explicit formatter config
- Backend: No explicit formatter enforced (black/isort available in dev dependencies)
- Indentation: 2 spaces (frontend), 4 spaces (backend)
- Line length: No strict enforced limit, follow readability

**Linting:**
- Frontend:
  - Tool: ESLint 9.33.0 with TypeScript plugin
  - Config: `frontend/eslint.config.js`
  - Key rules:
    - `@typescript-eslint/no-explicit-any`: warn (gradual migration)
    - `@typescript-eslint/no-unused-vars`: error with `argsIgnorePattern: '^_'` (allow prefixed underscores)
    - React hooks validation enabled
    - React refresh validation enabled
  - Run: `npm run lint` in frontend directory

- Backend:
  - Tool: flake8 available (in dev dependencies, not enforced in CI)
  - Type checking: mypy available (not enforced)
  - No centralized linting config file

## Import Organization

**Frontend (JavaScript/TypeScript):**

Order:
1. React and external libraries (e.g., `import React, { useState }`)
2. Type definitions (e.g., `import { User } from '../types'`)
3. Context imports (e.g., `import { useAuth }`)
4. Component imports (relative paths like `./components/...`)
5. Utility/lib imports (e.g., `../lib/apiClient`)
6. Style imports (TailwindCSS classes inline, rarely imported)

Example from `frontend/src/App.tsx`:
```typescript
import { useState, useEffect } from "react";
// Page components
import Homepage from "./pages/Homepage";
import GenerationFeed from "./pages/GenerationFeed";
// UI Components
import ComfyUIStatus from "./components/ComfyUIStatus";
// Contexts & Config
import { useAuth } from "./contexts/AuthContext";
import { studios, getStudioById } from "./lib/studioConfig";
```

**Path Aliases:**
- No path aliases configured; all imports are relative

**Backend (Python):**

Order:
1. Standard library (e.g., `import json`, `from typing import`)
2. Third-party imports (e.g., `from fastapi import APIRouter`)
3. Local imports (e.g., `from models.comfyui import`, `from services.workflow_service import`)

Example from `backend/api/comfyui.py`:
```python
from fastapi import APIRouter, Query
from typing import Optional, Dict, Any
from pydantic import BaseModel
from models.comfyui import ComfyUIStatusResponse
from services.comfyui_service import ComfyUIService
```

## Error Handling

**Frontend Patterns:**

Errors are handled using try-catch with `setStatus()` state updates:
```typescript
try {
  const response = await apiClient.submitWorkflow(...);
  if (!response.success) {
    throw new Error(response.error || 'Failed to submit');
  }
} catch (error: any) {
  setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
  // Optional: update job with error
  await completeJob({
    job_id: jobId,
    status: 'error',
    error_message: error.message
  }).catch(() => {});
}
```

Error messages always displayed to user via status state, prefixed with emoji (❌ for errors, ✅ for success).

**Backend Patterns:**

Backend returns tuple structure `(success, data, error_message)`:
```python
async def load_template(self, template_name: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    try:
        # ... logic ...
        return True, template, None
    except json.JSONDecodeError as e:
        return False, None, f"Invalid JSON in template '{template_name}': {str(e)}"
    except Exception as e:
        return False, None, f"Error loading template '{template_name}': {str(e)}"
```

API endpoints return Pydantic models with `success`, `data`, and `error` fields:
```python
class PromptResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None
    error: Optional[str] = None
```

## Logging

**Framework:**
- Frontend: `console.log()`, `console.error()` for basic debugging
- Backend: Standard Python `print()` for startup messages

**Patterns:**
- Frontend uses console logs for development troubleshooting
- Backend uses print statements with emoji prefixes for environment detection:
  - `print("🔧 Local development: Loaded .env file")`
  - `print("☁️ Running on Heroku: Using environment variables")`
- No structured logging framework in use; can be added as enhancement

## Comments

**When to Comment:**
- Complex logic that's not self-evident (e.g., placeholder replacement in `workflow_service.py`)
- Workarounds for known issues (e.g., in `AuthContext.tsx` for HMR prevention)
- Important business rules (e.g., parameter type handling in workflow building)
- AST-like transformations (e.g., JSON string manipulation)

**JSDoc/TSDoc:**
- Backend docstrings: Present in service classes, include Args and Returns
- Frontend: Minimal, mostly self-documenting code
- Example from `backend/services/workflow_service.py`:
```python
async def build_workflow(self, template_name: str, parameters: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Build a complete workflow from a template and parameters

    Args:
        template_name: Name of the template to use
        parameters: Dictionary of parameters to substitute in the template

    Returns:
        (success, workflow_dict, error_message)
    """
```

## Function Design

**Size:**
- Frontend components: 100-300 lines typical (can grow larger for complex UI)
- Backend service methods: 30-80 lines typical
- Aim for functions that do one thing well

**Parameters:**
- Frontend: Use destructuring for Props interfaces (e.g., `{ comfyUrl }: Props`)
- Backend: Use Pydantic models for request validation (not raw function parameters)
- Avoid parameter lists longer than 3-4 items; use objects/models instead

**Return Values:**
- Backend services: Return tuples `(success: bool, data: T, error: Optional[str])`
- Frontend async functions: Return promises or throw errors for catch blocks
- API endpoints: Always return Pydantic response models

## Module Design

**Exports:**
- Frontend: Default export for page components, named exports for utilities
- Backend: Router objects for FastAPI routers, functions for factories
- Example:
  ```python
  # backend/services/workflow_service.py
  class WorkflowService:
      async def load_template(self, ...): ...

  # backend/api/comfyui.py
  router = APIRouter(prefix="/comfyui", tags=["comfyui"])

  def get_workflow_service():
      return WorkflowService()
  ```

**Barrel Files:**
- Frontend: Limited use, imports are mostly direct
- Backend: Uses `__init__.py` files but minimal re-exports

## Type Safety

**Frontend:**
- TypeScript strict mode enabled (references `tsconfig.app.json`)
- Prefer explicit types over `any` (rule warns on `any`)
- Interface-based Props definitions required for components
- React hooks have proper typing

**Backend:**
- Type hints required in function signatures
- Pydantic models used for all request/response validation
- Return type annotations always present (especially for tuple returns)

## Styling

**Approach:**
- Frontend: TailwindCSS utility classes inline in JSX
- No separate CSS files; all styling through Tailwind
- Dark mode support via `dark:` prefix utilities (e.g., `dark:text-dark-text-primary`)
- Consistent spacing, rounded corners, shadows via Tailwind classes
- Gradient background commonly used: `bg-gradient-to-r from-blue-500 to-purple-600`

**UI Components Pattern:**
Reusable UI components in `frontend/src/components/UI.tsx` with props-based customization:
```typescript
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-dark-border-primary p-6 ...">
      <h2 className="text-lg font-semibold...">{title}</h2>
      {children}
    </section>
  )
}
```

## State Management

**Frontend:**
- React Context for global state (`AuthContext`, `ProjectContext`, `ExecutionBackendContext`)
- Local state with `useState()` for component-specific data
- useCallback for memoized callbacks to prevent unnecessary re-renders
- useRef for tracking state across HMR reloads (e.g., `initialVerificationDone` in AuthContext)
- localStorage for persistence (keys prefixed with `vapai-`: `vapai-auth-token`, `vapai-user`)

**Backend:**
- Stateless services instantiated per request
- Factory functions return service instances: `def get_workflow_service(): return WorkflowService()`
- No global state; all data from parameters or environment variables

## API Patterns

**Frontend API Client:**
- Class-based `ApiClient` with private methods
- Caching mechanism with TTL (30 seconds default)
- Token refresh with deduplication (prevents multiple simultaneous refreshes)
- Retry logic with configurable attempts (default 3)
- All requests include `Authorization: Bearer {token}` header

**Backend API:**
- FastAPI routers with `@router.get()`, `@router.post()` decorators
- Pydantic request/response models for validation
- Service injection via factory functions in route handlers
- Async/await for async operations
- CORS enabled globally (permissive in development)

---

*Convention analysis: 2025-03-04*
