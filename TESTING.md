# Testing Guide

This document describes the testing strategy and practices for the MultiTalk UI project.

## Table of Contents

- [Overview](#overview)
- [Testing Layers](#testing-layers)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Workflow Testing](#workflow-testing)
- [CI/CD Integration](#cicd-integration)
- [Test Coverage](#test-coverage)

## Overview

The MultiTalk UI uses a comprehensive multi-layered testing strategy to ensure code quality and prevent regressions.

### Testing Philosophy

1. **Test workflows as contracts** - Each workflow has a defined contract that must be maintained
2. **Catch errors early** - Static validation before runtime testing
3. **Test in isolation** - Unit tests don't depend on external services
4. **Integration matters** - API tests verify the complete flow
5. **Automate everything** - CI/CD runs all tests automatically

### Test Stack

**Backend:**
- **pytest** - Test framework
- **pytest-asyncio** - Async test support
- **pytest-cov** - Code coverage
- **pytest-mock** - Mocking utilities

**Frontend:**
- **Vitest** - Test framework (planned)
- **@testing-library/react** - Component testing (planned)

## Testing Layers

Our testing strategy follows a pyramid approach with multiple layers:

```
           ┌─────────────────┐
           │   E2E Tests     │  (Future)
           └─────────────────┘
         ┌────────────────────┐
         │ Integration Tests  │
         └────────────────────┘
       ┌──────────────────────────┐
       │   Contract Tests         │
       └──────────────────────────┘
     ┌────────────────────────────────┐
     │     Unit Tests                 │
     └────────────────────────────────┘
   ┌──────────────────────────────────────┐
   │      Static Validation               │
   └──────────────────────────────────────┘
```

### Layer 1: Static Workflow Validation

**File:** `backend/tests/test_workflows_static.py`

**Purpose:** Validate workflow JSON files without executing them.

**What it tests:**
- Valid JSON syntax
- Required node fields (`class_type`, `inputs`)
- Output nodes exist
- Placeholder format (must be `{{PARAM_NAME}}`)
- No orphaned node references
- No duplicate workflow names

**Run with:**
```bash
cd backend
pytest tests/test_workflows_static.py -v
```

### Layer 2: Workflow Service Unit Tests

**File:** `backend/tests/test_workflow_service.py`

**Purpose:** Test WorkflowService business logic in isolation.

**What it tests:**
- Template loading (success/failure)
- Parameter substitution (strings, numbers, booleans)
- Workflow validation
- Parameter extraction
- Special character escaping

**Run with:**
```bash
cd backend
pytest tests/test_workflow_service.py -v
```

### Layer 3: API Integration Tests

**File:** `backend/tests/test_comfyui_api.py`

**Purpose:** Test API endpoints with mocked external services.

**What it tests:**
- POST `/comfyui/submit-workflow`
- GET `/comfyui/workflows`
- GET `/comfyui/workflows/{name}/parameters`
- Error handling
- Request/response formats

**Run with:**
```bash
cd backend
pytest tests/test_comfyui_api.py -v
```

### Layer 4: Workflow Contract Tests

**Files:** `backend/tests/workflows/test_contract_*.py`

**Purpose:** Define and enforce workflow contracts.

**What it tests per workflow:**
- Required parameters match template
- Builds successfully with valid params
- No unsubstituted placeholders
- Passes validation
- Has output node
- Workflow-specific requirements

**Example:** [test_contract_videolipsync.py](backend/tests/workflows/test_contract_videolipsync.py)

**Run with:**
```bash
cd backend
pytest tests/workflows/ -v
```

## Running Tests

### Setup

1. **Install dependencies:**

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

2. **Verify installation:**

```bash
pytest --version
```

### Run All Tests

```bash
cd backend
pytest
```

### Run Specific Test Layers

```bash
# Static validation only
pytest tests/test_workflows_static.py

# Service unit tests only
pytest tests/test_workflow_service.py

# API integration tests only
pytest tests/test_comfyui_api.py

# Workflow contract tests only
pytest tests/workflows/

# Specific workflow contract
pytest tests/workflows/test_contract_videolipsync.py
```

### Run with Coverage

```bash
cd backend
pytest --cov=services --cov=api --cov-report=html
```

View coverage report:
```bash
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

### Run with Markers

```bash
# Run only unit tests
pytest -m unit

# Run only integration tests
pytest -m integration

# Run only workflow tests
pytest -m workflow

# Exclude slow tests
pytest -m "not slow"
```

### Verbose Output

```bash
# Show test names and results
pytest -v

# Show full output (don't capture stdout)
pytest -s

# Show local variables on failure
pytest -l

# Stop on first failure
pytest -x
```

## Writing Tests

### General Guidelines

1. **Follow naming conventions:**
   - Test files: `test_*.py`
   - Test classes: `Test*`
   - Test functions: `test_*`

2. **Use descriptive names:**
   ```python
   # Good
   def test_build_workflow_with_valid_params():
       pass

   # Bad
   def test_workflow():
       pass
   ```

3. **Arrange-Act-Assert pattern:**
   ```python
   def test_something():
       # Arrange
       service = WorkflowService()
       params = {...}

       # Act
       result = service.do_something(params)

       # Assert
       assert result.success is True
   ```

4. **One assertion per test (when possible):**
   ```python
   # Good - focused test
   def test_workflow_loads_successfully():
       success, workflow, error = await service.load_template("Test")
       assert success is True

   def test_workflow_returns_dict():
       success, workflow, error = await service.load_template("Test")
       assert isinstance(workflow, dict)

   # Also acceptable for related assertions
   def test_workflow_load_failure():
       success, workflow, error = await service.load_template("Missing")
       assert success is False
       assert workflow is None
       assert error is not None
   ```

### Using Fixtures

Fixtures are defined in `backend/tests/conftest.py`:

```python
def test_something(workflow_service, sample_params):
    # workflow_service and sample_params are automatically provided
    success, workflow, _ = await workflow_service.build_workflow(
        "MyWorkflow",
        sample_params
    )
    assert success is True
```

### Async Tests

Use `@pytest.mark.asyncio` for async functions:

```python
@pytest.mark.asyncio
async def test_async_function():
    result = await some_async_function()
    assert result is not None
```

### Mocking External Services

```python
from unittest.mock import patch, AsyncMock

def test_with_mock(client):
    with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock:
        mock.return_value = (True, "prompt-123", None)

        response = client.post("/comfyui/submit-workflow", json={...})

        assert response.status_code == 200
        mock.assert_called_once()
```

## Workflow Testing

### Adding a New Workflow

When adding a new workflow, follow these steps:

1. **Create the workflow JSON:**
   ```bash
   # Add your workflow
   backend/workflows/MyNewWorkflow.json
   ```

2. **Extract required parameters:**
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

3. **Create contract test:**
   ```bash
   # Copy the template
   cp backend/tests/workflows/CONTRACT_TEST_TEMPLATE.py \
      backend/tests/workflows/test_contract_mynewworkflow.py
   ```

4. **Update the contract test:**
   - Set `WORKFLOW_NAME = "MyNewWorkflow"`
   - Set `REQUIRED_PARAMS` with parameters from step 2
   - Set `VALID_TEST_PARAMS` with appropriate test values

5. **Run the tests:**
   ```bash
   pytest backend/tests/workflows/test_contract_mynewworkflow.py -v
   ```

6. **Fix any failures** until all tests pass.

### Workflow Testing Checklist

- [ ] Workflow JSON file exists in `backend/workflows/`
- [ ] Workflow has valid JSON syntax
- [ ] All nodes have `class_type` and `inputs`
- [ ] Workflow has at least one output node
- [ ] Contract test created
- [ ] Required parameters documented in contract test
- [ ] Valid test parameters defined
- [ ] All contract tests pass
- [ ] Static validation tests pass

## CI/CD Integration

### GitHub Actions

Tests run automatically on:
- Every push to `main`, `dev`, or `feature/*` branches
- Every pull request to `main` or `dev`

**Workflow file:** `.github/workflows/test.yml`

**Jobs:**
1. **backend-tests** - Runs all backend tests with coverage
2. **frontend-tests** - Runs linting and build
3. **test-summary** - Aggregates results

### Viewing Test Results

1. Go to **Actions** tab on GitHub
2. Click on the latest workflow run
3. View job logs and test results

### Coverage Reports

Coverage reports are automatically uploaded to Codecov (if configured).

View coverage badge in README:
```markdown
![Coverage](https://codecov.io/gh/your-org/multitalk-ui/branch/main/graph/badge.svg)
```

## Test Coverage

### Current Coverage Goals

- **Workflow Service:** 90%+
- **API Endpoints:** 80%+
- **Workflow Files:** 100% (all must have contract tests)

### Checking Coverage

```bash
cd backend
pytest --cov=services --cov=api --cov-report=term-missing
```

Example output:
```
---------- coverage: platform darwin, python 3.11.0 -----------
Name                              Stmts   Miss  Cover   Missing
---------------------------------------------------------------
services/workflow_service.py         89      5    94%   45-47
api/comfyui.py                       67      8    88%   102-105, 134-137
---------------------------------------------------------------
TOTAL                               156     13    92%
```

### Improving Coverage

Focus on:
1. Untested error paths
2. Edge cases
3. Input validation
4. Exception handling

## Troubleshooting

### Tests Fail Due to Missing Dependencies

```bash
# Reinstall dev dependencies
cd backend
pip install -r requirements-dev.txt
```

### Import Errors

Make sure Python path includes backend directory:
```bash
cd backend
export PYTHONPATH=$PYTHONPATH:$(pwd)
pytest
```

### Async Tests Not Running

Ensure `pytest-asyncio` is installed and `pytest.ini` is configured:
```ini
[pytest]
asyncio_mode = auto
```

### Tests Pass Locally but Fail in CI

1. Check Python version matches (3.11)
2. Verify all dependencies in `requirements-dev.txt`
3. Check for environment-specific paths

## Best Practices

1. **Write tests first** (TDD) when adding new workflows
2. **Run tests before committing** to catch issues early
3. **Keep tests fast** - mock external services
4. **Test edge cases** - empty inputs, special characters, etc.
5. **Update tests when changing workflows** - maintain contracts
6. **Use descriptive assertions** - make failures easy to understand
7. **Don't test implementation details** - test behavior
8. **Keep tests independent** - no shared state between tests

## Future Enhancements

- [ ] Frontend unit tests with Vitest
- [ ] E2E tests with Playwright
- [ ] Performance testing
- [ ] Load testing for API endpoints
- [ ] Mutation testing with `mutmut`
- [ ] Contract testing with Pact

## Resources

- [pytest documentation](https://docs.pytest.org/)
- [FastAPI testing docs](https://fastapi.tiangolo.com/tutorial/testing/)
- [pytest-asyncio docs](https://pytest-asyncio.readthedocs.io/)
- [Testing Best Practices](https://testdriven.io/blog/modern-frontend-testing-with-cypress/)

---

**Last Updated:** 2025-01-09
