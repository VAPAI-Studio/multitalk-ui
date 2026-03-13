# Phase 14: Foundation - Validation Strategy

**Created:** 2026-03-13

## Success Criteria → Test Map

| # | Success Criterion | Test Type | Automated Command | Pass Condition |
|---|-------------------|-----------|-------------------|----------------|
| SC-1 | Admin can POST API-format JSON to parse endpoint and receive structured nodes; UI-format rejected | integration | `cd backend && pytest tests/test_custom_workflow_api.py::TestParseEndpoint -v` | 200 with nodes for API format; 400 with guidance for UI format |
| SC-2 | Admin can CRUD custom workflow configs; non-admin gets 403 | integration | `cd backend && pytest tests/test_custom_workflow_api.py::TestCRUD tests/test_custom_workflow_api.py::TestAdminProtection -v` | All CRUD returns 200/201 for admin; 403 for non-admin |
| SC-3 | custom_workflows table exists with JSONB columns; templates saved to workflows/custom/ | unit + migration | `cd backend && pytest tests/test_custom_workflow_service.py::test_create_saves_template_file -v` | Table created via migration; file written to correct path |
| SC-4 | execute_dynamic_workflow function exists and delegates to WorkflowService + ComfyUIService | unit | `cd backend && pytest tests/test_custom_workflow_service.py::test_execute_dynamic_workflow -v` | Function calls build_workflow then submit_prompt; returns prompt_id |

## Requirement → Test Map

| Req ID | Behavior | Test File | Test Name Pattern | Automated? |
|--------|----------|-----------|-------------------|------------|
| STORE-01 | JSONB storage in custom_workflows | test_custom_workflow_service.py | test_create*, test_read*, test_update*, test_delete* | Yes |
| STORE-02 | Template file saved to workflows/custom/ | test_custom_workflow_service.py | test_save_template_file, test_create_saves_template | Yes |
| STORE-03 | CRUD API endpoints | test_custom_workflow_api.py | TestCRUD class | Yes |
| STORE-04 | Parse endpoint returns structured data | test_custom_workflow_api.py | TestParseEndpoint class | Yes |
| STORE-05 | Admin-only protection | test_custom_workflow_api.py | TestAdminProtection class | Yes |
| WB-01 | Upload JSON via API | test_custom_workflow_api.py | TestParseEndpoint::test_parse_valid_api_format | Yes |
| WB-02 | Detect & reject UI format | test_custom_workflow_service.py | test_detect_ui_format*, test_reject_ui_format | Yes |
| WB-03 | Parse nodes with class_type and inputs | test_custom_workflow_service.py | test_parse_nodes*, test_extract_class_type | Yes |
| WB-04 | Filter link arrays from configurable inputs | test_custom_workflow_service.py | test_filter_links*, test_is_link_input | Yes |
| TEST-04 | Shared execution function | test_custom_workflow_service.py | test_execute_dynamic_workflow* | Yes |

## Test Files to Create

1. **`backend/tests/test_custom_workflow_service.py`** — Unit tests (mocked Supabase)
   - Format detection (API/UI/unknown)
   - Node parsing with link filtering
   - CRUD operations via service layer
   - Template file operations
   - execute_dynamic_workflow delegation

2. **`backend/tests/test_custom_workflow_api.py`** — Integration tests (FastAPI TestClient)
   - Parse endpoint (valid API format, invalid UI format, malformed JSON)
   - CRUD endpoints (create, read, update, delete, list)
   - Admin protection (403 for non-admin)
   - Publish/unpublish toggle

## Sampling Strategy

- **Per task commit:** `cd backend && pytest tests/test_custom_workflow_service.py tests/test_custom_workflow_api.py -x`
- **Per wave merge:** `cd backend && pytest`
- **Phase gate:** Full suite green + manual verification of migration applied

## Manual Verification (Phase Gate)

- [ ] Migration 008 applied successfully to Supabase
- [ ] `backend/workflows/custom/` directory exists and is writable
- [ ] Parse endpoint returns correct node structure for a real ComfyUI workflow
- [ ] Non-admin user receives 403 on all write endpoints
