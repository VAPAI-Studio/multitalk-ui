# Feature Landscape: Workflow Builder

**Domain:** Admin-only no-code workflow builder for converting ComfyUI workflow JSON into live feature pages
**Researched:** 2026-03-13
**Milestone:** v1.2 Workflow Builder
**Context:** Adding a visual workflow builder to an existing platform that already has 25+ AI features, a centralized backend workflow system (templates + {{PLACEHOLDER}} substitution), studio-based navigation (studioConfig.ts), UnifiedFeed sidebar, dual execution backends (ComfyUI + RunPod), and admin-only Infrastructure studio. The builder creates database-stored feature configurations that a dynamic renderer turns into feature pages — no code generation, no rebuild required.

---

## Table Stakes

Features the admin user will expect from any workflow builder tool. Missing these makes the tool feel unfinished or untrustworthy compared to existing tools like ViewComfy, ComfyUI App Builder, and ComfyFlowApp.

### TS-1: Workflow JSON Upload and Node Parsing

| Aspect | Detail |
|--------|--------|
| **Why expected** | Every workflow builder in this space (ViewComfy, ComfyFlowApp, ComfyUI App Builder) starts with uploading a workflow JSON file. This is the universal entry point. An admin who exports from ComfyUI will immediately look for a file upload button. |
| **Complexity** | Medium |
| **Notes** | Accept `workflow_api.json` (the API format exported from ComfyUI via "Save (API format)"). Parse node IDs, `class_type`, and all inputs, distinguishing between widget inputs (constant values: strings, numbers, booleans, lists) and link inputs (references to other nodes as `[node_id, output_index]` arrays). Widget inputs are the ones that can become user-facing variables. Link inputs connect the graph and are not user-configurable. Also parse `_meta.title` on each node for display names. The existing `backend/workflows/` directory stores flat JSON templates — this builder creates new entries in that system. |
| **Acceptance** | Admin uploads a JSON file. System parses and lists all nodes with their class types, titles, and configurable inputs. Only widget inputs (non-link values) are shown as candidates for user variables. Parse errors show clear messages with the problematic field. |

### TS-2: Variable Configuration — Map Node Inputs to Form Fields

| Aspect | Detail |
|--------|--------|
| **Why expected** | The core function of every ComfyUI-to-app tool is selecting which inputs become user-facing. ViewComfy, ComfyUI App Builder, and ComfyFlowApp all center on this. An admin expects to check a box next to a node input, give it a label, and configure its display type. |
| **Complexity** | Medium |
| **Notes** | From ComfyUI's own type system (verified against official docs), the primitive widget types are: `STRING` (text field or textarea), `INT` (number input or slider), `FLOAT` (number input or slider with step), `BOOLEAN` (toggle/checkbox), `COMBO` (dropdown, defined as a list of strings in the workflow). File inputs are `IMAGE` and `AUDIO` (and effectively `VIDEO` via LoadVideo nodes). The builder should auto-suggest a display type based on the detected input type: `STRING` → text, `INT` with min/max → slider or number, `COMBO` → dropdown, `IMAGE` → file upload. Admin can override the suggestion. Each variable gets: label, placeholder/helper text, required/optional flag, default value, and display type override. Maps the variable to a `{{PLACEHOLDER_NAME}}` in the template using a naming convention like `NODE_ID_INPUT_NAME`. |
| **Acceptance** | Each parseable node input shows its type (auto-detected), current value (from the JSON), and a "Make variable" toggle. When toggled on, admin sees: label field, placeholder field, required toggle, default value field, and display type selector. Changes update a live preview config. |

### TS-3: Six Core Field Display Types

| Aspect | Detail |
|--------|--------|
| **Why expected** | The existing feature pages use exactly these input patterns. Any workflow builder that doesn't support the types already in use will be unable to replicate existing features. ViewComfy documents support for "Text, Numbers, Dropdowns, Sliders, Checkboxes, Images, Videos, Audio." |
| **Complexity** | Medium |
| **Notes** | The six types needed to cover all current {{PLACEHOLDER}} usages across the 19 existing workflows: (1) **text** — single-line text input (maps to STRING, short values like filenames or short prompts); (2) **textarea** — multi-line text (maps to STRING, maps to prompts like {{CUSTOM_PROMPT}}); (3) **number** — numeric input with optional min/max/step (maps to INT or FLOAT, e.g., {{STEPS}}, {{WIDTH}}, {{HEIGHT}}); (4) **slider** — range slider (maps to INT or FLOAT with known range, e.g., {{AUDIO_SCALE}} 0.0-1.0, {{IMAGE_STRENGTH}}); (5) **select** — dropdown (maps to COMBO type or known enum values); (6) **file-upload** — file picker with accept type filter (maps to IMAGE → image/*, AUDIO → audio/*, VIDEO → video/*). Boolean toggle is a seventh type for BOOLEAN inputs. Resolution (width+height pair) is a convenience composite type. That's eight total but the six core + toggle + resolution-pair covers all known use cases. |
| **Acceptance** | Builder offers all eight display types in the type selector. Dynamic renderer correctly renders all eight types. File upload fields accept appropriate MIME types based on configuration. Resolution pair renders as two linked number inputs that enforce multiples of 32 (matching the existing `useSmartResolution` hook pattern). |

### TS-4: Section Grouping

| Aspect | Detail |
|--------|--------|
| **Why expected** | All existing feature pages organize inputs into sections (e.g., "Input", "Settings", "Resolution", "Generate"). Presenting 8 uncategorized fields in a flat list makes the feature page feel unpolished. Every serious form builder (Kissflow, Zoho Forms, Carbon Design System) supports sections. |
| **Complexity** | Low |
| **Notes** | Admin assigns each variable to a named section. Default sections mirroring existing pages: "Inputs", "Settings", "Advanced". Admin can rename, add, or reorder sections. Variables within a section can be reordered (drag-handle or up/down arrows). Section order also configurable. This is stored in the JSONB `section_config` field in the database. |
| **Acceptance** | Admin can create, rename, and delete sections. Each variable assigned to a section. Sections and their variables reorderable. Dynamic renderer renders sections as the existing `<Section title="...">` component pattern. |

### TS-5: Test Run Within the Builder

| Aspect | Detail |
|--------|--------|
| **Why expected** | Every workflow builder tool includes a test/preview mode. ComfyUI App Builder has a built-in "App Mode" preview. ViewComfy has a "Playground". Without test-run capability, the admin can only verify the workflow works after publishing it to all users, which is unacceptable. The PROJECT.md explicitly requires this: "Test-run workflows directly from the builder." |
| **Complexity** | Medium-High |
| **Notes** | The test runner renders the configured form inline within the builder page (below the configuration panel). Admin fills in test values and submits. The form submission follows the exact same code path as the production dynamic renderer: it calls the existing ComfyUI or RunPod submission pipeline using the configured workflow template and parameters. Output (video/image) is shown inline. Error messages surface ComfyUI errors clearly. This is the "test runner shares code path with renderer" decision from PROJECT.md — critical for confidence that what works in test works in production. The ComfyUI URL comes from the existing `comfyUrl` prop (header setting). |
| **Acceptance** | Test form rendered with configured field types and labels. Admin can fill and submit. Job monitoring shows progress (reuses existing `startJobMonitoring` pattern). Output rendered inline. Errors shown with ComfyUI error text. Test does not create a permanent job record visible to regular users (or is clearly marked as a test run). |

### TS-6: Publish to Studio

| Aspect | Detail |
|--------|--------|
| **Why expected** | The purpose of the builder is to publish new features. An admin completing configuration expects a "Publish" button that makes the feature live. The PROJECT.md explicitly requires: "Publish features to any studio — instant appearance in navigation, no rebuild needed." |
| **Complexity** | Medium |
| **Notes** | Publishing saves the configuration to the database and adds the feature to the selected studio's navigation. Admin specifies: feature name, description, icon (emoji), gradient colors (matching existing studio gradient pattern), and which studio (dropdown of existing studios). On publish, the dynamic renderer immediately serves the feature page when navigated to. The studioConfig.ts pattern currently uses a hardcoded array — this needs to become database-driven (or hybrid: static for built-in features, database-queried for custom features). Navigation must update without page reload (could use a React context refresh or React Query invalidation). |
| **Acceptance** | "Publish" button saves configuration. Admin selects target studio and provides name/description/icon/gradient. Feature immediately appears in sidebar navigation for all users. Dynamic renderer loads and displays the feature correctly. No frontend rebuild required. |

### TS-7: Manage Published Features (CRUD)

| Aspect | Detail |
|--------|--------|
| **Why expected** | Admins expect to view, edit, unpublish, and delete features they've created. A tool with only a "create" operation but no management is a dead end after the first publish. |
| **Complexity** | Low-Medium |
| **Notes** | A management list view within the builder page shows all published custom features: name, studio, created date, last edited, status (published/draft). Actions per feature: Edit (re-opens builder with loaded config), Unpublish (removes from navigation but keeps config in database), Delete (removes config and navigation entry). Edit must load the full configuration back into the builder panel. Draft state (saved but not yet published) is useful for multi-session editing. |
| **Acceptance** | List of all custom features with name, studio, status, dates. Edit button opens feature in builder. Unpublish removes from navigation instantly. Delete removes permanently with confirmation dialog. Draft save available during editing. |

---

## Differentiators

Features that set this builder apart from generic workflow-to-app tools like ViewComfy or ComfyFlowApp. They justify building a custom tool instead of using an external service.

### D-1: Live Preview of the Rendered Feature Page

| Aspect | Detail |
|--------|--------|
| **Value proposition** | As the admin configures variables, sections, and field types, a live preview panel shows exactly what the feature page will look like — using the actual dynamic renderer component. No "save and check" cycle. This is more like Webflow or Framer's approach than generic form builders. |
| **Complexity** | Medium |
| **Notes** | The dynamic renderer is a React component that accepts a config object. The builder feeds it the current (unsaved) config in real-time. Preview renders in a sidebar or bottom panel. Because the renderer is just a component, this is straightforward to wire — the same component renders in preview mode and production mode. Preview should be clearly marked as a preview to avoid confusion. |
| **Acceptance** | Preview updates as admin changes field labels, types, section names, or ordering. Matches the exact output of the production renderer. Preview mode disables form submission (no actual workflow execution in preview). |

### D-2: Auto-Detect Field Types from ComfyUI Type System

| Aspect | Detail |
|--------|--------|
| **Value proposition** | Instead of requiring the admin to manually choose every field type, the parser infers the most likely display type from the ComfyUI input type and current value. `INT` with a value between 0 and 1 → suggests slider. `STRING` longer than 100 characters → suggests textarea. `COMBO` with a list of options → suggests select. This reduces configuration friction significantly. |
| **Complexity** | Low-Medium |
| **Notes** | Heuristics for auto-detection: (1) BOOLEAN → toggle; (2) COMBO → select (options taken from the list); (3) STRING with multiline=true → textarea; (4) STRING with known filename patterns (ends in .safetensors, .ckpt, .pt) → skip (these are model selectors not user inputs); (5) INT or FLOAT with min/max defined → slider; (6) INT or FLOAT without range → number input; (7) field name contains "seed" → number input with a "randomize" button; (8) field name is "image", "audio", "video", or ends in "_filename" → file upload. These are heuristics and the admin can always override. |
| **Acceptance** | Each variable shows auto-detected type as default. Override selector available. Auto-detection is documented or shown (e.g., a tooltip saying "Auto-detected from INT type with range 0-100"). |

### D-3: Full Integration with Existing Job Tracking and Feed

| Aspect | Detail |
|--------|--------|
| **Value proposition** | Published custom features behave identically to built-in features — they appear in the generation feed, support dual execution backends (ComfyUI + RunPod), and their jobs appear in the unified feed sidebar. This is only possible because the tool is built into the platform rather than being an external service. |
| **Complexity** | Medium |
| **Notes** | When a user submits a custom feature job, the dynamic renderer calls `createJob` with a `workflow_type` derived from the feature's slug. The UnifiedFeed sidebar on custom feature pages filters by that workflow_type. The existing `startJobMonitoring` utility handles progress tracking without changes. The execution backend toggle (ComfyUI vs RunPod) respects user preference automatically. |
| **Acceptance** | Jobs from custom features appear in generation feed. UnifiedFeed sidebar on the custom feature page shows only that feature's jobs. Execution backend toggle works for custom feature submissions. Job details (status, output, thumbnail) display correctly. |

### D-4: Seed Field with Randomize Button

| Aspect | Detail |
|--------|--------|
| **Value proposition** | Most ComfyUI workflows have a seed parameter (INT, typically very large range). The standard UX for seed fields is a number input paired with a "randomize" button (dice icon) that generates a random 64-bit integer. This is a common pattern in existing pages like WANI2V and LipsyncOnePerson. Auto-detecting seed fields and rendering them with a randomize button produces a polished result with no extra admin configuration. |
| **Complexity** | Low |
| **Notes** | Detection: field name is "seed" or contains "seed". Renderer: number input + randomize button. Randomize generates `Math.floor(Math.random() * 2**32)` (matching the pattern in existing page components). |
| **Acceptance** | Fields named "seed" auto-render with randomize button. Randomize button generates a new random seed on click. Admin can disable seed exposure (leave it as a fixed value in the template). |

### D-5: Resolution Pair as Composite Field Type

| Aspect | Detail |
|--------|--------|
| **Value proposition** | Width and height parameters are always paired in ComfyUI workflows and must be multiples of 32. The existing `useSmartResolution` hook handles this. Custom features with resolution inputs should use the same composite input that enforces the constraint automatically, rather than two unrelated number fields. |
| **Complexity** | Low |
| **Notes** | When both `WIDTH` and `HEIGHT` node inputs are selected as variables (or inputs named "width"/"height"), the admin can link them as a resolution pair. The dynamic renderer then uses the `useSmartResolution` hook behavior. Admin can also just expose them as separate number fields if desired. |
| **Acceptance** | "Resolution pair" composite type available. When selected for width+height, renders as two linked inputs with "Auto-corrected to multiples of 32" note. Dynamic renderer enforces rounding. |

---

## Anti-Features

Things to deliberately NOT build in v1.2. Including them adds complexity that either slows delivery or belongs in a later milestone.

### AF-1: Visual Node Graph Editor

**Do not build.** A visual canvas showing ComfyUI nodes as connected boxes (like ComfyUI's own interface or reactflow-based editors) is enormously complex. The builder's purpose is to configure user-facing inputs for an existing workflow, not to create or modify the workflow's computational graph.

**What to do instead:** Parse the uploaded JSON, present a flat list of nodes with their inputs. The admin configures which inputs become variables — they do not need to see or edit the graph topology. If an admin wants to modify the workflow graph, they do so in ComfyUI itself and re-upload.

### AF-2: Code Generation (React Component Files)

**Do not build.** Generating `.tsx` files, writing to the filesystem, and triggering rebuilds is fragile, slow, and defeats the "instant publish without rebuild" goal from PROJECT.md. The dynamic renderer approach (database config → React component renders at runtime) is explicitly the chosen pattern.

**What to do instead:** Store configuration in Supabase (JSONB columns). The dynamic renderer interprets the config at runtime. No code generation, no file writes, no rebuilds.

### AF-3: Per-User Workflow Builder Access (Non-Admin)

**Do not build.** Allowing regular users to create and publish features requires multi-tenant workflow management, approval workflows, sandboxing, rate limiting per user, and access control audit trails. This is a different product (more like Gradio Spaces or Hugging Face).

**What to do instead:** Keep the builder strictly admin-only (same `isAdmin` check used in Infrastructure). One admin, full trust, full control.

### AF-4: Workflow Validation Against a Running ComfyUI Instance

**Do not build** as a blocking step during upload. Calling `/object_info` on a ComfyUI instance to validate every node and input type is useful but: (a) requires a live ComfyUI server at builder time, (b) the server may have different custom nodes than production, (c) it adds latency to the upload flow. The existing workflow templates work without per-upload validation.

**What to do instead:** Validate the JSON structure (nodes have `class_type` and `inputs`, no cyclic links). The test-run (TS-5) is the real validation — if the workflow runs successfully in test, it will run in production.

### AF-5: Drag-and-Drop Node Graph Parsing with Auto-Layout

**Do not build.** Auto-detecting the "semantic" role of each node (which nodes are for model loading vs. user input vs. output) by analyzing the graph structure requires heuristics that break for custom nodes. The admin knows their workflow and can identify inputs manually.

**What to do instead:** Present nodes in a simple list with their `_meta.title` and `class_type`. Admin selects inputs by inspection. For power users who know their JSON, this is fast.

### AF-6: Conditional Field Logic (Show/Hide Based on Other Field Values)

**Do not build** in v1.2. Conditional logic (e.g., "show SEED field only if RANDOMIZE_SEED is false") significantly complicates both the builder configuration UI and the dynamic renderer. No existing feature page uses conditional field visibility.

**What to do instead:** Keep all fields always visible. If an admin wants to hide an input, they set it as a fixed value in the template (not a variable). Conditional logic can be added in v2 if feature pages require it.

### AF-7: Multiple Output Configuration (Image vs. Video vs. Audio)

**Do not build** as a complex configuration panel. Output type detection can be inferred from the workflow's SaveImage/VHS_VideoCombine/SaveAudio node types (the node that saves the final output). If the builder detects a video save node, the renderer uses a video player; image save node → image preview.

**What to do instead:** Auto-detect output type from terminal node class_type patterns. Admin can override with a simple "Output type: Image / Video / Audio" selector. No multi-output rendering in v1.2.

---

## Feature Dependencies

```
TS-1: Workflow JSON Upload + Parse
  |
  +-- TS-2: Variable Configuration (needs parsed nodes)
        |
        +-- TS-3: Six Core Field Types (implements display types for variables)
        |
        +-- TS-4: Section Grouping (organizes variables into sections)
        |
        +-- D-1: Live Preview (renders TS-2+TS-3+TS-4 in real-time)
        |
        +-- D-2: Auto-Detect Types (enhances TS-2 with smart defaults)
        |
        +-- D-4: Seed Field + Randomize (specialized field type in TS-3)
        |
        +-- D-5: Resolution Pair (specialized composite type in TS-3)
        |
        +-- TS-5: Test Run (requires TS-2+TS-3+TS-4 complete to render test form)
              |
              +-- TS-6: Publish to Studio (requires test passing to publish)
                    |
                    +-- D-3: Feed + Dual Backend Integration (happens at publish time)
                    |
                    +-- TS-7: Manage Published Features (requires published features to manage)
```

**Critical path:** TS-1 → TS-2 → TS-3 → TS-4 → TS-5 → TS-6

This is the minimum viable loop: upload a workflow, configure its inputs, give them types and sections, test it, publish it.

**Parallel work possible:**
- D-2 (auto-detect) can be built into TS-1/TS-2 from the start without blocking other features
- D-4 and D-5 (seed field, resolution pair) are renderer-level features buildable in parallel with TS-5
- TS-7 (management list) can be built after TS-6 as a follow-on
- D-3 (feed integration) works automatically if the dynamic renderer calls `createJob` correctly — no separate build step

---

## MVP Recommendation

### Launch With (v1.2 Core)

- [ ] TS-1: Workflow JSON upload and node parsing — without this, nothing else works
- [ ] TS-2: Variable configuration (label, type, required, default) — core builder UX
- [ ] TS-3: Six core field types + toggle + resolution pair — covers all existing workflow placeholder types
- [ ] TS-4: Section grouping — minimum for polished output
- [ ] TS-5: Test run — non-negotiable; admins must test before publishing
- [ ] TS-6: Publish to studio — the feature's purpose
- [ ] D-2: Auto-detect field types — low cost, high time savings during configuration

### Add After First Publish Works (v1.2 Polish)

- [ ] TS-7: Manage published features (edit, unpublish, delete) — needed as soon as the first feature is published
- [ ] D-1: Live preview panel — improves confidence during configuration; add once core is stable
- [ ] D-3: Feed + dual backend integration — validate this works with the first published feature
- [ ] D-4: Seed field with randomize — common enough to include early
- [ ] D-5: Resolution pair composite type — needed for any workflow with width+height

### Future Consideration (v2+)

- [ ] Conditional field logic — only needed when feature pages require dynamic visibility
- [ ] object_info-based validation (optional, requires live server) — useful but not blocking
- [ ] Workflow versioning (upload new version of a published workflow) — needed as workflows evolve
- [ ] Sharing custom features between admin accounts — needed if multi-admin scenario arises
- [ ] Visual node graph viewer (read-only) — useful for debugging complex workflows

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-1: Workflow JSON upload + parse | HIGH | MEDIUM | P1 |
| TS-2: Variable configuration | HIGH | MEDIUM | P1 |
| TS-3: Six core field types | HIGH | MEDIUM | P1 |
| TS-4: Section grouping | HIGH | LOW | P1 |
| TS-5: Test run | HIGH | HIGH | P1 |
| TS-6: Publish to studio | HIGH | MEDIUM | P1 |
| D-2: Auto-detect field types | MEDIUM | LOW | P1 |
| TS-7: Manage published features | HIGH | LOW | P2 |
| D-1: Live preview | MEDIUM | MEDIUM | P2 |
| D-3: Feed + dual backend | HIGH | LOW | P2 |
| D-4: Seed field + randomize | MEDIUM | LOW | P2 |
| D-5: Resolution pair | MEDIUM | LOW | P2 |
| Conditional field logic | LOW | HIGH | P3 |
| object_info validation | LOW | MEDIUM | P3 |
| Workflow versioning | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.2 launch
- P2: Should have, add in v1.2 polish phase
- P3: Future milestone

---

## Competitor / Prior Art Feature Analysis

| Feature | ViewComfy | ComfyUI App Builder | ComfyFlowApp | Our Builder |
|---------|-----------|---------------------|--------------|-------------|
| Upload workflow JSON | Yes (drag+drop) | No (uses current workflow) | Yes | Yes (file input) |
| Select which inputs to expose | Yes | Yes (click in graph) | Yes | Yes (list view) |
| Field type configuration | Yes (text, number, select, slider, checkbox, image, video, audio) | Partial | Partial | Yes (8 types) |
| Section grouping | Unknown | Yes (rename, reorder, group) | Unknown | Yes |
| Test/preview before publish | Yes (playground) | Yes (app mode) | Yes | Yes (inline test run) |
| Publish to navigation | No (external hosting) | Yes (ComfyHub) | Yes (own platform) | Yes (platform sidebar) |
| Manage published features | Yes (CRUD in dashboard) | Yes | Unknown | Yes |
| Feed/job tracking integration | No | No | No | Yes (platform native) |
| Dual execution backend | No | No | No | Yes (ComfyUI + RunPod) |
| Admin-only access | No | No | No | Yes (isAdmin gate) |
| No rebuild required | Yes | Yes | Yes | Yes |
| Live preview while configuring | Unknown | Yes (real-time) | Unknown | Yes |
| Auto-detect field types | No | Yes (graph context) | Unknown | Yes |

**Unique to our approach:** Feed integration, dual execution backend support, and admin-gating are impossible in external tools because they require deep platform integration. These are the key reasons to build rather than use ViewComfy.

---

## Implementation Notes for Dynamic Renderer

The dynamic renderer is the counterpart to the builder. It:

1. Reads the published feature config from the database (workflow_name, variable_config[], section_config[])
2. Renders a React component matching the existing feature page layout (Section, Field, Label pattern)
3. On submit: calls `apiClient.submitWorkflow(workflowName, parameterMap, comfyUrl, clientId)`
4. Creates a job via `createJob({ workflow_type: feature.slug, ... })`
5. Starts monitoring via `startJobMonitoring(...)`
6. Renders output (video/image/audio) based on the feature's configured output type
7. Includes UnifiedFeed with `pageContext: feature.slug`

The renderer is essentially a generic version of every existing feature page, parameterized by the database config. The test runner in the builder IS the renderer, rendered with a flag that suppresses the job from appearing in the regular feed (or marks it clearly as a test).

---

## Key Constraints Affecting Features

| Constraint | Impact on Features |
|-----------|-------------------|
| No frontend rebuild on publish | Dynamic renderer (not code generation) is mandatory. Config must live in database. |
| studioConfig.ts currently hardcoded | Navigation integration requires making custom features database-driven. Built-in features stay in studioConfig.ts; custom features fetched from API. Hybrid approach. |
| Existing `{{PLACEHOLDER}}` substitution pattern | Variable naming convention must produce valid placeholder names. Suggest SCREAMING_SNAKE_CASE. Reserve names of existing placeholders. |
| ComfyUI workflow_api.json vs workflow.json | Must accept API format (widget values as constants). The visual format (ComfyUI native) uses a different structure with `widgets_values` arrays that are harder to parse. Require API format export. |
| Admin-only access | Builder page protected by `isAdmin` check. Dynamic renderer pages are public (like all feature pages). |
| Existing workflow system (WorkflowService) | Published custom workflows store JSON in `backend/workflows/` or in the database. Database storage preferred for instant publish. WorkflowService needs a path to load from database in addition to files. |

---

## Sources

- [ComfyUI Datatypes documentation](https://docs.comfy.org/custom-nodes/backend/datatypes) — official input types (STRING, INT, FLOAT, BOOLEAN, COMBO, IMAGE, AUDIO)
- [ComfyUI Workflow JSON Format — DeepWiki](https://deepwiki.com/Comfy-Org/ComfyUI/7.3-workflow-json-format) — node structure, link arrays vs constant values
- [ViewComfy GitHub repository](https://github.com/ViewComfy/ViewComfy) — field types: text, numbers, dropdowns, sliders, checkboxes, images, videos, audio
- [ViewComfy blog: turn workflow into app](https://www.viewcomfy.com/blog/turn-a-comfyui-workflow-into-an-app) — workflow-to-app process (upload → configure → deploy)
- [ComfyUI App Builder announcement](https://blog.comfy.org/p/from-workflow-to-app-introducing) — rename, reorder, group inputs; App Mode vs App Builder pattern
- [ComfyUI JS Objects documentation](https://docs.comfy.org/custom-nodes/js/javascript_objects_and_hijacking) — node.widgets, node.inputs distinction; BOOLEAN, INT, FLOAT, STRING, COMBO, IMAGEUPLOAD widget types
- [InvokeAI Workflow Implementation](https://invoke-ai.github.io/InvokeAI/contributing/frontend/workflows/) — Linear View (linearizing graph into form), field templates from OpenAPI schema, stateful vs stateless fields
- [Dynamic Forms Complete Guide — Noteforms](https://noteforms.com/resources/dynamic-forms-complete-guide) — conditional logic, progressive disclosure, governance patterns
- [Dynamic Form Builder System Design — Medium](https://shivambhasin29.medium.com/mastering-frontend-system-design-building-a-dynamic-form-builder-from-scratch-0dfdd78d31d6) — field schema (id, type, label, validation, conditional logic)
- [Form UI Design Best Practices — Designlab](https://designlab.com/blog/form-ui-design-best-practices) — section grouping, field ordering, spacing
- Existing codebase: `frontend/src/lib/studioConfig.ts`, `frontend/src/components/StudioPage.tsx`, `frontend/src/App.tsx`, `backend/services/workflow_service.py`, `backend/workflows/*.json`

---

*Feature landscape for: v1.2 Workflow Builder*
*Researched: 2026-03-13*
