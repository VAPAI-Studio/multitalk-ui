"""
Layer 3: API integration tests

These tests validate the ComfyUI API endpoints using FastAPI's TestClient.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def client():
    """Provide FastAPI test client"""
    # Import here to avoid circular imports
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).parent.parent
    sys.path.insert(0, str(backend_dir))

    from main import app
    return TestClient(app)


@pytest.mark.integration
class TestSubmitWorkflowEndpoint:
    """Tests for POST /comfyui/submit-workflow endpoint"""

    def test_submit_workflow_success(self, client):
        """Test successful workflow submission"""
        with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
            # Mock successful ComfyUI response
            mock_submit.return_value = (True, "prompt-id-123", None)

            response = client.post("/api/comfyui/submit-workflow", json={
                "workflow_name": "VideoLipsync",
                "parameters": {
                    "VIDEO_FILENAME": "test.mp4",
                    "AUDIO_FILENAME": "test.wav",
                    "WIDTH": 640,
                    "HEIGHT": 360,
                    "AUDIO_SCALE": 1.0,
                    "AUDIO_START_TIME": 0,
                    "AUDIO_END_TIME": 10,
                    "CUSTOM_PROMPT": "test prompt"
                },
                "client_id": "test-client-123",
                "base_url": "http://comfy.test"
            })

            assert response.status_code == 200
            data = response.json()

            assert data["success"] is True
            assert data["prompt_id"] == "prompt-id-123"
            assert data["workflow_name"] == "VideoLipsync"
            assert data["error"] is None

            # Verify ComfyUI service was called
            mock_submit.assert_called_once()

    def test_submit_workflow_nonexistent(self, client):
        """Test submitting non-existent workflow"""
        response = client.post("/api/comfyui/submit-workflow", json={
            "workflow_name": "NonExistentWorkflow",
            "parameters": {},
            "client_id": "test-client",
            "base_url": "http://comfy.test"
        })

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is False
        assert data["error"] is not None
        assert "not found" in data["error"].lower() or "failed to build" in data["error"].lower()

    def test_submit_workflow_missing_parameters(self, client):
        """Test submitting workflow with missing required parameters"""
        # VideoLipsync requires specific parameters
        response = client.post("/api/comfyui/submit-workflow", json={
            "workflow_name": "VideoLipsync",
            "parameters": {
                # Missing most required parameters
                "WIDTH": 640
            },
            "client_id": "test-client",
            "base_url": "http://comfy.test"
        })

        assert response.status_code == 200
        data = response.json()

        # Should fail due to unsubstituted placeholders
        assert data["success"] is False
        assert data["error"] is not None

    def test_submit_workflow_comfyui_error(self, client):
        """Test workflow submission when ComfyUI returns error"""
        with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
            # Mock ComfyUI error
            mock_submit.return_value = (False, None, "ComfyUI connection failed")

            response = client.post("/api/comfyui/submit-workflow", json={
                "workflow_name": "VideoLipsync",
                "parameters": {
                    "VIDEO_FILENAME": "test.mp4",
                    "AUDIO_FILENAME": "test.wav",
                    "WIDTH": 640,
                    "HEIGHT": 360,
                    "AUDIO_SCALE": 1.0,
                    "AUDIO_START_TIME": 0,
                    "AUDIO_END_TIME": 10,
                    "CUSTOM_PROMPT": "test"
                },
                "client_id": "test-client",
                "base_url": "http://comfy.test"
            })

            assert response.status_code == 200
            data = response.json()

            assert data["success"] is False
            assert "ComfyUI connection failed" in data["error"]

    def test_submit_workflow_invalid_request_body(self, client):
        """Test submitting with invalid request body"""
        response = client.post("/api/comfyui/submit-workflow", json={
            # Missing required fields
            "workflow_name": "VideoLipsync"
        })

        assert response.status_code == 422  # Validation error


@pytest.mark.integration
class TestListWorkflowsEndpoint:
    """Tests for GET /comfyui/workflows endpoint"""

    def test_list_workflows_success(self, client):
        """Test successfully listing workflows"""
        response = client.get("/api/comfyui/workflows")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert "workflows" in data
        assert isinstance(data["workflows"], dict)
        assert len(data["workflows"]) > 0

        # Should include known workflows
        workflow_names = set(data["workflows"].keys())
        assert "VideoLipsync" in workflow_names
        assert "WANI2V" in workflow_names

    def test_list_workflows_returns_descriptions(self, client):
        """Test that workflow list includes descriptions"""
        response = client.get("/api/comfyui/workflows")

        assert response.status_code == 200
        data = response.json()

        # Each workflow should have a description
        for workflow_name, description in data["workflows"].items():
            assert isinstance(description, str)
            assert len(description) > 0


@pytest.mark.integration
class TestGetWorkflowParametersEndpoint:
    """Tests for GET /comfyui/workflows/{workflow_name}/parameters endpoint"""

    def test_get_parameters_success(self, client):
        """Test successfully getting workflow parameters"""
        response = client.get("/api/comfyui/workflows/VideoLipsync/parameters")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["workflow_name"] == "VideoLipsync"
        assert "parameters" in data
        assert isinstance(data["parameters"], list)
        assert len(data["parameters"]) > 0

        # VideoLipsync should have known parameters
        params = set(data["parameters"])
        expected_params = {
            "VIDEO_FILENAME", "AUDIO_FILENAME",
            "WIDTH", "HEIGHT"
        }
        assert expected_params.issubset(params)

    def test_get_parameters_nonexistent_workflow(self, client):
        """Test getting parameters for non-existent workflow"""
        response = client.get("/api/comfyui/workflows/NonExistentWorkflow/parameters")

        assert response.status_code == 404


@pytest.mark.integration
class TestLegacyEndpoints:
    """Tests for legacy ComfyUI endpoints (backward compatibility)"""

    def test_submit_prompt_legacy(self, client):
        """Test legacy POST /comfyui/submit-prompt still works"""
        with patch('services.comfyui_service.ComfyUIService.submit_prompt') as mock_submit:
            mock_submit.return_value = (True, "prompt-123", None)

            response = client.post("/api/comfyui/submit-prompt", json={
                "base_url": "http://comfy.test",
                "prompt": {
                    "1": {
                        "class_type": "TestNode",
                        "inputs": {}
                    }
                },
                "client_id": "test-123"
            })

            assert response.status_code == 200
            data = response.json()

            assert data["success"] is True
            assert data["prompt_id"] == "prompt-123"


@pytest.mark.integration
def test_health_check(client):
    """Test that API is accessible"""
    # FastAPI root might return 404, but should respond
    response = client.get("/")

    # Should get some response (even if 404)
    assert response.status_code in [200, 404, 307]  # 307 is redirect
