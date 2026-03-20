# Phase 15: Builder UI - Research

**Researched:** 2026-03-14
**Domain:** React admin builder UI, drag-and-drop, ComfyUI /object_info API, dependency/model checking, GitHub Dockerfile patching
**Confidence:** HIGH

## Summary

Phase 15 is a purely frontend phase that adds a Workflow Builder admin page inside the Infrastructure studio. It consumes the Phase 14 API endpoints (`/api/custom-workflows/`) and combines five distinct panels into one cohesive builder page: (1) workflow upload + node inspector, (2) variable configuration with drag-and-drop reordering, (3) dependency checker against the node registry + live Dockerfile, (4) model checker against S3 volume, and (5) feature metadata editor with publish toggle.

No new backend endpoints are required for the core requirements. The node registry (`backend/runpod_config/node_registry.json`) and model manifest are static files the backend already owns; they need to be exposed via two new lightweight API endpoints so the frontend can drive the dependency/model check UI. The Dockerfile content is already readable via `GET /api/infrastructure/dockerfiles/content`. All CRUD and parse operations are fully implemented in Phase 14.

The main frontend challenge is composing a complex multi-panel builder that feels light and responsive. The critical architectural decision is to use HTML5 native drag-and-drop (no new library) for variable reordering since the project has no dnd library installed and the list is simple (one-dimensional, small). The ComfyUI `/object_info` integration (WB-07) is the one async operation that requires the admin to provide a live ComfyUI URL and is explicitly optional.

**Primary recommendation:** Build the builder as a single `WorkflowBuilder.tsx` page component added to `frontend/src/pages/`, rendered inside `Infrastructure.tsx` as a tabbed sub-section. Add two backend endpoints — `GET /api/infrastructure/node-registry` and `GET /api/infrastructure/model-manifest` — to expose the static JSON files already on disk. Use native HTML5 drag-and-drop for variable reordering. No new npm packages are needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WB-05 | Admin can select which node inputs become user-facing variables by clicking them | Node inspector renders parsed nodes from `/api/custom-workflows/parse`; clicking a non-link input adds it to variable_config JSONB array |
| WB-06 | System auto-detects suggested field types from ComfyUI metadata | Type inference from value shape: boolean→toggle, array-of-strings (COMBO)→dropdown, string→text, integer→number, float→slider; sourced from parsed input values or enriched by /object_info |
| WB-07 | Admin can optionally enrich node metadata via ComfyUI /object_info endpoint | Optional async fetch to `{comfyUrl}/object_info/{class_type}`; response gives input type hints and constraints; existing pattern in FluxLora.tsx and CreateImage.tsx |
| DEP-01 | System extracts all custom node class_types from the uploaded workflow | Done client-side from ParseWorkflowResponse.nodes array; each node has class_type |
| DEP-02 | System looks up custom node package names from ComfyUI registry by class_type | New `GET /api/infrastructure/node-registry` endpoint returns node_registry.json; class_type→package reverse map built client-side |
| DEP-03 | System checks current Dockerfile for which custom node packages are already installed | `GET /api/infrastructure/dockerfiles/content` already exists; parse git clone lines matching `custom_nodes/{package_name}` |
| DEP-04 | Admin can add missing custom node packages to Dockerfile with one click | Append git clone + pip install block to Dockerfile content and commit via `PUT /api/infrastructure/dockerfiles/content` using existing sha+commit pattern from DockerfileEditor.tsx |
| MDL-01 | System extracts all model filenames referenced in the workflow | Client-side: scan workflow JSON inputs for MODEL_FIELDS keys (ckpt_name, model_name, unet_name, vae_name, lora_name, etc.) with .safetensors/.pth extensions |
| MDL-02 | System checks which models exist on RunPod network volume via S3 listing | New `GET /api/infrastructure/model-manifest` endpoint returns model_manifest.json; cross-reference extracted filenames against manifest list |
| MDL-03 | Admin sees list of models with present/missing status indicators | Frontend renders extracted model refs with green (in manifest) / red (missing from manifest) badges |
| VAR-01 | Admin can set display label, placeholder text, and help text per variable | Variable config editor panel with three text inputs per variable |
| VAR-02 | Admin can choose UI input type: 10 types | Dropdown selector with 10 options: text, textarea, number, slider, file-image, file-audio, file-video, dropdown, toggle, resolution |
| VAR-03 | Admin can set default values, min/max, step size | Conditional extra fields shown based on selected input type |
| VAR-04 | Admin can set validation rules: required, file type accept, file size limits | Checkbox for required + text input for accept filter + number input for size limit |
| VAR-05 | System maps variable to {{PLACEHOLDER_KEY}} with visual indicator | Placeholder key derived from node_id + input_name; shown as a read-only badge on each variable card |
| VAR-06 | Admin can specify file handling mode per file variable | Toggle between "upload-to-comfyui" and "base64" shown only for file-* input types |
| VAR-07 | Admin can reorder variables via drag-and-drop | HTML5 native drag-and-drop on variable card list (no library needed for 1D list) |
| VAR-08 | Admin can organize variables into named sections | Section name input + "Add Section" button; drag into section via drop zone |
| META-01 | Admin can set feature name, auto-generated slug (editable), and description | Text inputs with slug auto-generated from name (mirrors backend generate_slug logic in JS) |
| META-02 | Admin can assign feature to any existing studio | Dropdown of studio IDs from studioConfig.ts |
| META-03 | Admin can specify output type: image, video, or audio | Three-way radio/dropdown |
| META-04 | Admin can pick an icon (emoji) and gradient colors | Emoji text input + Tailwind gradient class selector (predefined palette) |
| META-05 | Admin can enable or disable a published feature | Toggle that calls publish/unpublish endpoint; disabled hides from non-admins |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 + TypeScript | 19.1.1 | UI framework | Already in use |
| TailwindCSS | 3.4.17 | Styling | Already in use; all existing components use Tailwind |
| apiClient (internal) | - | Backend communication | All API calls go through the existing singleton with auth headers |
| HTML5 Drag and Drop API | native | Variable reordering | No library needed; list is 1D and small; avoids new dependency |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @monaco-editor/react | 4.7.0 | Code/JSON preview | Already installed; use for read-only JSON preview of workflow if needed |
| vitest | 4.0.18 | Frontend tests | Existing test infrastructure for component tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native HTML5 DnD | @dnd-kit/core | @dnd-kit is better for complex cases but adds ~35KB; native DnD works perfectly for a simple vertical list of cards; no install needed |
| Native HTML5 DnD | react-beautiful-dnd | Deprecated in favor of @dnd-kit; avoid |
| Tailwind gradient palette | Color picker library | Predefined gradient classes matches the project design system; free-form color pickers add complexity for no design value |
| Client-side type inference | Mandatory /object_info call | /object_info is optional per WB-07; inference from value shape is reliable enough as default |

**Installation:**
```bash
# No new packages needed. All required tools are already installed.
```

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/pages/
└── WorkflowBuilder.tsx          # New: main builder page component

frontend/src/pages/
└── Infrastructure.tsx           # Modified: add "Workflow Builder" tab

frontend/src/lib/
└── apiClient.ts                 # Modified: add custom workflow + node-registry + model-manifest methods

backend/api/
└── infrastructure.py            # Modified: add node-registry + model-manifest endpoints
```

### Pattern 1: Builder as Tab in Infrastructure Page
**What:** `Infrastructure.tsx` gains a second tab — "File Manager" (existing) and "Workflow Builder" (new). The tab switcher is a simple `currentTab` state with two buttons.
**When to use:** Always. The builder lives in the Infrastructure studio which is already admin-only. No new routing is needed.
**Example:**
```tsx
// Source: existing Infrastructure.tsx pattern
const [currentTab, setCurrentTab] = useState<'files' | 'builder'>('files');

return (
  <div>
    {/* Tab bar */}
    <div className="flex gap-2 mb-6">
      <button
        onClick={() => setCurrentTab('files')}
        className={`px-4 py-2 rounded-xl font-medium transition-all ${
          currentTab === 'files'
            ? 'bg-slate-700 text-white'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        File Manager
      </button>
      <button
        onClick={() => setCurrentTab('builder')}
        className={`px-4 py-2 rounded-xl font-medium transition-all ${
          currentTab === 'builder'
            ? 'bg-slate-700 text-white'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        Workflow Builder
      </button>
    </div>

    {currentTab === 'files' && <FileTree ... />}
    {currentTab === 'builder' && <WorkflowBuilder comfyUrl={comfyUrl} />}
  </div>
);
```

### Pattern 2: Builder State Machine
**What:** The builder has a linear flow: upload → inspect → configure → check deps → set metadata → save/publish. Represent this as a multi-step form with a `builderStep` state and "Back / Next" navigation.
**When to use:** Keeps the UI focused; prevents admin from trying to configure variables before uploading a workflow.
**Example:**
```tsx
type BuilderStep = 'upload' | 'inspect' | 'variables' | 'dependencies' | 'metadata';

const [step, setStep] = useState<BuilderStep>('upload');
const [parsedNodes, setParsedNodes] = useState<ParsedNode[]>([]);
const [variableConfig, setVariableConfig] = useState<VariableConfig[]>([]);
const [workflowId, setWorkflowId] = useState<string | null>(null);
```

### Pattern 3: Type Inference from Input Values (WB-06)
**What:** Auto-suggest a field type by inspecting the parsed input value without calling /object_info.
**When to use:** Applied automatically when admin promotes an input to a variable; admin can override.
**Example:**
```typescript
// Source: ComfyUI datatypes documentation + existing codebase analysis
function inferFieldType(value: unknown): VariableInputType {
  if (typeof value === 'boolean') return 'toggle';
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return 'dropdown';
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower.endsWith('.safetensors') || lower.endsWith('.pth') || lower.endsWith('.ckpt')) return 'text';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return 'file-image';
    if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm')) return 'file-video';
    if (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.flac')) return 'file-audio';
    return 'text';
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return 'number';
    return 'slider'; // floats default to slider
  }
  return 'text'; // fallback
}
```

### Pattern 4: /object_info Enrichment (WB-07)
**What:** Optional async fetch to enrich type inference with actual ComfyUI node metadata. The `/object_info/{class_type}` endpoint returns the full node input spec including type, default, min, max.
**When to use:** After the admin clicks "Enrich from ComfyUI" button while on the inspect step (optional, requires comfyUrl).
**Example:**
```typescript
// Source: existing FluxLora.tsx pattern (line 124) + api_doc.md
async function fetchObjectInfo(comfyUrl: string, classType: string): Promise<Record<string, ComfyNodeInput>> {
  const response = await fetch(`${comfyUrl}/object_info/${classType}`, {
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) return {};
  const data = await response.json();
  // Response structure: { [classType]: { input: { required: {...}, optional: {...} } } }
  const nodeInfo = data[classType];
  if (!nodeInfo?.input) return {};
  return {
    ...nodeInfo.input.required,
    ...nodeInfo.input.optional,
  };
}

// /object_info response for a single input field:
// "steps": ["INT", { "default": 20, "min": 1, "max": 10000, "step": 1 }]
// "cfg": ["FLOAT", { "default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1 }]
// "sampler_name": [["euler", "euler_ancestral", ...], {}]   <- COMBO = array of options
// "tiled": ["BOOLEAN", { "default": true }]
```

### Pattern 5: Dependency Check (DEP-01 to DEP-04)
**What:** Extract class_types from the parsed workflow, look up packages in node_registry.json, check which are present in Dockerfile content, show missing ones with "Add to Dockerfile" button.
**When to use:** On the "Dependencies" step of the builder.
**Example:**
```typescript
// Source: scan_workflows.py logic ported to TypeScript

// Step 1: Reverse map from node_registry endpoint
// GET /api/infrastructure/node-registry returns the packages dict
function buildClassTypeToPackage(registry: NodeRegistry): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [pkgName, pkgInfo] of Object.entries(registry.packages)) {
    for (const classType of pkgInfo.class_types) {
      map[classType] = pkgName;
    }
  }
  return map;
}

// Step 2: Check Dockerfile content
// GET /api/infrastructure/dockerfiles/content returns { content, sha, path }
function parseInstalledPackages(dockerfileContent: string): Set<string> {
  const installed = new Set<string>();
  // Look for: git clone ... custom_nodes/{PackageName}
  const regex = /custom_nodes\/([^\s\\]+)/g;
  let match;
  while ((match = regex.exec(dockerfileContent)) !== null) {
    installed.add(match[1]);
  }
  return installed;
}

// Step 3: Append missing package to Dockerfile
function buildDockerfileInstallBlock(pkgName: string, repo: string, hasRequirements: boolean): string {
  let block = `\n# Added by Workflow Builder\nRUN cd /comfyui/custom_nodes && \\\n    git clone ${repo} ${pkgName}`;
  if (hasRequirements) {
    block += `\nRUN cd /comfyui/custom_nodes/${pkgName} && \\\n    pip install -r requirements.txt --no-cache-dir`;
  }
  return block + '\n';
}
```

### Pattern 6: Model Check (MDL-01 to MDL-03)
**What:** Extract model filenames from workflow inputs (same field names as scan_workflows.py), cross-reference against model_manifest.json.
**When to use:** On the "Dependencies" step alongside dependency check.
**Example:**
```typescript
// Source: scan_workflows.py MODEL_FIELDS + MODEL_EXTENSIONS ported to TypeScript
const MODEL_FIELDS = new Set([
  'ckpt_name', 'model_name', 'unet_name', 'vae_name', 'lora_name',
  'clip_name', 'clip_name1', 'clip_name2', 'model', 'lora',
  'audio_model', 'name', 'gemma_path',
]);
const MODEL_EXTENSIONS = new Set(['.safetensors', '.pth', '.ckpt', '.bin', '.onnx']);

function extractModelRefs(nodes: ParsedNode[]): string[] {
  const refs = new Set<string>();
  for (const node of nodes) {
    for (const input of node.configurable_inputs) {
      if (typeof input.value !== 'string') continue;
      if (input.value.startsWith('{{') && input.value.endsWith('}}')) continue; // placeholder
      const ext = input.value.slice(input.value.lastIndexOf('.')).toLowerCase();
      if (MODEL_FIELDS.has(input.name) || MODEL_EXTENSIONS.has(ext)) {
        refs.add(input.value);
      }
    }
  }
  return Array.from(refs);
}

// Model manifest response: { models: [{ filename, path, type, ... }] }
// Check: modelRef basename matches manifest filename
function checkModelPresence(refs: string[], manifest: ModelManifest): ModelStatus[] {
  const manifestFilenames = new Set(manifest.models.map(m => m.filename));
  const manifestBasenames = new Set(manifest.models.map(m => m.filename.split('/').pop()!));
  return refs.map(ref => {
    const basename = ref.split('/').pop()!;
    const present = manifestFilenames.has(ref) || manifestBasenames.has(basename);
    return { filename: ref, present };
  });
}
```

### Pattern 7: Variable Config JSONB Schema
**What:** The variable_config JSONB array stores one object per variable. This is the TypeScript type that matches the DB schema and is sent via `PUT /api/custom-workflows/{id}`.
**When to use:** As the canonical shape for variable configuration throughout the builder.
**Example:**
```typescript
// Source: REQUIREMENTS.md VAR-01 through VAR-08 + DB migration 008_add_custom_workflows.sql
export interface VariableConfig {
  // Identity
  id: string;                    // uuid, generated client-side (crypto.randomUUID())
  node_id: string;               // source node ID from workflow
  input_name: string;            // source input field name from workflow
  placeholder_key: string;       // {{PLACEHOLDER_KEY}} in template — auto-derived: `${node_id}_${input_name}`.toUpperCase()

  // Display
  label: string;                 // admin-set display label
  placeholder?: string;          // input placeholder text
  help_text?: string;            // help text shown below input

  // Input type
  type: 'text' | 'textarea' | 'number' | 'slider' | 'file-image' | 'file-audio' | 'file-video' | 'dropdown' | 'toggle' | 'resolution';

  // Value constraints
  default_value?: string | number | boolean;
  min?: number;                  // for number/slider
  max?: number;                  // for number/slider
  step?: number;                 // for number/slider
  options?: string[];            // for dropdown: list of choices

  // Validation
  required?: boolean;
  accept?: string;               // file accept filter e.g. "image/png,image/jpeg"
  max_size_mb?: number;          // file size limit in MB

  // File handling
  file_mode?: 'upload' | 'base64'; // only for file-* types

  // Organization
  section_id?: string;           // null = unsectioned
  order: number;                 // sort order within section (or globally)
}

export interface SectionConfig {
  id: string;                    // uuid, generated client-side
  name: string;                  // section display name
  order: number;                 // sort order
}
```

### Pattern 8: Placeholder Key Derivation (VAR-05)
**What:** The `{{PLACEHOLDER_KEY}}` that gets substituted in the workflow template is auto-derived from node_id + input_name, shown as a read-only badge. The backend's WorkflowService.build_workflow() does the substitution.
**When to use:** When admin promotes an input to a variable, derive the key immediately. Show it visually in the variable card.
**Example:**
```typescript
// Source: REQUIREMENTS.md VAR-05 + WorkflowService substitution pattern
function deriveplaceholderKey(nodeId: string, inputName: string): string {
  // e.g. node_id="14", input_name="ckpt_name" → "14_CKPT_NAME"
  return `${nodeId}_${inputName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}
// Used in workflow template as: {{14_CKPT_NAME}}
// WorkflowService.build_workflow() replaces this with the user-supplied value
```

### Pattern 9: Native HTML5 Drag-and-Drop for Variable Reordering (VAR-07)
**What:** Implement variable list reordering using the native HTML5 draggable API. No library needed.
**When to use:** Variable card list in the VAR configuration step.
**Example:**
```tsx
// Source: MDN HTML Drag and Drop API — standard pattern
function VariableList({ variables, onReorder }: { variables: VariableConfig[]; onReorder: (reordered: VariableConfig[]) => void }) {
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) return;
    const updated = [...variables];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, moved);
    onReorder(updated.map((v, i) => ({ ...v, order: i })));
    dragIndexRef.current = null;
  };

  return (
    <div>
      {variables.map((v, i) => (
        <div
          key={v.id}
          draggable
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, i)}
          className="cursor-grab active:cursor-grabbing ..."
        >
          {/* Variable card */}
        </div>
      ))}
    </div>
  );
}
```

### Pattern 10: Slug Auto-Generation (META-01)
**What:** Mirror the backend `generate_slug()` function in TypeScript so the slug field auto-fills as the admin types the feature name.
**When to use:** In the metadata editor, `name` input onChange.
**Example:**
```typescript
// Source: backend/models/custom_workflow.py generate_slug function
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

### Anti-Patterns to Avoid
- **Single-page flat layout:** Do NOT render all builder sections at once with scroll. Use a step-based or tabbed layout. The variable configuration step alone is complex enough to fill a screen.
- **Blocking on /object_info:** WB-07 is explicitly optional. The builder must work without a live ComfyUI connection. Wrap /object_info calls in try/catch, show status, never block.
- **Client-side only save:** Always persist variable_config to the backend via `PUT /api/custom-workflows/{id}` on each step transition. Do NOT wait until "Publish" to save configuration.
- **Deriving placeholder keys at render time:** Derive and store `placeholder_key` in the variable config object when the variable is created. Do not re-derive dynamically — it would break if the admin renames a variable later.
- **Overwriting Dockerfile between markers:** The DEP-04 implementation appends BELOW the `--- AUTO-GENERATED CUSTOM NODES END ---` marker, not inside it, to avoid conflicting with the `generate_dockerfile.py` script. Manual additions go after the auto-generated block.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workflow template substitution | Custom placeholder replacement in frontend | `PUT /api/custom-workflows/{id}` stores config; `execute_dynamic_workflow` handles substitution | WorkflowService already handles string/number/boolean type coercion and unsubstituted placeholder detection |
| Dockerfile content reading | Direct GitHub API call from frontend | `GET /api/infrastructure/dockerfiles/content` (already exists) | Backend owns GitHub credentials; frontend never touches GitHub API directly |
| Dockerfile writing | Direct GitHub API call from frontend | `PUT /api/infrastructure/dockerfiles/content` (already exists) | Same reason; sha-based optimistic locking is handled by the existing endpoint |
| S3 model existence check | Direct S3 listing from frontend | `GET /api/infrastructure/node-registry` + client-side manifest cross-reference | S3 credentials never go to frontend; manifest cross-reference is sufficient for MDL-02/MDL-03 |
| Admin auth guard | Custom isAdmin check in component | `const { isAdmin } = useAuth()` + early return (already done in Infrastructure.tsx) | AuthContext.isAdmin is the project-standard guard |
| Slug generation | Custom implementation | Port `generate_slug()` from Python verbatim | Ensures frontend slug matches what the backend will store |

**Key insight:** Every backend operation this phase needs already exists (Phase 14 CRUD + Phase 6/7 Dockerfile + Infrastructure S3). Phase 15 is wiring the frontend to these APIs, not building new backend logic.

## Common Pitfalls

### Pitfall 1: /object_info Response Shape is Per-Class-Type
**What goes wrong:** Code tries to access `response.data.input` directly but the actual response wraps it under the class_type name: `response[classType].input.required`.
**Why it happens:** The API returns `{ "KSampler": { "input": { "required": {...}, "optional": {...} } } }` not `{ "input": ... }`.
**How to avoid:** Always access `data[classType]?.input` not `data.input`. See existing FluxLora.tsx line 131: `data?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0]`.
**Warning signs:** All type enrichment returns undefined; no error thrown.

### Pitfall 2: COMBO Inputs Are Arrays, Not Strings
**What goes wrong:** Type inference treats all non-link inputs as scalar values. A COMBO input has a value that is an array of strings (the allowed options), e.g. `["euler", "euler_ancestral", "dpm_2"]`. Calling `typeof value === 'string'` returns false.
**Why it happens:** In ComfyUI API format, the workflow stores the currently selected COMBO option as a plain string, but the /object_info response wraps COMBO type definitions differently. In the parsed workflow JSON, the selected value is a string but inference from /object_info sees an array of options.
**How to avoid:** In workflow JSON, COMBO input values are strings (the selected option). In /object_info, COMBO inputs have the definition as `[["option1", "option2", ...], {...}]` where `[0]` is an array of strings. Check `Array.isArray(objectInfoDef[0])` to detect COMBO.
**Warning signs:** Dropdown type not auto-detected when using /object_info enrichment.

### Pitfall 3: Placeholder Key Collision Between Nodes
**What goes wrong:** Two nodes have an input with the same name (e.g., both node "3" and node "8" have a `steps` input). The placeholder keys `3_STEPS` and `8_STEPS` are different — but an admin might give both the same label "Steps", causing confusion.
**Why it happens:** Multiple nodes in a workflow commonly share input names.
**How to avoid:** Show the `node_id` and `class_type` prominently on each variable card alongside the placeholder key badge. The admin must understand which node each variable targets.
**Warning signs:** Admin gets confused why two "Steps" sliders exist.

### Pitfall 4: Dockerfile SHA Staleness on Rapid Successive Edits
**What goes wrong:** Admin adds package A, then immediately adds package B. The second commit uses the SHA from before package A was added, causing a 409 conflict.
**Why it happens:** The SHA must be the current HEAD SHA of the file. After committing package A, the SHA changes.
**How to avoid:** After each successful Dockerfile commit (DEP-04), immediately fetch the new SHA from the response and update local state. The `PUT /api/infrastructure/dockerfiles/content` response includes `commit_sha` — but the file SHA is not the commit SHA. After any Dockerfile mutation, re-fetch the file via `GET /api/infrastructure/dockerfiles/content` to get the updated blob SHA.
**Warning signs:** 409 errors on the second "Add to Dockerfile" click within the same builder session.

### Pitfall 5: Variable Config Not Persisted Before Step Transition
**What goes wrong:** Admin configures variables on step 3, navigates to step 4 (dependencies), then navigates back — and all variable config is lost because it was only in React state.
**Why it happens:** Step navigation re-renders the step component; if state is local to the step component it resets.
**How to avoid:** Keep ALL builder state (parsedNodes, variableConfig, sectionConfig, metadata) lifted to `WorkflowBuilder.tsx` component state (or a single `builderState` reducer). Persist to backend via `PUT /api/custom-workflows/{id}` on every transition. workflowId is set after the initial create call on step 1.
**Warning signs:** Clicking "Back" loses variable configuration.

### Pitfall 6: model_manifest.json Uses Full Paths, Workflow Uses Basenames
**What goes wrong:** The workflow references `"Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors"` but the manifest stores `{ "filename": "Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors", "path": "unet/WAN/2.1/" }`. The cross-reference must match on the filename alone, not the full path.
**Why it happens:** ComfyUI stores just the filename in inputs; the manifest tracks path separately.
**How to avoid:** Extract only the filename portion (last path segment) from both sides when comparing. See `scan_workflows.py` lines 264-280 for the normalized comparison logic — port this to TypeScript.
**Warning signs:** All models show as "missing" even though they are in the manifest.

## Code Examples

### New Backend Endpoints (DEP-02, MDL-02)

```python
# Source: Pattern from infrastructure.py — two new lightweight endpoints
# Add to backend/api/infrastructure.py

@router.get("/node-registry")
async def get_node_registry(
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """Return the node_registry.json used for dependency checking. Admin-only."""
    import json
    from pathlib import Path
    registry_path = Path(__file__).resolve().parent.parent / "runpod_config" / "node_registry.json"
    if not registry_path.exists():
        raise HTTPException(status_code=404, detail="node_registry.json not found")
    return json.loads(registry_path.read_text())


@router.get("/model-manifest")
async def get_model_manifest(
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """Return the model_manifest.json used for model presence checking. Admin-only."""
    import json
    from pathlib import Path
    manifest_path = Path(__file__).resolve().parent.parent / "runpod_config" / "model_manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="model_manifest.json not found")
    return json.loads(manifest_path.read_text())
```

### apiClient Methods

```typescript
// Source: existing apiClient.ts pattern — add to ApiClient class

// Parse a workflow and return structured nodes
async parseWorkflow(workflowJson: object) {
  return this.request<ParseWorkflowResponse>('/api/custom-workflows/parse', {
    method: 'POST',
    body: JSON.stringify({ workflow_json: workflowJson }),
  });
}

// Create a new custom workflow (returns the row with generated id)
async createCustomWorkflow(payload: CreateWorkflowPayload) {
  return this.request<CustomWorkflowResponse>('/api/custom-workflows/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Update variable_config and section_config
async updateCustomWorkflow(id: string, payload: UpdateWorkflowPayload) {
  return this.request<CustomWorkflowResponse>(`/api/custom-workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// Publish / unpublish
async publishCustomWorkflow(id: string) {
  return this.request<CustomWorkflowResponse>(`/api/custom-workflows/${id}/publish`, {
    method: 'POST',
  });
}
async unpublishCustomWorkflow(id: string) {
  return this.request<CustomWorkflowResponse>(`/api/custom-workflows/${id}/unpublish`, {
    method: 'POST',
  });
}

// Dependency check data
async getNodeRegistry() {
  return this.request<NodeRegistry>('/api/infrastructure/node-registry');
}
async getModelManifest() {
  return this.request<ModelManifest>('/api/infrastructure/model-manifest');
}
```

### WorkflowBuilder Step Skeleton

```tsx
// Source: Infrastructure.tsx pattern for admin-only multi-panel tool
// frontend/src/pages/WorkflowBuilder.tsx

type BuilderStep = 'upload' | 'inspect' | 'variables' | 'dependencies' | 'metadata';

interface BuilderState {
  workflowFile: File | null;
  parsedNodes: ParsedNode[];
  workflowId: string | null;
  variableConfig: VariableConfig[];
  sectionConfig: SectionConfig[];
  metadata: FeatureMetadata;
  dockerfileSha: string;  // needed for DEP-04 commit
}

const STEPS: BuilderStep[] = ['upload', 'inspect', 'variables', 'dependencies', 'metadata'];

export default function WorkflowBuilder({ comfyUrl }: { comfyUrl: string }) {
  const [step, setStep] = useState<BuilderStep>('upload');
  const [state, setState] = useState<BuilderState>(initialState);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Step navigation with auto-save
  async function goToStep(next: BuilderStep) {
    if (state.workflowId) {
      await apiClient.updateCustomWorkflow(state.workflowId, {
        variable_config: state.variableConfig,
        section_config: state.sectionConfig,
        ...state.metadata,
      });
    }
    setStep(next);
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <StepIndicator steps={STEPS} current={step} />

      {/* Step panels */}
      {step === 'upload' && <UploadStep state={state} setState={setState} onNext={() => goToStep('inspect')} />}
      {step === 'inspect' && <InspectStep state={state} setState={setState} comfyUrl={comfyUrl} onNext={() => goToStep('variables')} />}
      {step === 'variables' && <VariablesStep state={state} setState={setState} onNext={() => goToStep('dependencies')} />}
      {step === 'dependencies' && <DependenciesStep state={state} setState={setState} onNext={() => goToStep('metadata')} />}
      {step === 'metadata' && <MetadataStep state={state} setState={setState} />}
    </div>
  );
}
```

### Gradient Palette for META-04

```typescript
// Source: existing project gradients from studioConfig.ts
// Provide a predefined set matching the project design system
export const GRADIENT_PALETTE = [
  { label: 'Blue → Purple', value: 'from-blue-500 to-purple-600' },
  { label: 'Purple → Pink', value: 'from-purple-500 to-pink-600' },
  { label: 'Green → Teal', value: 'from-green-500 to-teal-600' },
  { label: 'Orange → Red', value: 'from-orange-500 to-red-600' },
  { label: 'Cyan → Blue', value: 'from-cyan-500 to-blue-600' },
  { label: 'Amber → Orange', value: 'from-amber-500 to-orange-600' },
  { label: 'Slate → Gray', value: 'from-slate-500 to-gray-700' },
  { label: 'Emerald → Teal', value: 'from-emerald-500 to-teal-600' },
  { label: 'Indigo → Purple', value: 'from-indigo-500 to-purple-600' },
];
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Frontend loads workflow JSON from public/workflows/ | Backend WorkflowService loads from backend/workflows/ | v1.0 | Custom workflows use centralized backend templates |
| Static page components per feature | Dynamic rendering from JSONB config | v1.2 (now) | Builder output drives renderer without code changes |
| Manual Dockerfile editing | DockerfileEditor Monaco component | v1.0 | Dockerfile managed via GitHub API; builder can reuse same PUT endpoint |

**Deprecated/outdated:**
- `frontend/public/workflows/*.json` files: Still present for legacy static features but new custom workflows never use this pattern
- `buildPromptJSON()` functions in page components: New custom workflows use `execute_dynamic_workflow` on the backend instead

## Open Questions

1. **Where to save the workflow JSON file before creating the DB record**
   - What we know: The create endpoint requires `workflow_json` in the request body and creates the DB record + template file in one call
   - What's unclear: The builder uploads the JSON file from the browser, parses it, then on "Save & Continue" calls create. The parsed nodes are already in state. The original JSON should also be kept.
   - Recommendation: On the Upload step, read the file with `FileReader.readAsText()`, parse as JSON, call `/api/custom-workflows/parse`, and store the raw JSON in state. On step transition to Inspect, create the DB record by calling `POST /api/custom-workflows/` with the raw JSON. This follows the two-phase approach: parse first (validation), create second (persistence).

2. **Handling the "edit existing workflow" flow**
   - What we know: REQUIREMENTS.md only describes creating a new workflow. The list of existing workflows is at `GET /api/custom-workflows/`.
   - What's unclear: Should the builder also support editing an existing workflow? META-05 implies toggling publish state, which is an edit.
   - Recommendation: Add a workflow list panel to the builder landing (before step 'upload') that shows existing workflows with Edit / Delete / Publish toggle actions. Clicking Edit loads the workflow's variable_config and metadata into the builder state, skipping the upload/inspect steps and going directly to the variables step. This makes the builder a complete management tool.

3. **What happens when admin adds a package to the Dockerfile (DEP-04) and clicks Save + Deploy**
   - What we know: The existing DockerfileEditor has a "Deploy to RunPod" checkbox that triggers a GitHub release. The builder needs the same.
   - What's unclear: Whether the builder's dependency step should include a "Deploy" checkbox or just commit the Dockerfile without deploying.
   - Recommendation: Include a "Trigger RunPod rebuild" checkbox in the dependency step alongside the "Add to Dockerfile" button. Reuse the same payload shape (`trigger_deploy: boolean`) as the existing `PUT /api/infrastructure/dockerfiles/content` endpoint.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 + @testing-library/react 16.3.2 |
| Config file | `frontend/vite.config.ts` (check for test config) |
| Quick run command | `cd frontend && npm test -- --run src/test/` |
| Full suite command | `cd frontend && npm test -- --run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WB-06 | inferFieldType() returns correct types for each value shape | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| DEP-01 | class_types correctly extracted from parsedNodes | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| DEP-03 | parseInstalledPackages() extracts package names from Dockerfile text | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| MDL-01 | extractModelRefs() returns correct filenames from workflow nodes | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| MDL-02 | checkModelPresence() correctly matches filenames against manifest | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| META-01 | generateSlug() matches backend behavior | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| VAR-08 | placeholder key derivation from node_id + input_name | unit | `npm test -- --run src/test/builderUtils.test.ts` | Wave 0 |
| DEP-02, DEP-03, DEP-04 | Backend node-registry endpoint returns parseable JSON | integration | manual / curl | N/A (new endpoint) |
| MDL-02, MDL-03 | Backend model-manifest endpoint returns parseable JSON | integration | manual / curl | N/A (new endpoint) |

### Sampling Rate
- **Per task commit:** `cd frontend && npm test -- --run src/test/builderUtils.test.ts`
- **Per wave merge:** `cd frontend && npm test -- --run`
- **Phase gate:** Full frontend suite green + manual builder walkthrough before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/test/builderUtils.test.ts` — covers WB-06, DEP-01, DEP-03, MDL-01, MDL-02, META-01, VAR-08 pure-function tests
- [ ] No new conftest needed — existing vitest setup covers it

## Sources

### Primary (HIGH confidence)
- `backend/api/custom_workflows.py` — direct code inspection of all Phase 14 API endpoints (parse, CRUD, publish)
- `backend/models/custom_workflow.py` — Pydantic models confirming variable_config and section_config are `List[dict]` JSONB
- `backend/services/custom_workflow_service.py` — WorkflowService integration, template file management, execute_dynamic_workflow
- `backend/api/infrastructure.py` — Dockerfile GET/PUT endpoints; per-endpoint Depends(verify_admin) pattern; S3 listing patterns
- `backend/services/github_service.py` — get_file returns {content, sha, path}; update_file requires sha
- `backend/runpod_config/node_registry.json` — full node registry format with packages.class_types arrays
- `backend/runpod_config/model_manifest.json` — full manifest format with filename, path, type fields
- `backend/scripts/scan_workflows.py` — MODEL_FIELDS, MODEL_EXTENSIONS, extract_class_types, extract_model_refs logic to port
- `frontend/src/pages/Infrastructure.tsx` — admin-only page pattern; card section styling; isAdmin guard
- `frontend/src/components/DockerfileEditor.tsx` — Dockerfile read/write pattern with sha tracking
- `frontend/src/FluxLora.tsx` lines 124-131 — /object_info/{class_type} call pattern
- `frontend/src/lib/studioConfig.ts` — studio IDs, gradient values available for META-02/META-04
- `frontend/package.json` — confirms no drag-and-drop library installed; confirms vitest and @testing-library/react present
- `.planning/phases/14-foundation/14-RESEARCH.md` — DB schema, service patterns, API patterns from Phase 14
- `.planning/phases/14-foundation/14-01-SUMMARY.md` through `14-03-SUMMARY.md` — confirms all Phase 14 endpoints implemented and tested
- [ComfyUI Datatypes Docs](https://docs.comfy.org/custom-nodes/backend/datatypes) — INT/FLOAT/STRING/BOOLEAN/COMBO input type definitions and metadata parameters

### Secondary (MEDIUM confidence)
- [MDN HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) — native drag-and-drop pattern for variable reordering
- ComfyUI source — /object_info response format verified against existing FluxLora.tsx usage in codebase

### Tertiary (LOW confidence)
- None — all critical findings verified against codebase or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; everything already installed or already used
- Architecture: HIGH — patterns derived directly from existing Infrastructure.tsx, DockerfileEditor.tsx, FluxLora.tsx
- Pitfalls: HIGH — all identified from actual codebase analysis (sha staleness, COMBO shape, placeholder collision)
- /object_info format: HIGH — verified against existing usage in FluxLora.tsx line 131 and official ComfyUI docs

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable — all patterns are internal to this project)
