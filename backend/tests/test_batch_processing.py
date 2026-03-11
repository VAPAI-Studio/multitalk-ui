"""
Integration tests for background batch processing functions.

Tests _process_single_video and _process_batch from api/upscale.py
with mocked FreepikUpscalerService and UpscaleJobService.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

SAMPLE_VIDEO = {
    "id": "video-001",
    "batch_id": "batch-001",
    "input_storage_url": "https://storage.example.com/input.mp4",
    "status": "pending",
    "queue_position": 1,
}

SAMPLE_BATCH = {
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
}


# ---------------------------------------------------------------------------
# _process_single_video
# ---------------------------------------------------------------------------

class TestProcessSingleVideo:
    """Tests for _process_single_video background function."""

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_calls_freepik_and_updates_completed(self, MockJobService, MockFreepik):
        """_process_single_video calls submit_task + poll_until_complete and updates to 'completed'."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        mock_freepik.poll_until_complete = AsyncMock(return_value=("COMPLETED", "https://output.url/video.mp4", None))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_completed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result is True
        mock_freepik.submit_task.assert_called_once()
        mock_freepik.poll_until_complete.assert_called_once_with("task-123")

        # Should have been called to set 'processing', then freepik_task_id, then 'completed'
        assert mock_job_svc.update_video_status.call_count >= 2
        mock_job_svc.increment_completed_count.assert_called_once_with("batch-001")

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_updates_video_to_failed_on_freepik_error(self, MockJobService, MockFreepik):
        """_process_single_video updates video status to 'failed' on Freepik error."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(False, None, "Freepik API error"))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_failed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result is False
        mock_job_svc.increment_failed_count.assert_called_once_with("batch-001")

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_updates_video_to_failed_on_poll_failure(self, MockJobService, MockFreepik):
        """_process_single_video updates video status to 'failed' when polling returns FAILED."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(True, "task-999", None))
        mock_freepik.poll_until_complete = AsyncMock(return_value=("FAILED", None, "Upscaling failed"))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_failed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result is False
        mock_job_svc.increment_failed_count.assert_called_once_with("batch-001")


# ---------------------------------------------------------------------------
# _process_batch
# ---------------------------------------------------------------------------

class TestProcessBatch:
    """Tests for _process_batch background function."""

    @pytest.mark.asyncio
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_updates_batch_heartbeat(self, MockJobService, mock_process_video):
        """_process_batch updates batch heartbeat during processing."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        # Return one video, then None (no more pending)
        mock_job_svc.get_next_pending_video = AsyncMock(side_effect=[SAMPLE_VIDEO, None])
        mock_job_svc.get_batch = AsyncMock(return_value=SAMPLE_BATCH)
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)
        mock_process_video.return_value = True

        await _process_batch("batch-001")

        mock_job_svc.update_batch_heartbeat.assert_called()

    @pytest.mark.asyncio
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_sets_batch_completed_when_no_more_pending(self, MockJobService, mock_process_video):
        """_process_batch sets batch status to 'completed' when no more pending videos."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        mock_job_svc.get_next_pending_video = AsyncMock(side_effect=[SAMPLE_VIDEO, None])
        mock_job_svc.get_batch = AsyncMock(return_value=SAMPLE_BATCH)
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)
        mock_process_video.return_value = True

        await _process_batch("batch-001")

        mock_job_svc.update_batch_status.assert_called_with("batch-001", "completed")
