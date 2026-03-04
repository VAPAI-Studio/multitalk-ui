# Testing Patterns

**Analysis Date:** 2025-03-04

## Test Framework

**Runner:**
- pytest 7.4.0
- Config: `backend/pytest.ini`
- Async support: pytest-asyncio 0.21.0 with `asyncio_mode = auto`

**Assertion Library:**
- pytest built-in assertions (no external assertion library)

**Run Commands:**
```bash
cd backend
pytest                              # Run all tests
pytest -v                          # Verbose output with test names
pytest --cov=services --cov=api    # With coverage
pytest -m unit                     # Run unit tests only
pytest -m integration              # Run integration tests only
pytest -m workflow                 # Run workflow contract tests only
pytest tests/test_workflows_static.py  # Static workflow validation
pytest tests/test_workflow_service.py   # Service unit tests
pytest tests/test_comfyui_api.py        # API integration tests
pytest tests/workflows/                 # Workflow contract tests
pytest -x                          # Stop on first failure
pytest -s                          # Show stdout (don't capture)
```

## Test File Organization

**Location:**
- Separate from source code in `backend/tests/` directory
- Mirrored structure matches functionality being tested

**Naming:**
- Test files: `test_*.py` (e.g., `test_workflow_service.py`)
- Test classes: `Test*` (e.g., `TestWorkflowServiceLoad`)
- Test functions: `test_*` (e.g., `test_load_existing_workflow`)

**Structure:**
```
backend/tests/
├── conftest.py                      # Shared fixtures
├── test_workflows_static.py         # Layer 1: Static validation
├── test_workflow_service.py         # Layer 2: Service unit tests
├── test_comfyui_api.py             # Layer 3: API integration tests
└── workflows/
    ├── __init__.py
    ├── CONTRACT_TEST_TEMPLATE.py    # Template for contract tests
    └── test_contract_videolipsync.py # Layer 4: Workflow contract
```

## Test Structure

**Multi-Layer Testing Pyramid:**

```
           ┌─────────────────┐
           │   Contract      │  Layer 4: Workflow-specific contracts
           │   Tests         │
         ┌─────────────────────┐
         │   Integration       │  Layer 3: API endpoints
         │   Tests             │
       ┌─────────────────────────┐
       │   Unit Tests            │  Layer 2: Service logic
       └─────────────────────────┘
     ┌───────────────────────────────┐
     │   Static Validation           │  Layer 1: JSON/syntax validation
     └───────────────────────────────┘
```

**Markers Used:**
- `@pytest.mark.unit` - Unit tests (isolated components)
- `@pytest.mark.integration` - Integration tests (with FastAPI TestClient)
- `@pytest.mark.workflow` - Workflow contract tests
- `@pytest.mark.slow` - Slow-running tests (marked separately)
- `@pytest.mark.asyncio` - Async test functions

**Fixture Pattern:**

`backend/tests/conftest.py` provides shared fixtures:
```python
@pytest.fixture
def workflow_service():
    """Provide a WorkflowService instance"""
    from services.workflow_service import WorkflowService
    return WorkflowService()

@pytest.fixture
def workflows_dir():
    """Provide path to workflows directory"""
    return Path(__file__).parent.parent / "workflows"

@pytest.fixture
def sample_params():
    """Provide sample parameters for testing"""
    return {
        "VIDEO_FILENAME": "test_video.mp4",
        "AUDIO_FILENAME": "test_audio.wav",
        # ... more params
    }
```

## Test Structure Patterns

### Layer 1: Static Workflow Validation

**File:** `backend/tests/test_workflows_static.py`

**Purpose:** Validate workflow JSON files without executing them.

**Pattern:**
```python
@pytest.mark.unit
@pytest.mark.parametrize("workflow_name", [
    "VideoLipsync",
    "WANI2V",
    "MultiTalkMultiplePeople"
])
class TestWorkflowStaticValidation:
    """Static validation tests for all workflows"""

    def test_workflow_file_exists(self, workflows_dir, workflow_name):
        """Test that workflow JSON file exists"""
        workflow_path = workflows_dir / f"{workflow_name}.json"
        assert workflow_path.exists()

    def test_workflow_is_valid_json(self, workflows_dir, workflow_name):
        """Test that workflow file contains valid JSON"""
        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)
        assert isinstance(workflow, dict)
```

**What it Tests:**
- Valid JSON syntax
- Required node fields (`class_type`, `inputs`)
- Output nodes exist (SaveImage, SaveVideo, etc.)
- Placeholder format validity (`{{PARAM_NAME}}`)
- Node structure integrity

### Layer 2: Service Unit Tests

**File:** `backend/tests/test_workflow_service.py`

**Purpose:** Test WorkflowService business logic in isolation.

**Pattern:**
```python
@pytest.mark.unit
@pytest.mark.asyncio
class TestWorkflowServiceLoad:
    """Tests for workflow loading functionality"""

    async def test_load_existing_workflow(self, workflow_service):
        """Test loading an existing workflow succeeds"""
        success, workflow, error = await workflow_service.load_template("VideoLipsync")

        assert success is True
        assert workflow is not None
        assert error is None
```

**What it Tests:**
- Template loading (success/failure paths)
- Parameter substitution (strings, numbers, booleans)
- Workflow validation logic
- Parameter extraction from templates
- Special character escaping

### Layer 3: API Integration Tests

**File:** `backend/tests/test_comfyui_api.py`

**Purpose:** Test API endpoints with mocked external services.

**Pattern:**
```python
@pytest.mark.integration
class TestSubmitWorkflowEndpoint:
    """Tests for POST /comfyui/submit-workflow endpoint"""

    def test_submit_workflow_success(self, client):
        """Test successful workflow submission"""
        with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
            mock_submit.return_value = (True, "prompt-id-123", None)

            response = client.post("/api/comfyui/submit-workflow", json={
                "workflow_name": "VideoLipsync",
                "parameters": {...},
                "client_id": "test-client",
                "base_url": "http://comfy.test"
            })

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            mock_submit.assert_called_once()
```

**Key Features:**
- Uses FastAPI's `TestClient` for endpoint testing
- External services mocked with `unittest.mock.patch()`
- Tests both success and error paths
- Verifies response model structure

### Layer 4: Workflow Contract Tests

**File:** `backend/tests/workflows/test_contract_videolipsync.py`

**Purpose:** Define and enforce workflow contracts.

**Pattern:**
```python
@pytest.mark.workflow
@pytest.mark.asyncio
class TestVideoLipsyncContract:
    """Contract tests for VideoLipsync workflow"""

    WORKFLOW_NAME = "VideoLipsync"

    REQUIRED_PARAMS = {
        "VIDEO_FILENAME",
        "AUDIO_FILENAME",
        "WIDTH",
        "HEIGHT",
        # ...
    }

    VALID_TEST_PARAMS = {
        "VIDEO_FILENAME": "test_video.mp4",
        "AUDIO_FILENAME": "test_audio.wav",
        # ...
    }

    async def test_all_parameters_documented(self, workflow_service):
        """Test that all documented parameters are actually used"""
        success, params, error = await workflow_service.get_template_parameters(
            self.WORKFLOW_NAME
        )
        assert set(params) == self.REQUIRED_PARAMS

    async def test_builds_with_valid_params(self, workflow_service):
        """Test that workflow builds successfully"""
        success, workflow, error = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            self.VALID_TEST_PARAMS
        )
        assert success is True
```

**What it Tests per Workflow:**
- Required parameters match template
- Builds successfully with valid params
- No unsubstituted placeholders remain
- Passes validation
- Has output node
- Has required input nodes
- Parameter types are correct
- Handles edge cases (special chars, quotes)

## Mocking

**Framework:** unittest.mock

**Patterns:**

```python
# Mock function return value
with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
    mock_submit.return_value = (True, "prompt-id-123", None)
    # ... test code ...
    mock_submit.assert_called_once()

# Mock async function
with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
    mock_submit.return_value = AsyncMock(return_value=(True, "id", None))

# Verify arguments
mock_submit.assert_called_with(base_url, prompt, client_id)

# Check call count
assert mock_submit.call_count == 1
```

**What to Mock:**
- External API calls (ComfyUI, Supabase)
- File I/O operations
- Network requests
- Services that aren't being tested in isolation

**What NOT to Mock:**
- The service/function being tested
- JSON operations
- Basic data structure operations
- Core application logic

## Test Data & Fixtures

**Sample Parameters Fixture:**
```python
@pytest.fixture
def sample_params():
    """Provide sample parameters for testing"""
    return {
        "VIDEO_FILENAME": "test_video.mp4",
        "AUDIO_FILENAME": "test_audio.wav",
        "IMAGE_FILENAME": "test_image.png",
        "WIDTH": 640,
        "HEIGHT": 360,
        "CUSTOM_PROMPT": "test prompt",
    }
```

**Fixtures Used:**
- `workflow_service` - WorkflowService instance
- `workflows_dir` - Path to workflows directory
- `all_workflow_names` - List of all workflow names
- `sample_params` - Dictionary of test parameters
- `client` - FastAPI TestClient for endpoint testing

**Test Data Pattern:**
Each workflow contract test defines `VALID_TEST_PARAMS` that represents a complete, valid parameter set for that workflow.

## Coverage

**Requirements:**
- No explicit coverage threshold enforced
- Coverage reports generated with `pytest --cov`

**View Coverage:**
```bash
cd backend
pytest --cov=services --cov=api --cov-report=html
# Coverage HTML report in htmlcov/index.html
```

**Coverage Goals (recommended):**
- Workflow Service: 90%+
- API Endpoints: 80%+
- Workflow Files: 100% (all must have contract tests)

## Test Types

**Unit Tests:**
- Scope: Single function/method in isolation
- Dependencies: Mocked or injected
- File location: `test_workflow_service.py`
- Markers: `@pytest.mark.unit`
- Example: Testing `WorkflowService.build_workflow()` with various parameter types

**Integration Tests:**
- Scope: API endpoint with service layer
- Dependencies: Partially mocked (ComfyUI service mocked, WorkflowService real)
- File location: `test_comfyui_api.py`
- Markers: `@pytest.mark.integration`
- Example: Testing POST `/api/comfyui/submit-workflow` endpoint

**Contract Tests:**
- Scope: Single workflow definition
- Dependencies: Real WorkflowService
- File location: `tests/workflows/test_contract_*.py`
- Markers: `@pytest.mark.workflow`, `@pytest.mark.asyncio`
- Example: `TestVideoLipsyncContract` validates VideoLipsync.json structure

## Async Testing

**Pattern:**
```python
@pytest.mark.asyncio
async def test_async_function(self, workflow_service):
    """Test async function"""
    success, result, error = await workflow_service.load_template("Test")
    assert success is True
```

**Key Points:**
- All async test functions must have `@pytest.mark.asyncio` decorator
- Async fixture setup/teardown supported (not currently used)
- `asyncio_mode = auto` in pytest.ini enables automatic async detection

## Error Testing

**Pattern:**
```python
async def test_load_nonexistent_workflow(self, workflow_service):
    """Test loading non-existent workflow returns error"""
    success, workflow, error = await workflow_service.load_template("NonExistentWorkflow")

    assert success is False
    assert workflow is None
    assert error is not None
    assert "not found" in error.lower()
```

**Approach:**
- Test both success and failure paths
- Verify error messages contain helpful information
- Check error flags (success=False) set correctly
- Use lowercase in error string assertions for case-insensitive matching

## Common Test Patterns

### Parametrized Tests
```python
@pytest.mark.parametrize("workflow_name", [
    "VideoLipsync",
    "WANI2V",
    "MultiTalkMultiplePeople"
])
def test_workflow_file_exists(self, workflows_dir, workflow_name):
    # Test runs once for each workflow_name
```

### Class-Based Tests
```python
@pytest.mark.unit
class TestWorkflowServiceLoad:
    async def test_load_existing_workflow(self, workflow_service):
        # Shared setup via class and fixtures
```

### Arrange-Act-Assert
```python
async def test_build_workflow(self, workflow_service):
    # Arrange
    params = {"VIDEO_FILENAME": "test.mp4", ...}

    # Act
    success, workflow, error = await workflow_service.build_workflow("VideoLipsync", params)

    # Assert
    assert success is True
```

## Testing Workflows

### Adding a New Workflow Test

1. **Create contract test:**
   ```bash
   cp backend/tests/workflows/CONTRACT_TEST_TEMPLATE.py \
      backend/tests/workflows/test_contract_mynewworkflow.py
   ```

2. **Update the contract test:**
   ```python
   WORKFLOW_NAME = "MyNewWorkflow"

   REQUIRED_PARAMS = {
       "PARAM_1",
       "PARAM_2",
       # ...
   }

   VALID_TEST_PARAMS = {
       "PARAM_1": "value1",
       "PARAM_2": 123,
       # ...
   }
   ```

3. **Extract required parameters:**
   ```bash
   cd backend
   python -c "
   import asyncio
   from services.workflow_service import WorkflowService
   ws = WorkflowService()
   success, params, _ = asyncio.run(ws.get_template_parameters('MyNewWorkflow'))
   print('Required parameters:', sorted(params))
   "
   ```

4. **Run the tests:**
   ```bash
   pytest backend/tests/workflows/test_contract_mynewworkflow.py -v
   ```

### Workflow Testing Checklist
- [ ] Workflow JSON file exists in `backend/workflows/`
- [ ] Workflow has valid JSON syntax
- [ ] All nodes have `class_type` and `inputs`
- [ ] Workflow has at least one output node
- [ ] Contract test created with `REQUIRED_PARAMS`
- [ ] Contract test created with `VALID_TEST_PARAMS`
- [ ] All contract tests pass
- [ ] Static validation tests pass

## Frontend Testing

**Status:** No automated frontend tests currently in place

**Planned (from TESTING.md in project docs):**
- Vitest as test runner
- @testing-library/react for component testing
- E2E tests with Playwright

**Current Approach:**
- Manual testing via browser dev server
- PropTypes or TypeScript for type safety
- ESLint for static validation

## CI/CD Integration

**Status:** Test infrastructure in place, CI/CD setup documented

**How to Run Tests Locally:**
```bash
cd backend
pip install -r requirements-dev.txt
pytest                              # Run all tests
pytest --cov=services --cov=api     # With coverage
```

**GitHub Actions (Planned):**
- Tests should run on: push to main/dev, pull requests
- Jobs: backend-tests, frontend-tests, test-summary
- Coverage reports uploaded to Codecov (if configured)

## Troubleshooting

**Tests fail due to missing dependencies:**
```bash
cd backend
pip install -r requirements-dev.txt
```

**Import errors:**
```bash
cd backend
export PYTHONPATH=$PYTHONPATH:$(pwd)
pytest
```

**Async tests not running:**
- Verify `asyncio_mode = auto` in `pytest.ini`
- Ensure `@pytest.mark.asyncio` decorator present
- Install pytest-asyncio: `pip install pytest-asyncio>=0.21.0`

**Fixtures not found:**
- Verify fixture defined in `backend/tests/conftest.py`
- Check fixture is in correct scope (usually `function`)
- Ensure conftest.py is in correct directory

## Best Practices

1. **Write tests first** (TDD) when adding new workflows
2. **Run tests before committing** to catch issues early
3. **Keep tests fast** - mock external services
4. **Test edge cases** - empty inputs, special characters, etc.
5. **Update tests when changing workflows** - maintain contracts
6. **Use descriptive assertions** - make failures easy to understand
7. **Don't test implementation details** - test behavior
8. **Keep tests independent** - no shared state between tests
9. **One responsibility per test** - focused, single-purpose tests
10. **Clear, descriptive test names** - understand intent from name

## Future Enhancements

- [ ] Frontend unit tests with Vitest
- [ ] E2E tests with Playwright
- [ ] Performance testing
- [ ] Load testing for API endpoints
- [ ] Mutation testing with `mutmut`
- [ ] Contract testing with Pact
- [ ] Enforce code coverage thresholds (CI-gated)

---

*Testing analysis: 2025-03-04*
