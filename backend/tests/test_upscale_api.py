"""
API endpoint tests for the upscale router.

Tests all CRUD endpoints for batch and video management
with mocked authentication and service dependencies.
Includes delivery pipeline tests (Phase 12).
"""
import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch, call


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


# ---------------------------------------------------------------------------
# Delivery Pipeline Tests (Phase 12)
# ---------------------------------------------------------------------------

def _make_video_dict(**overrides):
    """Return a sample video dict for _process_single_video."""
    d = {
        "id": "video-001",
        "batch_id": "batch-001",
        "status": "pending",
        "queue_position": 1,
        "input_filename": "my_clip.mp4",
        "input_storage_url": "https://storage.example.com/my_clip.mp4",
    }
    d.update(overrides)
    return d


def _make_batch_dict(**overrides):
    """Return a sample batch dict for _process_single_video."""
    d = {
        "id": "batch-001",
        "user_id": "user-abc",
        "status": "processing",
        "resolution": "2k",
        "creativity": 0,
        "sharpen": 0,
        "grain": 0,
        "fps_boost": False,
        "flavor": "vivid",
        "project_id": None,
    }
    d.update(overrides)
    return d


class TestDeliveryPipeline:
    """Tests for the delivery pipeline wired into _process_single_video."""

    @pytest.mark.asyncio
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_supabase_upload_success(
        self, MockFreepik, MockJobService, MockStorage
    ):
        """When Freepik returns COMPLETED, Supabase upload succeeds -- supabase_upload_status='completed' and output_storage_url is the public URL."""
        from api.upscale import _process_single_video

        # Freepik: submit succeeds, poll returns COMPLETED
        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        # Job service
        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        # Storage: upload succeeds
        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            True, "https://supabase.example.com/public/upscaled.mp4", None
        ))

        video = _make_video_dict()
        batch = _make_batch_dict()

        result = await _process_single_video(video, batch)

        assert result.success is True

        # Verify Supabase upload was called
        storage.upload_upscaled_video.assert_called_once_with(
            source_url="https://freepik.example.com/output.mp4",
            user_id="user-abc",
            batch_id="batch-001",
            original_filename="my_clip.mp4",
        )

        # Verify upload status was recorded as completed
        upload_calls = job.update_video_upload_status.call_args_list
        # First call: Supabase status
        supabase_call = upload_calls[0]
        assert supabase_call[0][0] == "video-001"
        assert supabase_call[1]["supabase_upload_status"] == "completed"
        assert supabase_call[1]["output_storage_url"] == "https://supabase.example.com/public/upscaled.mp4"

        # Verify video completed with Supabase URL (not Freepik URL)
        final_status_call = job.update_video_status.call_args_list[-1]
        assert final_status_call[1].get("output_url") == "https://supabase.example.com/public/upscaled.mp4"

    @pytest.mark.asyncio
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_supabase_failure_preserves_freepik_url(
        self, MockFreepik, MockJobService, MockStorage
    ):
        """When Supabase upload fails, supabase_upload_status='failed' and Freepik temp URL preserved in output_storage_url."""
        from api.upscale import _process_single_video

        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        # Storage: upload FAILS
        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            False, None, "Supabase upload failed: timeout"
        ))

        video = _make_video_dict()
        batch = _make_batch_dict()

        result = await _process_single_video(video, batch)

        # Video still completes (upscaling succeeded)
        assert result.success is True

        # Verify Supabase status recorded as failed
        upload_calls = job.update_video_upload_status.call_args_list
        supabase_call = upload_calls[0]
        assert supabase_call[1]["supabase_upload_status"] == "failed"
        # Freepik temp URL preserved
        assert supabase_call[1]["output_storage_url"] == "https://freepik.example.com/output.mp4"

    @pytest.mark.asyncio
    @patch("api.upscale.is_drive_configured")
    @patch("api.upscale.GoogleDriveService")
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_drive_upload_success(
        self, MockFreepik, MockJobService, MockStorage, MockDrive, mock_is_configured
    ):
        """When batch has project_id and Drive is configured, upload to Drive succeeds -- drive_upload_status='completed'."""
        from api.upscale import _process_single_video

        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        # Storage: upload succeeds; also mock the HTTP client for Drive re-download
        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            True, "https://supabase.example.com/public/upscaled.mp4", None
        ))
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"video-bytes-here"
        mock_http_client = AsyncMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=None)
        storage._get_fresh_http_client = AsyncMock(return_value=mock_http_client)

        # Drive: configured and upload succeeds
        mock_is_configured.return_value = True
        drive = MockDrive.return_value
        drive.get_or_create_folder = AsyncMock(return_value=(True, "folder-xyz", None))
        drive.upload_file = AsyncMock(return_value=(True, "drive-file-789", None))

        video = _make_video_dict()
        batch = _make_batch_dict(project_id="project-folder-123")

        result = await _process_single_video(video, batch)

        assert result.success is True

        # Verify Drive upload was attempted
        drive.get_or_create_folder.assert_called_once()
        drive.upload_file.assert_called_once()

        # Verify drive status recorded
        upload_calls = job.update_video_upload_status.call_args_list
        drive_call = upload_calls[1]  # Second call is for Drive status
        assert drive_call[1]["drive_upload_status"] == "completed"
        assert drive_call[1]["output_drive_file_id"] == "drive-file-789"

    @pytest.mark.asyncio
    @patch("api.upscale.is_drive_configured")
    @patch("api.upscale.GoogleDriveService")
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_drive_failure_nonfatal(
        self, MockFreepik, MockJobService, MockStorage, MockDrive, mock_is_configured
    ):
        """When Drive upload fails, video still 'completed', drive_upload_status='failed'."""
        from api.upscale import _process_single_video

        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        # Storage: upload succeeds; mock HTTP client for Drive re-download
        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            True, "https://supabase.example.com/public/upscaled.mp4", None
        ))
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"video-bytes-here"
        mock_http_client = AsyncMock()
        mock_http_client.get = AsyncMock(return_value=mock_response)
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=None)
        storage._get_fresh_http_client = AsyncMock(return_value=mock_http_client)

        # Drive: configured but upload fails
        mock_is_configured.return_value = True
        drive = MockDrive.return_value
        drive.get_or_create_folder = AsyncMock(return_value=(True, "folder-xyz", None))
        drive.upload_file = AsyncMock(return_value=(False, None, "Drive quota exceeded"))

        video = _make_video_dict()
        batch = _make_batch_dict(project_id="project-folder-123")

        result = await _process_single_video(video, batch)

        # Video still completes
        assert result.success is True

        # Drive status is "failed"
        upload_calls = job.update_video_upload_status.call_args_list
        drive_call = upload_calls[1]
        assert drive_call[1]["drive_upload_status"] == "failed"

    @pytest.mark.asyncio
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_drive_skipped_no_project_id(
        self, MockFreepik, MockJobService, MockStorage
    ):
        """When batch has no project_id, drive_upload_status='skipped'."""
        from api.upscale import _process_single_video

        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            True, "https://supabase.example.com/public/upscaled.mp4", None
        ))

        video = _make_video_dict()
        batch = _make_batch_dict(project_id=None)

        result = await _process_single_video(video, batch)

        assert result.success is True

        # Drive status should be "skipped"
        upload_calls = job.update_video_upload_status.call_args_list
        drive_call = upload_calls[1]
        assert drive_call[1]["drive_upload_status"] == "skipped"

    @pytest.mark.asyncio
    @patch("api.upscale.is_drive_configured")
    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    @patch("api.upscale.FreepikUpscalerService")
    async def test_delivery_drive_skipped_not_configured(
        self, MockFreepik, MockJobService, MockStorage, mock_is_configured
    ):
        """When Drive is not configured, drive_upload_status='skipped' even with project_id."""
        from api.upscale import _process_single_video

        freepik = MockFreepik.return_value
        freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        freepik.poll_until_complete = AsyncMock(return_value=(
            "COMPLETED", "https://freepik.example.com/output.mp4", None
        ))

        job = MockJobService.return_value
        job.update_video_status = AsyncMock(return_value=True)
        job.update_video_upload_status = AsyncMock(return_value=True)
        job.increment_completed_count = AsyncMock(return_value=True)

        storage = MockStorage.return_value
        storage.upload_upscaled_video = AsyncMock(return_value=(
            True, "https://supabase.example.com/public/upscaled.mp4", None
        ))

        # Drive NOT configured
        mock_is_configured.return_value = False

        video = _make_video_dict()
        batch = _make_batch_dict(project_id="project-folder-123")

        result = await _process_single_video(video, batch)

        assert result.success is True

        upload_calls = job.update_video_upload_status.call_args_list
        drive_call = upload_calls[1]
        assert drive_call[1]["drive_upload_status"] == "skipped"

    @patch("api.upscale.UpscaleJobService")
    def test_batch_detail_includes_upload_status_fields(self, MockService, client):
        """GET /api/upscale/batches/{id} returns videos with upload status fields."""
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
                    "output_storage_url": "https://supabase.example.com/public/upscaled.mp4",
                    "supabase_upload_status": "completed",
                    "drive_upload_status": "skipped",
                    "output_drive_file_id": None,
                    "created_at": "2026-03-11T10:00:00Z",
                }
            ],
        })

        response = client.get("/api/upscale/batches/batch-001")
        assert response.status_code == 200
        data = response.json()
        video = data["batch"]["videos"][0]
        assert video["supabase_upload_status"] == "completed"
        assert video["drive_upload_status"] == "skipped"
        assert video["output_drive_file_id"] is None


# ---------------------------------------------------------------------------
# ZIP Download Tests (Phase 12 Plan 02)
# ---------------------------------------------------------------------------


class TestZipDownload:
    """Tests for batch ZIP download endpoints."""

    @patch("api.upscale.asyncio")
    @patch("api.upscale.UpscaleJobService")
    def test_zip_job_creation(self, MockService, mock_asyncio, client):
        """POST /api/upscale/batches/{id}/download-zip creates ZIP job and returns job_id."""
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

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
            "total_videos": 2,
            "completed_videos": 2,
            "failed_videos": 0,
            "created_at": "2026-03-11T10:00:00Z",
            "videos": [
                {
                    "id": "video-001",
                    "batch_id": "batch-001",
                    "status": "completed",
                    "queue_position": 1,
                    "input_filename": "clip_a.mp4",
                    "input_storage_url": "https://example.com/clip_a.mp4",
                    "output_storage_url": "https://supabase.example.com/public/clip_a_upscaled.mp4",
                    "created_at": "2026-03-11T10:00:00Z",
                },
                {
                    "id": "video-002",
                    "batch_id": "batch-001",
                    "status": "completed",
                    "queue_position": 2,
                    "input_filename": "clip_b.mp4",
                    "input_storage_url": "https://example.com/clip_b.mp4",
                    "output_storage_url": "https://supabase.example.com/public/clip_b_upscaled.mp4",
                    "created_at": "2026-03-11T10:00:00Z",
                },
            ],
        })

        response = client.post("/api/upscale/batches/batch-001/download-zip")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "job_id" in data
        assert data["job_id"] is not None

    @patch("api.upscale.UpscaleJobService")
    def test_zip_job_creation_no_completed_videos(self, MockService, client):
        """POST returns 400 when batch has no completed videos with output_storage_url."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "processing",
            "resolution": "2k",
            "creativity": 0,
            "sharpen": 0,
            "grain": 0,
            "fps_boost": False,
            "flavor": "vivid",
            "total_videos": 1,
            "completed_videos": 0,
            "failed_videos": 0,
            "created_at": "2026-03-11T10:00:00Z",
            "videos": [
                {
                    "id": "video-001",
                    "batch_id": "batch-001",
                    "status": "pending",
                    "queue_position": 1,
                    "input_filename": "clip_a.mp4",
                    "input_storage_url": "https://example.com/clip_a.mp4",
                    "output_storage_url": None,
                    "created_at": "2026-03-11T10:00:00Z",
                },
            ],
        })

        response = client.post("/api/upscale/batches/batch-001/download-zip")
        assert response.status_code == 400

    @patch("api.upscale.UpscaleJobService")
    def test_zip_job_creation_batch_not_found(self, MockService, client):
        """POST returns 404 for nonexistent batch."""
        instance = MockService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.post("/api/upscale/batches/nonexistent/download-zip")
        assert response.status_code == 404

    def test_zip_job_status(self, client):
        """GET /api/upscale/zip-jobs/{id}/status returns job status fields."""
        from api.upscale import _ZIP_JOBS

        job_id = "test-status-job"
        _ZIP_JOBS[job_id] = {
            "status": "building",
            "created_at": time.time(),
            "progress_pct": 50.0,
            "files_done": 1,
            "total_files": 2,
            "error": None,
            "zip_bytes": None,
        }

        try:
            response = client.get(f"/api/upscale/zip-jobs/{job_id}/status")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "building"
            assert data["progress_pct"] == 50.0
            assert data["files_done"] == 1
            assert data["total_files"] == 2
            assert data["error"] is None
        finally:
            _ZIP_JOBS.pop(job_id, None)

    def test_zip_job_status_not_found(self, client):
        """GET returns 404 for unknown job_id."""
        response = client.get("/api/upscale/zip-jobs/unknown-id/status")
        assert response.status_code == 404

    def test_zip_download_ready(self, client):
        """GET /api/upscale/zip-jobs/{id}/download returns ZIP bytes with correct headers."""
        from api.upscale import _ZIP_JOBS

        # Create a real ZIP in memory
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as zf:
            zf.writestr("test_upscaled.mp4", b"fake-video-bytes")
        zip_bytes = buf.getvalue()

        job_id = "test-download-job"
        _ZIP_JOBS[job_id] = {
            "status": "ready",
            "created_at": time.time(),
            "progress_pct": 100.0,
            "files_done": 1,
            "total_files": 1,
            "error": None,
            "zip_bytes": zip_bytes,
        }

        try:
            response = client.get(f"/api/upscale/zip-jobs/{job_id}/download")
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/zip"
            assert "attachment" in response.headers.get("content-disposition", "")
            assert "upscaled_batch.zip" in response.headers.get("content-disposition", "")

            # Verify response is valid ZIP
            result_zip = zipfile.ZipFile(io.BytesIO(response.content))
            assert "test_upscaled.mp4" in result_zip.namelist()
        finally:
            _ZIP_JOBS.pop(job_id, None)

    def test_zip_download_not_ready(self, client):
        """GET returns 409 when ZIP status is not 'ready'."""
        from api.upscale import _ZIP_JOBS

        job_id = "test-not-ready-job"
        _ZIP_JOBS[job_id] = {
            "status": "building",
            "created_at": time.time(),
            "progress_pct": 50.0,
            "files_done": 1,
            "total_files": 2,
            "error": None,
            "zip_bytes": None,
        }

        try:
            response = client.get(f"/api/upscale/zip-jobs/{job_id}/download")
            assert response.status_code == 409
        finally:
            _ZIP_JOBS.pop(job_id, None)

    def test_zip_download_cleanup(self, client):
        """After successful download, job is removed from _ZIP_JOBS."""
        from api.upscale import _ZIP_JOBS

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as zf:
            zf.writestr("test_upscaled.mp4", b"fake-video-bytes")
        zip_bytes = buf.getvalue()

        job_id = "test-cleanup-job"
        _ZIP_JOBS[job_id] = {
            "status": "ready",
            "created_at": time.time(),
            "progress_pct": 100.0,
            "files_done": 1,
            "total_files": 1,
            "error": None,
            "zip_bytes": zip_bytes,
        }

        response = client.get(f"/api/upscale/zip-jobs/{job_id}/download")
        assert response.status_code == 200
        # Job should be removed after download
        assert job_id not in _ZIP_JOBS

    def test_zip_ttl_cleanup(self, client):
        """Expired ZIP jobs are cleaned up when a new job is created."""
        from api.upscale import _ZIP_JOBS, _cleanup_expired_zip_jobs

        # Insert an expired job (created 20 minutes ago)
        expired_id = "expired-job"
        _ZIP_JOBS[expired_id] = {
            "status": "ready",
            "created_at": time.time() - 1200,  # 20 minutes ago
            "progress_pct": 100.0,
            "files_done": 1,
            "total_files": 1,
            "error": None,
            "zip_bytes": b"old-zip",
        }

        try:
            _cleanup_expired_zip_jobs()
            assert expired_id not in _ZIP_JOBS
        finally:
            _ZIP_JOBS.pop(expired_id, None)

    @pytest.mark.asyncio
    async def test_zip_filenames_use_upscaled_suffix(self):
        """_build_zip creates ZIP entries with {stem}_upscaled.mp4 filenames."""
        from api.upscale import _build_zip, _ZIP_JOBS

        job_id = "test-filename-job"
        _ZIP_JOBS[job_id] = {
            "status": "pending",
            "created_at": time.time(),
            "progress_pct": 0.0,
            "files_done": 0,
            "total_files": 2,
            "error": None,
            "zip_bytes": None,
        }

        videos = [
            {
                "input_filename": "my_video.mp4",
                "output_storage_url": "https://example.com/my_video_up.mp4",
            },
            {
                "input_filename": "another_clip.mp4",
                "output_storage_url": "https://example.com/another_up.mp4",
            },
        ]

        # Mock httpx to return fake video bytes
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"fake-video-bytes"

        with patch("api.upscale.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            MockClient.return_value = mock_client

            await _build_zip(job_id, videos)

        try:
            assert _ZIP_JOBS[job_id]["status"] == "ready"
            assert _ZIP_JOBS[job_id]["zip_bytes"] is not None

            # Verify ZIP contents have correct filenames
            result_zip = zipfile.ZipFile(io.BytesIO(_ZIP_JOBS[job_id]["zip_bytes"]))
            names = result_zip.namelist()
            assert "my_video_upscaled.mp4" in names
            assert "another_clip_upscaled.mp4" in names
        finally:
            _ZIP_JOBS.pop(job_id, None)

    @pytest.mark.asyncio
    async def test_zip_build_skips_failed_downloads(self):
        """_build_zip skips videos whose download fails (non-200 status)."""
        from api.upscale import _build_zip, _ZIP_JOBS

        job_id = "test-skip-failed-job"
        _ZIP_JOBS[job_id] = {
            "status": "pending",
            "created_at": time.time(),
            "progress_pct": 0.0,
            "files_done": 0,
            "total_files": 2,
            "error": None,
            "zip_bytes": None,
        }

        videos = [
            {
                "input_filename": "good.mp4",
                "output_storage_url": "https://example.com/good.mp4",
            },
            {
                "input_filename": "bad.mp4",
                "output_storage_url": "https://example.com/bad.mp4",
            },
        ]

        good_response = MagicMock()
        good_response.status_code = 200
        good_response.content = b"good-video-bytes"

        bad_response = MagicMock()
        bad_response.status_code = 404
        bad_response.content = b""

        with patch("api.upscale.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=[good_response, bad_response])
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            MockClient.return_value = mock_client

            await _build_zip(job_id, videos)

        try:
            assert _ZIP_JOBS[job_id]["status"] == "ready"
            result_zip = zipfile.ZipFile(io.BytesIO(_ZIP_JOBS[job_id]["zip_bytes"]))
            names = result_zip.namelist()
            assert "good_upscaled.mp4" in names
            assert "bad_upscaled.mp4" not in names
        finally:
            _ZIP_JOBS.pop(job_id, None)

    @pytest.mark.asyncio
    async def test_zip_build_sets_error_on_exception(self):
        """_build_zip sets status='error' if an unexpected exception occurs."""
        from api.upscale import _build_zip, _ZIP_JOBS

        job_id = "test-error-job"
        _ZIP_JOBS[job_id] = {
            "status": "pending",
            "created_at": time.time(),
            "progress_pct": 0.0,
            "files_done": 0,
            "total_files": 1,
            "error": None,
            "zip_bytes": None,
        }

        videos = [
            {
                "input_filename": "test.mp4",
                "output_storage_url": "https://example.com/test.mp4",
            },
        ]

        with patch("api.upscale.httpx.AsyncClient") as MockClient:
            MockClient.side_effect = RuntimeError("connection pool exhausted")

            await _build_zip(job_id, videos)

        try:
            assert _ZIP_JOBS[job_id]["status"] == "error"
            assert _ZIP_JOBS[job_id]["error"] is not None
            assert "connection pool exhausted" in _ZIP_JOBS[job_id]["error"]
        finally:
            _ZIP_JOBS.pop(job_id, None)

    def test_zip_download_not_found(self, client):
        """GET /api/upscale/zip-jobs/{id}/download returns 404 for unknown job."""
        response = client.get("/api/upscale/zip-jobs/unknown-id/download")
        assert response.status_code == 404

    def test_zip_creation_requires_auth(self, unauthenticated_client):
        """POST download-zip returns 401 without auth token."""
        response = unauthenticated_client.post("/api/upscale/batches/batch-001/download-zip")
        assert response.status_code == 401

    def test_zip_status_requires_auth(self, unauthenticated_client):
        """GET zip-jobs status returns 401 without auth token."""
        response = unauthenticated_client.get("/api/upscale/zip-jobs/some-id/status")
        assert response.status_code == 401

    def test_zip_download_requires_auth(self, unauthenticated_client):
        """GET zip-jobs download returns 401 without auth token."""
        response = unauthenticated_client.get("/api/upscale/zip-jobs/some-id/download")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Upload Video Tests (Phase 13 Plan 01)
# ---------------------------------------------------------------------------


class TestUploadVideo:
    """Tests for POST /api/upscale/upload-video."""

    @patch("api.upscale.StorageService")
    @patch("api.upscale.UpscaleJobService")
    def test_upload_video_returns_storage_url(self, MockJobService, MockStorage, client):
        """POST /api/upscale/upload-video with valid file returns 200 with storage_url."""
        # Mock batch exists
        instance = MockJobService.return_value
        instance.get_batch = AsyncMock(return_value={
            "id": "batch-001",
            "user_id": "test-user-id",
            "status": "pending",
            "total_videos": 0,
        })

        # Mock storage upload
        storage = MockStorage.return_value
        storage.supabase = MagicMock()
        mock_bucket = MagicMock()
        mock_bucket.upload.return_value = MagicMock()
        mock_bucket.get_public_url.return_value = "https://supabase.example.com/public/upscale-inputs/test-user-id/batch-001/test_video.mp4"
        storage.supabase.storage.from_.return_value = mock_bucket

        response = client.post(
            "/api/upscale/upload-video",
            data={"batch_id": "batch-001"},
            files={"file": ("test_video.mp4", b"fake-video-content", "video/mp4")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "storage_url" in data
        assert data["filename"] == "test_video.mp4"

    def test_upload_video_without_file_returns_422(self, client):
        """POST /api/upscale/upload-video without file returns 422."""
        response = client.post(
            "/api/upscale/upload-video",
            data={"batch_id": "batch-001"},
        )
        assert response.status_code == 422

    @patch("api.upscale.UpscaleJobService")
    def test_upload_video_nonexistent_batch_returns_404(self, MockJobService, client):
        """POST /api/upscale/upload-video with non-existent batch_id returns 404."""
        instance = MockJobService.return_value
        instance.get_batch = AsyncMock(return_value=None)

        response = client.post(
            "/api/upscale/upload-video",
            data={"batch_id": "nonexistent-batch"},
            files={"file": ("test_video.mp4", b"fake-video-content", "video/mp4")},
        )
        assert response.status_code == 404

    def test_upload_video_requires_auth(self, unauthenticated_client):
        """POST /api/upscale/upload-video without auth token returns 401."""
        response = unauthenticated_client.post(
            "/api/upscale/upload-video",
            data={"batch_id": "batch-001"},
            files={"file": ("test_video.mp4", b"fake-video-content", "video/mp4")},
        )
        assert response.status_code == 401
