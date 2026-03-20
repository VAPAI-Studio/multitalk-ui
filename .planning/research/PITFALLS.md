# Pitfalls Research: Workflow Builder

**Domain:** Adding a dynamic workflow builder and feature generator to an existing AI platform with hardcoded navigation, TypeScript union routing, and static app configuration
**Researched:** 2026-03-13
**Milestone:** v1.2 Workflow Builder
**Confidence:** HIGH (based on deep codebase analysis of actual files + verified against official documentation)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken routing, security holes, or complete loss of published features.

---

### Pitfall 1: The `StudioPageType` Union Type Doesn't Cover Dynamic Workflow IDs

**What goes wrong:**
`StudioPageType` in `frontend/src/lib/studioConfig.ts` (line 335) is a hardcoded TypeScript string literal union:

```typescript
export type StudioPageType =
  | 'home'
  | 'lipsync-studio'
  | 'image-studio'
  | ...
  | 'profile-settings';
```

`App.tsx` (line 112) defines `validPages: StudioPageType[]` from this same literal list and uses `validPages.includes(savedPage)` to gate localStorage restoration. Dynamic workflow pages have IDs like `'workflow-abc123'` at runtime — these will never appear in the compile-time union, so TypeScript will reject them, the `includes()` check will fail, and navigating to a dynamic page will always redirect to home after refresh.

**Why it happens:**
The type was built to enable TypeScript exhaustive checking at compile time. That benefit disappears the moment IDs come from a database at runtime. Developers add `| string` as a quick fix, which then kills type narrowing on ALL the static pages and breaks the switch-like rendering logic in `App.tsx`.

**Consequences:**
- Deep-linking to a published workflow page fails silently on hard reload
- Users lose their navigation position after every page refresh
- TypeScript `as StudioPageType` casts everywhere become required, hiding future bugs
- Adding `| string` makes the `validPages.includes()` guard useless (everything passes)

**How to avoid:**
Model dynamic pages as a separate routing concept from static studios. Keep `StudioPageType` exactly as-is for static pages. Add a parallel `dynamicPage` state: `{ type: 'workflow'; workflowId: string }`. Persist it separately in localStorage under a different key (`vapai-dynamic-page`). In `App.tsx`, check both: if `savedPage` is a known static page, restore normally; otherwise check localStorage for a dynamic page override. Never merge dynamic IDs into the static union.

**Warning signs:**
- Any PR that adds `| string` to `StudioPageType`
- Any `as StudioPageType` cast for a database-sourced ID
- Navigation to published workflow breaks after F5

**Phase to address:** Phase 1 (Navigation Integration) — the routing model must be decided before any other phase

---

### Pitfall 2: ComfyUI UI-Format JSON Uploaded Instead of API-Format JSON

**What goes wrong:**
ComfyUI has two entirely different JSON formats. The **UI format** (what you get when you drag the workflow canvas to a file or click "Save") contains node positions, link objects, visual metadata, and a `nodes` array. The **API format** (enabled via Dev Mode → "Save API Format") contains only the execution graph: a flat object keyed by node ID with `class_type` and `inputs`. Only the API format can be submitted to `POST /prompt`.

The existing `WorkflowService.build_workflow()` in `backend/services/workflow_service.py` expects API format. The new workflow builder lets admins upload workflow JSON. If the admin uploads a UI-format workflow, `WorkflowService.validate_workflow()` may partially pass (it checks for `class_type` and `inputs` which exist in UI format nodes too, but nested under a different path), but when submitted to ComfyUI the result is a cryptic `{"error": "prompt is not a dict"}` or silent failure.

**Why it happens:**
Users working in ComfyUI naturally save the UI format — it's the default Ctrl+S behavior. API format requires enabling Dev Mode, a step that is not obvious. The difference is not called out in the ComfyUI UI and has confused experienced users (GitHub issue #1335 describes this as a "lot of confusion"). Admin users building workflows will almost certainly make this mistake without explicit instruction.

**Consequences:**
- Uploaded workflows fail validation in misleading ways (partial JSON structure match)
- Admin sees no clear error explaining the format mismatch
- Admin re-uploads the same wrong file multiple times, confused about why it fails
- If validation somehow passes, ComfyUI rejects the workflow at submission time

**How to avoid:**
Detect the format on upload, not at execution time. Write a `detect_workflow_format(json_dict)` utility that checks for the signature fields: UI format has a top-level `nodes` array and `links` array; API format has node IDs as top-level keys with `class_type` values. If UI format is detected, either (a) auto-convert to API format using the ComfyUI conversion logic, or (b) immediately reject with a clear error: "This is a ComfyUI UI workflow file. Please export using Dev Mode → Save (API Format) instead." Include a screenshot in the builder UI showing exactly where to find the Save API Format button.

**Warning signs:**
- `"nodes"` key found at the root of uploaded JSON
- `"links"` key found at the root of uploaded JSON
- `validate_workflow()` fails with structure errors on freshly uploaded files

**Phase to address:** Phase 1 (Workflow JSON Upload + Parser) — format detection must be the first validation step

---

### Pitfall 3: Node Introspection Assumes Static `object_info` Available at Parse Time

**What goes wrong:**
The workflow builder needs to inspect each node's possible inputs (to let admins configure which inputs become user-facing variables). The correct source for this is ComfyUI's `GET /object_info` endpoint, which returns all node types with their input definitions, types, default values, and constraints. But `object_info` is only available when a ComfyUI instance is live and reachable. Implementing node introspection as a backend call to the ComfyUI URL stored in the upload request creates several failure modes:
1. Admin uploads a workflow but no ComfyUI is running — introspection fails, no feedback on what inputs are configurable
2. The ComfyUI running during upload has different custom nodes than the ComfyUI that will run during execution (different node catalogs)
3. `object_info` is 2-10 MB of JSON covering hundreds of node types — caching is critical but the existing `WorkflowService` has no caching layer

**Why it happens:**
It seems natural to introspect at upload time using the live ComfyUI. But the workflow builder is admin infrastructure that needs to work even when ComfyUI is temporarily down, and the `comfyUrl` field is user-configurable in the header at any time.

**Consequences:**
- Workflow upload UI is broken whenever ComfyUI is unreachable (even briefly)
- Different ComfyUI environments produce different introspection results for the same workflow
- Repeated `object_info` fetches on every upload add 500ms-2s latency and create unnecessary load on ComfyUI

**How to avoid:**
Do a two-pass parsing approach: (1) **Static parse** — extract all node IDs, class_types, and widget values directly from the workflow JSON without needing `object_info`. This always works offline and gives 80% of what admins need. (2) **Optional live introspection** — when ComfyUI is reachable, enrich the parsed results with `object_info` for input type labels, range constraints, and default values. If introspection fails, still let the admin proceed with manually specified variable types. Cache `object_info` responses in Redis or in-memory with a 5-minute TTL so repeated requests don't hit ComfyUI repeatedly. Never make `object_info` a blocking requirement for workflow upload.

**Warning signs:**
- Workflow upload failing with "ComfyUI unreachable" errors
- Workflow builder showing a loading spinner that never resolves when ComfyUI is down
- Admin reports that two identical uploads produce different variable lists

**Phase to address:** Phase 1 (Workflow JSON Parser) — parser must work offline; live enrichment is optional

---

### Pitfall 4: Dynamic Published Features Not Isolated From Static App State in Context/Rendering

**What goes wrong:**
`StudioPage.tsx` uses a compile-time `appComponents` record (line 29):

```typescript
const appComponents: Record<string, React.ComponentType<...>> = {
  'lipsync-one-person': LipsyncOnePerson,
  'lipsync-multi-person': LipsyncMultiPerson,
  ...
};
```

The dynamic renderer for published workflows will need to be inserted into this same rendering pipeline. The naive approach adds a fallback: "if the app ID is not in `appComponents`, try to load it as a dynamic workflow." This works, but every re-render of `StudioPage` now triggers a database fetch for the dynamic workflow config, because the fallback has no caching. On navigation between apps in the same studio, `StudioPage` re-renders, the lookup misses `appComponents`, the fetch fires, and there's a flash of loading state even for pages the user already visited.

**Why it happens:**
Static components are imported at bundle time and always available synchronously. Dynamic components need async fetching. Mixing the two without explicit caching and loading state management creates an inconsistent UX between static features (instant) and dynamic features (always has a loading delay).

**Consequences:**
- Dynamic feature pages flash a loading spinner every time the user navigates to them
- Published workflow configs are fetched on every visit, not cached
- If the database is slow or unavailable, published features become inaccessible while static features work fine
- React StrictMode causes double-fetching, amplifying the database load

**How to avoid:**
Separate the data layer from the rendering layer. Fetch all published workflow configs at app startup (in `AuthContext` or a new `WorkflowConfigContext`) and store them in memory. `StudioPage.tsx` reads from this in-memory map synchronously — same pattern as `appComponents`. The `DynamicFeaturePage` component gets its config as a prop, not via an inline fetch. Implement a background refresh (every 5 minutes or on focus) to pick up newly published workflows. The loading state only happens once at app startup, not on every navigation.

**Warning signs:**
- Dynamic feature pages have visible loading delay compared to static pages
- Network tab shows `GET /api/workflows/{id}` firing on every navigation to a dynamic page
- State reset occurs when switching between apps in a studio containing a dynamic workflow

**Phase to address:** Phase 2 (Navigation Integration) — loading strategy must be decided before building the renderer

---

### Pitfall 5: Dynamic Form Renderer With Uncontrolled Input Types Crashes on Unexpected Values

**What goes wrong:**
The dynamic form renderer constructs input fields from JSONB configuration stored in Supabase: `{ type: 'slider', key: 'steps', min: 1, max: 100, default: 20 }`. The renderer maps `type` to a React component. If an admin saves a config with `type: 'range'` instead of `type: 'slider'` (a typo or schema drift), the renderer hits the default branch and either renders nothing, crashes with "Cannot read properties of undefined", or renders a raw input with no constraints. Similarly, if `min`/`max`/`default` are missing for a slider, the component renders with `undefined` props that propagate as `NaN` to ComfyUI.

**Why it happens:**
JSONB has no enforced schema by default — Supabase stores any valid JSON without validation. Configuration saved by the builder at v1 of the schema may not match the renderer expectations at v2. Admins editing configurations manually in Supabase's table editor can introduce drift.

**Consequences:**
- Published feature pages crash or render broken forms for malformed configs
- NaN or `undefined` values sent to ComfyUI cause cryptic node errors that are hard to trace back to the form config
- Non-admin users see broken feature pages with no explanation

**How to avoid:**
(1) Use Supabase's `pg_jsonschema` extension with a CHECK constraint on the `variable_configs` JSONB column to enforce structure at the database level. (2) Add a Zod schema in the frontend that validates the entire config object before the renderer uses it. If validation fails, show an admin-only "Configuration Error" banner instead of crashing. (3) Normalize all variable types to a strict enum in the builder UI — admins pick from a dropdown, not a free-text field. (4) Add default fallbacks for missing numeric constraints: if `min` is missing for a slider, default to 0; if `max` is missing, default to 100. Log a warning but render rather than crash.

**Warning signs:**
- Feature page crashes with React error boundary catching "Cannot read properties of undefined"
- ComfyUI receives workflow with `NaN` in numeric fields
- Admin reports "my workflow stopped working after I edited the config"

**Phase to address:** Phase 2 (Dynamic Form Renderer) — validation contract must be established before building any form types

---

### Pitfall 6: Test Runner in the Builder Uses a Different Code Path Than the Renderer

**What goes wrong:**
The PROJECT.md explicitly flags this as a key architectural decision: "Test runner shares code path with renderer — guarantees consistency; if test works, production works." But the natural implementation drift creates divergence: the test runner calls the backend workflow submission endpoint directly (since it only needs to check if the workflow runs), while the renderer goes through a different flow (job tracking, storage, feed integration). The test runner may substitute placeholder values differently, may not upload files to ComfyUI before submission, or may skip the parameter normalization that the renderer applies. Tests pass in the builder but the published feature fails in production with parameter mismatches.

**Why it happens:**
The builder test is an admin-only operation and it seems faster to wire it directly to `POST /comfyui/submit-workflow` without all the job tracking overhead. But "just testing the workflow" still requires the same parameter preparation, file upload, and substitution logic. Taking a shortcut builds in divergence that only manifests when real users hit edge cases the test didn't cover.

**Consequences:**
- Admin publishes a "tested" workflow that fails for real users on the first submission
- Edge cases in parameter types (boolean values, `null` for optional fields) work in the test but fail in production because the code paths handle them differently
- Debugging is difficult because the admin can reproduce in the builder but cannot in the live feature

**How to avoid:**
Build a single `execute_dynamic_workflow(config, params, comfy_url, job_context)` function where `job_context` is optional (`None` for test runs, a real job record for production runs). Both the test runner and the renderer call this same function. The function handles: parameter validation, file upload to ComfyUI, template substitution, submission, and polling. The only difference between test and production is whether a job record is created and whether outputs are stored in Supabase. Never have two separate parameter substitution implementations.

**Warning signs:**
- Test runner imports `workflow_service.py` directly but renderer goes through an API endpoint
- `submit_test_workflow` and `submit_production_workflow` are two separate functions
- A workflow test passes but the published feature fails with a parameter error

**Phase to address:** Phase 1 (Backend Workflow Execution) — single code path must be established before building either the test runner or the renderer

---

### Pitfall 7: Admin Publishes a Workflow to a Studio That Doesn't Exist in the Static Config

**What goes wrong:**
The builder lets admins publish a workflow to any studio by selecting from a dropdown. The admin types or selects `'custom-studio'` — a studio that doesn't exist in the hardcoded `studios` array in `studioConfig.ts`. The database stores `studio_id: 'custom-studio'`. At runtime, `App.tsx` calls `getStudioById('custom-studio')` which returns `undefined`. The `StudioPage` component receives `studio={undefined}` and crashes with a null reference, taking down the entire page for all users navigating to that studio route.

**Why it happens:**
The gap between what the database can store (any string) and what the frontend knows about (hardcoded `studios` array) is invisible to the admin. The builder doesn't validate against the static config at publish time.

**Consequences:**
- The studio containing the published workflow becomes inaccessible to all users
- Error is not contained — it propagates up because `StudioPage` has no null guard on the `studio` prop
- Admin cannot easily diagnose why the published feature doesn't appear

**How to avoid:**
The builder's "publish to studio" dropdown must be populated from the exact same `studios` array in `studioConfig.ts` (or an API that returns the same data). Never allow free-text studio IDs in the builder. Add a validation step at publish time that cross-references the target studio ID against known studio IDs. In `StudioPage.tsx`, add a null guard and render a "Studio not found" fallback if `studio` is undefined — this prevents a crash from taking down the page for other users.

**Warning signs:**
- Builder has a free-text studio ID field rather than a dropdown
- `getStudioById()` returns `undefined` in production logs
- `StudioPage` crashes with "Cannot read properties of undefined (reading 'apps')"

**Phase to address:** Phase 2 (Builder UI) + Phase 3 (Navigation Integration) — constrain the publish target before the builder goes live

---

### Pitfall 8: `workflow_type` for Dynamic Features Conflicts With Existing Job Tracking Filter

**What goes wrong:**
Every job in `video_jobs` and `image_jobs` has a `workflow_name` field used by the generation feed for filtering (`pageContext` in `UnifiedFeed.tsx`). Existing static features use hardcoded type strings (`'lipsync-one'`, `'wan-i2v'`, etc.). Dynamic workflows will need a `workflow_name` too. If dynamic workflows use a pattern like `'workflow-' + db_id` (e.g., `'workflow-abc123'`), the generation feed's existing filter logic fails to match them — the feed was built assuming fixed known strings. Users who run a published dynamic workflow see their jobs disappear from the feed immediately after submission because the filter excludes unknown `workflow_name` values.

**Why it happens:**
The feed filtering assumes the set of `workflow_type` values is closed and known at build time. Dynamic workflows introduce open-ended IDs at runtime.

**Consequences:**
- Users cannot see their in-progress dynamic workflow jobs in the generation feed
- Job history for dynamic features is invisible unless the user switches to "Show All"
- "Fix stuck jobs" functionality in the feed doesn't apply to dynamic workflow jobs

**How to avoid:**
Add a discriminator to the job schema: a boolean `is_dynamic_workflow` column or a `workflow_category` enum with values `'static'` and `'dynamic'`. The generation feed can filter on `workflow_category = 'dynamic'` for the dynamic features page, showing all dynamic workflows regardless of their specific `workflow_name`. Alternatively, prefix all dynamic `workflow_name` values with a consistent sentinel like `'dyn:'` and update the feed filter to match on prefix. Choose one approach before writing any job creation code for dynamic workflows.

**Warning signs:**
- Dynamic workflow jobs submitted successfully but not appearing in the feed
- Job feed shows empty for a dynamic feature page even after a successful run
- `pageContext` in `UnifiedFeed` config for a dynamic renderer doesn't match the submitted `workflow_name`

**Phase to address:** Phase 1 (Database Schema) — the discriminator field must exist before the first dynamic workflow job is created

---

### Pitfall 9: localStorage Stores a Published Workflow Page ID That Gets Deleted

**What goes wrong:**
A user navigates to a published workflow `'dyn:abc123'`. Their browser stores this as `vapai-current-page: 'dyn:abc123'` in localStorage. The admin deletes or unpublishes this workflow from the builder. The user refreshes. `App.tsx` loads the stored page ID, looks it up in the workflow config list (fetched on startup), finds no match, and falls through to... what? If there's no explicit fallback for "stored page not found," the app renders nothing, shows an error, or silently renders the wrong page.

**Why it happens:**
The existing localStorage restore logic (App.tsx, line 139) validates against a fixed `validPages` array. Dynamic pages can't be in this array. Without explicit "does this dynamic page still exist?" validation at restore time, orphaned localStorage entries cause silent failures.

**Consequences:**
- Users get a blank page or error screen on startup every time they visit after a workflow is unpublished
- Users don't understand what happened and think the app is broken
- The fix requires users to manually clear localStorage (they won't know to do this)

**How to avoid:**
When restoring a dynamic page from localStorage, validate that the workflow ID still exists in the loaded workflow configs. If not found, fall back to home and clear the stored dynamic page. This validation must happen after the workflow configs are fetched on startup — it cannot be synchronous. The sequence is: (1) fetch published workflows, (2) if stored page is a dynamic ID, look it up, (3) if not found, fall back to home.

**Warning signs:**
- Blank page or React error after app startup
- Console shows "getStudioById returned undefined" or similar
- Workflow was recently unpublished/deleted

**Phase to address:** Phase 3 (Navigation Integration) — handle the full lifecycle of published → unpublished

---

## Moderate Pitfalls

---

### Pitfall 10: Builder Allows Substitution of Hardcoded Node-to-Node Links as User Variables

**What goes wrong:**
In ComfyUI's API format, node connections are represented as arrays: `["source_node_id", output_slot_index]` (e.g., `["12", 0]`). Widget values (actual configurable values) are primitives: strings, numbers, booleans. The builder's variable detection logic needs to distinguish between these two. A naive parser that marks "all non-primitive inputs as configurable" will flag `["12", 0]` link references as configurable variables. The admin accidentally marks a node-to-node connection as a user-facing variable. The renderer tries to render a UI control for it. At execution time, the workflow is sent to ComfyUI with `"image": "user_string"` where ComfyUI expects `"image": ["12", 0]`, causing execution failure.

**Why it happens:**
The widget values vs. linked inputs distinction (documented in ComfyUI's workflow JSON spec) is not obvious. Link arrays look like valid JSON values and a simple `typeof value !== 'object'` check doesn't catch them because arrays are objects.

**Consequences:**
- Admins accidentally expose node wiring to users as configurable "inputs"
- Published workflow fails at execution with cryptic ComfyUI node errors
- The error happens at runtime, not at build time, so it's not caught until a user submits

**How to avoid:**
In the parser, explicitly exclude inputs where the value is an array with the pattern `[string_or_number, number]` — these are node link references, not widget values. Use this heuristic: `Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'` identifies a node link. Mark these as non-configurable in the builder UI. Optionally, enrich with `object_info` to know definitively which inputs are connectable vs. widget-only.

**Warning signs:**
- Builder shows array-valued inputs like `[12, 0]` as configurable variable candidates
- Published workflow fails with "expected array, got string" type of ComfyUI error

**Phase to address:** Phase 1 (Workflow JSON Parser) — link detection must be in the parser, not the renderer

---

### Pitfall 11: File Upload Variables in Dynamic Forms Bypass Existing Upload Infrastructure

**What goes wrong:**
Static feature pages upload files to ComfyUI using established patterns (see `LipsyncOnePerson.tsx`, `WANI2V.tsx`): the file is uploaded to ComfyUI's `/upload/image` endpoint and the returned filename is substituted into the workflow. The dynamic form renderer needs to handle `type: 'file-upload'` variables. The naive implementation has the renderer upload the file directly to ComfyUI using a new, simplified upload function — bypassing the existing upload utilities in `components/utils.ts`, skipping ComfyUI health checks, and not handling CORS properly (some ComfyUI instances require credentials: 'omit'). Files upload successfully in testing but fail for users with specific ComfyUI configurations.

**Why it happens:**
Building new upload logic for the dynamic renderer is faster than wiring up the existing upload infrastructure. But the existing patterns encode months of edge case fixes.

**Consequences:**
- File uploads from dynamic feature pages fail on some ComfyUI configurations
- CORS errors appear in production but not in testing
- Upload progress indicators missing (existing upload code has progress tracking)

**How to avoid:**
The dynamic form renderer's file upload must call the same `apiClient` methods used by static pages. Create a reusable `useFileUploadToComfyUI(comfyUrl)` hook that wraps the existing upload logic. The dynamic renderer uses this hook for all file-type variables. Do not write new fetch calls for file upload in the renderer.

**Phase to address:** Phase 2 (Dynamic Form Renderer) — file upload must reuse existing infrastructure from the start

---

### Pitfall 12: `comfy_job_id` vs `job_id` Mismatch in Dynamic Workflow Job Tracking

**What goes wrong:**
The existing `CreateJobPayload` interface in `supabase.ts` (line 71) uses `job_id` to mean the ComfyUI prompt ID. The newer `CreateVideoJobPayload` (line 44) uses `comfy_job_id` for the same concept. Dynamic workflow jobs will be created via whichever payload type seems appropriate, but the actual Supabase column is `comfy_job_id` in `video_jobs` and `image_jobs`. If the dynamic workflow job creation uses `job_id` (the legacy field), the job is stored without a `comfy_job_id`, the monitoring loop that polls by `comfy_job_id` never finds it, and the job stays permanently in "processing" state.

**Why it happens:**
There are two payload interfaces for the same underlying operation (legacy `CreateJobPayload` with `job_id` and new `CreateVideoJobPayload` with `comfy_job_id`). The inconsistency is pre-existing tech debt documented in the codebase. New code written without checking which field maps to which column will use the wrong one.

**Consequences:**
- Dynamic workflow jobs submitted to ComfyUI successfully but never transition out of "processing"
- Generation feed shows perpetual spinner for dynamic workflow jobs
- "Fix stuck job" button required for every dynamic workflow job

**How to avoid:**
Before writing any job creation code for dynamic workflows, map the `CreateJobPayload.job_id` → `comfy_job_id` relationship explicitly in a comment or migration note. Use only the new `CreateVideoJobPayload` or `CreateImageJobPayload` interfaces for new code — not the legacy `CreateJobPayload`. Add a linting rule or code review checklist item: "dynamic workflow job creation must use `comfy_job_id`, not `job_id`."

**Phase to address:** Phase 1 (Database Schema + Job Tracking) — identify and resolve the field naming before writing any dynamic job creation code

---

### Pitfall 13: Published Workflow Configuration Cached Stale After Admin Updates

**What goes wrong:**
Following the recommendation in Pitfall 4, the frontend caches published workflow configs at startup. An admin updates a published workflow's variable configuration (adds a new input, changes a default value) and saves. The change is in the database immediately. But users who loaded the app before the update have the stale config in memory. They submit the workflow with the old variable set — missing required new variables or sending deprecated fields. The ComfyUI workflow receives an incorrect parameter set and fails.

**Why it happens:**
In-memory config caching has no invalidation signal from the server. The admin saves to the database but there's no push notification to connected clients. Standard polling or background refresh helps but doesn't guarantee immediate consistency.

**Consequences:**
- Users on stale config get workflow execution errors after the admin makes changes
- The errors are intermittent (some users have fresh config, others have stale)
- Impossible to reproduce in testing because the admin is always on the latest version

**How to avoid:**
Add a `config_version` or `updated_at` timestamp to each published workflow record. The frontend polls for workflow config changes every 60 seconds (using an endpoint that returns only the IDs + updated_at of all published workflows). If any `updated_at` is newer than the cached version, re-fetch that workflow's full config. For critical changes, the admin can trigger a "force refresh" button in the builder that bumps a global `config_version` counter, which clients check on each polling cycle. This avoids a full re-fetch on every poll while ensuring changes propagate within 60 seconds.

**Phase to address:** Phase 3 (Navigation Integration) — polling strategy must be planned before the renderer handles production traffic

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Add `\| string` to `StudioPageType` | Allows dynamic IDs to pass TypeScript checks | Kills compile-time safety on all static pages; breaks `includes()` validation | Never |
| Inline `object_info` fetch in builder | Simpler — one request to get all node types | Builder broken whenever ComfyUI is down; repeated fetches on every upload | Never |
| Separate test-runner and renderer code paths | Test runner is simpler without job tracking | Tests pass but production fails; two implementations diverge over time | Never |
| Free-text studio ID in builder | More flexible for admins | Admin can publish to nonexistent studio, crashing navigation | Never |
| Load dynamic workflow config inline in `StudioPage.tsx` | Easier to implement | Flash of loading state on every navigation; repeated DB fetches | Only in prototype, not production |
| Use `CreateJobPayload` (legacy) for dynamic workflow jobs | Consistent with some existing code | `job_id` not stored in the right DB column; jobs never complete | Never |
| Hardcode `workflow_type` string for dynamic workflows to a single value | Simpler feed filtering | Can't distinguish which workflow was run; breaks per-workflow feed filtering | Only if feed filtering is not needed |

---

## Integration Gotchas

Common mistakes when connecting this feature to the existing platform.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ComfyUI `/object_info` | Call on every workflow upload, no caching | Cache with 5-min TTL; treat as optional enrichment, not blocking requirement |
| ComfyUI file upload in dynamic renderer | Write new fetch call, bypassing `utils.ts` | Reuse existing `uploadFileToComfyUI` logic via the `apiClient` |
| Supabase JSONB for variable configs | No schema constraint, accept any JSON | Add pg_jsonschema CHECK constraint + Zod validation on frontend read |
| `studioConfig.ts` studios array | Let builder accept any string as studio target | Builder dropdown sourced from same `studios` array; validate against it at publish time |
| Generation feed `pageContext` for dynamic features | Set `pageContext` to a specific workflow ID | Use `workflow_category = 'dynamic'` discriminator so all dynamic jobs show together |
| `WorkflowService.build_workflow()` | Call directly from test runner only | Share single `execute_dynamic_workflow()` wrapper between test and production paths |
| Supabase RLS for workflow configs table | No RLS policy (relying on backend auth only) | Add RLS: published workflows readable by all authenticated users; write operations restricted to admin role |

---

## Performance Traps

Patterns that work at small scale but fail as the number of published workflows grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching all published workflow configs on every app load | Slow startup as the workflow library grows | Paginate or fetch only the studio-relevant configs; cache aggressively | At ~20 published workflows with large JSONB configs |
| Calling `object_info` without caching on each workflow parse | ComfyUI load spike during builder sessions | TTL cache for `object_info` response (5 min minimum) | Immediately if multiple admins use builder concurrently |
| Storing full ComfyUI workflow JSON in JSONB without size limit | Large workflows bloat the config table | Validate workflow size on upload (reject if >500 KB) | At ~50 complex workflows with large embedded values |
| Re-rendering `DynamicFeaturePage` on every `comfyUrl` change in header | Entire form resets when user edits ComfyUI URL | Memoize the rendered form; only re-instantiate on explicit workflow change | Immediately on any ComfyUI URL edit |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Admin can publish any arbitrary workflow JSON to production | Malicious ComfyUI workflow nodes could exfiltrate data or execute arbitrary code on the ComfyUI server | Validate that all `class_type` values in the uploaded workflow exist in `object_info`; reject unknown node types |
| Builder has no auth guard on the backend (relies on parent page) | Existing tech debt pattern (`DockerfileEditor` has no internal auth guard per PROJECT.md) — do not repeat this | Every builder endpoint must independently call `get_current_user()` and check `is_admin` on every request |
| Dynamic workflow configs readable by all users including their ComfyUI node structure | Exposes internal workflow architecture (model names, node configurations) to non-admin users | Return only the form variable schema to regular users; restrict full workflow JSON access to admin role via Supabase RLS |
| Test runner calls ComfyUI directly from admin browser | Admin's browser may have different CORS permissions than production backend | Route all ComfyUI calls through the backend, even for test runs; never expose ComfyUI URL endpoints directly to the browser |
| Published workflow variable names used directly as ComfyUI parameter keys | Admin-supplied variable names become part of the workflow substitution template; a name containing `}}{{ADMIN_SECRET` could inject placeholder syntax | Sanitize all variable names: allow only `[A-Z_][A-Z0-9_]*` pattern; reject names with `{`, `}`, `\`, or template syntax characters |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Builder validates the workflow only at save time, not during input | Admin spends 20 minutes configuring variables, then hits a parse error at save | Parse and validate workflow JSON immediately on upload; show errors inline before entering the config UI |
| No preview of what the published feature will look like before publishing | Admin publishes, then sees the form looks wrong for users | Add a "Preview as user" mode in the builder that renders the `DynamicFeaturePage` with the current config |
| Published feature shows generic "Generating..." status with no link to the generation feed | Users don't know where to find their results | `DynamicFeaturePage` must show the same `UnifiedFeed` sidebar with `pageContext` filter as static feature pages |
| Deleting a published workflow with no confirmation | Users may be using the workflow; jobs referencing the workflow_name become orphaned in the feed | Require admin confirmation; check for jobs with that workflow_name created in the last 24 hours; show count before deletion |
| Builder shows raw node IDs and class_type strings to admin | Non-technical admins cannot understand "KSampler → `steps` (INT, default 20)" as configuration | Map class_type to human-readable names; show node title from `_meta.title` if available in the workflow JSON |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Workflow published and visible in navigation:** verify it also appears after F5 (localStorage restore works for dynamic IDs)
- [ ] **Builder test run passes:** verify the same workflow also completes when submitted via the published feature page (same code path confirmed)
- [ ] **Dynamic feature page renders correctly:** verify jobs from this page appear in the generation feed sidebar (workflow_category discriminator working)
- [ ] **Admin unpublishes a workflow:** verify users who had that page stored in localStorage are redirected to home, not shown a broken page
- [ ] **Workflow config updated by admin:** verify users with stale cached config receive the updated version within 60 seconds (polling works)
- [ ] **File upload variable in dynamic form:** verify files upload to ComfyUI and the returned filename is correctly substituted in the workflow JSON
- [ ] **Builder upload of UI-format JSON:** verify the format detection fires and shows a clear error explaining API format is required
- [ ] **Admin marks a node-link value as a variable:** verify the builder prevents this and shows an explanation of why it's not configurable

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `StudioPageType` union broken by dynamic IDs | HIGH | Revert to separate routing state; requires refactor of `App.tsx` localStorage handling and type system |
| UI-format workflow stored in DB | LOW | Add a migration to re-validate and re-parse all stored workflows; flag invalid ones for admin review |
| Test/production code path divergence discovered | HIGH | Audit all parameter handling between test and renderer; write integration tests comparing outputs; likely requires refactoring the shared submission function |
| Dynamic feature page crashes all users in a studio | LOW | Admin unpublishes the workflow from the builder (if builder is accessible); or backend endpoint to hard-delete the workflow config |
| Stale configs causing user errors | LOW | Trigger a config version bump in the database; all clients re-fetch on next poll cycle (within 60 seconds) |
| Node-link value was marked as a variable and published | MEDIUM | Admin edits the workflow config in the builder; re-publishes; users with cached config get the fix on next poll |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| #1: `StudioPageType` union doesn't cover dynamic IDs | Phase 1: Navigation model design | F5 on a published workflow page restores correctly |
| #2: UI-format vs API-format JSON | Phase 1: Workflow JSON upload parser | Upload a UI-format file; verify immediate clear error |
| #3: Node introspection requires live ComfyUI | Phase 1: Workflow JSON parser | Parser works with ComfyUI URL set to unreachable; enrichment optional |
| #4: Dynamic configs fetched inline causing flash | Phase 2: Navigation integration | Navigate to dynamic page 5 times; zero network requests after first load |
| #5: JSONB form config has no schema enforcement | Phase 2: Dynamic form renderer | Store malformed config; renderer shows graceful error, not crash |
| #6: Test runner diverges from renderer code path | Phase 1: Backend execution service | Unit test confirms test runner and renderer call same `execute_dynamic_workflow()` |
| #7: Publish to nonexistent studio | Phase 2: Builder UI | Builder dropdown contains only known studio IDs |
| #8: `workflow_type` conflicts with feed filtering | Phase 1: Database schema | Dynamic workflow jobs visible in generation feed sidebar |
| #9: Stale localStorage after workflow deleted | Phase 3: Navigation integration | Delete workflow; existing user refreshes; lands on home |
| #10: Node links marked as user variables | Phase 1: Workflow JSON parser | Link arrays excluded from configurable variable candidates |
| #11: File upload bypasses existing infrastructure | Phase 2: Dynamic form renderer | File upload in dynamic page passes ComfyUI health check first |
| #12: `comfy_job_id` vs `job_id` field mismatch | Phase 1: Database schema | Dynamic workflow job transitions to "completed" status without fix |
| #13: Stale published workflow config | Phase 3: Navigation integration | Admin saves change; user sees it within 60 seconds without refresh |

---

## Sources

- Codebase analysis: `frontend/src/lib/studioConfig.ts`, `frontend/src/App.tsx`, `frontend/src/components/StudioPage.tsx`, `frontend/src/lib/jobTracking.ts`, `frontend/src/lib/supabase.ts`, `backend/services/workflow_service.py`
- ComfyUI workflow format specification: [Workflow JSON - ComfyUI Docs](https://docs.comfy.org/specs/workflow_json)
- ComfyUI UI vs API format confusion (GitHub issue from community): [Issue #1335 - comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI/issues/1335)
- ComfyUI production playbook patterns: [The ComfyUI Production Playbook - Cohorte Projects](https://www.cohorte.co/blog/the-comfyui-production-playbook)
- Common ComfyUI workflow loading errors: [Fix ComfyUI Workflow Loading Errors 2025 - Apatero Blog](https://www.apatero.com/blog/comfyui-workflow-not-loading-8-common-errors-2025)
- Supabase JSONB schema validation: [pg_jsonschema: JSON Schema Validation - Supabase Docs](https://supabase.com/docs/guides/database/extensions/pg_jsonschema)
- Supabase Row Level Security: [Row Level Security - Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Dynamic React configuration without rebuild: ["Dynamic Configurations in React Apps: Bypass the Rebuild with Express" - Medium](https://medium.com/@bjvalmaseda/dynamic-configurations-in-react-apps-bypass-the-rebuild-with-express-0269e86eb61d)
- React Context common mistakes: [Common mistakes in using React Context API - greenonsoftware](https://greenonsoftware.com/articles/react/common-mistakes-in-using-react-context-api/)
- Data Driven Forms React library patterns: [Data Driven Forms - data-driven-forms.org](https://www.data-driven-forms.org/introduction)

---

*Pitfalls research for: v1.2 Workflow Builder — dynamic feature generation on an existing hardcoded-navigation platform*
*Researched: 2026-03-13*
