# Phase 14: Foundation - Research

**Researched:** 2026-03-13
**Domain:** ComfyUI workflow parsing, Supabase JSONB storage, FastAPI CRUD, dynamic workflow execution
**Confidence:** HIGH

## Summary

Phase 14 establishes the backend foundation for the Workflow Builder: a workflow parser that accepts ComfyUI API-format JSON and returns structured node/input data, a `custom_workflows` Supabase table with JSONB columns, a full CRUD API for managing custom workflow configurations, and a shared `execute_dynamic_workflow` function that both the test runner (Phase 16) and production renderer will call.

The existing codebase provides all the building blocks: `WorkflowService` handles template loading and placeholder substitution, `ComfyUIService` handles submission to ComfyUI, `RunPodService` handles cloud execution, `verify_admin` provides admin-only endpoint protection, and the Supabase client singleton handles database operations. The new code extends these patterns -- it does not replace them.

**Primary recommendation:** Follow the existing service/API/model layering exactly. Create `backend/services/custom_workflow_service.py` for all business logic, `backend/api/custom_workflows.py` for CRUD endpoints, `backend/models/custom_workflow.py` for Pydantic schemas, and `backend/migrations/008_add_custom_workflows.sql` for the database table. The `execute_dynamic_workflow` function lives in `custom_workflow_service.py` and delegates to the existing `WorkflowService.build_workflow()` + `ComfyUIService.submit_prompt()` chain.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STORE-01 | Custom workflow configs stored in Supabase `custom_workflows` table with JSONB columns | Migration 008 creates the table with `variable_config JSONB` and `section_config JSONB` columns; service layer reads/writes via Supabase Python client |
| STORE-02 | Workflow template files saved to `backend/workflows/custom/` directory | WorkflowService already searches subdirectories; save raw JSON to `custom/` folder on create/update |
| STORE-03 | Backend CRUD API (create, read, update, delete, list, publish/unpublish) at `/api/custom-workflows/` | New API router following existing patterns (infrastructure.py); all endpoints use `Depends(verify_admin)` |
| STORE-04 | Workflow parsing endpoint accepts ComfyUI JSON and returns structured node/input data | Parse endpoint detects API vs UI format, extracts nodes with class_type, filters link arrays from inputs |
| STORE-05 | All custom workflow API endpoints are admin-only | Existing `verify_admin` dependency from `core/auth.py` applied to every endpoint |
| WB-01 | Admin can upload a ComfyUI workflow JSON file via drag-and-drop or file picker | Backend parse endpoint accepts the JSON; frontend upload is Phase 15 but API must be ready |
| WB-02 | System detects API vs UI format and rejects UI format with guidance to export API format | Detection logic in parse endpoint: UI format has `nodes` array + `links` array; API format has numeric string keys with `class_type` |
| WB-03 | System parses workflow JSON and displays all nodes with class_type and inputs in a node inspector | Parse endpoint returns structured list of `{node_id, class_type, title, inputs: [{name, value, is_link}]}` |
| WB-04 | System filters out node-to-node link arrays from configurable input candidates | Link detection: input value is a list of `[string, int]` = link; these are marked as `is_link: true` and excluded from configurable candidates |
| TEST-04 | Test run uses the exact same code path as the published feature (shared execution function) | Single `execute_dynamic_workflow()` function in service layer called by both test runner and renderer |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | >=0.104.1 | API framework | Already in use; all existing routers follow same patterns |
| Pydantic | >=2.5.1 | Request/response models | Already in use; v2 with `model_dump()` |
| supabase-py | >=2.3.0 | Database client | Already in use; singleton pattern in `core/supabase.py` |
| httpx | >=0.25.2 | HTTP client for ComfyUI | Already in use in `ComfyUIService` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | >=7.4.0 | Testing | Backend tests for parse, CRUD, execute functions |
| pytest-asyncio | >=0.21.0 | Async test support | Testing async service methods |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase JSONB | Separate relational tables for variables/sections | JSONB is simpler for evolving schema; relational is more queryable but overkill here |
| File-system template storage | Supabase Storage | File system matches existing pattern; Supabase Storage deferred to WB-V2-05 for Heroku |

**Installation:**
```bash
# No new dependencies needed -- everything is already in requirements.txt
```

## Architecture Patterns

### Recommended Project Structure
```
backend/
├── api/
│   └── custom_workflows.py        # CRUD + parse + execute endpoints
├── models/
│   └── custom_workflow.py          # Pydantic request/response schemas
├── services/
│   └── custom_workflow_service.py  # Business logic + execute_dynamic_workflow
├── migrations/
│   └── 008_add_custom_workflows.sql  # Database schema
└── workflows/
    └── custom/                     # Custom workflow template files (auto-created)
```

### Pattern 1: ComfyUI API-Format vs UI-Format Detection
**What:** Determine whether uploaded JSON is API format (usable) or UI format (must be rejected with guidance).
**When to use:** Parse endpoint, before any node extraction.
**Example:**
```python
# Source: ComfyUI documentation + codebase analysis
def detect_workflow_format(data: dict) -> str:
    """
    Detect whether JSON is ComfyUI API format or UI format.

    API format: dict with numeric string keys, each value has 'class_type' and 'inputs'
      {"3": {"class_type": "KSampler", "inputs": {...}}, "6": {...}}

    UI format: dict with 'nodes' (array) and 'links' (array) top-level keys
      {"nodes": [...], "links": [...], "groups": [...], ...}
    """
    # UI format markers: has 'nodes' array and/or 'links' array at top level
    if "nodes" in data and isinstance(data["nodes"], list):
        return "ui"
    if "links" in data and isinstance(data["links"], list):
        return "ui"
    # Additional UI format check: 'version' key with numeric value (workflow spec)
    if "version" in data and isinstance(data.get("version"), (int, float)):
        return "ui"

    # API format: all top-level keys should be node IDs (strings),
    # and at least one value must have 'class_type'
    has_class_type = False
    for key, value in data.items():
        if key.startswith("_"):  # Skip metadata keys like _meta
            continue
        if isinstance(value, dict) and "class_type" in value:
            has_class_type = True
            break

    if has_class_type:
        return "api"

    return "unknown"
```

### Pattern 2: Link Array Detection (WB-04)
**What:** Node inputs that are arrays of `[node_id_string, output_index_int]` are node-to-node links, not configurable user inputs.
**When to use:** When extracting configurable inputs from parsed workflow nodes.
**Example:**
```python
# Source: Existing workflow JSON analysis (img2img.json, AudioStemSeparator.json)
def is_link_input(value) -> bool:
    """
    Check if an input value is a node-to-node link.
    Links are arrays of [node_id: str, output_index: int], e.g. ["14", 0]
    """
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )
```

### Pattern 3: CRUD Service with Supabase (existing project pattern)
**What:** Service class with Supabase client injection, tuple returns for write ops.
**When to use:** All database operations for custom_workflows table.
**Example:**
```python
# Source: Existing UpscaleJobService pattern in backend/services/upscale_job_service.py
class CustomWorkflowService:
    def __init__(self, supabase=None):
        self.supabase = supabase or get_supabase()
        self.workflow_service = WorkflowService()

    async def create(self, data: dict) -> Tuple[bool, Optional[dict], Optional[str]]:
        try:
            result = self.supabase.table("custom_workflows").insert(data).execute()
            if result.data:
                row = result.data[0] if isinstance(result.data, list) else result.data
                return True, row, None
            return False, None, "Failed to create workflow"
        except Exception as e:
            return False, None, str(e)
```

### Pattern 4: Admin-Only Endpoint Protection (existing project pattern)
**What:** Every endpoint uses `Depends(verify_admin)` per-endpoint (not router-level).
**When to use:** All custom workflow CRUD endpoints.
**Example:**
```python
# Source: backend/api/infrastructure.py -- exact pattern used for all admin endpoints
from core.auth import verify_admin

@router.post("/")
async def create_custom_workflow(
    payload: CreateCustomWorkflowRequest,
    admin_user: dict = Depends(verify_admin),  # Returns 403 for non-admins
):
    ...
```

### Pattern 5: Shared Execution Function (TEST-04)
**What:** A single function that both the test runner and production renderer call to execute a dynamic workflow.
**When to use:** Test run in builder (Phase 16) and DynamicWorkflowPage submission (Phase 16).
**Example:**
```python
# Source: Architecture decision from STATE.md + existing WorkflowService/ComfyUIService pattern
async def execute_dynamic_workflow(
    workflow_config: dict,       # Row from custom_workflows table
    user_params: dict,           # User-provided parameter values
    base_url: str,               # ComfyUI server URL
    client_id: str,              # WebSocket client ID
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Shared execution path for dynamic workflows.

    1. Load template from backend/workflows/custom/{slug}.json
    2. Substitute user_params into {{PLACEHOLDER}} slots
    3. Validate the resulting workflow
    4. Submit to ComfyUI via existing ComfyUIService

    Returns: (success, prompt_id, error_message)
    """
    workflow_service = WorkflowService()
    comfyui_service = ComfyUIService()

    # Build workflow from template + params (uses existing substitution logic)
    template_name = f"custom/{workflow_config['slug']}"  # or however stored
    success, workflow, error = await workflow_service.build_workflow(
        template_name, user_params
    )
    if not success:
        return False, None, error

    # Validate
    is_valid, val_error = await workflow_service.validate_workflow(workflow)
    if not is_valid:
        return False, None, val_error

    # Submit
    payload = {"prompt": workflow, "client_id": client_id}
    return await comfyui_service.submit_prompt(base_url, payload)
```

### Anti-Patterns to Avoid
- **Router-level dependencies for admin auth:** This project uses per-endpoint `Depends(verify_admin)`. Do NOT use `router = APIRouter(dependencies=[Depends(verify_admin)])` -- it breaks the pattern and the infrastructure.py comment explicitly warns about this.
- **Direct SQL for JSONB operations:** Use the Supabase Python client's `.table().insert()` / `.update()` methods. Pass Python dicts for JSONB columns -- the client handles serialization.
- **Storing workflow templates in Supabase Storage:** Deferred to WB-V2-05. For now, store in `backend/workflows/custom/` to match the existing `WorkflowService._find_template_path()` subdirectory scanning.
- **Creating a separate execution function for test vs production:** STATE.md explicitly decided on a single `execute_dynamic_workflow` function. Do not create two code paths.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workflow template substitution | Custom placeholder replacement | `WorkflowService.build_workflow()` | Already handles string/number/boolean types, JSON escaping, and unsubstituted placeholder detection |
| ComfyUI submission | Direct httpx calls | `ComfyUIService.submit_prompt()` | Handles timeouts, error parsing, prompt_id extraction |
| Admin authentication | Custom role checking | `verify_admin` from `core/auth.py` | Already checks both `user_metadata` and `app_metadata` for admin role |
| Supabase client | New client instantiation | `get_supabase()` from `core/supabase.py` | Singleton with key resolution fallback |
| UUID generation | Custom ID generation | Supabase default `gen_random_uuid()` | Database handles it; consistent with all other tables |
| JSON validation | Manual dict checking | Pydantic models | Already the project standard for all request/response validation |

**Key insight:** Every component of the execute path already exists. `execute_dynamic_workflow` is essentially a thin orchestrator that calls existing services in sequence. The real work is in the parser and CRUD.

## Common Pitfalls

### Pitfall 1: Confusing ComfyUI Workflow Formats
**What goes wrong:** Admin uploads UI-format JSON (exported via "Save" button) instead of API-format JSON (exported via "Save (API Format)" with Dev Mode enabled). The parser fails silently or produces garbage.
**Why it happens:** ComfyUI has two export modes and the default "Save" produces UI format.
**How to avoid:** Detect format upfront with structural checks (`nodes` array = UI format; numeric string keys with `class_type` = API format). Return a clear error message: "This appears to be a UI-format workflow. Please enable Dev Mode in ComfyUI settings and use 'Save (API Format)' to export."
**Warning signs:** JSON has top-level `nodes`, `links`, `groups`, or `version` keys.

### Pitfall 2: JSONB Column Insertion with Python Dicts
**What goes wrong:** Attempting to insert a JSON string into a JSONB column, or forgetting that supabase-py expects Python dicts for JSONB columns.
**Why it happens:** Confusion between `json.dumps()` and passing raw dicts.
**How to avoid:** Pass Python dicts directly when inserting/updating. The Supabase Python client serializes them automatically. Use `model_dump()` from Pydantic v2 models.
**Warning signs:** Insert calls with `json.dumps(config)` instead of just `config`.

### Pitfall 3: Workflow Template File Naming Conflicts
**What goes wrong:** A custom workflow template name collides with an existing built-in template (e.g., naming a custom workflow `VideoLipsync.json`).
**Why it happens:** `WorkflowService._find_template_path()` searches root first, then subdirectories. Custom templates in `custom/` subfolder would be shadowed by root templates with the same name.
**How to avoid:** Use the workflow slug (from the custom_workflows table) as the filename in `custom/` subdirectory. The slug is derived from the feature name and must be unique. When loading, use `custom/{slug}` as the template name.
**Warning signs:** `WorkflowService` returns a different template than expected.

### Pitfall 4: Heroku Filesystem Ephemerality
**What goes wrong:** Custom workflow template files in `backend/workflows/custom/` are lost when Heroku dyno restarts.
**Why it happens:** Heroku has an ephemeral filesystem.
**How to avoid:** This is a known concern documented in STATE.md. For v1.2 dev, accept the limitation. The JSONB config in Supabase persists; only the raw template file is lost. For production, WB-V2-05 defers migration to Supabase Storage. For now, add a "regenerate template files from DB" startup routine or accept manual re-upload.
**Warning signs:** Custom workflows 404 after Heroku deploy.

### Pitfall 5: Forgetting `_meta` in Node Parsing
**What goes wrong:** Parser ignores the `_meta` field on nodes which contains the human-readable `title`.
**Why it happens:** `_meta` is optional in API format and easy to overlook.
**How to avoid:** Extract `_meta.title` when available and include it in the parsed output. It helps admins identify nodes in the builder UI.
**Warning signs:** Node inspector shows only `class_type` without friendly names.

## Code Examples

Verified patterns from the existing codebase:

### Database Migration (custom_workflows table)
```sql
-- Source: Pattern from backend/migrations/004_add_runpod_support.sql and 007_add_upscale_batches.sql

CREATE TABLE IF NOT EXISTS custom_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                    -- Display name (e.g., "My LoRA Trainer")
    slug TEXT NOT NULL UNIQUE,             -- URL-safe identifier (e.g., "my-lora-trainer")
    description TEXT,                      -- Feature description

    -- Workflow template reference
    template_filename TEXT NOT NULL,        -- Filename in backend/workflows/custom/
    original_workflow JSONB NOT NULL,       -- Raw uploaded ComfyUI API-format JSON (preserved)

    -- Configuration (JSONB for flexible schema evolution)
    variable_config JSONB NOT NULL DEFAULT '[]'::jsonb,   -- Array of variable definitions
    section_config JSONB NOT NULL DEFAULT '[]'::jsonb,    -- Array of section definitions

    -- Feature metadata
    output_type TEXT NOT NULL DEFAULT 'image' CHECK (output_type IN ('image', 'video', 'audio')),
    studio TEXT,                            -- Target studio (e.g., "lipsync", "image", "video")
    icon TEXT DEFAULT '⚡',                 -- Emoji icon
    gradient TEXT DEFAULT 'from-blue-500 to-purple-600',  -- Tailwind gradient classes

    -- Status
    is_published BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_workflows_slug ON custom_workflows(slug);
CREATE INDEX IF NOT EXISTS idx_custom_workflows_published ON custom_workflows(is_published);
CREATE INDEX IF NOT EXISTS idx_custom_workflows_studio ON custom_workflows(studio) WHERE is_published = true;

-- Comments
COMMENT ON TABLE custom_workflows IS 'Custom workflow configurations created via the Workflow Builder';
COMMENT ON COLUMN custom_workflows.variable_config IS 'JSONB array of variable definitions: [{node_id, input_name, label, type, default, ...}]';
COMMENT ON COLUMN custom_workflows.section_config IS 'JSONB array of section definitions: [{name, variable_ids}]';
COMMENT ON COLUMN custom_workflows.original_workflow IS 'Raw ComfyUI API-format JSON as uploaded, preserved for re-parsing';
```

### Pydantic Models
```python
# Source: Pattern from backend/models/upscale.py, infrastructure.py

from pydantic import BaseModel, Field
from typing import Optional, List, Any, Literal
from datetime import datetime

# --- Workflow parsing ---

class ParsedNodeInput(BaseModel):
    name: str
    value: Any
    is_link: bool = False

class ParsedNode(BaseModel):
    node_id: str
    class_type: str
    title: Optional[str] = None        # From _meta.title
    inputs: List[ParsedNodeInput] = []
    configurable_inputs: List[ParsedNodeInput] = []  # Non-link inputs only

class ParseWorkflowRequest(BaseModel):
    workflow_json: dict  # Raw ComfyUI JSON

class ParseWorkflowResponse(BaseModel):
    success: bool
    format: Optional[str] = None       # "api" or "ui"
    nodes: List[ParsedNode] = []
    error: Optional[str] = None

# --- CRUD ---

class CreateCustomWorkflowRequest(BaseModel):
    name: str
    slug: Optional[str] = None         # Auto-generated from name if not provided
    description: Optional[str] = None
    workflow_json: dict                 # ComfyUI API-format JSON
    output_type: Literal['image', 'video', 'audio'] = 'image'
    studio: Optional[str] = None
    icon: str = '⚡'
    gradient: str = 'from-blue-500 to-purple-600'

class UpdateCustomWorkflowRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    variable_config: Optional[List[dict]] = None
    section_config: Optional[List[dict]] = None
    output_type: Optional[Literal['image', 'video', 'audio']] = None
    studio: Optional[str] = None
    icon: Optional[str] = None
    gradient: Optional[str] = None

class CustomWorkflowResponse(BaseModel):
    success: bool
    workflow: Optional[dict] = None
    error: Optional[str] = None

class CustomWorkflowListResponse(BaseModel):
    success: bool
    workflows: List[dict] = []
    error: Optional[str] = None
```

### Slug Generation
```python
# Source: Common Python pattern
import re

def generate_slug(name: str) -> str:
    """Generate URL-safe slug from feature name."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s-]+', '-', slug)
    slug = slug.strip('-')
    return slug
```

### Supabase CRUD Operations
```python
# Source: Pattern from backend/services/upscale_job_service.py

# INSERT with JSONB
result = self.supabase.table("custom_workflows").insert({
    "name": "My Workflow",
    "slug": "my-workflow",
    "template_filename": "my-workflow.json",
    "original_workflow": workflow_json,       # Python dict, NOT json.dumps()
    "variable_config": [],                    # Python list, NOT json.dumps()
    "section_config": [],                     # Python list
    "output_type": "video",
}).execute()

# SELECT single
result = self.supabase.table("custom_workflows") \
    .select("*").eq("id", workflow_id).single().execute()

# SELECT list (published only)
result = self.supabase.table("custom_workflows") \
    .select("*").eq("is_published", True).order("created_at", desc=True).execute()

# UPDATE with partial JSONB
result = self.supabase.table("custom_workflows") \
    .update({"variable_config": new_config, "updated_at": "now()"}) \
    .eq("id", workflow_id).execute()

# DELETE
result = self.supabase.table("custom_workflows") \
    .delete().eq("id", workflow_id).execute()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Frontend-side workflow JSON loading | Backend WorkflowService with centralized templates | v1.0 | All new workflows use backend template system |
| Per-feature hardcoded pages | Dynamic renderer from JSONB config (this milestone) | v1.2 (now) | Custom workflows don't need code changes |
| Separate code paths for test/production | Shared `execute_dynamic_workflow` function | v1.2 (now) | Single code path ensures test fidelity |

**Deprecated/outdated:**
- Frontend `buildPromptJSON()` functions: Still exist in legacy feature pages but new features should use `apiClient.submitWorkflow()` which calls the backend `submit-workflow` endpoint
- Frontend workflow files in `public/workflows/`: Migration to backend `workflows/` directory is the standard; some legacy files may still exist

## Open Questions

1. **Heroku template regeneration strategy**
   - What we know: Heroku filesystem is ephemeral; template files in `workflows/custom/` will be lost on restart
   - What's unclear: Whether to add a startup regeneration routine now or defer entirely to WB-V2-05
   - Recommendation: Store `original_workflow` in the DB (JSONB). On create/update, write to filesystem. Add a lightweight startup check that regenerates missing files from DB. This is simple and solves the problem without requiring Supabase Storage.

2. **Slug uniqueness enforcement**
   - What we know: Slug must be unique (it's the template filename and URL identifier)
   - What's unclear: Whether to enforce at DB level only or also check upfront
   - Recommendation: UNIQUE constraint on `slug` column (DB level) + check in service layer before insert with a friendly error message.

3. **`updated_at` trigger vs application-level update**
   - What we know: Some projects use PostgreSQL triggers for `updated_at`; this project uses application-level timestamps
   - What's unclear: Whether to add a DB trigger or keep it application-level
   - Recommendation: Application-level (set `updated_at` in the UPDATE call) to match existing project patterns. Avoid adding triggers that the team may not expect.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest >=7.4.0 + pytest-asyncio >=0.21.0 |
| Config file | `backend/pytest.ini` or `pyproject.toml` (check existing) |
| Quick run command | `cd backend && pytest tests/test_custom_workflow_service.py -x` |
| Full suite command | `cd backend && pytest` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STORE-01 | custom_workflows table CRUD via Supabase | unit | `pytest tests/test_custom_workflow_service.py -x` | Wave 0 |
| STORE-02 | Template file saved to workflows/custom/ | unit | `pytest tests/test_custom_workflow_service.py::test_save_template_file -x` | Wave 0 |
| STORE-03 | CRUD API endpoints return correct responses | integration | `pytest tests/test_custom_workflow_api.py -x` | Wave 0 |
| STORE-04 | Parse endpoint returns structured node data | integration | `pytest tests/test_custom_workflow_api.py::TestParseEndpoint -x` | Wave 0 |
| STORE-05 | Non-admin users get 403 on write endpoints | integration | `pytest tests/test_custom_workflow_api.py::TestAdminProtection -x` | Wave 0 |
| WB-02 | UI format detected and rejected | unit | `pytest tests/test_custom_workflow_service.py::test_detect_ui_format -x` | Wave 0 |
| WB-03 | Nodes extracted with class_type and inputs | unit | `pytest tests/test_custom_workflow_service.py::test_parse_nodes -x` | Wave 0 |
| WB-04 | Link arrays filtered from configurable inputs | unit | `pytest tests/test_custom_workflow_service.py::test_filter_links -x` | Wave 0 |
| TEST-04 | execute_dynamic_workflow calls WorkflowService + ComfyUIService | unit | `pytest tests/test_custom_workflow_service.py::test_execute_dynamic -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && pytest tests/test_custom_workflow_service.py tests/test_custom_workflow_api.py -x`
- **Per wave merge:** `cd backend && pytest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/tests/test_custom_workflow_service.py` -- covers STORE-01, STORE-02, WB-02, WB-03, WB-04, TEST-04
- [ ] `backend/tests/test_custom_workflow_api.py` -- covers STORE-03, STORE-04, STORE-05
- [ ] conftest.py additions: `mock_supabase` fixture already exists; add `custom_workflow_service` fixture

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis: `backend/services/workflow_service.py`, `backend/services/comfyui_service.py`, `backend/core/auth.py`, `backend/api/infrastructure.py`, `backend/services/upscale_job_service.py` -- direct code inspection of patterns to follow
- Existing workflow JSON files: `backend/workflows/img2img.json`, `backend/workflows/AudioStemSeparator.json` -- API format structure with link arrays and `_meta` fields
- `.planning/STATE.md` -- locked decisions on JSONB, shared execution function, dynamic renderer approach
- [ComfyUI Workflow JSON Spec](https://docs.comfy.org/specs/workflow_json) -- UI format structure documentation
- [ComfyUI Routes Documentation](https://docs.comfy.org/development/comfyui-server/comms_routes) -- API endpoint reference

### Secondary (MEDIUM confidence)
- [ComfyUI format confusion issue](https://github.com/comfyanonymous/ComfyUI/issues/1335) -- confirms structural differences between UI and API format
- [Supabase JSONB documentation](https://supabase.com/docs/guides/database/json) -- JSONB column usage patterns
- [Supabase Python insert docs](https://supabase.com/docs/reference/python/insert) -- Python client insertion patterns

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies; everything already in use
- Architecture: HIGH -- patterns copied directly from existing codebase (infrastructure.py, upscale_job_service.py)
- Pitfalls: HIGH -- identified from direct codebase analysis and ComfyUI documentation
- Workflow format detection: HIGH -- verified against actual workflow JSON files in the codebase and ComfyUI docs

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable -- all patterns are internal to this project)
