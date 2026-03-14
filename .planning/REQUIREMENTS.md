# Requirements: sideOUTsticks

**Defined:** 2026-03-13
**Core Value:** Provide a unified platform for AI-powered media processing where users can generate, edit, upscale, and manage their content end-to-end

## v1.2 Requirements

Requirements for Workflow Builder milestone. Each maps to roadmap phases.

### Workflow Builder

- [x] **WB-01**: Admin can upload a ComfyUI workflow JSON file via drag-and-drop or file picker
- [x] **WB-02**: System detects API vs UI format and rejects UI format with guidance to export API format
- [x] **WB-03**: System parses workflow JSON and displays all nodes with class_type and inputs in a node inspector
- [x] **WB-04**: System filters out node-to-node link arrays from configurable input candidates
- [x] **WB-05**: Admin can select which node inputs become user-facing variables by clicking them
- [x] **WB-06**: System auto-detects suggested field types from ComfyUI metadata (BOOLEAN→toggle, COMBO→select, STRING→text, INT/FLOAT→number)
- [x] **WB-07**: Admin can optionally enrich node metadata via ComfyUI `/object_info` endpoint

### Dependency Check

- [x] **DEP-01**: System extracts all custom node class_types from the uploaded workflow
- [x] **DEP-02**: System looks up custom node package names from ComfyUI registry by class_type
- [x] **DEP-03**: System checks the current Dockerfile for which custom node packages are already installed
- [x] **DEP-04**: Admin can add missing custom node packages to the Dockerfile with one click

### Model Check

- [x] **MDL-01**: System extracts all model filenames referenced in the workflow (checkpoints, LoRAs, VAEs, controlnets)
- [x] **MDL-02**: System checks which models exist on the RunPod network volume via S3 listing
- [x] **MDL-03**: Admin sees a list of models with present/missing status indicators

### Variable Configuration

- [x] **VAR-01**: Admin can set display label, placeholder text, and help text for each variable
- [x] **VAR-02**: Admin can choose UI input type: text, textarea, number, slider, file-image, file-audio, file-video, dropdown, toggle, resolution
- [x] **VAR-03**: Admin can set default values, min/max (for numbers/sliders), and step size
- [x] **VAR-04**: Admin can set validation rules: required, file type accept filters, file size limits
- [x] **VAR-05**: System maps each variable to its `{{PLACEHOLDER_KEY}}` in the workflow template with visual indicator
- [x] **VAR-06**: Admin can specify file handling mode per file variable: upload to ComfyUI or base64 encode
- [x] **VAR-07**: Admin can reorder variables via drag-and-drop
- [x] **VAR-08**: Admin can organize variables into named sections

### Feature Metadata

- [x] **META-01**: Admin can set feature name, auto-generated slug (editable), and description
- [x] **META-02**: Admin can assign feature to any existing studio (Lipsync, Image, Video, Audio, Virtual Set, LoRA)
- [x] **META-03**: Admin can specify output type: image, video, or audio
- [x] **META-04**: Admin can pick an icon (emoji) and gradient colors for the feature card
- [x] **META-05**: Admin can enable or disable a published feature (disabled hides from non-admins)

### Testing

- [ ] **TEST-01**: Admin can fill in test values for all configured variables in the builder
- [ ] **TEST-02**: Admin can execute a test run against the ComfyUI server with real-time progress
- [ ] **TEST-03**: Test output (image/video/audio) displays inline in the builder
- [x] **TEST-04**: Test run uses the exact same code path as the published feature (shared execution function)

### Dynamic Rendering

- [ ] **DYN-01**: Published custom workflows appear in their assigned studio's navigation
- [ ] **DYN-02**: Published custom workflows appear on the Homepage within their studio card
- [ ] **DYN-03**: A DynamicWorkflowPage component renders the configured form with sections, inputs, and validation
- [ ] **DYN-04**: Dynamic page handles file uploads (upload to ComfyUI and/or base64) per variable config
- [ ] **DYN-05**: Dynamic page integrates with job tracking and monitoring (createJob, startJobMonitoring)
- [ ] **DYN-06**: Dynamic page includes feed sidebar with correct pageContext filtering
- [ ] **DYN-07**: Dynamic features work with both ComfyUI and RunPod execution backends

### Storage & API

- [x] **STORE-01**: Custom workflow configs stored in Supabase `custom_workflows` table with JSONB columns
- [x] **STORE-02**: Workflow template files saved to `backend/workflows/custom/` directory
- [x] **STORE-03**: Backend CRUD API (create, read, update, delete, list, publish/unpublish) at `/api/custom-workflows/`
- [x] **STORE-04**: Workflow parsing endpoint accepts ComfyUI JSON and returns structured node/input data
- [x] **STORE-05**: All custom workflow API endpoints are admin-only
- [ ] **STORE-06**: Frontend fetches published custom workflows on app load and merges into navigation

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Workflow Builder v2

- **WB-V2-01**: Conditional field logic (show/hide field based on another field's value)
- **WB-V2-02**: Custom CSS/theming per dynamic feature page
- **WB-V2-03**: Workflow configuration versioning with rollback
- **WB-V2-04**: Automatic model download button for missing models (HuggingFace integration)
- **WB-V2-05**: Workflow template storage in Supabase (for Heroku ephemeral filesystem)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Visual node-graph editor | Far too complex; admin uses ComfyUI itself for workflow design |
| Public workflow marketplace | Multi-tenant concern; admin-only for v1.2 |
| Non-admin workflow creation | Security and complexity; admin-only |
| Custom CSS per dynamic page | All dynamic pages use the same design system |
| Automatic input type detection without admin review | Admin must always confirm field types for safety |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WB-01 | Phase 14 | Complete |
| WB-02 | Phase 14 | Complete |
| WB-03 | Phase 14 | Complete |
| WB-04 | Phase 14 | Complete |
| WB-05 | Phase 15 | Complete |
| WB-06 | Phase 15 | Complete |
| WB-07 | Phase 15 | Complete |
| DEP-01 | Phase 15 | Complete |
| DEP-02 | Phase 15 | Complete |
| DEP-03 | Phase 15 | Complete |
| DEP-04 | Phase 15 | Complete |
| MDL-01 | Phase 15 | Complete |
| MDL-02 | Phase 15 | Complete |
| MDL-03 | Phase 15 | Complete |
| VAR-01 | Phase 15 | Complete |
| VAR-02 | Phase 15 | Complete |
| VAR-03 | Phase 15 | Complete |
| VAR-04 | Phase 15 | Complete |
| VAR-05 | Phase 15 | Complete |
| VAR-06 | Phase 15 | Complete |
| VAR-07 | Phase 15 | Complete |
| VAR-08 | Phase 15 | Complete |
| META-01 | Phase 15 | Complete |
| META-02 | Phase 15 | Complete |
| META-03 | Phase 15 | Complete |
| META-04 | Phase 15 | Complete |
| META-05 | Phase 15 | Complete |
| TEST-01 | Phase 16 | Pending |
| TEST-02 | Phase 16 | Pending |
| TEST-03 | Phase 16 | Pending |
| TEST-04 | Phase 14 | Complete |
| DYN-01 | Phase 17 | Pending |
| DYN-02 | Phase 17 | Pending |
| DYN-03 | Phase 16 | Pending |
| DYN-04 | Phase 16 | Pending |
| DYN-05 | Phase 16 | Pending |
| DYN-06 | Phase 17 | Pending |
| DYN-07 | Phase 16 | Pending |
| STORE-01 | Phase 14 | Complete |
| STORE-02 | Phase 14 | Complete |
| STORE-03 | Phase 14 | Complete |
| STORE-04 | Phase 14 | Complete |
| STORE-05 | Phase 14 | Complete |
| STORE-06 | Phase 17 | Pending |

**Coverage:**
- v1.2 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0

---
*Requirements defined: 2026-03-13*
*Last updated: 2026-03-13 after roadmap creation*
