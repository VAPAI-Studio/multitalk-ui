"""
Integration tests for the execute endpoint.

Tests POST /api/custom-workflows/{workflow_id}/execute for:
- ComfyUI execution path (execution_backend='comfyui')
- RunPod execution path (execution_backend='runpod')
- 404 on unknown workflow
- 401 on unauthenticated request
- execute_dynamic_workflow_runpod service method builds workflow and posts to RunPod
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def auth_client():
    """TestClient with mocked authenticated user (non-admin)."""
    from main import app
    from core.auth import get_current_user

    mock_user = MagicMock()
    mock_user.id = "user-id-abc"
    mock_user.user_metadata = {}
    mock_user.app_metadata = {}

    app.dependency_overrides[get_current_user] = lambda: mock_user
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def unauthenticated_client():
    """TestClient without auth overrides (tests 401)."""
    from main import app

    app.dependency_overrides.clear()
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Sample Data
# ---------------------------------------------------------------------------

SAMPLE_WORKFLOW_ROW = {
    "id": "wf-uuid-execute-001",
    "name": "Test Execute Workflow",
    "slug": "test-wf",
    "description": "A test workflow for execution",
    "template_filename": "test-wf.json",
    "variable_config": [],
    "section_config": [],
    "output_type": "image",
    "icon": "⚡",
    "gradient": "from-blue-500 to-purple-600",
    "is_published": True,
    "created_at": "2026-03-14T00:00:00Z",
    "updated_at": "2026-03-14T00:00:00Z",
}

EXECUTE_PAYLOAD_COMFYUI = {
    "parameters": {"PROMPT": "a beautiful scene", "STEPS": 20},
    "base_url": "http://comfy.test",
    "client_id": "test-client-id-123",
    "execution_backend": "comfyui",
}

EXECUTE_PAYLOAD_RUNPOD = {
    "parameters": {"PROMPT": "a beautiful scene", "STEPS": 20},
    "execution_backend": "runpod",
}


# ---------------------------------------------------------------------------
# Test 1: ComfyUI execution returns 200 with prompt_id
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_execute_workflow_comfyui(auth_client):
    """POST /{workflow_id}/execute with execution_backend='comfyui' returns 200 with prompt_id."""
    with patch("api.custom_workflows.CustomWorkflowService") as MockService:
        instance = MockService.return_value
        instance.get = AsyncMock(return_value=SAMPLE_WORKFLOW_ROW)
        instance.execute_dynamic_workflow = AsyncMock(
            return_value=(True, "prompt-abc", None)
        )

        response = auth_client.post(
            "/api/custom-workflows/wf-uuid-execute-001/execute",
            json=EXECUTE_PAYLOAD_COMFYUI,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["prompt_id"] == "prompt-abc"
    assert data["execution_backend"] == "comfyui"
    assert data.get("error") is None


# ---------------------------------------------------------------------------
# Test 2: RunPod execution returns 200 with job_id
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_execute_workflow_runpod(auth_client):
    """POST /{workflow_id}/execute with execution_backend='runpod' returns 200 with job_id."""
    with patch("api.custom_workflows.CustomWorkflowService") as MockService:
        instance = MockService.return_value
        instance.get = AsyncMock(return_value=SAMPLE_WORKFLOW_ROW)
        instance.execute_dynamic_workflow_runpod = AsyncMock(
            return_value=(True, "runpod-job-123", None)
        )

        response = auth_client.post(
            "/api/custom-workflows/wf-uuid-execute-001/execute",
            json=EXECUTE_PAYLOAD_RUNPOD,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["prompt_id"] == "runpod-job-123"
    assert data["execution_backend"] == "runpod"
    assert data.get("error") is None


# ---------------------------------------------------------------------------
# Test 3: Unknown workflow returns 404
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_execute_workflow_not_found(auth_client):
    """POST /{workflow_id}/execute with unknown workflow_id returns 404."""
    with patch("api.custom_workflows.CustomWorkflowService") as MockService:
        instance = MockService.return_value
        instance.get = AsyncMock(return_value=None)

        response = auth_client.post(
            "/api/custom-workflows/nonexistent-workflow-id/execute",
            json=EXECUTE_PAYLOAD_COMFYUI,
        )

    assert response.status_code == 404
    data = response.json()
    assert "not found" in data["detail"].lower()


# ---------------------------------------------------------------------------
# Test 4: Unauthenticated request returns 401
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_execute_workflow_requires_auth(unauthenticated_client):
    """POST /{workflow_id}/execute without auth returns 401."""
    response = unauthenticated_client.post(
        "/api/custom-workflows/wf-uuid-execute-001/execute",
        json=EXECUTE_PAYLOAD_COMFYUI,
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Test 5: execute_dynamic_workflow_runpod service method
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_dynamic_workflow_runpod_service():
    """execute_dynamic_workflow_runpod builds workflow and posts to RunPod endpoint."""
    from services.custom_workflow_service import CustomWorkflowService
    from unittest.mock import AsyncMock, patch, MagicMock

    service = CustomWorkflowService.__new__(CustomWorkflowService)

    # Mock workflow_service to return a built workflow dict
    mock_workflow_service = MagicMock()
    mock_workflow_service.build_workflow = AsyncMock(
        return_value=(True, {"1": {"class_type": "TestNode", "inputs": {}}}, None)
    )
    service.workflow_service = mock_workflow_service

    # Mock RunPodService to return a job_id
    with patch("services.custom_workflow_service.RunPodService") as MockRunPod:
        mock_runpod = MockRunPod.return_value
        mock_runpod.submit_built_workflow = AsyncMock(
            return_value=(True, "runpod-job-abc", None)
        )

        success, job_id, error = await service.execute_dynamic_workflow_runpod(
            SAMPLE_WORKFLOW_ROW, {"PROMPT": "test"}
        )

    assert success is True
    assert job_id == "runpod-job-abc"
    assert error is None
    mock_workflow_service.build_workflow.assert_called_once_with(
        "custom/test-wf", {"PROMPT": "test"}
    )
    mock_runpod.submit_built_workflow.assert_called_once()
