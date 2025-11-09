# Backend Tests

This directory contains all backend tests for the MultiTalk UI project.

## Quick Start

```bash
# Install dependencies
pip install -r requirements-dev.txt

# Run all tests
pytest

# Run with coverage
pytest --cov=services --cov=api --cov-report=html
```

## Test Structure

```
tests/
├── conftest.py                         # Shared fixtures
├── test_workflows_static.py            # Layer 1: Static validation
├── test_workflow_service.py            # Layer 2: Service unit tests
├── test_comfyui_api.py                 # Layer 3: API integration tests
├── workflows/                          # Layer 4: Workflow contracts
│   ├── CONTRACT_TEST_TEMPLATE.py       # Template for new workflows
│   ├── test_contract_videolipsync.py   # Example contract test
│   └── ... (one per workflow)
├── fixtures/                           # Test data
└── snapshots/                          # Test snapshots
```

## Test Layers

### Layer 1: Static Validation (`test_workflows_static.py`)
Validates workflow JSON files without execution.

**Run:** `pytest tests/test_workflows_static.py -v`

### Layer 2: Service Unit Tests (`test_workflow_service.py`)
Tests WorkflowService business logic in isolation.

**Run:** `pytest tests/test_workflow_service.py -v`

### Layer 3: API Integration (`test_comfyui_api.py`)
Tests API endpoints with mocked external services.

**Run:** `pytest tests/test_comfyui_api.py -v`

### Layer 4: Workflow Contracts (`workflows/`)
Defines and enforces contracts for each workflow.

**Run:** `pytest tests/workflows/ -v`

## Adding Tests for New Workflows

1. Copy the template:
   ```bash
   cp workflows/CONTRACT_TEST_TEMPLATE.py workflows/test_contract_myworkflow.py
   ```

2. Update the contract test:
   - Set `WORKFLOW_NAME`
   - Define `REQUIRED_PARAMS`
   - Define `VALID_TEST_PARAMS`

3. Run the test:
   ```bash
   pytest tests/workflows/test_contract_myworkflow.py -v
   ```

See [../../TESTING.md](../../TESTING.md) for complete guide.

## Useful Commands

```bash
# Run specific test
pytest tests/test_workflows_static.py::test_all_workflows_discovered -v

# Run with markers
pytest -m unit              # Unit tests only
pytest -m integration       # Integration tests only
pytest -m workflow          # Workflow tests only

# Stop on first failure
pytest -x

# Show local variables on failure
pytest -l

# Verbose output
pytest -v -s
```

## CI/CD

Tests run automatically on push via GitHub Actions.

See workflow: `.github/workflows/test.yml`
