"""
Layer 3: API integration tests for custom workflow endpoints.

Tests all 9 endpoints: parse, CRUD (create, list, list_published, get, update,
delete), and publish/unpublish. Verifies admin protection on all endpoints.

Uses FastAPI TestClient with dependency overrides to mock admin auth and
unittest.mock.patch to mock the service layer for CRUD operations.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def admin_client():
    """TestClient with mocked admin auth."""
    from main import app
    from core.auth import verify_admin

    mock_admin = MagicMock()
    mock_admin.id = "admin-user-id-123"
    mock_admin.user_metadata = {"role": "admin"}
    mock_admin.app_metadata = {}

    app.dependency_overrides[verify_admin] = lambda: mock_admin
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def unauthenticated_client():
    """TestClient without auth overrides (tests 401/403)."""
    from main import app

    app.dependency_overrides.clear()
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Sample Data
# ---------------------------------------------------------------------------

SAMPLE_API_WORKFLOW = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 42,
            "steps": 20,
            "cfg": 7.0,
            "sampler_name": "euler",
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
        "_meta": {"title": "KSampler"},
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "model.safetensors"},
        "_meta": {"title": "Load Checkpoint"},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"images": ["8", 0], "filename_prefix": "output"},
        "_meta": {"title": "Save Image"},
    },
}

SAMPLE_UI_WORKFLOW = {
    "nodes": [
        {"id": 1, "type": "KSampler", "pos": [100, 100]},
        {"id": 2, "type": "SaveImage", "pos": [400, 100]},
    ],
    "links": [[1, 1, 0, 2, 0, "IMAGE"]],
}

SAMPLE_CREATE_PAYLOAD = {
    "name": "Test Workflow",
    "description": "A test workflow",
    "workflow_json": SAMPLE_API_WORKFLOW,
    "output_type": "image",
    "icon": "🎨",
    "gradient": "from-red-500 to-orange-600",
}

SAMPLE_WORKFLOW_ROW = {
    "id": "wf-uuid-001",
    "name": "Test Workflow",
    "slug": "test-workflow",
    "description": "A test workflow",
    "template_filename": "test-workflow.json",
    "original_workflow": SAMPLE_API_WORKFLOW,
    "variable_config": [],
    "section_config": [],
    "output_type": "image",
    "icon": "🎨",
    "gradient": "from-red-500 to-orange-600",
    "is_published": False,
    "created_by": "admin-user-id-123",
    "created_at": "2026-03-13T20:00:00Z",
    "updated_at": "2026-03-13T20:00:00Z",
}


# ---------------------------------------------------------------------------
# Parse Endpoint Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestParseEndpoint:
    """Tests for POST /api/custom-workflows/parse"""

    def test_parse_valid_api_format(self, admin_client):
        """Parse a valid API-format workflow and receive structured nodes."""
        response = admin_client.post(
            "/api/custom-workflows/parse",
            json={"workflow_json": SAMPLE_API_WORKFLOW},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["format"] == "api"
        assert len(data["nodes"]) == 3

        # Verify node structure
        node_types = {n["class_type"] for n in data["nodes"]}
        assert "KSampler" in node_types
        assert "CheckpointLoaderSimple" in node_types
        assert "SaveImage" in node_types

        # Verify link detection: KSampler has link inputs (model, positive, negative, latent_image)
        ksampler = next(n for n in data["nodes"] if n["class_type"] == "KSampler")
        link_inputs = [i for i in ksampler["inputs"] if i["is_link"]]
        configurable = ksampler["configurable_inputs"]
        assert len(link_inputs) == 4  # model, positive, negative, latent_image
        assert all(not ci["is_link"] for ci in configurable)
        # configurable should have seed, steps, cfg, sampler_name
        configurable_names = {ci["name"] for ci in configurable}
        assert "seed" in configurable_names
        assert "steps" in configurable_names

    def test_parse_ui_format_rejected(self, admin_client):
        """UI-format workflow is rejected with guidance about API format."""
        response = admin_client.post(
            "/api/custom-workflows/parse",
            json={"workflow_json": SAMPLE_UI_WORKFLOW},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["format"] == "ui"
        assert "API Format" in data["error"] or "Dev Mode" in data["error"]

    def test_parse_empty_json(self, admin_client):
        """Empty dict returns success=False."""
        response = admin_client.post(
            "/api/custom-workflows/parse",
            json={"workflow_json": {}},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False


# ---------------------------------------------------------------------------
# CRUD Endpoint Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestCRUD:
    """Tests for CRUD lifecycle endpoints."""

    def test_create_workflow(self, admin_client):
        """POST / creates workflow and returns 201."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.create = AsyncMock(
                return_value=(True, SAMPLE_WORKFLOW_ROW, None)
            )

            response = admin_client.post(
                "/api/custom-workflows/",
                json=SAMPLE_CREATE_PAYLOAD,
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["workflow"]["id"] == "wf-uuid-001"
            assert data["workflow"]["name"] == "Test Workflow"
            instance.create.assert_called_once()

    def test_create_workflow_duplicate_slug(self, admin_client):
        """POST / with duplicate slug returns 409."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.create = AsyncMock(
                return_value=(
                    False,
                    None,
                    "A workflow with slug 'test-workflow' already exists. duplicate key.",
                )
            )

            response = admin_client.post(
                "/api/custom-workflows/",
                json=SAMPLE_CREATE_PAYLOAD,
            )

            assert response.status_code == 409

    def test_list_workflows(self, admin_client):
        """GET / lists all workflows."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.list_all = AsyncMock(
                return_value=[SAMPLE_WORKFLOW_ROW]
            )

            response = admin_client.get("/api/custom-workflows/")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["workflows"]) == 1
            assert data["workflows"][0]["slug"] == "test-workflow"

    def test_list_published(self, admin_client):
        """GET /published lists published only."""
        published_row = {**SAMPLE_WORKFLOW_ROW, "is_published": True}
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.list_published = AsyncMock(
                return_value=[published_row]
            )

            response = admin_client.get("/api/custom-workflows/published")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert len(data["workflows"]) == 1
            assert data["workflows"][0]["is_published"] is True

    def test_get_workflow(self, admin_client):
        """GET /{id} returns single workflow."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.get = AsyncMock(return_value=SAMPLE_WORKFLOW_ROW)

            response = admin_client.get(
                "/api/custom-workflows/wf-uuid-001"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["workflow"]["id"] == "wf-uuid-001"

    def test_get_workflow_not_found(self, admin_client):
        """GET /{id} returns 404 when not found."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.get = AsyncMock(return_value=None)

            response = admin_client.get(
                "/api/custom-workflows/nonexistent-id"
            )

            assert response.status_code == 404

    def test_update_workflow(self, admin_client):
        """PUT /{id} updates workflow fields."""
        updated_row = {**SAMPLE_WORKFLOW_ROW, "name": "Updated Name"}
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.update = AsyncMock(
                return_value=(True, updated_row, None)
            )

            response = admin_client.put(
                "/api/custom-workflows/wf-uuid-001",
                json={"name": "Updated Name"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["workflow"]["name"] == "Updated Name"

    def test_delete_workflow(self, admin_client):
        """DELETE /{id} removes workflow."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.delete = AsyncMock(return_value=(True, None))

            response = admin_client.delete(
                "/api/custom-workflows/wf-uuid-001"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_delete_workflow_not_found(self, admin_client):
        """DELETE /{id} returns 404 when not found."""
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.delete = AsyncMock(
                return_value=(False, "Workflow not found")
            )

            response = admin_client.delete(
                "/api/custom-workflows/nonexistent-id"
            )

            assert response.status_code == 404


# ---------------------------------------------------------------------------
# Publish/Unpublish Endpoint Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestPublish:
    """Tests for publish/unpublish endpoints."""

    def test_publish_workflow(self, admin_client):
        """POST /{id}/publish sets is_published=true."""
        published_row = {**SAMPLE_WORKFLOW_ROW, "is_published": True}
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.toggle_publish = AsyncMock(
                return_value=(True, published_row, None)
            )

            response = admin_client.post(
                "/api/custom-workflows/wf-uuid-001/publish"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["workflow"]["is_published"] is True
            instance.toggle_publish.assert_called_once_with(
                "wf-uuid-001", True
            )

    def test_unpublish_workflow(self, admin_client):
        """POST /{id}/unpublish sets is_published=false."""
        unpublished_row = {**SAMPLE_WORKFLOW_ROW, "is_published": False}
        with patch(
            "api.custom_workflows.CustomWorkflowService"
        ) as MockService:
            instance = MockService.return_value
            instance.toggle_publish = AsyncMock(
                return_value=(True, unpublished_row, None)
            )

            response = admin_client.post(
                "/api/custom-workflows/wf-uuid-001/unpublish"
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["workflow"]["is_published"] is False
            instance.toggle_publish.assert_called_once_with(
                "wf-uuid-001", False
            )


# ---------------------------------------------------------------------------
# Admin Protection Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestAdminProtection:
    """All endpoints require admin auth -- unauthenticated returns 401 or 403."""

    def test_parse_requires_admin(self, unauthenticated_client):
        """POST /parse returns 401/403 without auth."""
        response = unauthenticated_client.post(
            "/api/custom-workflows/parse",
            json={"workflow_json": SAMPLE_API_WORKFLOW},
        )
        assert response.status_code in (401, 403)

    def test_create_requires_admin(self, unauthenticated_client):
        """POST / returns 401/403 without auth."""
        response = unauthenticated_client.post(
            "/api/custom-workflows/",
            json=SAMPLE_CREATE_PAYLOAD,
        )
        assert response.status_code in (401, 403)

    def test_list_requires_admin(self, unauthenticated_client):
        """GET / returns 401/403 without auth."""
        response = unauthenticated_client.get("/api/custom-workflows/")
        assert response.status_code in (401, 403)

    def test_get_requires_admin(self, unauthenticated_client):
        """GET /{id} returns 401/403 without auth."""
        response = unauthenticated_client.get(
            "/api/custom-workflows/some-id"
        )
        assert response.status_code in (401, 403)

    def test_update_requires_admin(self, unauthenticated_client):
        """PUT /{id} returns 401/403 without auth."""
        response = unauthenticated_client.put(
            "/api/custom-workflows/some-id",
            json={"name": "hacked"},
        )
        assert response.status_code in (401, 403)

    def test_delete_requires_admin(self, unauthenticated_client):
        """DELETE /{id} returns 401/403 without auth."""
        response = unauthenticated_client.delete(
            "/api/custom-workflows/some-id"
        )
        assert response.status_code in (401, 403)

    def test_publish_requires_admin(self, unauthenticated_client):
        """POST /{id}/publish returns 401/403 without auth."""
        response = unauthenticated_client.post(
            "/api/custom-workflows/some-id/publish"
        )
        assert response.status_code in (401, 403)

    def test_unpublish_requires_admin(self, unauthenticated_client):
        """POST /{id}/unpublish returns 401/403 without auth."""
        response = unauthenticated_client.post(
            "/api/custom-workflows/some-id/unpublish"
        )
        assert response.status_code in (401, 403)
