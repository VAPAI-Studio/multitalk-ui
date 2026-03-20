# Technology Stack: v1.2 Workflow Builder

**Project:** sideOUTsticks - Workflow Builder (Admin No-Code Feature Creator)
**Researched:** 2026-03-13
**Scope:** Stack additions needed for the Workflow Builder milestone only. Existing stack (FastAPI, React 19/TypeScript/Vite/TailwindCSS, Supabase, httpx, Monaco Editor, dnd patterns, job tracking) is validated and NOT re-researched.
**Confidence:** HIGH for all recommendations (npm-verified versions, peer dependency checks performed)

---

## Core Finding: Minimal New Dependencies

The Workflow Builder requires exactly **4 new npm packages** across two capability areas. Everything else — form rendering, ComfyUI parsing, backend validation, database storage — is handled by the existing stack or custom code. The philosophy here is to add only what cannot be done cleanly without a library.

---

## New Dependencies Required

### 1. Drag-and-Drop Field Reordering

**Recommended: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`**

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@dnd-kit/core` | `^6.3.1` | DnD primitives (sensors, context, collision detection) | Last updated Dec 2024. Required by @dnd-kit/sortable |
| `@dnd-kit/sortable` | `^10.0.0` | Sortable list preset with `arrayMove()` | Provides `useSortable`, `SortableContext`, `arrayMove`. Direct dependency for field reordering. |
| `@dnd-kit/utilities` | `^3.2.2` | CSS transform helpers used by `useSortable` | Tiny utility package, required for `CSS.Transform.toString()` calls |

**Why dnd-kit over alternatives:**
- `@hello-pangea/dnd` (react-beautiful-dnd fork): More verbose API, designed for lists-only, no keyboard sensors by default. dnd-kit is more composable for a form builder where drag targets can be arbitrary components.
- `react-dnd`: Lower-level, no sortable preset, requires manual HTML5 backend wiring. More code for same result.
- Native HTML5 drag-and-drop: Accessible drag requires significant polyfilling. dnd-kit handles keyboard, pointer, and touch sensors out of the box.
- `@dnd-kit/react` (v0.3.x): The newer API under active development but still pre-1.0 and has React 19 server component compatibility issues (Issue #1654). The stable v6 `@dnd-kit/core` + `@dnd-kit/sortable` is the correct choice for a client-side SPA with React 19.

**React 19 compatibility:** Peer deps specify `>=16.8.0`. No known issues with React 19 for the classic `@dnd-kit/core` + `@dnd-kit/sortable` combo (issues are isolated to the newer `@dnd-kit/react` package which targets Next.js server components).

**Usage pattern for the Workflow Builder:**

```tsx
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// In the builder's variable list:
function SortableVariableRow({ variable }: { variable: WorkflowVariable }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: variable.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>...</div>;
}
```

---

### 2. Emoji Picker (Feature Icon Selection)

**Recommended: `emoji-picker-react`**

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `emoji-picker-react` | `^4.18.0` | Emoji picker popover for feature icon selection | Last updated Feb 2026. Actively maintained. |

**Why `emoji-picker-react` over alternatives:**
- `emoji-mart`: Heavier (~170KB), requires separate data package. Justified for messaging apps with emoji-as-primary-feature. The Workflow Builder just needs an icon picker — `emoji-picker-react` (~80KB gzipped) is sufficient.
- `frimousse` (Liveblocks, headless): Released March 2025, promising but requires full custom styling on top of TailwindCSS. Adding unstyled headless library is more work than pre-built for this single use case.
- Native emoji input: No cross-browser consistency. iOS shows native picker, desktop shows nothing useful.

**React 19 compatibility:** Peer dep is `react >= 16`. Last updated Feb 2026, no known React 19 issues.

**Usage pattern:**

```tsx
import EmojiPicker from 'emoji-picker-react';

// In the workflow feature config form:
<EmojiPicker
  onEmojiClick={(emojiData) => setFeatureIcon(emojiData.emoji)}
  previewConfig={{ showPreview: false }}
  skinTonesDisabled
/>
```

---

### 3. Color/Gradient Selection (Feature Card Styling)

**Recommended: `react-colorful`**

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `react-colorful` | `^5.6.1` | Solid color picker for feature gradient stops | 2.8KB gzipped. No dependencies. React 19 compatible. |

**Why `react-colorful` despite 4-year-old last publish:**
The package is stable, minimal (2.8KB, zero dependencies), tree-shakeable, and its peer dep `>=16.8.0` works correctly with React 19. A 4-year freeze on a 2.8KB utility with zero deps is a sign of completeness, not abandonment. The alternative `@uiw/react-color` (v2.9.6, active) is heavier and adds `@babel/runtime` as a peer dep — unnecessary complexity.

**Critical context:** The gradient is a Tailwind CSS class string (`from-blue-500 to-purple-600`), not an arbitrary CSS gradient. The builder presents a fixed palette of the existing Tailwind gradient combinations used across the platform. A color picker is only needed if allowing custom hex colors. Recommendation: **implement gradient selection as a predefined palette grid first** (zero libraries), add `react-colorful` only if custom hex color support is required in v1.2. The palette grid covers 100% of current platform usage.

**Palette-only implementation (preferred, no library):**

```tsx
const GRADIENT_PRESETS = [
  { label: 'Blue to Purple', value: 'from-blue-600 to-purple-600' },
  { label: 'Green to Teal', value: 'from-green-500 to-teal-600' },
  { label: 'Orange to Red', value: 'from-orange-500 to-red-600' },
  // ... 8-10 options matching existing feature cards
];

<div className="grid grid-cols-4 gap-2">
  {GRADIENT_PRESETS.map(g => (
    <button
      key={g.value}
      className={`h-8 rounded-lg bg-gradient-to-r ${g.value}`}
      onClick={() => setGradient(g.value)}
    />
  ))}
</div>
```

**Verdict:** Add `react-colorful` only if custom gradient colors are in scope. For v1.2 with a fixed palette, no library is needed for this capability.

---

### 4. Schema Validation (Workflow Config + Form Field Definitions)

**NOT a new dependency. Use Zod v4.3.6 — already available.**

Wait — Zod is NOT currently in `package.json`. However, validation of the workflow config JSON schema is best handled on the **backend** (Python/Pydantic, already in place), and on the frontend, simple TypeScript type assertions suffice for the config editor since the admin is building the config, not a user submitting data.

**Decision: No validation library needed for v1.2.**

Rationale:
- The workflow variable config stored in Supabase is JSONB. The backend validates before save.
- The frontend builder is admin-only — strict runtime validation adds complexity without meaningful security benefit (admin is trusted).
- TypeScript interfaces provide compile-time safety for the config shape.
- If validation is needed later, Zod v4.3.6 can be added then.

---

## ComfyUI Workflow JSON Parsing (No Library — Pure TypeScript)

This is the most important capability and requires **no library**. The existing codebase already manipulates ComfyUI workflow JSON extensively. The parsing logic is straightforward and should be custom code to maintain full control.

### Two ComfyUI JSON Formats

**API Format** (what the builder accepts — admin exports via "Save (API format)"):

```json
{
  "6": {
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Prompt)" },
    "inputs": {
      "text": "beautiful scenery",
      "clip": ["4", 1]
    }
  }
}
```

**Litegraph Format** (the visual editor format — NOT what we accept):
Contains `nodes` array, `links` array, `widgets_values`, positional data. More complex to parse. The builder explicitly accepts only the API format.

### Widget Input Detection Logic

The parser distinguishes configurable inputs from node connections:

```typescript
// A link input (NOT configurable): array with [node_id, output_slot_index]
// A widget input (configurable): any non-array value (string, number, boolean, list of strings)

interface ComfyNodeInput {
  nodeId: string;
  nodeType: string;         // class_type
  nodeTitle: string;        // _meta.title or class_type fallback
  inputKey: string;
  currentValue: unknown;
  detectedType: 'STRING' | 'INT' | 'FLOAT' | 'BOOLEAN' | 'COMBO' | 'IMAGE' | 'AUDIO' | 'unknown';
}

function parseWorkflowInputs(workflow: Record<string, ComfyApiNode>): ComfyNodeInput[] {
  const results: ComfyNodeInput[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [inputKey, value] of Object.entries(node.inputs || {})) {
      // Skip link inputs: [nodeId, outputIndex] arrays
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
        continue;
      }
      // Infer type from value
      const detectedType = inferInputType(value);
      results.push({
        nodeId,
        nodeType: node.class_type,
        nodeTitle: node._meta?.title ?? node.class_type,
        inputKey,
        currentValue: value,
        detectedType,
      });
    }
  }
  return results;
}

function inferInputType(value: unknown): ComfyNodeInput['detectedType'] {
  if (Array.isArray(value)) return 'COMBO'; // list of strings = dropdown options
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INT' : 'FLOAT';
  if (typeof value === 'string') return 'STRING';
  return 'unknown';
}
```

**Important:** The `/api/comfyui/object_info` endpoint can augment this with richer type metadata (min, max, step for INT/FLOAT; multiline flag for STRING; actual option list for COMBO). The builder should optionally call this endpoint after workflow upload to enrich the auto-detected types. This is existing API infrastructure — no new code needed in `api_doc.md`.

---

## Backend: No New Dependencies

The Workflow Builder's backend needs:

1. **Custom workflows table** in Supabase — new SQL migration, no library.
2. **WorkflowService extension** — already exists, add `save_custom_workflow()` and `load_custom_workflow()` methods.
3. **New API router** `backend/api/workflow_builder.py` — CRUD for custom workflows.
4. **Dynamic renderer integration** — the existing WorkflowService `build_workflow()` method handles `{{PLACEHOLDER}}` substitution. Custom workflows use the same system.

All using: FastAPI (existing), Pydantic v2 (existing), supabase-py (existing), Python's built-in `json` module.

---

## Database Schema (New Migration)

**`custom_workflows` table:**

```sql
CREATE TABLE custom_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL UNIQUE,           -- URL-safe name, used as workflow_type
  display_name TEXT NOT NULL,          -- Shown in navigation and homepage
  description TEXT,
  icon TEXT DEFAULT '✨',              -- Emoji for navigation and homepage card
  gradient TEXT DEFAULT 'from-blue-600 to-purple-600',  -- Tailwind gradient classes
  studio TEXT NOT NULL,                -- Which studio tab this appears in
  workflow_filename TEXT NOT NULL,     -- Stored in backend/workflows/ as {{name}}.json
  variables JSONB NOT NULL DEFAULT '[]',  -- Array of WorkflowVariable configs
  sections JSONB NOT NULL DEFAULT '[]',   -- Array of section groupings
  output_type TEXT DEFAULT 'video',    -- 'video' | 'image' | 'audio'
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**No new Supabase features needed.** JSONB columns follow the existing pattern used by other tables in the project.

---

## Recommended Stack Summary

### New npm Packages (Frontend)

| Package | Version | Purpose | Required For |
|---------|---------|---------|-------------|
| `@dnd-kit/core` | `^6.3.1` | DnD context, sensors, collision detection | Field reordering in builder |
| `@dnd-kit/sortable` | `^10.0.0` | Sortable preset with `arrayMove()` | Field reordering in builder |
| `@dnd-kit/utilities` | `^3.2.2` | CSS transform utilities for DnD | Required by `useSortable` |
| `emoji-picker-react` | `^4.18.0` | Emoji picker for feature icon selection | Icon picker in builder |

### Conditionally Add

| Package | Version | Purpose | When to Add |
|---------|---------|---------|-------------|
| `react-colorful` | `^5.6.1` | Solid color picker | Only if custom gradient colors required (not needed if using preset palette) |

### Not Needed (Zero New Backend Packages)

All backend capabilities use existing: FastAPI, Pydantic v2, supabase-py, Python `json`.

---

## Installation

```bash
cd /Users/yvesfogel/Desktop/plataforma_b/multitalk-ui/frontend

# Required packages
npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2 emoji-picker-react@^4.18.0

# Conditional (only if custom gradient colors are required)
# npm install react-colorful@^5.6.1
```

---

## What NOT to Add (and Why)

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@dnd-kit/react` (v0.3.x) | Pre-1.0, React 19 server component issues, breaks in some Next.js 15 configs. Designed for SSR, not this CSR SPA. | `@dnd-kit/core` + `@dnd-kit/sortable` (stable v6) |
| `react-beautiful-dnd` | Officially deprecated by Atlassian since 2022. Unmaintained. | `@dnd-kit/sortable` |
| `@hello-pangea/dnd` | Community fork of react-beautiful-dnd; more verbose API for same result. | `@dnd-kit/sortable` |
| `react-jsonschema-form` (rjsf) | 250KB bundle, opinionated HTML output that conflicts with Tailwind styling. The builder needs full control over field appearance. Overkill for admin config form. | Custom field components using React state |
| `formik` | Heavy, class-component mindset, slower than react-hook-form. No benefit over controlled React state for this use case. | Native React state (`useState`) for the builder form |
| `react-hook-form` | Not needed. The builder UI is a configuration tool with ~10 fields, not a complex validated form. Native `useState` + controlled inputs is cleaner at this scale. | Native React `useState` |
| `zod` | No runtime validation needed on the frontend. Admin is trusted user. TypeScript types cover compile-time safety. Backend (Pydantic) validates before persistence. | TypeScript interfaces + Pydantic on backend |
| `json-schema-validator` / `ajv` | Same rationale as Zod. Backend handles validation. | Pydantic on backend |
| `emoji-mart` | 170KB+ bundle vs emoji-picker-react's ~80KB. Full-featured messaging emoji picker — overkill for an icon selection widget. | `emoji-picker-react` |
| `react-color` (casesandberg) | Unmaintained since 2019. Large bundle with class components. | `react-colorful` if needed, or preset palette |
| `sortablejs` / `react-sortablejs` | jQuery-derived, manipulates DOM directly rather than React state. Conflicts with React's rendering model. | `@dnd-kit/sortable` |
| JSON Schema-to-form libraries (SurveyJS, `uniforms`) | These generate forms from JSON Schema format, not from a custom config schema. The dynamic renderer needs to support the platform's own variable config format, not JSON Schema. Heavy and invasive. | Custom `DynamicRenderer` component |

---

## Integration Points with Existing Stack

### 1. WorkflowService (Extend, Don't Replace)

The existing `backend/services/workflow_service.py` already handles `{{PLACEHOLDER}}` substitution and validation. Custom workflows use the exact same system:

```python
# New method added to WorkflowService
async def save_custom_workflow(self, workflow_name: str, workflow_json: dict) -> Tuple[bool, Optional[str]]:
    """Save a custom workflow JSON to the workflows directory"""
    path = self.workflows_dir / f"{workflow_name}.json"
    with open(path, 'w') as f:
        json.dump(workflow_json, f, indent=2)
    return True, None

# Existing build_workflow() works unchanged for custom workflows:
success, result, error = await workflow_service.build_workflow(
    workflow_name,        # the saved custom workflow filename
    user_variable_values  # dict of placeholder_name -> user_value
)
```

### 2. studioConfig.ts (Dynamic Navigation Entry Point)

The existing `frontend/src/lib/studioConfig.ts` manages studio navigation. Published custom workflows inject entries at runtime:

```typescript
// Custom workflows are loaded from Supabase and merged into studioConfig at app startup
// The dynamic renderer component is always present; it switches behavior based on workflow config
```

### 3. UnifiedFeed (No Changes Needed)

Custom workflow jobs use `workflow_type: customWorkflow.name` — the existing UnifiedFeed `pageContext` filtering works without modification.

### 4. Dual Backend (ComfyUI + RunPod)

Custom workflows use the same `ExecutionBackendContext` toggle as all other features. The RunPod path submits the filled-in workflow JSON to the universal handler — custom workflows are JSON workflows, so RunPod support is automatic.

### 5. Job Tracking (No Changes Needed)

`createJob()`, `startJobMonitoring()`, `completeJob()` work unchanged. The dynamic renderer calls these the same way existing feature pages do.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@dnd-kit/core@6.3.1` | `@dnd-kit/sortable@10.0.0` | sortable@10 requires core@^6.3.0 (verified via peerDeps) |
| `@dnd-kit/sortable@10.0.0` | `@dnd-kit/utilities@3.2.2` | Utilities version doesn't need to match sortable |
| `@dnd-kit/core@6.3.1` | React 19.1.1 | Peer dep `>=16.8.0`. No known issues with React 19 for this classic package |
| `emoji-picker-react@4.18.0` | React 19.1.1 | Peer dep `>= 16`. Actively maintained (last update Feb 2026) |
| `react-colorful@5.6.1` | React 19.1.1 | Peer dep `>=16.8.0`. Stable, no known React 19 issues |

---

## Confidence Assessment

| Component | Confidence | Basis |
|-----------|------------|-------|
| `@dnd-kit` for field reordering | HIGH | npm-verified versions, peerDep compatibility confirmed, React 19 safe for v6 classic packages |
| `emoji-picker-react` for icon picker | HIGH | npm-verified v4.18.0, last updated Feb 2026, React 19 peer dep |
| Gradient via preset palette (no library) | HIGH | Zero-risk — matches existing platform patterns |
| `react-colorful` (conditional) | MEDIUM | Stable but 4-year-old package; functional for this use case, no React 19 issues found |
| ComfyUI JSON parsing in TypeScript | HIGH | Official ComfyUI docs confirm the widget input vs link input distinction; existing codebase already parses this format |
| Backend zero new dependencies | HIGH | Verified against existing requirements.txt and package.json |
| Database schema (JSONB columns) | HIGH | Matches existing patterns in the project; Supabase supports JSONB natively |

---

## Sources

- [dnd-kit/core npm](https://www.npmjs.com/package/@dnd-kit/core) — Version 6.3.1, peerDeps verified
- [dnd-kit/sortable npm](https://www.npmjs.com/package/@dnd-kit/sortable) — Version 10.0.0, peerDeps require core@^6.3.0
- [dnd-kit React 19 Issue #1654](https://github.com/clauderic/dnd-kit/issues/1654) — React 19 issues are isolated to @dnd-kit/react (pre-1.0), not @dnd-kit/core v6
- [emoji-picker-react npm](https://www.npmjs.com/package/emoji-picker-react) — Version 4.18.0, last updated 2026-02-07
- [react-colorful GitHub](https://github.com/omgovich/react-colorful) — 2.8KB, no dependencies, React >=16.8.0
- [ComfyUI Datatypes Documentation](https://docs.comfy.org/custom-nodes/backend/datatypes) — STRING, INT, FLOAT, BOOLEAN, COMBO types with metadata (min, max, step, multiline)
- [ComfyUI Workflow JSON Spec](https://docs.comfy.org/specs/workflow_json) — API format structure, node/link distinction
- [ComfyUI GitHub Issue #1335](https://github.com/comfyanonymous/ComfyUI/issues/1335) — API format vs litegraph format differences, widgets_values array mapping challenge
- npm version checks run 2026-03-13 against live npm registry — all versions current

---
*Stack research for: sideOUTsticks v1.2 Workflow Builder*
*Researched: 2026-03-13*
