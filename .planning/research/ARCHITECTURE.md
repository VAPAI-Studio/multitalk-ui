# Architecture Research: Workflow Builder Integration

**Domain:** Admin tooling for dynamic feature creation in an AI media processing platform
**Researched:** 2026-03-13
**Confidence:** HIGH — Based on direct codebase analysis of existing patterns

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (React SPA)                             │
│                                                                          │
│  ┌──────────────┐  ┌──────────────────────┐  ┌────────────────────────┐ │
│  │  App.tsx     │  │  StudioPage.tsx       │  │  WorkflowBuilderPage   │ │
│  │  (routing)   │  │  (static app map)     │  │  (admin, new)         │ │
│  │              │  │  appComponents{}      │  │                        │ │
│  └──────┬───────┘  └──────────┬───────────┘  └───────────┬────────────┘ │
│         │                     │                           │              │
│         ▼                     ▼                           ▼              │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    studioConfig.ts (MODIFIED)                       │ │
│  │   studios[] — static                                                │ │
│  │   dynamicStudios[] — fetched from DB, merged at runtime             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              DynamicWorkflowRenderer (NEW)                        │   │
│  │  Receives: CustomWorkflow config from DB                          │   │
│  │  Renders: inputs from variable_configs JSONB                      │   │
│  │  Submits: via existing apiClient.submitWorkflow()                 │   │
│  │  Tracks: via existing createJob / startJobMonitoring              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
             │ HTTPS / JWT
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                                   │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  api/comfyui.py  │  │  api/custom_      │  │  api/feed.py         │  │
│  │  (existing)      │  │  workflows.py     │  │  (existing)          │  │
│  │  submit-workflow │  │  (NEW, admin)     │  │  unified feed        │  │
│  └────────┬─────────┘  └────────┬──────────┘  └──────────────────────┘  │
│           │                     │                                        │
│           ▼                     ▼                                        │
│  ┌──────────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  WorkflowService │  │  CustomWorkflowService (NEW)                  │ │
│  │  (existing)      │  │  CRUD for workflow configs                    │ │
│  │  load_template   │  │  parse_nodes — extract input metadata         │ │
│  │  build_workflow  │  │  build_params — resolve variable configs      │ │
│  │  validate        │  │  run_test — reuses WorkflowService            │ │
│  └────────┬─────────┘  └────────┬─────────────────────────────────────┘ │
│           │                     │                                        │
└───────────┼─────────────────────┼────────────────────────────────────────┘
            │                     │
            ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (PostgreSQL)                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  custom_workflows table (NEW)                                       │ │
│  │  id, name, slug, studio_id, icon, gradient, workflow_file,         │ │
│  │  variable_configs JSONB, section_configs JSONB, output_type,       │ │
│  │  published, created_by, created_at, updated_at                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌───────────────────────┐  ┌───────────────────────────────────────┐   │
│  │  video_jobs (existing) │  │  image_jobs (existing)                 │   │
│  │  workflow_name field  │  │  workflow_name field                   │   │
│  │  (stores slug of      │  │  (stores slug of dynamic workflows)    │   │
│  │  dynamic workflows)   │  └───────────────────────────────────────┘   │
│  └───────────────────────┘                                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Storage bucket: workflow-uploads/                                  │ │
│  │  Stores uploaded workflow JSON files for custom_workflows           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         COMFYUI SERVER                                   │
│  Receives workflow JSON via submit-prompt (existing path, unchanged)     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New or Modified |
|-----------|----------------|-----------------|
| `studioConfig.ts` | Static studio/app definitions + dynamic studio merge at runtime | MODIFIED — add dynamic merge |
| `App.tsx` | Routing, page rendering, navigation state | MODIFIED — handle dynamic studio IDs |
| `StudioPage.tsx` | Renders selected app within studio (static map) | MODIFIED — fallback to DynamicWorkflowRenderer |
| `WorkflowBuilderPage` | Admin UI: upload JSON, configure inputs, test-run, publish | NEW |
| `WorkflowNodeInspector` | Parses ComfyUI workflow JSON, displays nodes/inputs | NEW |
| `VariableConfigurator` | UI to map node inputs to user-facing variable widgets | NEW |
| `DynamicWorkflowRenderer` | Generic feature page rendered from DB config | NEW |
| `api/custom_workflows.py` | CRUD + parse + test-run endpoints, admin-gated | NEW |
| `CustomWorkflowService` | Business logic: parse nodes, build params, validate | NEW |
| `custom_workflows` table | Stores workflow configs as JSONB, one row per feature | NEW (DB migration) |

---

## Recommended Project Structure

```
frontend/src/
├── pages/
│   ├── WorkflowBuilder.tsx         # NEW: Admin builder page (upload/configure/test/publish)
│   └── [existing pages unchanged]
├── components/
│   ├── WorkflowBuilder/            # NEW: Sub-components for builder
│   │   ├── NodeInspector.tsx       # Display parsed ComfyUI nodes/inputs
│   │   ├── VariableConfigurator.tsx# Map node inputs to widgets (text/slider/file/etc.)
│   │   └── WorkflowTestPanel.tsx   # Inline test runner
│   ├── DynamicWorkflowRenderer.tsx # NEW: Generic renderer for published workflows
│   └── [existing components unchanged]
├── lib/
│   ├── studioConfig.ts             # MODIFIED: Add dynamic studio fetching
│   └── [existing libs unchanged]
└── types/
    └── customWorkflow.ts           # NEW: TypeScript interfaces for workflow configs

backend/
├── api/
│   └── custom_workflows.py         # NEW: Admin CRUD + parse + test endpoints
├── models/
│   └── custom_workflow.py          # NEW: Pydantic request/response models
├── services/
│   └── custom_workflow_service.py  # NEW: Parse, build, validate, test logic
└── migrations/
    └── 005_add_custom_workflows.sql # NEW: DB migration
```

### Structure Rationale

- **`WorkflowBuilder/` sub-components:** The builder page has distinct phases (upload → inspect → configure → test → publish). Splitting into sub-components keeps the builder page manageable and each sub-component independently testable.
- **`DynamicWorkflowRenderer.tsx` separate from pages:** It is not a page — it is a component invoked by `StudioPage.tsx` when no static `appComponents` entry exists for an app ID. Keeping it in `components/` maintains the existing page/component boundary.
- **`custom_workflow_service.py`:** Business logic stays in services per existing layered architecture. The service can be called by both the CRUD API and the test-run endpoint, avoiding duplication.
- **`005_add_custom_workflows.sql`:** Migration naming follows existing pattern (004 was RunPod support).

---

## Architectural Patterns

### Pattern 1: Dynamic Studio Merge at Runtime

**What:** `studioConfig.ts` exposes a `getDynamicStudios()` async function that fetches published custom workflows from the API and synthesizes them into `StudioConfig`-shaped objects. `App.tsx` merges them with `studios[]` at startup and on publish events.

**When to use:** The static `studios[]` array in `studioConfig.ts` cannot be modified at runtime without a redeploy. For Workflow Builder, we need features to appear in navigation immediately after an admin publishes them without any rebuild.

**Trade-offs:** Adds one API call on app load; studios appear after hydration (brief flash possible). Acceptable given admin-only publish use case — users load the app fresh after admin publishes.

**Example:**
```typescript
// studioConfig.ts (MODIFIED)
export interface CustomWorkflowConfig {
  id: string;           // slug, e.g., "my-custom-feature"
  name: string;
  studio_id: string;    // which studio to attach to, e.g., "image-studio"
  icon: string;
  gradient: string;
  description: string;
  output_type: 'video' | 'image';
  variable_configs: VariableConfig[];
}

// NEW function
export async function fetchDynamicApps(apiBaseUrl: string, token: string): Promise<AppConfig[]> {
  const response = await fetch(`${apiBaseUrl}/custom-workflows/published`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  return data.workflows.map((wf: CustomWorkflowConfig): AppConfig => ({
    id: wf.id,
    title: wf.name,
    icon: wf.icon,
    gradient: wf.gradient,
    description: wf.description,
    features: [`Model: ${wf.name}`, wf.output_type === 'video' ? 'Video output' : 'Image output']
  }));
}
```

```typescript
// App.tsx (MODIFIED)
const [dynamicApps, setDynamicApps] = useState<AppConfig[]>([]);

useEffect(() => {
  if (!isAuthenticated || !token) return;
  fetchDynamicApps(config.apiBaseUrl, token).then(apps => {
    setDynamicApps(apps);
  });
}, [isAuthenticated, token]);

// Merge dynamic apps into the correct studios when building navigation
const mergedStudios = useMemo(() => mergeStudiosWithDynamicApps(studios, dynamicApps), [dynamicApps]);
```

### Pattern 2: StudioPage Fallback to DynamicWorkflowRenderer

**What:** `StudioPage.tsx` currently has a static `appComponents` record mapping app IDs to components. For any app ID not found in this record, fall through to `DynamicWorkflowRenderer`, passing the app ID so it can load the config from the API.

**When to use:** Every time `StudioPage` renders an app whose ID is not hardcoded. This is the integration point that makes published workflows appear as real pages without modifying the static component map.

**Trade-offs:** Adds an API call when a dynamic app is first opened (to load its config). This is per-navigation, not per-keystroke — negligible cost. Cache the config in component state to avoid re-fetching on re-renders.

**Example:**
```typescript
// StudioPage.tsx (MODIFIED)
import DynamicWorkflowRenderer from './DynamicWorkflowRenderer';

const AppComponent = selectedApp ? appComponents[selectedApp.id] : null;

return (
  <div>
    {AppComponent ? (
      <AppComponent comfyUrl={comfyUrl} />
    ) : selectedApp ? (
      // Dynamic app: load config from DB and render generically
      <DynamicWorkflowRenderer appId={selectedApp.id} comfyUrl={comfyUrl} />
    ) : null}
  </div>
);
```

### Pattern 3: DynamicWorkflowRenderer as a Config-Driven Feature Page

**What:** A single React component that receives an `appId`, fetches the `CustomWorkflowConfig` from the API, renders the appropriate input widgets based on `variable_configs`, handles file uploads, and submits via the existing `apiClient.submitWorkflow()`. It is a drop-in replacement for any feature page.

**When to use:** All published custom workflows. This component must produce the same job-tracking behavior as hand-coded pages — same `createJob`, `startJobMonitoring`, `completeJob` calls.

**Trade-offs:** A generic renderer is inherently less specialized than a hand-coded page. Complex input interactions (e.g., multi-person mask editor, timeline sync) remain hand-coded pages. DynamicWorkflowRenderer handles the common pattern: upload files, set parameters, generate, view result.

**Example:**
```typescript
// DynamicWorkflowRenderer.tsx (NEW)
interface Props {
  appId: string;   // matches custom_workflows.slug
  comfyUrl: string;
}

export default function DynamicWorkflowRenderer({ appId, comfyUrl }: Props) {
  const [config, setConfig] = useState<CustomWorkflowConfig | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiClient.getCustomWorkflow(appId).then(data => setConfig(data));
  }, [appId]);

  async function submit() {
    // Build parameters from fieldValues + variable_configs mapping
    // Each VariableConfig has: node_id, input_name, widget_type, param_key
    const parameters = buildParametersFromConfig(config!.variable_configs, fieldValues);

    const response = await apiClient.submitWorkflow(
      config!.workflow_file,  // workflow name in backend/workflows/
      parameters,
      comfyUrl,
      `dynamic-${appId}-${Math.random().toString(36).slice(2)}`
    );

    if (response.success) {
      await createJob({ job_id: response.prompt_id!, workflow_type: appId, ... });
      const cleanup = startJobMonitoring(response.prompt_id!, comfyUrl, handleJobUpdate);
      // cleanup on unmount
    }
  }

  // Render input widgets based on variable_configs
  // Each VariableConfig.widget_type maps to a specific input component
}
```

### Pattern 4: JSONB Config Schema for Variable Configs

**What:** Each `custom_workflows` row stores `variable_configs` as a JSONB array. Each element describes one user-facing input: which ComfyUI node it maps to, what widget to render, its display label, and validation rules.

**When to use:** For flexible schema evolution — new widget types can be added without altering the database table structure.

**Trade-offs:** JSONB gives flexibility but loses foreign-key constraints. Acceptable here because the data is admin-managed, not user-generated, and the schema is validated at the application layer.

**Schema:**
```typescript
// frontend/src/types/customWorkflow.ts (NEW)
export interface VariableConfig {
  param_key: string;        // placeholder key in workflow: {{PARAM_KEY}}
  node_id: string;          // ComfyUI node ID, e.g., "5"
  input_name: string;       // field inside node inputs, e.g., "text"
  widget_type: 'text' | 'textarea' | 'slider' | 'file_image' | 'file_audio'
              | 'file_video' | 'dropdown' | 'toggle' | 'resolution' | 'number';
  label: string;            // display label for the user
  default_value?: any;      // optional default
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    options?: string[];     // for dropdown
    accept?: string;        // for file inputs, e.g., "image/*"
  };
  section?: string;         // optional grouping label
  order: number;            // display order within section
}

export interface SectionConfig {
  key: string;
  title: string;
  order: number;
}

export interface CustomWorkflowConfig {
  id: string;               // UUID
  slug: string;             // URL-safe name, used as app ID
  name: string;
  studio_id: string;        // target studio for navigation
  icon: string;
  gradient: string;
  description: string;
  workflow_file: string;    // filename in backend/workflows/ (without .json)
  variable_configs: VariableConfig[];
  section_configs: SectionConfig[];
  output_type: 'video' | 'image';
  published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}
```

### Pattern 5: ComfyUI Workflow JSON Node Parsing

**What:** The builder's node inspector parses a raw ComfyUI workflow JSON and extracts a structured list of nodes with their inputs — specifically values that look like user-configurable parameters (strings, numbers, booleans — not node-to-node connections).

**When to use:** When an admin uploads a workflow JSON file. The parsed node list powers the `VariableConfigurator` so the admin can map inputs to widget types without reading raw JSON.

**Trade-offs:** ComfyUI workflow JSON uses numeric keys for node IDs and stores connections as `[node_id, output_index]` arrays. The parser must distinguish between scalar values (configurable) and array values (node connections). This is deterministic — array inputs are always connections, scalar inputs are always values.

**Example (backend service):**
```python
# backend/services/custom_workflow_service.py (NEW, excerpt)
def parse_workflow_nodes(workflow_json: dict) -> list[dict]:
    """
    Extract user-configurable inputs from a ComfyUI workflow.
    Returns list of: {node_id, class_type, input_name, current_value, input_type}
    """
    nodes = []
    for node_id, node_data in workflow_json.items():
        class_type = node_data.get("class_type", "Unknown")
        inputs = node_data.get("inputs", {})
        configurable_inputs = []

        for input_name, value in inputs.items():
            # Skip node connections (arrays like [node_id, output_index])
            if isinstance(value, list):
                continue
            # Skip null values
            if value is None:
                continue
            # This is a scalar — user-configurable
            configurable_inputs.append({
                "input_name": input_name,
                "current_value": value,
                "inferred_type": type(value).__name__  # str, int, float, bool
            })

        if configurable_inputs:
            nodes.append({
                "node_id": node_id,
                "class_type": class_type,
                "inputs": configurable_inputs
            })

    return nodes
```

---

## Data Flow

### Flow 1: Admin Creates and Publishes a Workflow

```
Admin uploads workflow JSON
    │
    ▼
POST /api/custom-workflows/upload
    │ Stores file in Supabase Storage (workflow-uploads/)
    │ Returns file reference
    ▼
POST /api/custom-workflows/parse
    │ Loads JSON, calls parse_workflow_nodes()
    │ Returns list of nodes with configurable inputs
    ▼
WorkflowNodeInspector displays nodes
Admin configures VariableConfigs in VariableConfigurator
    │
    ▼
POST /api/custom-workflows/test-run
    │ Builds params from test values
    │ Calls WorkflowService.build_workflow() (existing)
    │ Calls ComfyUIService.submit_prompt() (existing)
    │ Monitors via existing job polling
    │ Returns result or error
    ▼
Admin confirms, clicks "Publish"
    │
    ▼
POST /api/custom-workflows/  (create or PATCH /api/custom-workflows/{id})
    │ Writes row to custom_workflows table with published=true
    │ workflow_file stored in backend/workflows/ or referenced by path
    ▼
Frontend: dynamicApps state refreshes → navigation shows new feature immediately
```

### Flow 2: User Runs a Published Dynamic Workflow

```
User navigates to dynamic app (e.g., studio = "image-studio", app = "my-custom-feature")
    │
    ▼
StudioPage renders → appComponents["my-custom-feature"] is undefined
    │
    ▼
StudioPage falls through to <DynamicWorkflowRenderer appId="my-custom-feature" />
    │
    ▼
DynamicWorkflowRenderer → GET /api/custom-workflows/my-custom-feature
    │ Returns CustomWorkflowConfig with variable_configs
    ▼
Renders input widgets from variable_configs
User fills inputs, clicks Generate
    │
    ▼
DynamicWorkflowRenderer.submit()
    │ Builds parameters: { PARAM_KEY: fieldValue, ... }
    │ apiClient.submitWorkflow(config.workflow_file, parameters, comfyUrl, clientId)
    │   → POST /api/comfyui/submit-workflow (EXISTING, unchanged)
    │   → WorkflowService.build_workflow() (EXISTING, unchanged)
    │   → ComfyUIService.submit_prompt() (EXISTING, unchanged)
    ▼
createJob({ job_id, workflow_type: appId, ... })  [EXISTING]
updateJobToProcessing(job_id)                      [EXISTING]
startJobMonitoring(job_id, comfyUrl, callback)     [EXISTING]
    │
    ▼
On completion: completeJob({ output_video_urls or output_image_urls }) [EXISTING]
Result displayed in DynamicWorkflowRenderer
Job visible in GenerationFeed (workflow_name = appId)
```

### Flow 3: Navigation Hydration with Dynamic Apps

```
App.tsx mounts, user is authenticated
    │
    ▼
fetchDynamicApps(apiBaseUrl, token)
    │ GET /api/custom-workflows/published
    │ Returns [{id: slug, title, icon, gradient, studio_id, ...}]
    ▼
mergeStudiosWithDynamicApps(studios, dynamicApps)
    │ For each dynamic app, finds matching studio by studio_id
    │ Appends AppConfig to studio.apps
    │ Returns merged studios array
    ▼
App.tsx updates visibleStudios → sidebar re-renders with new apps
validPages array is updated to include new app IDs
    │
    ▼
Dynamic app navigable in sidebar without rebuild
```

---

## Integration Points

### New vs Modified: Complete List

| Component | Status | What Changes |
|-----------|--------|--------------|
| `studioConfig.ts` | MODIFIED | Add `fetchDynamicApps()`, `mergeStudiosWithDynamicApps()`. `StudioPageType` union needs to accommodate dynamic IDs — use `string` for the union or a runtime-checked type. |
| `App.tsx` | MODIFIED | Fetch dynamic apps on auth. Merge into `visibleStudios`. Update `validPages` check to also allow dynamic app slugs. Update main content switch to include dynamic studio page render path. |
| `StudioPage.tsx` | MODIFIED | After `appComponents` lookup fails, render `DynamicWorkflowRenderer` instead of `null`. |
| `WorkflowBuilder.tsx` | NEW | Admin page with four sub-panels: upload, inspect, configure, publish. |
| `DynamicWorkflowRenderer.tsx` | NEW | Generic feature page. Must mirror job-tracking pattern of hand-coded pages. |
| `WorkflowBuilder/NodeInspector.tsx` | NEW | Displays parsed node list, node class names, input names, current values. |
| `WorkflowBuilder/VariableConfigurator.tsx` | NEW | For each configurable input, lets admin choose widget type, label, default, validation. |
| `WorkflowBuilder/WorkflowTestPanel.tsx` | NEW | Submits a test run using test values, shows result inline. |
| `types/customWorkflow.ts` | NEW | TypeScript interfaces for VariableConfig, SectionConfig, CustomWorkflowConfig. |
| `apiClient.ts` | MODIFIED | Add methods: `createCustomWorkflow`, `updateCustomWorkflow`, `getCustomWorkflow`, `getPublishedCustomWorkflows`, `uploadWorkflowFile`, `parseWorkflowNodes`, `testRunWorkflow`. |
| `backend/api/custom_workflows.py` | NEW | FastAPI router at `/api/custom-workflows`. All write endpoints gated by `verify_admin`. GET published is accessible to authenticated users. |
| `backend/models/custom_workflow.py` | NEW | Pydantic models: `CustomWorkflowCreate`, `CustomWorkflowUpdate`, `CustomWorkflowResponse`, `ParseWorkflowRequest`, `ParseWorkflowResponse`, `TestRunRequest`. |
| `backend/services/custom_workflow_service.py` | NEW | `parse_workflow_nodes()`, `build_parameters_from_config()`, `test_run()` (calls WorkflowService). |
| `backend/main.py` | MODIFIED | Register new router: `app.include_router(custom_workflows.router, prefix="/api")`. |
| `backend/migrations/005_add_custom_workflows.sql` | NEW | Creates `custom_workflows` table with JSONB columns. |
| `infrastructure-studio` in `studioConfig.ts` | MODIFIED | Add WorkflowBuilder as a new app within infrastructure-studio (alongside existing Infrastructure Manager). |

### API Boundary: New Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/custom-workflows/` | GET | user | List all published workflows |
| `/api/custom-workflows/published` | GET | user | List published workflows for nav hydration |
| `/api/custom-workflows/{slug}` | GET | user | Get single workflow config |
| `/api/custom-workflows/` | POST | admin | Create workflow config |
| `/api/custom-workflows/{id}` | PATCH | admin | Update workflow config |
| `/api/custom-workflows/{id}` | DELETE | admin | Delete workflow config |
| `/api/custom-workflows/upload` | POST | admin | Upload workflow JSON file to storage |
| `/api/custom-workflows/parse` | POST | admin | Parse uploaded JSON, return node list |
| `/api/custom-workflows/test-run` | POST | admin | Test-run workflow with given params |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| DynamicWorkflowRenderer ↔ apiClient | Direct method calls | Same as existing pages |
| DynamicWorkflowRenderer ↔ createJob/startJobMonitoring | Direct import | Reuses existing jobTracking.ts unchanged |
| WorkflowTestPanel ↔ existing ComfyUI submit | Via apiClient.submitWorkflow() | No new submit path needed for test runs |
| custom_workflow_service ↔ WorkflowService | Direct instantiation | `CustomWorkflowService` calls `WorkflowService.build_workflow()` for test runs — same code path as production runs |
| custom_workflow_service ↔ Supabase | Via `get_supabase_for_token()` | Same pattern as video_job_service, image_job_service |

### Critical Constraint: Workflow File Storage

The existing `WorkflowService` loads templates from `backend/workflows/` on disk. Custom workflows uploaded by admins need their JSON accessible by `WorkflowService`. There are two options:

**Option A (recommended):** Store uploaded JSON as a file in `backend/workflows/custom/` — the builder writes the file to disk on upload, `WorkflowService._find_template_path()` already searches subdirectories. No changes to `WorkflowService` required.

**Option B:** Store JSON in Supabase Storage, add a `load_template_from_db()` method to `WorkflowService`. More flexible but more code change.

Choose Option A. `WorkflowService` already supports subdirectories. The file path in `custom_workflows.workflow_file` stores the stem (e.g., `"custom/MyWorkflow"`) which `WorkflowService` resolves to `backend/workflows/custom/MyWorkflow.json`.

**Constraint:** On Heroku, the filesystem is ephemeral — `backend/workflows/custom/` does not survive a restart. For Heroku production, Option B (DB storage) becomes necessary. For local and RunPod, Option A works. Flag this as a phase-specific concern: start with Option A for development, migrate to Option B before Heroku deploy.

---

## Database Schema

### `custom_workflows` Table

```sql
-- backend/migrations/005_add_custom_workflows.sql
CREATE TABLE IF NOT EXISTS custom_workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,           -- app ID used in navigation
  name          TEXT NOT NULL,
  studio_id     TEXT NOT NULL,                  -- matches StudioConfig.id
  icon          TEXT NOT NULL DEFAULT '⚡',
  gradient      TEXT NOT NULL DEFAULT 'from-blue-500 to-purple-600',
  description   TEXT,
  workflow_file TEXT NOT NULL,                  -- stem path for WorkflowService
  variable_configs  JSONB NOT NULL DEFAULT '[]',
  section_configs   JSONB NOT NULL DEFAULT '[]',
  output_type   TEXT NOT NULL DEFAULT 'video',  -- 'video' | 'image'
  published     BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for published lookup (navigation hydration)
CREATE INDEX idx_custom_workflows_published ON custom_workflows(published)
  WHERE published = true;

-- Index for slug lookup (per-app config fetch)
CREATE INDEX idx_custom_workflows_slug ON custom_workflows(slug);

-- RLS: all authenticated users can read published; admins can do everything
ALTER TABLE custom_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read published" ON custom_workflows FOR SELECT
  USING (published = true);
-- Admin operations handled at application layer via verify_admin dependency
```

---

## Anti-Patterns

### Anti-Pattern 1: Code Generation Instead of Config-Driven Rendering

**What people do:** Generate TypeScript/Python source files from the builder configuration and write them to disk, triggering a rebuild.

**Why it's wrong:** Requires filesystem access, build tooling available at runtime, and restarts. Eliminates the "instant publish without rebuild" goal. Introduces security risks (arbitrary code injection).

**Do this instead:** Store configuration as JSONB in the database. `DynamicWorkflowRenderer` interprets the config at render time. No code generation, no rebuild.

### Anti-Pattern 2: Separate Submit Path for Dynamic Workflows

**What people do:** Create a new API endpoint for dynamic workflow submission that handles the JSONB config and builds the workflow differently.

**Why it's wrong:** Duplicates the `WorkflowService.build_workflow()` → `ComfyUIService.submit_prompt()` path. Bugs fixed in one path don't fix the other. Test coverage diverges.

**Do this instead:** `DynamicWorkflowRenderer` uses the exact same `apiClient.submitWorkflow()` call as existing pages. The renderer's job is to translate JSONB variable configs into the `parameters` dict that `submitWorkflow` already accepts. The ComfyUI path is unchanged.

### Anti-Pattern 3: Hardcoding Dynamic Studio IDs in App.tsx

**What people do:** Add dynamic studio page cases to the `switch`/`if-else` in `App.tsx` main content area, requiring a code change when new dynamic studios are created.

**Why it's wrong:** Defeats the purpose of dynamic publishing. Every new studio type requires a deploy.

**Do this instead:** The main content area in `App.tsx` handles studio rendering via `StudioPage`. `StudioPage` handles the unknown app ID via `DynamicWorkflowRenderer`. No new cases needed in `App.tsx` for individual dynamic apps.

### Anti-Pattern 4: Storing Raw ComfyUI JSON in the JSONB Column

**What people do:** Store the entire workflow JSON in `variable_configs` or a separate JSONB column rather than just the variable configuration metadata.

**Why it's wrong:** Large JSONB payloads (ComfyUI workflows can be 50-200KB) bloat every row read and make the DB a workflow file store. Navigation hydration fetches all published workflows — fetching full JSON in that query is wasteful.

**Do this instead:** Store only the `variable_configs` metadata (small, structured) in the DB. The workflow JSON file lives at `backend/workflows/custom/`. The `workflow_file` column stores just the path stem.

### Anti-Pattern 5: TypeScript Union Type for Dynamic Page IDs

**What people do:** Add every dynamic app's slug to the `StudioPageType` TypeScript union, requiring a type change with every publish.

**Why it's wrong:** The type union is a compile-time construct. Dynamic slugs don't exist at compile time.

**Do this instead:** `StudioPageType` already covers studio-level IDs (`'image-studio'`, etc.). Dynamic app routing happens within `StudioPage` — the `currentPage` state only needs to know which studio is active, not which individual app within the studio.

---

## Scaling Considerations

| Concern | At Current Scale (small team, ~10 custom workflows) | At 100+ custom workflows |
|---------|------------------------------------------------------|--------------------------|
| Navigation hydration | Fetch all published at startup — fast, acceptable | Add pagination or lazy-load studios; cache response |
| Workflow file storage | Local filesystem (`backend/workflows/custom/`) | Must use Supabase Storage or S3 (ephemeral filesystem on Heroku) |
| JSONB query performance | No issue | Add GIN index on `variable_configs` if filtering by widget_type |
| DynamicWorkflowRenderer | Single component handles all cases | Split by output_type if rendering diverges significantly |

---

## Suggested Build Order

Based on dependencies:

1. **Database migration first** — `005_add_custom_workflows.sql`. Everything else depends on this.

2. **Backend service + models** — `custom_workflow.py` models and `custom_workflow_service.py` with `parse_workflow_nodes()`. No frontend dependency.

3. **Backend API endpoints** — `api/custom_workflows.py`. Depends on service. Start with parse and CRUD; test-run can come later.

4. **`DynamicWorkflowRenderer`** — Can be built independently of builder UI. Unblocks end-to-end testing of the renderer with manually-inserted DB rows.

5. **Navigation hydration** — Modify `studioConfig.ts` and `App.tsx` to fetch and merge dynamic apps. Depends on published endpoint.

6. **`StudioPage` fallback** — One-line change after DynamicWorkflowRenderer exists.

7. **Workflow Builder UI** — `WorkflowBuilder.tsx` with `NodeInspector`, `VariableConfigurator`. Depends on parse endpoint and CRUD endpoints.

8. **Test runner in builder** — `WorkflowTestPanel`. Depends on DynamicWorkflowRenderer patterns being established (reuses same submit logic).

9. **Publish flow** — Connect builder PATCH/publish endpoint to navigation refresh.

---

## Sources

- Direct codebase analysis: `studioConfig.ts`, `StudioPage.tsx`, `App.tsx`, `AuthContext.tsx`, `ExecutionBackendContext.tsx`, `jobTracking.ts`, `apiClient.ts`
- Backend patterns: `workflow_service.py`, `api/comfyui.py`, `api/infrastructure.py` (`verify_admin` pattern), `api/feed.py`, `main.py`
- Database patterns: `supabase.ts` type definitions, existing job table structures
- Project requirements: `.planning/PROJECT.md`

---
*Architecture research for: Workflow Builder integration with sideOUTsticks AI platform*
*Researched: 2026-03-13*
