# Phase 16: Test Runner and Dynamic Renderer - Research

**Researched:** 2026-03-14
**Domain:** React dynamic form rendering, file handling (upload-to-ComfyUI / base64), dual-backend job submission, in-builder test panel
**Confidence:** HIGH

## Summary

Phase 16 is the execution heart of the Workflow Builder milestone. It delivers two tightly coupled capabilities that share a single component: (1) an in-builder TestStep panel that lets admins fill in test values and submit a real workflow execution with live progress feedback, and (2) a standalone `DynamicWorkflowPage` component that renders any saved custom workflow configuration into a production-ready feature page.

The key architectural insight from STATE.md is already locked: **both test runner and production renderer call the same backend function (`execute_dynamic_workflow`)** — this was implemented in Phase 14. Phase 16 wires the frontend to that function. What is still missing is (a) the backend HTTP endpoint that exposes `execute_dynamic_workflow` as a POST route, (b) the `DynamicWorkflowPage` React component that renders form fields from `variable_config` JSONB, and (c) a `TestStep` added to `WorkflowBuilder.tsx` as a sixth step after Metadata.

The critical engineering challenge is file handling: some variables have `file_mode: 'upload'` (upload the file to ComfyUI's `/upload/image` endpoint and pass the filename as the placeholder value) and others have `file_mode: 'base64'` (encode the file to base64 and pass the raw base64 string as the placeholder value). The DynamicWorkflowPage must handle both modes transparently, pre-processing all file inputs before calling the backend execute endpoint.

For the dual-backend requirement (DYN-07), the renderer reads the `useExecutionBackend()` context. If the backend is `comfyui`, it calls `POST /api/custom-workflows/{id}/execute` with `base_url`. If the backend is `runpod`, it calls the existing `POST /api/runpod/submit-workflow` pattern — but since `execute_dynamic_workflow` is currently ComfyUI-only, a new `execute_dynamic_workflow_runpod` service path or a unified execute endpoint that branches on backend type is needed. The simplest design (and the one consistent with STATE.md's decisions) is a single backend endpoint that accepts `execution_backend` in the request body and branches internally.

**Primary recommendation:** Add `POST /api/custom-workflows/{id}/execute` backend endpoint that wraps `execute_dynamic_workflow` for ComfyUI and `RunPodService.submit_workflow_json` for RunPod. In the frontend, build `DynamicWorkflowPage` as a self-contained component imported by `App.tsx` for production use and by `WorkflowBuilder.tsx`'s new TestStep for builder preview. No new npm packages needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Admin can fill in test values for all configured variables in the builder | TestStep sub-component in WorkflowBuilder.tsx renders the same DynamicFormRenderer used by production; state is local to the step |
| TEST-02 | Admin can execute a test run against ComfyUI with real-time progress feedback | TestStep calls `POST /api/custom-workflows/{id}/execute` which routes to `execute_dynamic_workflow`; monitors via `startJobMonitoring` |
| TEST-03 | Test output (image/video/audio) displays inline in the builder | TestStep renders result inline using `<video>`, `<img>`, or `<audio>` element depending on `output_type` from metadata |
| DYN-03 | DynamicWorkflowPage renders correct form layout from sections/variables config | Iterate `section_config` and `variable_config` from the workflow DB row; render a `<Section>` per section plus an "Other" group for unsectioned variables |
| DYN-04 | Dynamic page handles file uploads (upload-to-ComfyUI and base64) per variable config | Pre-process loop before submission: `file_mode === 'upload'` → call `uploadMediaToComfy`; `file_mode === 'base64'` → call `fileToBase64`; replace file ref with result in params dict |
| DYN-05 | Dynamic page integrates with job tracking (createJob, startJobMonitoring) | createJob → `POST /api/custom-workflows/{id}/execute` → get prompt_id → updateJobToProcessing → startJobMonitoring; same pattern as all existing pages |
| DYN-07 | Dynamic workflow execution works with both ComfyUI and RunPod backends | `useExecutionBackend()` context determines which execute path; single backend endpoint that accepts `execution_backend` param |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 + TypeScript | 19.1.1 | UI framework | Already in use |
| TailwindCSS | 3.4.17 | Styling | All components use Tailwind |
| apiClient (internal) | - | Backend communication | All API calls go through the existing singleton |
| jobTracking (internal) | - | createJob / completeJob / updateJobToProcessing | Standard pattern across all 8+ existing feature pages |
| startJobMonitoring (components/utils.ts) | - | Poll ComfyUI history for completion | Already handles upload to Supabase Storage on completion |
| startRunPodJobMonitoring (components/utils.ts) | - | Poll RunPod status | Already implemented for RunPod backend |
| useExecutionBackend (ExecutionBackendContext) | - | Read user's ComfyUI vs RunPod preference | Already wired in App.tsx and used via context |
| uploadMediaToComfy (components/utils.ts) | - | Upload file to ComfyUI /upload/image | Already implemented; used in multiple feature pages |
| fileToBase64 (components/utils.ts) | - | Convert file to base64 string | Already implemented |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| useSmartResolution (hooks/useSmartResolution.ts) | - | Width/height inputs that snap to multiples of 32 | For `resolution` variable type |
| UnifiedFeed (components/UnifiedFeed.tsx) | - | Right-side job history sidebar | Required by all production feature pages; NOT in TestStep |
| vitest | 4.0.18 | Frontend unit tests | Existing test infrastructure for pure-function tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single execute endpoint with `execution_backend` param | Separate `/execute-comfyui` and `/execute-runpod` endpoints | Two endpoints are cleaner conceptually but create duplicate route registration; single endpoint with branching is simpler and mirrors the RunPod service's existing pattern |
| Building DynamicFormRenderer inside DynamicWorkflowPage | Extracting it as a separate component | Extraction only needed if TestStep and production page must both import it without WorkflowBuilder's BuilderState; extraction is the correct choice — a standalone `DynamicFormRenderer` component is more testable |
| Polling for output in TestStep via `startJobMonitoring` | Polling via `pollForResult` (older API) | `startJobMonitoring` already handles Supabase Storage upload on completion; use it to stay consistent |

**Installation:**
```bash
# No new packages needed. All required tools already installed.
```

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/pages/
├── WorkflowBuilder.tsx        # Modified: add TestStep (6th step) after MetadataStep
└── DynamicWorkflowPage.tsx    # New: production page component for published workflows

frontend/src/components/
└── DynamicFormRenderer.tsx    # New: renders form from VariableConfig[] + SectionConfig[]
                               # Used by both TestStep and DynamicWorkflowPage

backend/api/
└── custom_workflows.py        # Modified: add POST /{workflow_id}/execute endpoint

backend/models/
└── custom_workflow.py         # Modified: add ExecuteWorkflowRequest + ExecuteWorkflowResponse models

backend/services/
└── custom_workflow_service.py  # Modified: add execute_dynamic_workflow_runpod method (or unified method)
```

### Pattern 1: New Backend Execute Endpoint

**What:** `POST /api/custom-workflows/{workflow_id}/execute` accepts user parameter values (as a flat dict of placeholder_key → value) plus a `base_url` and `execution_backend`, runs the workflow, and returns a `prompt_id`.

**When to use:** Called by both TestStep (admin testing inside builder) and DynamicWorkflowPage (production use). This is the single code path from TEST-04 (already satisfied by the service method — now we need the HTTP route).

**Example:**
```python
# Source: existing custom_workflow_service.py execute_dynamic_workflow + runpod.py submit_workflow

class ExecuteWorkflowRequest(BaseModel):
    """Request to execute a custom workflow (test run or production)."""
    parameters: Dict[str, Any]          # placeholder_key → value; files already processed by frontend
    base_url: str                        # ComfyUI URL (used for comfyui backend; ignored for runpod)
    client_id: str                       # WebSocket client ID for ComfyUI progress
    execution_backend: Literal['comfyui', 'runpod'] = 'comfyui'

class ExecuteWorkflowResponse(BaseModel):
    success: bool
    prompt_id: Optional[str] = None     # ComfyUI prompt_id OR RunPod job_id
    execution_backend: Optional[str] = None
    error: Optional[str] = None

@router.post("/{workflow_id}/execute", response_model=ExecuteWorkflowResponse)
async def execute_workflow(
    workflow_id: str,
    payload: ExecuteWorkflowRequest,
    current_user=Depends(get_current_user),  # NOT admin-only — all users can run published features
) -> ExecuteWorkflowResponse:
    service = CustomWorkflowService()
    workflow = await service.get(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if payload.execution_backend == 'runpod':
        # Re-use RunPodService.submit_workflow_json for pre-built workflow dict
        success, job_id, error = await service.execute_dynamic_workflow_runpod(
            workflow, payload.parameters
        )
    else:
        success, prompt_id, error = await service.execute_dynamic_workflow(
            workflow, payload.parameters, payload.base_url, payload.client_id
        )
        job_id = prompt_id

    if not success:
        raise HTTPException(status_code=500, detail=error or "Execution failed")

    return ExecuteWorkflowResponse(
        success=True,
        prompt_id=job_id,
        execution_backend=payload.execution_backend,
    )
```

### Pattern 2: DynamicFormRenderer Component

**What:** A pure-presentational component that receives `variableConfig`, `sectionConfig`, `formValues`, and `onValueChange` props. It renders one section per `SectionConfig` entry (plus an "Unsectioned" group at the bottom) with the correct input widget for each `VariableConfig.type`.

**When to use:** Imported by both `TestStep` inside `WorkflowBuilder.tsx` and by `DynamicWorkflowPage.tsx`.

**Key design constraints:**
- Does NOT manage state itself — caller owns `formValues` as `Record<string, string | number | boolean | File | null>` keyed by `placeholder_key`
- Does NOT submit — just renders inputs and calls `onValueChange(placeholder_key, value)` on each change
- `resolution` type renders two linked inputs (width + height) stored as `formValues['16_WIDTH']` and `formValues['16_HEIGHT']` — planner needs to decide how to encode the resolution pair (recommend: two separate keys derived from the variable's `placeholder_key` + `_W` / `_H` suffix)
- File inputs store `File` objects in `formValues` (not yet processed); caller pre-processes before submit

**Example:**
```tsx
// Source: existing Section/Field/Label pattern from new_feature_guide.md

interface DynamicFormRendererProps {
  variableConfig: VariableConfig[];
  sectionConfig: SectionConfig[];
  formValues: Record<string, string | number | boolean | File | null>;
  onValueChange: (placeholderKey: string, value: string | number | boolean | File | null) => void;
  disabled?: boolean;     // true while job is running
}

export function DynamicFormRenderer({
  variableConfig,
  sectionConfig,
  formValues,
  onValueChange,
  disabled = false,
}: DynamicFormRendererProps) {
  // Sort variables by order
  const sorted = [...variableConfig].sort((a, b) => a.order - b.order);

  // Group by section
  const groups: Array<{ section: SectionConfig | null; vars: VariableConfig[] }> = [
    ...sectionConfig
      .sort((a, b) => a.order - b.order)
      .map(sec => ({
        section: sec,
        vars: sorted.filter(v => v.section_id === sec.id),
      })),
    {
      section: null,
      vars: sorted.filter(v => !v.section_id),
    },
  ].filter(g => g.vars.length > 0);

  return (
    <div className="space-y-6">
      {groups.map(({ section, vars }) => (
        <div key={section?.id ?? 'unsectioned'} className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-white/80">
          {section && (
            <h2 className="text-xl font-bold text-gray-900 mb-6">{section.name}</h2>
          )}
          <div className="space-y-4">
            {vars.map(v => (
              <FieldRenderer
                key={v.id}
                variable={v}
                value={formValues[v.placeholder_key] ?? v.default_value ?? null}
                onChange={(val) => onValueChange(v.placeholder_key, val)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Pattern 3: FieldRenderer Input Widgets

**What:** A switch over `VariableConfig.type` that renders the appropriate HTML input widget. Each widget reads from `value` and calls `onChange(newValue)`.

**When to use:** Inside `DynamicFormRenderer` for each variable.

**Input type to widget mapping:**
| VariableConfig.type | Widget | Value type |
|---------------------|--------|------------|
| `text` | `<input type="text">` | string |
| `textarea` | `<textarea>` | string |
| `number` | `<input type="number">` with min/max/step | number |
| `slider` | `<input type="range">` + display label | number |
| `file-image` | `<input type="file" accept={v.accept ?? "image/*"}>` | File |
| `file-audio` | `<input type="file" accept={v.accept ?? "audio/*"}>` | File |
| `file-video` | `<input type="file" accept={v.accept ?? "video/*"}>` | File |
| `dropdown` | `<select>` with v.options as `<option>` | string |
| `toggle` | `<input type="checkbox">` | boolean |
| `resolution` | Two `<input type="number">` linked with 32-snap | See note below |

**Resolution type note:** The `resolution` VariableConfig does not have a native width/height pair in the schema — the width and height are encoded as TWO separate keys. Convention (to be locked by planner): `{placeholder_key}_W` and `{placeholder_key}_H`. The backend execute endpoint receives both separately and the workflow template should have two placeholders like `{{14_RESOLUTION_W}}` and `{{14_RESOLUTION_H}}`. ALTERNATIVELY — and simpler — the resolution widget just stores a single `{width}x{height}` string and the backend parses it. The planner should pick one.

**Recommendation for resolution encoding:** Store as TWO separate form values with `_W` / `_H` suffix on the placeholder_key. The backend `execute_dynamic_workflow` receives `params = { '14_RESOLUTION_W': 640, '14_RESOLUTION_H': 360 }` and substitutes both independently. This is cleaner than string parsing.

**Example:**
```tsx
// Source: derived from existing input patterns in LipsyncOnePerson.tsx, WANI2V.tsx

function FieldRenderer({ variable, value, onChange, disabled }: FieldRendererProps) {
  const { type, label, placeholder, help_text, min, max, step, options, accept, required } = variable;

  const baseInputClass = "w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 disabled:opacity-50";

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-gray-800 mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {type === 'text' && (
        <input type="text" className={baseInputClass} value={String(value ?? '')}
          placeholder={placeholder} disabled={disabled}
          onChange={e => onChange(e.target.value)} />
      )}

      {type === 'textarea' && (
        <textarea rows={4} className={`${baseInputClass} resize-vertical`}
          value={String(value ?? '')} placeholder={placeholder} disabled={disabled}
          onChange={e => onChange(e.target.value)} />
      )}

      {type === 'number' && (
        <input type="number" className={baseInputClass}
          value={value !== null && value !== undefined ? Number(value) : ''}
          min={min} max={max} step={step ?? 1} disabled={disabled}
          onChange={e => onChange(Number(e.target.value))} />
      )}

      {type === 'slider' && (
        <div className="flex items-center gap-4">
          <input type="range" className="flex-1 accent-blue-500"
            value={value !== null && value !== undefined ? Number(value) : (min ?? 0)}
            min={min ?? 0} max={max ?? 100} step={step ?? 0.01} disabled={disabled}
            onChange={e => onChange(Number(e.target.value))} />
          <span className="w-16 text-right text-sm text-gray-700 font-mono">
            {value !== null && value !== undefined ? Number(value).toFixed(2) : '-'}
          </span>
        </div>
      )}

      {(type === 'file-image' || type === 'file-audio' || type === 'file-video') && (
        <input type="file" accept={accept ?? getDefaultAccept(type)}
          disabled={disabled}
          onChange={e => onChange(e.target.files?.[0] ?? null)}
          className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold" />
      )}

      {type === 'dropdown' && (
        <select className={baseInputClass} value={String(value ?? '')}
          disabled={disabled} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}

      {type === 'toggle' && (
        <input type="checkbox" checked={Boolean(value)} disabled={disabled}
          onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-blue-500" />
      )}

      {type === 'resolution' && (
        <ResolutionWidget
          placeholderKey={variable.placeholder_key}
          value={value as string | null}
          onChange={onChange}
          disabled={disabled}
        />
      )}

      {help_text && <p className="text-xs text-gray-500 mt-1">{help_text}</p>}
    </div>
  );
}
```

### Pattern 4: File Pre-Processing Before Submit

**What:** Before calling the execute API, iterate over all form values and process file fields based on their `file_mode` setting.

**When to use:** In the submit handler of both `TestStep` and `DynamicWorkflowPage`, before calling `apiClient.executeDynamicWorkflow()`.

**Example:**
```typescript
// Source: existing uploadMediaToComfy + fileToBase64 patterns from utils.ts

async function preprocessFormValues(
  formValues: Record<string, string | number | boolean | File | null>,
  variableConfig: VariableConfig[],
  comfyUrl: string,
): Promise<Record<string, string | number | boolean>> {
  const processed: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(formValues)) {
    const varConfig = variableConfig.find(v => v.placeholder_key === key);

    if (value instanceof File && varConfig) {
      if (varConfig.file_mode === 'base64') {
        // base64 encode (strips the data: prefix)
        processed[key] = await fileToBase64(value);
      } else {
        // Default: upload to ComfyUI, use returned filename
        const filename = await uploadMediaToComfy(comfyUrl, value);
        processed[key] = filename;
      }
    } else if (value !== null && value !== undefined) {
      processed[key] = value as string | number | boolean;
    }
    // null values (for optional fields) — omit from params dict, WorkflowService ignores unsubstituted optional placeholders
  }

  return processed;
}
```

**Important:** File pre-processing must happen BEFORE calling the backend execute endpoint. The backend `execute_dynamic_workflow` expects all values to be strings/numbers/booleans already — it does NOT handle `File` objects or re-do uploads.

### Pattern 5: TestStep Integration in WorkflowBuilder

**What:** A sixth step `'test'` added to the `STEPS` array in `WorkflowBuilder.tsx`. The step renders a `DynamicFormRenderer` using the builder's current `state.variableConfig` and `state.sectionConfig`, plus a Submit button that calls the execute endpoint with the current `state.workflowId`.

**When to use:** After the admin completes the Metadata step and is ready to run a trial execution.

**Key decisions for planner:**
- TestStep uses `comfyUrl` prop from WorkflowBuilder (already passed from Infrastructure.tsx)
- TestStep always uses ComfyUI backend (test runs are against local ComfyUI, not RunPod production)
- TestStep does NOT need UnifiedFeed — output displays inline in the step
- TestStep IS admin-only (it's inside the WorkflowBuilder, which only renders for admins)
- TestStep calls `POST /api/custom-workflows/{id}/execute` with `execution_backend: 'comfyui'`

**Example:**
```typescript
// BuilderStep union extended with 'test'
type BuilderStep = 'upload' | 'inspect' | 'variables' | 'dependencies' | 'metadata' | 'test';
const STEPS: BuilderStep[] = ['upload', 'inspect', 'variables', 'dependencies', 'metadata', 'test'];
const STEP_LABELS: Record<BuilderStep, string> = {
  // ... existing labels
  test: 'Test Run',
};
```

**Example TestStep:**
```tsx
function TestStep({ state, comfyUrl, onBack }: TestStepProps) {
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const handleChange = (key: string, value: any) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const handleRun = async () => {
    if (!state.workflowId) { setStatus('No workflow saved — go back and save first.'); return; }
    setIsRunning(true);
    setStatus('Preprocessing files…');
    try {
      const processed = await preprocessFormValues(formValues, state.variableConfig, comfyUrl);
      setStatus('Submitting to ComfyUI…');
      const clientId = `builder-test-${Math.random().toString(36).slice(2)}`;
      const res = await apiClient.executeDynamicWorkflow(state.workflowId, {
        parameters: processed,
        base_url: comfyUrl,
        client_id: clientId,
        execution_backend: 'comfyui',
      });
      if (!res.success || !res.prompt_id) throw new Error(res.error ?? 'No prompt_id returned');

      setStatus('Processing in ComfyUI…');
      const cleanup = startJobMonitoring(res.prompt_id, comfyUrl, (jobStatus, message, outputInfo) => {
        if (jobStatus === 'completed' && outputInfo) {
          const url = outputInfo.video_url
            ?? `${comfyUrl}/view?filename=${encodeURIComponent(outputInfo.filename)}&type=output`;
          setResultUrl(url);
          setStatus('Test run completed.');
          setIsRunning(false);
        } else if (jobStatus === 'error') {
          setStatus(`Error: ${message}`);
          setIsRunning(false);
        } else {
          setStatus(message ?? 'Processing…');
        }
      });
      cleanupRef.current = cleanup;
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <DynamicFormRenderer
        variableConfig={state.variableConfig}
        sectionConfig={state.sectionConfig}
        formValues={formValues}
        onValueChange={handleChange}
        disabled={isRunning}
      />
      <button onClick={() => void handleRun()} disabled={isRunning}>
        {isRunning ? 'Running…' : 'Run Test'}
      </button>
      {status && <p className="text-sm">{status}</p>}
      {resultUrl && state.metadata.output_type === 'video' && (
        <video src={resultUrl} controls className="w-full rounded-3xl" />
      )}
      {resultUrl && state.metadata.output_type === 'image' && (
        <img src={resultUrl} alt="Test output" className="w-full rounded-3xl" />
      )}
      {resultUrl && state.metadata.output_type === 'audio' && (
        <audio src={resultUrl} controls className="w-full" />
      )}
    </div>
  );
}
```

### Pattern 6: DynamicWorkflowPage (Production Page)

**What:** A standalone page component loaded by `App.tsx` (Phase 17 will wire the routing; Phase 16 builds the component). It fetches the workflow config by ID or slug, renders `DynamicFormRenderer`, and handles submission with full job tracking.

**When to use:** For all published custom workflows rendered as production feature pages.

**Layout:** Follows the standard feature page layout from `new_feature_guide.md` — `flex gap-6` with main content `flex-1 max-w-4xl` and `w-96 sticky` sidebar for `UnifiedFeed`.

**Example:**
```tsx
// frontend/src/pages/DynamicWorkflowPage.tsx
interface Props {
  workflowId: string;   // Phase 17 will pass this; for now, hardcode for testing
  comfyUrl: string;
}

export default function DynamicWorkflowPage({ workflowId, comfyUrl }: Props) {
  const { backend } = useExecutionBackend();
  const [workflow, setWorkflow] = useState<CustomWorkflow | null>(null);
  const [variableConfig, setVariableConfig] = useState<VariableConfig[]>([]);
  const [sectionConfig, setSectionConfig] = useState<SectionConfig[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Load workflow config from backend
    apiClient.getCustomWorkflow(workflowId).then(res => {
      if (res.success && res.workflow) {
        setWorkflow(res.workflow);
        setVariableConfig(res.workflow.variable_config as unknown as VariableConfig[]);
        setSectionConfig(res.workflow.section_config as unknown as SectionConfig[]);
      }
    });
    return () => { cleanupRef.current?.(); };
  }, [workflowId]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setStatus('Preparing files…');
    const clientId = `dynamic-${Math.random().toString(36).slice(2)}`;
    try {
      const processed = await preprocessFormValues(formValues, variableConfig, comfyUrl);

      setStatus('Submitting…');
      const res = await apiClient.executeDynamicWorkflow(workflowId, {
        parameters: processed,
        base_url: comfyUrl,
        client_id: clientId,
        execution_backend: backend,
      });
      if (!res.success || !res.prompt_id) throw new Error(res.error ?? 'Failed');

      await createJob({
        job_id: res.prompt_id,
        comfy_url: comfyUrl,
        workflow_type: workflow?.slug ?? 'custom',
        width: 0, height: 0,
        execution_backend: backend,
      });
      await updateJobToProcessing(res.prompt_id);
      setJobId(res.prompt_id);
      setStatus('Processing…');

      if (backend === 'runpod') {
        const cleanup = startRunPodJobMonitoring(res.prompt_id, '', (jobStatus, message, outputInfo) => {
          if (jobStatus === 'completed') { handleComplete(outputInfo, res.prompt_id); }
          else if (jobStatus === 'error') { setStatus(`Error: ${message}`); setIsSubmitting(false); }
          else { setStatus(message ?? 'Processing on RunPod…'); }
        });
        cleanupRef.current = cleanup;
      } else {
        const cleanup = startJobMonitoring(res.prompt_id, comfyUrl, (jobStatus, message, outputInfo) => {
          if (jobStatus === 'completed' && outputInfo) { handleComplete(outputInfo, res.prompt_id); }
          else if (jobStatus === 'error') { setStatus(`Error: ${message}`); setIsSubmitting(false); }
          else { setStatus(message ?? 'Processing…'); }
        });
        cleanupRef.current = cleanup;
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setIsSubmitting(false);
    }
  };

  // ... rest of component including UnifiedFeed sidebar
}
```

### Pattern 7: apiClient Method for Execute

**What:** Add `executeDynamicWorkflow` method to ApiClient class in `apiClient.ts`.

**When to use:** Called by both TestStep and DynamicWorkflowPage.

**Example:**
```typescript
// Add to ApiClient class in frontend/src/lib/apiClient.ts
async executeDynamicWorkflow(
  workflowId: string,
  payload: {
    parameters: Record<string, string | number | boolean>;
    base_url: string;
    client_id: string;
    execution_backend: 'comfyui' | 'runpod';
  }
) {
  return this.request(`/api/custom-workflows/${workflowId}/execute`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<{ success: boolean; prompt_id?: string; execution_backend?: string; error?: string }>;
}
```

### Anti-Patterns to Avoid

- **Processing files in the backend execute endpoint:** Do NOT send raw base64 or File objects to the execute endpoint. All file processing (upload to ComfyUI or base64 encode) MUST happen client-side before the API call. The backend `execute_dynamic_workflow` expects `user_params` to be a flat dict of strings/numbers/booleans already. The frontend is responsible for converting files.
- **Blocking on file uploads sequentially:** Process all file uploads in parallel with `Promise.all()` when multiple file variables exist. Sequential processing is slow.
- **Re-fetching the workflow config on every render in TestStep:** TestStep has access to `state.variableConfig` and `state.sectionConfig` directly from `BuilderState`. It does NOT need to call the API to get the workflow — the builder already has it in memory.
- **Adding UnifiedFeed to TestStep:** TestStep is inside the builder, not a production page. It should NOT include a full feed sidebar. Output displays inline.
- **Using `get_current_user` with admin restriction on the execute endpoint:** The `/execute` endpoint uses `get_current_user` (not `verify_admin`) — production DynamicWorkflowPage is used by all authenticated users, not just admins. The admin-only restriction is only on CRUD endpoints (create, update, delete, publish). Execution is user-accessible.
- **Using a static `workflow_type` string for createJob:** The `workflow_type` should be the workflow's `slug` (e.g., `'my-cool-lipsync'`) so the UnifiedFeed `pageContext` filter works correctly. Use `workflow.slug` not a hardcoded string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File upload to ComfyUI | Custom FormData handler | `uploadMediaToComfy(comfyUrl, file)` from components/utils.ts | Already handles error cases, returns filename |
| File to base64 | Custom FileReader | `fileToBase64(file)` from components/utils.ts | Already strips data: prefix, handles ArrayBuffer |
| Job progress monitoring (ComfyUI) | Custom polling loop | `startJobMonitoring(jobId, baseUrl, callback)` from components/utils.ts | Already handles Supabase Storage upload on completion |
| Job progress monitoring (RunPod) | Custom polling loop | `startRunPodJobMonitoring(jobId, endpointId, callback)` from components/utils.ts | Already handles IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED states |
| Job creation | Custom DB call | `createJob` + `updateJobToProcessing` + `completeJob` from lib/jobTracking.ts | Standard non-blocking job tracking used across all 8 feature pages |
| Width/height 32-snap | Custom validator | `useSmartResolution` hook | Already used by multiple pages; snaps to 32 multiples |
| Backend workflow substitution | Custom template replacement | `execute_dynamic_workflow` service method (existing) | WorkflowService handles string/number/boolean coercion and unsubstituted placeholder detection |
| Output media display | Custom media player | `<video>`, `<img>`, `<audio>` HTML elements | Browser native; no library needed |

**Key insight:** Phase 16 is primarily a wiring phase. All the heavy lifting (template substitution, file upload, job monitoring, Supabase storage) is already implemented. The new work is (1) one HTTP endpoint, (2) a DynamicFormRenderer component, (3) a TestStep step, and (4) a DynamicWorkflowPage component.

## Common Pitfalls

### Pitfall 1: Resolution Type Encoding Mismatch Between Frontend and Backend

**What goes wrong:** The `resolution` VariableConfig maps to a SINGLE `placeholder_key` in the workflow template. But the UI needs two inputs (width and height). If the frontend stores resolution as `"640x360"` and the backend template has `{{14_RESOLUTION}}`, the WorkflowService substitutes the string as-is — which is fine if the ComfyUI node accepts a `"WxH"` string format. But most ComfyUI nodes expect width and height as separate integer inputs.

**Why it happens:** The `resolution` type was designed as a UX shortcut (two linked fields) but the underlying ComfyUI workflow has two separate nodes/inputs for width and height that were promoted as a single "resolution" variable.

**How to avoid:** The resolution variable type should always be backed by TWO placeholder keys: `{placeholder_key}_W` and `{placeholder_key}_H`. When an admin sets `type: 'resolution'` for a variable, the workflow template must have `{{VAR_PLACEHOLDER_W}}` and `{{VAR_PLACEHOLDER_H}}` as two separate substitution points. The planner should lock this convention explicitly.

**Warning signs:** ComfyUI node errors about unexpected string format for a width/height input; workflow fails on integers-expected inputs.

### Pitfall 2: startJobMonitoring Calls completeJob with Supabase Storage URL

**What goes wrong:** The existing `startJobMonitoring` in `components/utils.ts` calls `completeJob` internally when it finds a video output (lines 374-406). This means the DynamicWorkflowPage's own `completeJob` call may run AFTER `startJobMonitoring` has already completed the job — causing a duplicate DB update.

**Why it happens:** `startJobMonitoring` was designed to be self-contained. It uploads to Supabase Storage and calls `completeJob` automatically. The page component should not call `completeJob` separately.

**How to avoid:** In `DynamicWorkflowPage`, do NOT call `completeJob` manually. Let `startJobMonitoring` handle it. The `onStatusUpdate` callback receives the final `video_url` from Supabase Storage in `outputInfo.video_url` after the job is complete. Only call `completeJob` with error status in the error path.

**Warning signs:** Job shows as "completed" twice in the feed; Supabase receives two update calls; potential duplicate video URLs in `output_video_urls` array.

### Pitfall 3: File Inputs Reset on Re-render

**What goes wrong:** `DynamicFormRenderer` re-renders when parent state changes (e.g., status message updates during processing). File `<input type="file">` elements reset to empty on re-render if not controlled properly.

**Why it happens:** React does not persist `value` for file inputs (browser security restriction). The `formValues[key]` holds the `File` object in state, but the `<input>` element itself cannot be given a `value` prop.

**How to avoid:** File inputs should only re-render when `disabled` changes or when the parent explicitly clears them. Use `key` prop to force reset only on explicit clear: keep a `fileInputKeys` state map that is only incremented when clearing a file. During `disabled=true` state (job running), still render the input but disabled — the displayed filename is shown via a separate controlled element (not the input itself).

**Warning signs:** Admin uploads a file, status changes to "Processing…", file upload disappears from the form — admin thinks they need to re-upload.

### Pitfall 4: checkComfyUIHealth Uses Hardcoded Required Nodes

**What goes wrong:** The existing `checkComfyUIHealth` function in `components/utils.ts` (line 506) checks for `['MultiTalkModelLoader', 'WanVideoSampler', 'Base64DecodeNode']` specifically. For a custom workflow with completely different nodes, this check will fail even if the custom nodes ARE installed.

**Why it happens:** `checkComfyUIHealth` was written for the original MultiTalk use case.

**How to avoid:** For TestStep and DynamicWorkflowPage, do NOT call `checkComfyUIHealth` — it will reject valid custom workflows. Instead, perform a simpler health check: just verify ComfyUI responds to `/system_stats` and `/queue`. Or add an optional `requiredNodes` parameter to a new `checkComfyUIHealthBasic` function. The safest path: call the backend execute endpoint and let ComfyUI itself report workflow errors through the monitoring callback.

**Warning signs:** "Required nodes not found" error in TestStep even though the custom workflow only uses standard nodes.

### Pitfall 5: execute_dynamic_workflow RunPod Path Needs WorkflowService Build

**What goes wrong:** The existing `RunPodService.submit_workflow` takes a `workflow_name` and `parameters` to build from a template. For custom workflows, the template is at `custom/{slug}.json`. If `execute_dynamic_workflow_runpod` passes the slug as `f"custom/{slug}"` to `WorkflowService.build_workflow`, it should work — but only if the `workflows/custom/` directory is accessible at runtime. On Heroku, this directory is ephemeral (noted in STATE.md blockers).

**Why it happens:** STATE.md explicitly notes: "Heroku filesystem ephemerality: backend/workflows/custom/ files lost on restart (acceptable for dev)".

**How to avoid:** For dev purposes, the current implementation is fine. The planner should note this as a known limitation in the plan. The Supabase Storage migration (WB-V2-05) is already in Future Requirements. For Phase 16 purposes: document the limitation but do not block on it.

**Warning signs:** RunPod execution fails with "template not found" after a Heroku dyno restart.

### Pitfall 6: apiClient.getCustomWorkflow Not Implemented for Non-Admin Users

**What goes wrong:** `GET /api/custom-workflows/{id}` requires `verify_admin` (from the Phase 14 implementation). When `DynamicWorkflowPage` loads for a regular user, the API call returns 403.

**Why it happens:** All custom workflow CRUD endpoints are admin-only per STORE-05 and the Phase 14 implementation. This was intentional for the builder, but DynamicWorkflowPage needs to load the config for non-admin users.

**How to avoid:** Add a NEW non-admin endpoint `GET /api/custom-workflows/published/{slug}` (or by ID) that only returns published workflows. This endpoint uses `get_current_user` (not `verify_admin`) and checks `is_published=True`. Alternatively, the Phase 17 `STORE-06` approach (fetching on app load and caching in context) means the workflow config is already in the app context by the time DynamicWorkflowPage renders — avoiding the need for per-page API calls.

**Decision for planner:** Since Phase 16 is a prerequisite of Phase 17, and Phase 17 handles navigation and the app-load fetch (STORE-06), Phase 16's `DynamicWorkflowPage` should accept the full `workflow` object as a prop (passed from the parent that already has the config) rather than fetching it internally. This avoids the 403 problem and is cleaner architecturally.

**Warning signs:** 403 error when regular user navigates to a dynamic feature page; inconsistent behavior between admin and non-admin users.

## Code Examples

### Backend Execute Endpoint

```python
# Add to backend/api/custom_workflows.py
# Source: execute_dynamic_workflow in custom_workflow_service.py + runpod.py pattern

from typing import Dict, Any, Literal

class ExecuteWorkflowRequest(BaseModel):
    """Request body for executing a custom workflow."""
    parameters: Dict[str, Any]                        # placeholder_key -> value (files pre-processed)
    base_url: str = ""                                  # ComfyUI URL; empty string for RunPod
    client_id: str = ""                                 # WebSocket client ID for ComfyUI progress
    execution_backend: Literal['comfyui', 'runpod'] = 'comfyui'

class ExecuteWorkflowResponse(BaseModel):
    """Response from executing a custom workflow."""
    success: bool
    prompt_id: Optional[str] = None    # ComfyUI prompt_id OR RunPod job_id
    execution_backend: Optional[str] = None
    error: Optional[str] = None

@router.post("/{workflow_id}/execute", response_model=ExecuteWorkflowResponse)
async def execute_workflow(
    workflow_id: str,
    payload: ExecuteWorkflowRequest,
    current_user=Depends(get_current_user),   # NOT verify_admin -- regular users can execute published workflows
) -> ExecuteWorkflowResponse:
    """
    Execute a custom workflow (test run or production use).

    Pre-processes file inputs on the frontend before calling this endpoint.
    Supports both ComfyUI (local/self-hosted) and RunPod (serverless) backends.

    Returns a prompt_id that the frontend uses for progress monitoring.
    """
    service = CustomWorkflowService()
    workflow = await service.get(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if payload.execution_backend == 'runpod':
        # Build workflow JSON and submit to RunPod universal handler
        from services.runpod_service import RunPodService
        slug = workflow.get("slug", "")
        template_name = f"custom/{slug}"
        # Build the workflow with user params
        success, workflow_json, error = await service.workflow_service.build_workflow(
            template_name, payload.parameters
        )
        if not success:
            raise HTTPException(status_code=500, detail=error or "Failed to build workflow")
        # Submit raw JSON to RunPod
        runpod_service = RunPodService()
        success, job_id, error = await runpod_service.submit_workflow_json(workflow_json)
        if not success:
            raise HTTPException(status_code=500, detail=error or "RunPod submission failed")
        return ExecuteWorkflowResponse(success=True, prompt_id=job_id, execution_backend='runpod')
    else:
        # ComfyUI path: delegate to existing execute_dynamic_workflow
        success, prompt_id, error = await service.execute_dynamic_workflow(
            workflow, payload.parameters, payload.base_url, payload.client_id
        )
        if not success:
            raise HTTPException(status_code=500, detail=error or "ComfyUI execution failed")
        return ExecuteWorkflowResponse(success=True, prompt_id=prompt_id, execution_backend='comfyui')
```

### RunPodService submit_workflow_json Method

```python
# Add to backend/services/runpod_service.py
# Source: existing submit_workflow pattern in runpod_service.py

async def submit_workflow_json(
    self, workflow_json: dict
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Submit a pre-built workflow JSON to RunPod universal endpoint.
    Used by execute_dynamic_workflow for custom workflows.
    """
    payload = {"input": {"workflow": workflow_json}}
    # Same HTTP submission as existing submit_workflow but skips template loading
    return await self._submit_to_runpod(payload)
```

### DynamicFormRenderer Props Type

```typescript
// frontend/src/components/DynamicFormRenderer.tsx
// Source: VariableConfig type from builderUtils.ts

import type { VariableConfig, SectionConfig } from '../lib/builderUtils';

export type FormValue = string | number | boolean | File | null;

export interface DynamicFormRendererProps {
  variableConfig: VariableConfig[];
  sectionConfig: SectionConfig[];
  formValues: Record<string, FormValue>;
  onValueChange: (placeholderKey: string, value: FormValue) => void;
  disabled?: boolean;
}
```

### DynamicWorkflowPage Props (Phase 17-ready)

```typescript
// frontend/src/pages/DynamicWorkflowPage.tsx
// Design: accepts workflow object directly (not a fetch-by-ID call)
// Phase 17 will pass workflow from the app-load context fetch

import type { CustomWorkflow } from '../lib/apiClient';
import type { VariableConfig, SectionConfig } from '../lib/builderUtils';

interface Props {
  workflow: CustomWorkflow;           // Full workflow config (loaded by parent)
  comfyUrl: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Each feature page has its own `buildPromptJSON()` function | `execute_dynamic_workflow` backend function handles template loading + substitution | Phase 14 (2026-03-13) | Custom workflows go through a shared code path |
| Static feature pages defined at compile time in App.tsx | Dynamic feature pages rendered from JSONB config at runtime | Phase 16 (now) | Admin can publish new features without code changes |
| ComfyUI-only pages | Dual backend via `useExecutionBackend()` context | v1.1 (2026-03-11) | Pages must branch on `backend` value at submission time |

**Deprecated/outdated:**
- `frontend/public/workflows/*.json` files: Never used for custom workflows; custom workflows load from `backend/workflows/custom/` via WorkflowService
- `buildPromptJSON()` async functions in page components: Custom workflows never build their own JSON; the backend does it

## Open Questions

1. **Resolution variable type encoding (TWO keys vs ONE string)**
   - What we know: The `resolution` VariableConfig has one `placeholder_key`. ComfyUI nodes expect separate integer width and height.
   - What's unclear: Should the resolution widget write to `{key}_W` and `{key}_H` (two form entries), or write a `"640x360"` string and add backend parsing?
   - Recommendation: TWO separate form keys (`_W` / `_H`). The workflow template must have two corresponding placeholders. The admin sets `type: 'resolution'` on a variable and the system auto-creates the paired placeholders. This is cleaner and avoids backend string parsing.

2. **Where to pass workflow config to DynamicWorkflowPage**
   - What we know: Phase 17 will handle navigation and app-load workflow fetching. Phase 16 builds the component.
   - What's unclear: Should Phase 16's DynamicWorkflowPage fetch its own config by ID, or require it as a prop?
   - Recommendation: Require it as a prop (`workflow: CustomWorkflow`). This avoids the 403 problem for non-admin users and makes the component easier to test. A temporary hardcoded test in App.tsx can pass a known workflow for Phase 16 verification.

3. **How to handle RunPod job output (base64 images/videos)**
   - What we know: RunPod jobs return base64-encoded outputs; `startRunPodJobMonitoring` receives `response.output`. The `output` shape depends on the RunPod handler's return format.
   - What's unclear: Does `startRunPodJobMonitoring`'s `onStatusUpdate(completed, message, outputInfo)` callback include a ready-to-use URL, or does it need Supabase Storage upload?
   - Recommendation: Check `startRunPodJobMonitoring` callback shape — the existing implementation passes `response.output` from RunPod directly. If RunPod returns base64, the frontend needs to decode and upload to Supabase Storage. This is an existing gap in the RunPod monitoring path (not unique to custom workflows). For Phase 16, document this gap and handle it the same way existing RunPod features handle it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 + @testing-library/react 16.3.2 |
| Config file | `frontend/vite.config.ts` |
| Quick run command | `cd frontend && npm test -- --run src/test/` |
| Full suite command | `cd frontend && npm test -- --run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | DynamicFormRenderer renders correct widget for each VariableInputType | unit | `npm test -- --run src/test/dynamicFormRenderer.test.ts` | Wave 0 |
| TEST-01 | DynamicFormRenderer calls onValueChange with correct value types | unit | `npm test -- --run src/test/dynamicFormRenderer.test.ts` | Wave 0 |
| DYN-03 | DynamicFormRenderer groups variables by section correctly | unit | `npm test -- --run src/test/dynamicFormRenderer.test.ts` | Wave 0 |
| DYN-04 | preprocessFormValues calls uploadMediaToComfy for upload mode | unit | `npm test -- --run src/test/dynamicWorkflowUtils.test.ts` | Wave 0 |
| DYN-04 | preprocessFormValues calls fileToBase64 for base64 mode | unit | `npm test -- --run src/test/dynamicWorkflowUtils.test.ts` | Wave 0 |
| TEST-02 | POST /api/custom-workflows/{id}/execute returns prompt_id | integration | manual / curl with test workflow | N/A (new endpoint) |
| DYN-07 | POST /api/custom-workflows/{id}/execute routes to RunPod when backend='runpod' | integration | manual | N/A (new endpoint) |
| TEST-03 | Inline output renders video/image/audio based on output_type | unit | `npm test -- --run src/test/dynamicFormRenderer.test.ts` | Wave 0 |
| DYN-05 | createJob called before execute returns; startJobMonitoring called after | unit (mock) | `npm test -- --run src/test/dynamicWorkflowUtils.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd frontend && npm test -- --run src/test/dynamicFormRenderer.test.ts`
- **Per wave merge:** `cd frontend && npm test -- --run`
- **Phase gate:** Full frontend suite green + manual end-to-end test of TestStep with a real ComfyUI before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `frontend/src/test/dynamicFormRenderer.test.ts` — covers TEST-01, DYN-03, TEST-03 unit tests
- [ ] `frontend/src/test/dynamicWorkflowUtils.test.ts` — covers DYN-04, DYN-05 (preprocessFormValues pure function + mocked job tracking)
- [ ] No new backend test files needed — backend execute endpoint follows same pattern as existing contract tests

## Sources

### Primary (HIGH confidence)
- `backend/services/custom_workflow_service.py` — `execute_dynamic_workflow` method signature and implementation; confirms `(workflow_config: dict, user_params: dict, base_url: str, client_id: str)` inputs
- `backend/api/custom_workflows.py` — existing endpoint patterns; `get_current_user` vs `verify_admin` usage; confirms no `/execute` endpoint exists yet
- `backend/api/runpod.py` — `submit_workflow` endpoint pattern; RunPod execution path; `RunPodService` usage
- `frontend/src/components/utils.ts` — `startJobMonitoring`, `startRunPodJobMonitoring`, `uploadMediaToComfy`, `fileToBase64`, `checkComfyUIHealth` — all confirmed implemented and signatures verified
- `frontend/src/lib/jobTracking.ts` — `createJob`, `updateJobToProcessing`, `completeJob` — confirmed implementations
- `frontend/src/contexts/ExecutionBackendContext.tsx` — `useExecutionBackend()` hook; `backend: 'comfyui' | 'runpod'` type
- `frontend/src/lib/apiClient.ts` — `submitWorkflow`, `submitWorkflowToRunPod`, `getRunPodJobStatus` — confirmed; no `executeDynamicWorkflow` method exists yet
- `frontend/src/lib/builderUtils.ts` — `VariableConfig`, `SectionConfig`, `VariableInputType` types; all 10 input types confirmed
- `frontend/src/pages/WorkflowBuilder.tsx` — `BuilderState`, `STEPS` array (currently 5 steps); TestStep not yet present; `comfyUrl` prop confirmed
- `backend/models/custom_workflow.py` — `ExecuteWorkflowRequest` does not exist yet; models confirmed
- `.planning/STATE.md` — locked decisions: dynamic renderer not code generation; test runner shares code path with renderer; parallel dynamic page state in localStorage
- `new_feature_guide.md` — standard layout pattern (flex gap-6, max-w-4xl, w-96 sidebar), jobTracking integration pattern, UnifiedFeed config
- `.planning/REQUIREMENTS.md` — TEST-01 through TEST-04, DYN-03 through DYN-07 verified scope

### Secondary (MEDIUM confidence)
- `frontend/src/pages/LipsyncOnePerson.tsx` + `WANI2V.tsx` — existing feature page patterns for job submission and result display; confirm standard layout works
- `frontend/src/components/utils.ts` lines 506-515 — `checkComfyUIHealth` hardcoded node list issue identified from code inspection

### Tertiary (LOW confidence)
- RunPod output format for base64 images — documented behavior but not verified against production RunPod handler output shape; flagged as Open Question 3

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all utilities already implemented and signatures confirmed
- Architecture: HIGH — patterns derived directly from codebase analysis; existing feature pages provide templates
- Backend execute endpoint: HIGH — clear what needs to be built; service method already exists
- RunPod output handling in DynamicWorkflowPage: MEDIUM — base64 decode path not fully verified
- Resolution type encoding: MEDIUM — convention not yet locked; recommendation made but planner must decide

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable — all patterns are internal to this project)
