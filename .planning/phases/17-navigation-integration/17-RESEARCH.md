# Phase 17: Navigation Integration - Research

**Researched:** 2026-03-14
**Domain:** React dynamic navigation, context-driven routing, published workflow config fetching
**Confidence:** HIGH

## Summary

Phase 17 is a pure frontend wiring phase with one critical backend fix. Its job is to make published custom workflows appear automatically in the app's sidebar navigation, on the Homepage studio cards, and with a correctly filtered generation feed sidebar — all without touching the `StudioPageType` TypeScript union and without rebuilding or redeploying.

The central architectural challenge is that `App.tsx` uses a typed `StudioPageType` union for `currentPage` state (stored in localStorage under `'vapai-current-page'`). Dynamic workflow pages must NOT pollute this union. The solution already established in STATE.md is a **parallel localStorage key** (e.g., `'vapai-dynamic-page'`) and a parallel state variable that holds the active `CustomWorkflow | null`. When `vapai-dynamic-page` is set, `App.tsx` renders `DynamicWorkflowPage` with the stored workflow config instead of any static studio.

The `DynamicWorkflowPage` component built in Phase 16 already accepts `{ workflowConfig: CustomWorkflow; comfyUrl: string }` and handles everything (form rendering, job tracking, feed sidebar filtered by `workflowConfig.slug`). Phase 17 only needs to: (1) add a backend public endpoint for listing published workflows, (2) fetch and cache those configs at app startup, (3) inject them into each studio's app list in the sidebar and StudioPage, and (4) wire the navigation so clicking a dynamic workflow renders `DynamicWorkflowPage`.

A **critical backend change is required**: the `GET /api/custom-workflows/published` endpoint currently requires `verify_admin`. Phase 17 must relax this to `get_current_user` so all authenticated users can fetch published configs on app load. Without this change, non-admin users cannot see any custom workflows.

**Primary recommendation:** Create a `useDynamicWorkflows` React hook that fetches published configs once at startup and exposes them by studio. Merge dynamic configs into the sidebar's studio groups and StudioPage's app switcher without modifying `studioConfig.ts` static data. Use `'vapai-dynamic-page'` localStorage key + `activeDynamicWorkflow` state in `App.tsx` to route to `DynamicWorkflowPage`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DYN-01 | Published custom workflows appear in their assigned studio's navigation | Sidebar SidebarGroup renders dynamic app buttons; StudioPage app switcher gains dynamic entries |
| DYN-02 | Published custom workflows appear on the Homepage within their studio card | Homepage StudioCard shows dynamic apps in the icon preview and features list via enriched StudioConfig |
| DYN-06 | Dynamic page includes feed sidebar with correct pageContext filtering | DynamicWorkflowPage already uses ResizableFeedSidebar with pageContext=workflowConfig.slug; only need to wire routing |
| STORE-06 | Frontend fetches published custom workflows on app load and merges into navigation | useDynamicWorkflows hook + relaxed /published endpoint (get_current_user) + parallel localStorage key |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React useState/useEffect | 18.x (project) | Dynamic workflow state + fetch-on-mount | Already used throughout project |
| React Context | 18.x | Share dynamic workflow list app-wide | Pattern established by AuthContext, ExecutionBackendContext |
| apiClient.listCustomWorkflows() | existing | Fetch published configs — needs new public endpoint | Already wired; only endpoint auth needs loosening |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| localStorage | browser native | Parallel dynamic page key (`vapai-dynamic-page`) | For persisting active dynamic workflow across page reloads |
| useMemo | React 18 | Compute enriched studios with dynamic apps merged | Avoids re-computing on every render |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Parallel localStorage key | Extend StudioPageType union | Extending union requires TypeScript rebuild on every new workflow; parallel key avoids this entirely — locked decision in STATE.md |
| React Context for dynamic workflows | Prop drilling from App.tsx | Context preferred for app-wide sharing; avoids passing through HomePag/StudioPage prop chains |
| Modifying studioConfig.ts studios array | Keeping studioConfig.ts immutable | Keeping it immutable keeps the static source of truth clean; dynamic configs merged at runtime via useMemo |

**Installation:**
No new dependencies needed.

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── hooks/
│   └── useDynamicWorkflows.ts   (NEW — fetches and caches published configs)
├── contexts/
│   └── DynamicWorkflowsContext.tsx  (NEW — provides dynamic workflows app-wide)
├── pages/
│   └── DynamicWorkflowPage.tsx  (Phase 16 — unchanged)
├── lib/
│   └── studioConfig.ts          (unchanged — static data)
└── App.tsx                      (modified — parallel state + DynamicWorkflowPage routing)
```

### Pattern 1: Parallel Dynamic Page State in App.tsx

**What:** Two independent state variables in App.tsx: `currentPage: StudioPageType` (unchanged) and `activeDynamicWorkflow: CustomWorkflow | null`. When the user navigates to a dynamic workflow, `activeDynamicWorkflow` is set and `currentPage` stays pointing at the studio (or is set to `'home'` — implementation detail). When `activeDynamicWorkflow` is non-null, the main content renders `DynamicWorkflowPage`.

**When to use:** Any time a user clicks a dynamic workflow from the sidebar or homepage.

**Example:**
```typescript
// In App.tsx
const [currentPage, setCurrentPage] = useState<StudioPageType>('home');
const [activeDynamicWorkflow, setActiveDynamicWorkflow] = useState<CustomWorkflow | null>(null);

// Parallel localStorage key — separate from 'vapai-current-page'
const DYNAMIC_PAGE_KEY = 'vapai-dynamic-page'; // stores workflow slug

function handleDynamicNavigate(workflow: CustomWorkflow) {
  setActiveDynamicWorkflow(workflow);
  // Persist: store the slug so we can reload on refresh
  localStorage.setItem(DYNAMIC_PAGE_KEY, workflow.slug);
  setSidebarOpen(false);
}

function handlePageChange(page: StudioPageType) {
  setCurrentPage(page);
  setActiveDynamicWorkflow(null); // Clear dynamic on static navigate
  localStorage.setItem('vapai-current-page', page);
  localStorage.removeItem(DYNAMIC_PAGE_KEY);
  setSidebarOpen(false);
}

// In main render:
{activeDynamicWorkflow ? (
  <DynamicWorkflowPage workflowConfig={activeDynamicWorkflow} comfyUrl={comfyUrl} />
) : currentPage === 'lipsync-studio' ? (
  <StudioPage studio={getStudioById('lipsync-studio')!} comfyUrl={comfyUrl} />
) : /* ... rest of static pages */}
```

**Startup restoration:**
```typescript
useEffect(() => {
  const savedDynamic = localStorage.getItem('vapai-dynamic-page');
  if (savedDynamic && publishedWorkflows.length > 0) {
    const wf = publishedWorkflows.find(w => w.slug === savedDynamic);
    if (wf) {
      setActiveDynamicWorkflow(wf);
      return; // Skip static page restoration
    }
  }
  // Fall through to normal static page restoration
}, [publishedWorkflows]);
```

### Pattern 2: useDynamicWorkflows Hook

**What:** A hook (or React Context) that fetches `GET /api/custom-workflows/published` once at app startup, caches the result, and exposes the list grouped by studio.

**When to use:** Called from `App.tsx` or a DynamicWorkflowsContext provider.

**Example:**
```typescript
// Source: apiClient.ts (existing listCustomWorkflows, needs new listPublishedWorkflows method)
export function useDynamicWorkflows() {
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.listPublishedWorkflows()  // new public method hitting /api/custom-workflows/published
      .then(resp => {
        if (resp.success) setWorkflows(resp.workflows);
      })
      .catch(() => { /* silent fail — dynamic features just won't appear */ })
      .finally(() => setLoading(false));
  }, []);

  // Group by studio for easy consumption
  const byStudio = useMemo((): Record<string, CustomWorkflow[]> => {
    const map: Record<string, CustomWorkflow[]> = {};
    for (const wf of workflows) {
      if (wf.studio) {
        map[wf.studio] = map[wf.studio] || [];
        map[wf.studio].push(wf);
      }
    }
    return map;
  }, [workflows]);

  return { workflows, byStudio, loading };
}
```

### Pattern 3: Merging Dynamic Apps into Studio Sidebar

**What:** In `App.tsx`'s sidebar, the `SidebarGroup` currently renders sub-items from `studio.apps`. For dynamic workflows, inject additional sub-items derived from `useDynamicWorkflows` for the matching studio ID. These call `handleDynamicNavigate(workflow)` instead of `handlePageChange(studioId)`.

**When to use:** For each visible studio that has published dynamic workflows.

**Example:**
```typescript
// In the sidebar, for each studio:
{dynamicByStudio[studio.id]?.map(wf => (
  <button
    key={wf.slug}
    onClick={() => handleDynamicNavigate(wf)}
    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg ... ${
      activeDynamicWorkflow?.slug === wf.slug ? 'bg-gradient-to-r ... text-white' : 'hover:bg-gray-100 ...'
    }`}
  >
    <span>{wf.icon}</span>
    <span>{wf.name}</span>
  </button>
))}
```

### Pattern 4: Merging Dynamic Apps into StudioPage App Switcher

**What:** `StudioPage.tsx` maintains an `appComponents` map from `app.id` to React component. For dynamic workflows within the same studio, `StudioPage` needs to know about them so the app switcher dropdown shows them. Two approaches:
- **Approach A (recommended):** Pass dynamic workflows as a prop to StudioPage and render `DynamicWorkflowPage` when a dynamic app is selected. StudioPage gets a `dynamicApps?: CustomWorkflow[]` prop.
- **Approach B:** Navigate up to App.tsx (call `handleDynamicNavigate`) from inside StudioPage — but this requires a callback prop, which is less clean.

**Approach A example:**
```typescript
// StudioPage receives dynamicApps prop
interface StudioPageProps {
  studio: StudioConfig;
  comfyUrl: string;
  dynamicApps?: CustomWorkflow[];  // NEW
  onDynamicNavigate?: (wf: CustomWorkflow) => void; // NEW — lift navigation up
}

// Inside StudioPage, add dynamic apps to the sorted apps list:
const allApps = [...sortedApps, ...(dynamicApps?.map(wf => ({
  id: wf.slug,
  title: wf.name,
  icon: wf.icon,
  gradient: wf.gradient,
  description: wf.description || '',
  features: [wf.output_type],
})) ?? [])];

// When a dynamic app is selected, call onDynamicNavigate instead of rendering AppComponent
if (dynamicApps?.find(wf => wf.slug === selectedAppId)) {
  const wf = dynamicApps.find(wf => wf.slug === selectedAppId)!;
  return <DynamicWorkflowPage workflowConfig={wf} comfyUrl={comfyUrl} />;
}
```

### Pattern 5: Homepage Dynamic App Injection

**What:** `Homepage.tsx` currently renders studio cards from the static `studios` array filtered by admin status. It shows the studio's `apps` list in the icon preview and features list. Dynamic workflows need to appear in the studio card preview. The cleanest approach is to pass enriched studio configs to Homepage (or pass dynamic workflows and let Homepage merge them internally).

**When to use:** Homepage needs to reflect published dynamic workflows for the studio card app count and feature list.

**Example:**
```typescript
// Homepage receives enriched studios that include dynamic apps merged in
interface Props {
  onNavigate: (page: StudioPageType) => void;
  onDynamicNavigate: (wf: CustomWorkflow) => void;  // NEW
  dynamicWorkflows: CustomWorkflow[];  // NEW
  user: User | null;
}

// Inside Homepage, compute enriched studios:
const enrichedStudios = useMemo(() => {
  return visibleStudios.map(studio => {
    const dynApps = dynamicWorkflows
      .filter(wf => wf.studio === studio.id)
      .map(wf => ({ id: wf.slug, title: wf.name, icon: wf.icon, gradient: wf.gradient, description: wf.description || '', features: [wf.output_type] }));
    return { ...studio, apps: [...studio.apps, ...dynApps] };
  });
}, [visibleStudios, dynamicWorkflows]);
```

### Pattern 6: Backend — Relax /published Endpoint Auth

**What:** The `GET /api/custom-workflows/published` endpoint currently requires `verify_admin`. Change it to `get_current_user` so all authenticated users can fetch the list. No other backend changes needed.

**Example (backend/api/custom_workflows.py):**
```python
@router.get("/published", response_model=CustomWorkflowListResponse)
async def list_published_workflows(
    current_user: dict = Depends(get_current_user),  # Changed from verify_admin
) -> CustomWorkflowListResponse:
    """List only published, enabled custom workflows (accessible to all authenticated users)."""
    service = CustomWorkflowService()
    workflows = await service.list_published()
    return CustomWorkflowListResponse(success=True, workflows=workflows)
```

Additionally, the frontend `apiClient.ts` currently only has `listCustomWorkflows()` (admin endpoint). A new `listPublishedWorkflows()` method is needed that calls `/api/custom-workflows/published`.

### Anti-Patterns to Avoid

- **Extending StudioPageType union:** Each new published workflow would require a TypeScript rebuild. The parallel localStorage key pattern is already locked in STATE.md.
- **Modifying studioConfig.ts at runtime:** studioConfig.ts is a static module; mutating its exports at runtime would break referential integrity. Merge at the useMemo layer.
- **Storing full CustomWorkflow in localStorage:** Only store the slug in `vapai-dynamic-page`. Re-hydrate from the in-memory fetched list to avoid stale configs.
- **Fetching published workflows on every render:** Fetch once in a hook/context at startup, cache in memory (the `apiClient` already has 30s TTL cache).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dynamic page rendering | Custom form renderer | `DynamicWorkflowPage` (Phase 16) | Already built, handles all field types, file upload, job tracking, dual backend |
| Feed sidebar filtering | Custom feed component | `ResizableFeedSidebar` with `pageContext: workflow.slug` | Already implemented in DynamicWorkflowPage; pageContext=slug maps to workflow_type in createJob |
| Workflow config caching | Manual fetch-and-store | apiClient's built-in 30s cache via `setCache`/`getCached` | Cache TTL already tuned to match polling interval |
| App switcher dropdown | Custom UI | Extend existing StudioPage dropdown | StudioPage already renders a polished dropdown; add dynamic apps as extra entries |

**Key insight:** Everything complex (form rendering, file handling, job tracking, feed filtering) was built in Phase 16. Phase 17 is entirely about wiring — fetching configs and rendering the right component based on navigation state.

## Common Pitfalls

### Pitfall 1: localStorage Pollution
**What goes wrong:** If `vapai-dynamic-page` is set to a slug that no longer exists (workflow unpublished), the app tries to restore a non-existent workflow on startup.
**Why it happens:** Published state can change server-side without client notification.
**How to avoid:** Always validate the restored slug against the freshly-fetched `publishedWorkflows` list before setting `activeDynamicWorkflow`. If not found, clear the key and fall back to static page restoration.
**Warning signs:** Blank main area or crash on startup after a workflow is unpublished.

### Pitfall 2: Race Condition on Startup Restoration
**What goes wrong:** The `useEffect` that restores `vapai-dynamic-page` from localStorage runs before `publishedWorkflows` is populated (still loading), so the slug lookup always fails.
**Why it happens:** `useDynamicWorkflows` is async; the restoration effect may run synchronously.
**How to avoid:** Make the restoration effect depend on `[publishedWorkflows, loading]` and skip restoration while `loading` is true. Only run restoration once `loading === false`.

### Pitfall 3: Studio ID Mismatch
**What goes wrong:** A custom workflow has `studio: 'lipsync'` but the studioConfig ID is `'lipsync-studio'`. The dynamic workflow never appears under any studio.
**Why it happens:** The `studio` field in `custom_workflows` table was set using whatever string the admin typed in the builder (Phase 15 MetadataStep).
**How to avoid:** Verify the exact set of studio IDs used in MetadataStep. From `studioConfig.ts` the valid IDs are: `lipsync-studio`, `image-studio`, `virtual-set-studio`, `video-studio`, `audio-studio`, `lora-studio`. Confirm the MetadataStep dropdown uses these exact IDs.

### Pitfall 4: `is_disabled` Workflows Appearing
**What goes wrong:** Published-but-disabled workflows appear in the nav for regular users (they should only be visible to admins).
**Why it happens:** The `/published` endpoint returns all `is_published=True` workflows including disabled ones.
**How to avoid:** The `/published` endpoint (or the frontend consumer) should filter out `is_disabled=True` workflows for non-admin users. Check whether `CustomWorkflowService.list_published()` already filters by `is_disabled`.

### Pitfall 5: StudioPage Receives No Dynamic Apps
**What goes wrong:** Clicking the Lipsync studio from the homepage loads static lipsync apps only; the dynamic lipsync workflow doesn't appear in the app switcher.
**Why it happens:** StudioPage doesn't receive dynamic apps — they're only visible in the sidebar.
**How to avoid:** Pass `dynamicApps` (filtered by `studio.id`) as a prop to StudioPage from App.tsx.

## Code Examples

Verified patterns from official sources (direct codebase inspection):

### DynamicWorkflowPage Props Interface (Phase 16 output)
```typescript
// Source: frontend/src/pages/DynamicWorkflowPage.tsx (Phase 16)
interface DynamicWorkflowPageProps {
  workflowConfig: CustomWorkflow;
  comfyUrl: string;
}
// Feed uses: pageContext: workflowConfig.slug
// createJob uses: workflow_type: workflowConfig.slug
// These two values MUST match for feed filtering to work
```

### CustomWorkflow Type (existing apiClient.ts)
```typescript
// Source: frontend/src/lib/apiClient.ts
export interface CustomWorkflow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  output_type: 'image' | 'video' | 'audio';
  studio?: string;       // matches studio.id from studioConfig.ts
  icon: string;          // emoji
  gradient: string;      // TailwindCSS gradient string e.g. "from-blue-500 to-purple-600"
  is_published: boolean;
  variable_config: Record<string, unknown>[];
  section_config: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}
```

### StudioPageType Union (studioConfig.ts — DO NOT MODIFY)
```typescript
// Source: frontend/src/lib/studioConfig.ts
export type StudioPageType =
  | 'home'
  | 'lipsync-studio'
  | 'image-studio'
  | 'virtual-set-studio'
  | 'video-studio'
  | 'audio-studio'
  | 'text-studio'
  | 'lora-studio'
  | 'infrastructure-studio'
  | 'history'
  | 'profile-settings';
// Phase 17 MUST NOT add dynamic workflow slugs to this union
```

### App.tsx validPages Array (must stay in sync with StudioPageType)
```typescript
// Source: frontend/src/App.tsx
const validPages: StudioPageType[] = [
  'home', 'lipsync-studio', 'image-studio', 'virtual-set-studio',
  'video-studio', 'audio-studio', 'text-studio', 'lora-studio',
  'infrastructure-studio', 'history', 'profile-settings'
];
// Phase 17 does NOT add to this array — dynamic pages use parallel key
```

### SidebarGroup Sub-items Pattern (existing App.tsx)
```typescript
// Source: frontend/src/App.tsx — existing sub-item rendering in SidebarGroup
{studio.apps.map((app) => (
  <button
    key={app.id}
    onClick={() => {
      setLastUsedApp(studio.id, app.id);
      onNavigate(studio.id as StudioPageType);
    }}
    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg ..."
  >
    <span>{app.icon}</span>
    <span>{app.title}</span>
  </button>
))}
// Dynamic workflow buttons follow identical styling; call onDynamicNavigate instead
```

### GenerationFeed pageContext Filtering
```typescript
// Source: frontend/src/components/GenerationFeed.tsx
// pageContext is passed to ResizableFeedSidebar -> GenerationFeed
// It's used to set the "This Workflow" filter default to show only that workflow's jobs
// The workflow_name in video-jobs/image-jobs is set to workflowConfig.slug by createJob
// in DynamicWorkflowPage.tsx line 109: workflow_type: workflowConfig.slug

// In GenerationFeed, the filter sends workflow_name query param to /video-jobs/feed:
const videoParams = {
  workflow_name: effectiveWorkflows?.length === 1 ? effectiveWorkflows[0] : undefined,
  // effectiveWorkflows = [workflowConfig.slug] when showThisWorkflowOnly is true
}
// This means: DYN-06 is already satisfied inside DynamicWorkflowPage
// Phase 17 only needs to route to DynamicWorkflowPage correctly
```

### Backend: list_published needs get_current_user
```python
# Source: backend/api/custom_workflows.py line 93-106 (current state — NEEDS CHANGE)
@router.get("/published", response_model=CustomWorkflowListResponse)
async def list_published_workflows(
    admin_user: dict = Depends(verify_admin),  # MUST change to get_current_user
) -> CustomWorkflowListResponse:
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Page-level routing via extended union | Parallel state key for dynamic pages | STATE.md decision (pre-Phase 17) | No TypeScript union changes ever needed for new workflows |
| Hard-coded app list in StudioPage | Dynamic apps merged at runtime | Phase 17 | New workflows appear without code changes |
| Admin-only /published endpoint | Authenticated-user /published endpoint | Phase 17 (backend fix) | Non-admin users can load dynamic nav on startup |

**Deprecated/outdated:**
- `UnifiedFeed` component: Does not exist. The production pattern is `ResizableFeedSidebar` with `GenerationFeedConfig` — confirmed in Phase 16 SUMMARY.md.

## Open Questions

1. **Does `CustomWorkflowService.list_published()` filter out `is_disabled` workflows?**
   - What we know: The `CustomWorkflow` model has an `is_published` field; Phase 15 META-05 added `is_disabled` support.
   - What's unclear: Whether `list_published()` filters by `is_disabled=False` for non-admin callers.
   - Recommendation: Verify `custom_workflow_service.py` list_published logic. If not filtered, add a client-side filter in `useDynamicWorkflows` for non-admin users.

2. **Exact `studio` field values stored by MetadataStep**
   - What we know: MetadataStep (Phase 15) has a studio dropdown; valid studioConfig IDs are `lipsync-studio`, `image-studio`, etc.
   - What's unclear: Whether MetadataStep dropdown uses exact studioConfig IDs or shorter strings like `'lipsync'`.
   - Recommendation: Read `MetadataStep.tsx` (or `WorkflowBuilder.tsx`) to confirm studio dropdown values match `studioConfig.ts` IDs exactly before building the filter.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.x (backend) |
| Config file | backend/pytest.ini |
| Quick run command | `pytest backend/tests/ -x -q` |
| Full suite command | `pytest backend/ --cov` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DYN-01 | Dynamic workflows appear in sidebar navigation | manual (visual) | n/a — UI navigation | ❌ manual |
| DYN-02 | Dynamic workflows appear on Homepage studio cards | manual (visual) | n/a — UI navigation | ❌ manual |
| DYN-06 | Feed sidebar filters to dynamic workflow's pageContext | manual (visual) | n/a — feed behavior | ❌ manual |
| STORE-06 | Published workflows fetched on app load | manual (network check) | n/a — startup behavior | ❌ manual |
| Backend | /published endpoint accessible to non-admin users | unit/integration | `pytest backend/tests/test_custom_workflow_api.py -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run build` (frontend TypeScript build gate)
- **Per wave merge:** Full frontend build + backend `pytest backend/tests/ -x -q`
- **Phase gate:** Manual smoke test — publish a workflow, reload app as non-admin, verify it appears in nav and homepage

### Wave 0 Gaps
- [ ] `backend/tests/test_custom_workflow_api.py` — test that `/published` returns 200 for non-admin authenticated user (currently returns 403)
- No frontend test infrastructure gap (no frontend unit tests in this project)

## Sources

### Primary (HIGH confidence)
- Direct read of `frontend/src/App.tsx` — current navigation structure, StudioPageType, validPages array, sidebar rendering
- Direct read of `frontend/src/lib/studioConfig.ts` — StudioPageType union, StudioConfig interface, studio IDs
- Direct read of `frontend/src/pages/DynamicWorkflowPage.tsx` — component props, feed config, pageContext pattern
- Direct read of `frontend/src/components/StudioPage.tsx` — app switcher pattern, appComponents map
- Direct read of `frontend/src/pages/Homepage.tsx` — studio card rendering, how apps are shown
- Direct read of `frontend/src/lib/apiClient.ts` — CustomWorkflow interface, listCustomWorkflows/listPublishedWorkflows
- Direct read of `backend/api/custom_workflows.py` — /published endpoint auth (verify_admin — needs change)
- Direct read of `frontend/src/components/GenerationFeed.tsx` — pageContext filtering implementation
- Direct read of `frontend/src/components/ResizableFeedSidebar.tsx` — GenerationFeedConfig shape
- Direct read of `.planning/STATE.md` — locked decision: parallel localStorage key for dynamic page state

### Secondary (MEDIUM confidence)
- `.planning/phases/16-test-runner-and-dynamic-renderer/16-03-SUMMARY.md` — confirms DynamicWorkflowPage API, ResizableFeedSidebar usage, pageContext=slug pattern
- `.planning/REQUIREMENTS.md` — confirms DYN-01, DYN-02, DYN-06, STORE-06 scope

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components already exist; nothing new to install
- Architecture: HIGH — parallel state key locked in STATE.md; integration points all verified from source
- Pitfalls: HIGH — identified from direct code inspection (race condition, localStorage stale slug, studio ID mismatch)
- Backend fix: HIGH — /published endpoint verified as admin-only from source; fix is trivial (one dependency swap)

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable codebase; component APIs don't change frequently)
