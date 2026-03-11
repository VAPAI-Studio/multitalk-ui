"""
API endpoint tests for the upscale router.

Tests all CRUD endpoints for batch and video management
with mocked authentication and service dependencies.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_user():
    """Create a mock authenticated user."""
    user = MagicMock()
    user.id = "test-user-id"
    return user


@pytest.fixture
def client(mock_user):
    """Provide a FastAPI TestClient with mocked auth."""
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).parent.parent
    sys.path.insert(0, str(backend_dir))

    from main import app
    from core.auth import get_current_user

    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def unauthenticated_client():
    """Provide a TestClient with NO auth override (for 401 tests)."""
    import sys
    from pathlib import Path
    backend_dir = Path(__file__).parent.parent
    sys.path.insert(0, str(backend_dir))

    from main import app
    # Clear any previous overrides
    app.dependency_overrides.clear()
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# POST /api/upscale/batches -- Create batch
# ---------------------------------------------------------------------------

class TestCreateBatch:
    """Tests for POST /api/upscale/batches."""

    @patch("api.upscale.UpscaleJobService")
    def test_create_batch_returns_batch_response(self, MockService, client):
        """POST /api/upscale/batches creates batch and returns BatchResponse with batch_id."""
        instance = MockService.return_value
        instance.create_batch = AsyncMock(return_value=(
            True,
            {"id": "batch-001", "status": "pending", "total_videos": 0},
            None,
        ))

        response = client.post("/api/upscale/batches", json={})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["batch_id"] == "batch-001"
        assert data["status"] == "pending"

    @patch("api.upscale.UpscaleJobService")
    def test_create_batch_with_custom_settings(self, MockService, client):
        """POST with custom settings stores those settings."""
        instance = MockService.return_value
        instance.create_batch = AsyncMock(return_value=(
            True,
            {"id": "batch-002", "status": "pending"},
            None,
        ))

        payload = {
            "settings": {
                "resolution": "4k",
                "creativity": 50,
                "sharpen": 30,
                "grain": 10,
                "fps_boost": True,
                "flavor": "natural",
            }
        }
        response = client.post("/api/upscale/batches", json=payload)
        assert response.status_code == 200

        # Verify service was called with UpscaleSettings containing custom values
        call_args = instance.create_batch.call_args
        settings_arg = call_args[1].get("settings") or call_args[0][1]
        assert settings_arg.resolution == "4k"
        assert settings_arg.creativity == 50

    @patch("api.upscale.UpscaleJobService")
    def test_create_batch_without_settings_uses_defaults(self, MockService, client):
        """POST without settings uses defaults (SETT-02)."""
        instance = MockService.return_value
        instance.create_batch = AsyncMock(return_value=(
            True,
            {"id": "batch-003", "status": "pending"},
            None,
        ))

        response = client.post("/api/upscale/batches", json={})
        assert response.status_code == 200

        call_args = instance.create_batch.call_args
        settings_arg = call_args[1].get("settings") or call_args[0][1]
        assert settings_arg.resolution == "2k"
        assert settings_arg.creativity == 0

    def test_create_batch_returns_401_without_auth(self, unauthenticated_client):
        """POST returns 401 without auth token."""
        response = unauthenticated_client.post("/api/upscale/batches", json={})
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/upscale/batches/{id}/videos -- Add video
# ---------------------------------------------------------------------------

class TestAddVideo:
    """Tests for POST /api/upscale/batches/{id}/videos."""

    @patch("api.upscale.UpscaleJobService")
    def test_add_video_to_batch(self, MockService, client):
        """POST /api/upscale/batches/{id}/videos adds video to batch."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "pending",
            "total_videos": 0,
            "videos": [],
        })
        instance.add_video_to_batch = AsyncMock(return_value=(
            True,
            {"id": "video-001", "batch_id": "batch-001", "status": "pending"},
            None,
        ))

        payload = {
            "input_filename": "my_video.mp4",
            "input_storage_url": "https://storage.example.com/my_video.mp4",
        }
        response = client.post("/api/upscale/batches/batch-001/videos", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_add_video_returns_401_without_auth(self, unauthenticated_client):
        """POST returns 401 without auth token."""
        payload = {
            "input_filename": "my_video.mp4",
            "input_storage_url": "https://storage.example.com/my_video.mp4",
        }
        response = unauthenticated_client.post("/api/upscale/batches/batch-001/videos", json=payload)
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/upscale/batches/{id}/start -- Start processing
# ---------------------------------------------------------------------------

class TestStartBatch:
    """Tests for POST /api/upscale/batches/{id}/start."""

    @patch("api.upscale.asyncio")
    @patch("api.upscale.UpscaleJobService")
    def test_start_batch_returns_processing_status(self, MockService, mock_asyncio, client):
        """POST /api/upscale/batches/{id}/start returns immediately with status 'processing'."""
        # Make mock create_task close the coroutine to prevent unawaited warnings
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "pending",
            "total_videos": 1,
            "videos": [],
        })
        instance.update_batch_status = AsyncMock(return_value=True)

        response = client.post("/api/upscale/batches/batch-001/start")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["status"] == "processing"

    @patch("api.upscale.UpscaleJobService")
    def test_start_batch_returns_400_if_not_pending(self, MockService, client):
        """POST returns 400 if batch not in 'pending' status."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "total_videos": 1,
            "videos": [],
        })

        response = client.post("/api/upscale/batches/batch-001/start")
        assert response.status_code == 400

    @patch("api.upscale.UpscaleJobService")
    def test_start_batch_returns_404_for_nonexistent(self, MockService, client):
        """POST returns 404 for non-existent batch."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.post("/api/upscale/batches/nonexistent/start")
        assert response.status_code == 404

    def test_start_batch_returns_401_without_auth(self, unauthenticated_client):
        """POST returns 401 without auth token."""
        response = unauthenticated_client.post("/api/upscale/batches/batch-001/start")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/upscale/batches/{id} -- Get batch detail
# ---------------------------------------------------------------------------

class TestGetBatch:
    """Tests for GET /api/upscale/batches/{id}."""

    @patch("api.upscale.UpscaleJobService")
    def test_get_batch_returns_detail(self, MockService, client):
        """GET /api/upscale/batches/{id} returns batch with videos."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "completed",
            "resolution": "2k",
            "creativity": 0,
            "sharpen": 0,
            "grain": 0,
            "fps_boost": False,
            "flavor": "vivid",
            "total_videos": 1,
            "completed_videos": 1,
            "failed_videos": 0,
            "created_at": "2026-03-11T10:00:00Z",
            "videos": [
                {
                    "id": "video-001",
                    "batch_id": "batch-001",
                    "status": "completed",
                    "queue_position": 1,
                    "input_filename": "test.mp4",
                    "input_storage_url": "https://example.com/test.mp4",
                    "created_at": "2026-03-11T10:00:00Z",
                }
            ],
        })

        response = client.get("/api/upscale/batches/batch-001")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["batch"]["id"] == "batch-001"
        assert len(data["batch"]["videos"]) == 1

    @patch("api.upscale.UpscaleJobService")
    def test_get_batch_returns_404_for_nonexistent(self, MockService, client):
        """GET returns 404 for non-existent batch."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.get("/api/upscale/batches/nonexistent")
        assert response.status_code == 404

    def test_get_batch_returns_401_without_auth(self, unauthenticated_client):
        """GET returns 401 without auth token."""
        response = unauthenticated_client.get("/api/upscale/batches/batch-001")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/upscale/batches -- List batches
# ---------------------------------------------------------------------------

class TestListBatches:
    """Tests for GET /api/upscale/batches."""

    @patch("api.upscale.UpscaleJobService")
    def test_list_batches(self, MockService, client):
        """GET /api/upscale/batches lists user batches."""
        instance = MockService.return_value
        instance.list_user_batches = AsyncMock(return_value=[
            {"id": "batch-001", "status": "completed"},
            {"id": "batch-002", "status": "pending"},
        ])

        response = client.get("/api/upscale/batches")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_list_batches_returns_401_without_auth(self, unauthenticated_client):
        """GET returns 401 without auth token."""
        response = unauthenticated_client.get("/api/upscale/batches")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/upscale/batches/{id}/resume -- Resume paused batch
# ---------------------------------------------------------------------------

class TestResumeBatch:
    """Tests for POST /api/upscale/batches/{id}/resume."""

    @patch("api.upscale.asyncio")
    @patch("api.upscale.UpscaleJobService")
    def test_resume_paused_batch(self, MockService, mock_asyncio, client):
        """POST /api/upscale/batches/{id}/resume returns 200 with status='processing' when batch is paused."""
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "paused",
            "total_videos": 3,
            "videos": [],
        })
        instance.unpause_videos = AsyncMock(return_value=True)
        instance.clear_pause_metadata = AsyncMock(return_value=True)
        instance.update_batch_status = AsyncMock(return_value=True)

        response = client.post("/api/upscale/batches/batch-001/resume")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["status"] == "processing"

    @patch("api.upscale.UpscaleJobService")
    def test_resume_returns_404_for_missing_batch(self, MockService, client):
        """POST returns 404 when batch not found."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.post("/api/upscale/batches/nonexistent/resume")
        assert response.status_code == 404

    @patch("api.upscale.UpscaleJobService")
    def test_resume_returns_400_for_non_paused(self, MockService, client):
        """POST returns 400 when batch is not paused (e.g., 'processing')."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "total_videos": 1,
            "videos": [],
        })

        response = client.post("/api/upscale/batches/batch-001/resume")
        assert response.status_code == 400

    @patch("api.upscale.asyncio")
    @patch("api.upscale.UpscaleJobService")
    def test_resume_calls_service_methods(self, MockService, mock_asyncio, client):
        """Resume endpoint calls unpause_videos, clear_pause_metadata, update_batch_status."""
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "paused",
            "total_videos": 3,
            "videos": [],
        })
        instance.unpause_videos = AsyncMock(return_value=True)
        instance.clear_pause_metadata = AsyncMock(return_value=True)
        instance.update_batch_status = AsyncMock(return_value=True)

        client.post("/api/upscale/batches/batch-001/resume")

        instance.unpause_videos.assert_called_once_with("batch-001")
        instance.clear_pause_metadata.assert_called_once_with("batch-001")
        instance.update_batch_status.assert_called_once_with("batch-001", "processing")


# ---------------------------------------------------------------------------
# POST /api/upscale/batches/{id}/videos/{vid}/retry -- Retry failed video
# ---------------------------------------------------------------------------

class TestRetryVideo:
    """Tests for POST /api/upscale/batches/{id}/videos/{vid}/retry."""

    @patch("api.upscale.UpscaleJobService")
    def test_retry_failed_video(self, MockService, client):
        """POST returns 200 when video is successfully reset to pending."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "total_videos": 1,
            "videos": [],
        })
        instance.retry_video = AsyncMock(return_value=True)
        instance.decrement_failed_count = AsyncMock(return_value=True)

        response = client.post("/api/upscale/batches/batch-001/videos/video-001/retry")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["video_id"] == "video-001"
        assert data["status"] == "pending"

    @patch("api.upscale.UpscaleJobService")
    def test_retry_returns_404_for_missing_batch(self, MockService, client):
        """POST returns 404 when batch not found."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.post("/api/upscale/batches/nonexistent/videos/video-001/retry")
        assert response.status_code == 404

    @patch("api.upscale.UpscaleJobService")
    def test_retry_returns_400_for_non_failed(self, MockService, client):
        """POST returns 400 when video is not in 'failed' status."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "total_videos": 1,
            "videos": [],
        })
        instance.retry_video = AsyncMock(return_value=False)

        response = client.post("/api/upscale/batches/batch-001/videos/video-001/retry")
        assert response.status_code == 400

    @patch("api.upscale.UpscaleJobService")
    def test_retry_decrements_failed_count(self, MockService, client):
        """Retry endpoint decrements failed_videos count on the batch."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "total_videos": 1,
            "videos": [],
        })
        instance.retry_video = AsyncMock(return_value=True)
        instance.decrement_failed_count = AsyncMock(return_value=True)

        client.post("/api/upscale/batches/batch-001/videos/video-001/retry")

        instance.decrement_failed_count.assert_called_once_with("batch-001")

    @patch("api.upscale.asyncio")
    @patch("api.upscale.UpscaleJobService")
    def test_retry_relaunches_completed_batch(self, MockService, mock_asyncio, client):
        """Retry endpoint sets completed batch back to processing and launches _process_batch."""
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "completed",
            "total_videos": 2,
            "videos": [],
        })
        instance.retry_video = AsyncMock(return_value=True)
        instance.decrement_failed_count = AsyncMock(return_value=True)
        instance.update_batch_status = AsyncMock(return_value=True)

        response = client.post("/api/upscale/batches/batch-001/videos/video-001/retry")
        assert response.status_code == 200

        instance.update_batch_status.assert_called_once_with("batch-001", "processing")
        mock_asyncio.create_task.assert_called_once()


# ---------------------------------------------------------------------------
# PATCH /api/upscale/batches/{id}/reorder -- Reorder pending videos
# ---------------------------------------------------------------------------

class TestReorderQueue:
    """Tests for PATCH /api/upscale/batches/{id}/reorder."""

    @patch("api.upscale.UpscaleJobService")
    def test_reorder_pending_videos(self, MockService, client):
        """PATCH with video_ids returns 200 on success."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "pending",
            "total_videos": 2,
            "videos": [],
        })
        instance.reorder_videos = AsyncMock(return_value=True)

        response = client.patch(
            "/api/upscale/batches/batch-001/reorder",
            json={"video_ids": ["video-002", "video-001"]},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch("api.upscale.UpscaleJobService")
    def test_reorder_returns_404_for_missing_batch(self, MockService, client):
        """PATCH returns 404 when batch not found."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.patch(
            "/api/upscale/batches/nonexistent/reorder",
            json={"video_ids": ["video-001"]},
        )
        assert response.status_code == 404

    @patch("api.upscale.UpscaleJobService")
    def test_reorder_calls_service(self, MockService, client):
        """Reorder endpoint calls reorder_videos with correct video_ids."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "pending",
            "total_videos": 2,
            "videos": [],
        })
        instance.reorder_videos = AsyncMock(return_value=True)

        client.patch(
            "/api/upscale/batches/batch-001/reorder",
            json={"video_ids": ["video-002", "video-001"]},
        )

        instance.reorder_videos.assert_called_once_with("batch-001", ["video-002", "video-001"])
