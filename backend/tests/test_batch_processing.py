"""
Integration tests for background batch processing functions.

Tests _process_single_video, _process_video_with_retry, and _process_batch
from api/upscale.py with mocked FreepikUpscalerService and UpscaleJobService.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from models.upscale import ProcessingResult


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

        assert result.success is True
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

        assert result.success is False
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

        assert result.success is False
        mock_job_svc.increment_failed_count.assert_called_once_with("batch-001")


# ---------------------------------------------------------------------------
# TestErrorClassification (integration with _process_single_video)
# ---------------------------------------------------------------------------

class TestErrorClassification:
    """Tests that _process_single_video returns ProcessingResult with correct error classification."""

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_returns_success_result_on_completion(self, MockJobService, MockFreepik):
        """_process_single_video returns ProcessingResult(success=True) on successful completion."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(True, "task-123", None))
        mock_freepik.poll_until_complete = AsyncMock(return_value=("COMPLETED", "https://output.url/video.mp4", None))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_completed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert isinstance(result, ProcessingResult)
        assert result.success is True
        assert result.failure_type is None

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_classifies_transient_on_5xx(self, MockJobService, MockFreepik):
        """_process_single_video classifies 5xx as transient failure."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(False, None, "HTTP 500 error"))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_failed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result.success is False
        assert result.failure_type == "transient"
        assert result.should_pause_batch is False

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_classifies_credit_exhaustion_on_402(self, MockJobService, MockFreepik):
        """_process_single_video classifies 402 as credit_exhaustion with should_pause_batch."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(False, None, "HTTP error 402"))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_failed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result.success is False
        assert result.failure_type == "credit_exhaustion"
        assert result.should_pause_batch is True

    @pytest.mark.asyncio
    @patch("api.upscale.FreepikUpscalerService")
    @patch("api.upscale.UpscaleJobService")
    async def test_classifies_permanent_on_400(self, MockJobService, MockFreepik):
        """_process_single_video classifies 400 as permanent failure."""
        from api.upscale import _process_single_video

        mock_freepik = MockFreepik.return_value
        mock_freepik.submit_task = AsyncMock(return_value=(False, None, "HTTP 400 Bad Request"))

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_status = AsyncMock(return_value=True)
        mock_job_svc.increment_failed_count = AsyncMock(return_value=True)

        result = await _process_single_video(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result.success is False
        assert result.failure_type == "permanent"


# ---------------------------------------------------------------------------
# TestRetryLogic
# ---------------------------------------------------------------------------

class TestRetryLogic:
    """Tests for _process_video_with_retry retry wrapper."""

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_retries_transient_up_to_max(self, MockJobService, mock_process, mock_sleep):
        """_process_video_with_retry retries transient failures up to 2 times (3 total attempts)."""
        from api.upscale import _process_video_with_retry

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_retry_count = AsyncMock(return_value=True)

        # All 3 attempts fail with transient
        mock_process.return_value = ProcessingResult(
            success=False, failure_type="transient", error_message="HTTP 500 error",
        )

        result = await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert mock_process.call_count == 3
        assert result.success is False

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_succeeds_on_retry(self, MockJobService, mock_process, mock_sleep):
        """_process_video_with_retry returns success if second attempt succeeds."""
        from api.upscale import _process_video_with_retry

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_retry_count = AsyncMock(return_value=True)

        # First attempt fails transient, second succeeds
        mock_process.side_effect = [
            ProcessingResult(success=False, failure_type="transient", error_message="HTTP 500 error"),
            ProcessingResult(success=True),
        ]

        result = await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert result.success is True
        assert mock_process.call_count == 2

    @pytest.mark.asyncio
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_no_retry_on_credit_exhaustion(self, MockJobService, mock_process):
        """_process_video_with_retry does NOT retry credit_exhaustion errors."""
        from api.upscale import _process_video_with_retry

        mock_process.return_value = ProcessingResult(
            success=False, failure_type="credit_exhaustion",
            error_message="HTTP error 402", should_pause_batch=True,
        )

        result = await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert mock_process.call_count == 1
        assert result.failure_type == "credit_exhaustion"

    @pytest.mark.asyncio
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_no_retry_on_permanent(self, MockJobService, mock_process):
        """_process_video_with_retry does NOT retry permanent errors."""
        from api.upscale import _process_video_with_retry

        mock_process.return_value = ProcessingResult(
            success=False, failure_type="permanent",
            error_message="HTTP 400 Bad Request",
        )

        result = await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        assert mock_process.call_count == 1
        assert result.failure_type == "permanent"

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_increments_retry_count(self, MockJobService, mock_process, mock_sleep):
        """_process_video_with_retry increments retry_count on each retry attempt."""
        from api.upscale import _process_video_with_retry

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_retry_count = AsyncMock(return_value=True)

        # Fail transient twice, succeed on third
        mock_process.side_effect = [
            ProcessingResult(success=False, failure_type="transient", error_message="HTTP 500"),
            ProcessingResult(success=False, failure_type="transient", error_message="HTTP 500"),
            ProcessingResult(success=True),
        ]

        await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        # Should have updated retry_count for attempts 1 and 2 (the retries)
        calls = mock_job_svc.update_video_retry_count.call_args_list
        assert len(calls) == 2
        assert calls[0][0] == ("video-001", 1)
        assert calls[1][0] == ("video-001", 2)

    @pytest.mark.asyncio
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("api.upscale._process_single_video", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_backoff_sleep(self, MockJobService, mock_process, mock_sleep):
        """_process_video_with_retry waits with exponential backoff: 2s then 4s."""
        from api.upscale import _process_video_with_retry

        mock_job_svc = MockJobService.return_value
        mock_job_svc.update_video_retry_count = AsyncMock(return_value=True)

        # All 3 attempts fail transient
        mock_process.return_value = ProcessingResult(
            success=False, failure_type="transient", error_message="HTTP 500",
        )

        await _process_video_with_retry(SAMPLE_VIDEO, SAMPLE_BATCH)

        # Should sleep between retries: 2s (BASE_DELAY * 2^0) and 4s (BASE_DELAY * 2^1)
        sleep_calls = mock_sleep.call_args_list
        assert len(sleep_calls) == 2
        assert sleep_calls[0][0][0] == 2  # BASE_DELAY * 2^0 = 2
        assert sleep_calls[1][0][0] == 4  # BASE_DELAY * 2^1 = 4


# ---------------------------------------------------------------------------
# TestCreditExhaustion (enhanced _process_batch)
# ---------------------------------------------------------------------------

class TestCreditExhaustion:
    """Tests for credit exhaustion handling in _process_batch."""

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_pauses_pending_on_credit_exhaustion(self, MockJobService, mock_retry):
        """_process_batch calls pause_all_pending_videos and pause_batch on credit exhaustion."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        mock_job_svc.get_next_pending_video = AsyncMock(return_value=SAMPLE_VIDEO)
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)
        mock_job_svc.pause_all_pending_videos = AsyncMock(return_value=True)
        mock_job_svc.pause_batch = AsyncMock(return_value=True)

        # Mock _get_batch_for_processing
        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            mock_get_batch.return_value = SAMPLE_BATCH

            mock_retry.return_value = ProcessingResult(
                success=False, failure_type="credit_exhaustion",
                error_message="HTTP error 402", should_pause_batch=True,
            )

            await _process_batch("batch-001")

        mock_job_svc.pause_all_pending_videos.assert_called_once_with("batch-001")
        mock_job_svc.pause_batch.assert_called_once_with("batch-001", "credit_exhaustion")

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_breaks_loop_on_credit_exhaustion(self, MockJobService, mock_retry):
        """_process_batch breaks the loop on credit exhaustion (does not process more videos)."""
        from api.upscale import _process_batch

        second_video = {**SAMPLE_VIDEO, "id": "video-002", "queue_position": 2}

        mock_job_svc = MockJobService.return_value
        # Return two videos -- but second should never be processed
        mock_job_svc.get_next_pending_video = AsyncMock(
            side_effect=[SAMPLE_VIDEO, second_video, None]
        )
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)
        mock_job_svc.pause_all_pending_videos = AsyncMock(return_value=True)
        mock_job_svc.pause_batch = AsyncMock(return_value=True)

        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            mock_get_batch.return_value = SAMPLE_BATCH

            mock_retry.return_value = ProcessingResult(
                success=False, failure_type="credit_exhaustion",
                error_message="HTTP error 402", should_pause_batch=True,
            )

            await _process_batch("batch-001")

        # Only first video should have been processed
        assert mock_retry.call_count == 1

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_completes_normally_when_no_credit_issues(self, MockJobService, mock_retry):
        """_process_batch sets batch to 'completed' when all videos processed without credit issues."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        mock_job_svc.get_next_pending_video = AsyncMock(side_effect=[SAMPLE_VIDEO, None])
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)

        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            mock_get_batch.return_value = SAMPLE_BATCH

            mock_retry.return_value = ProcessingResult(success=True)

            await _process_batch("batch-001")

        mock_job_svc.update_batch_status.assert_called_with("batch-001", "completed")


# ---------------------------------------------------------------------------
# TestBatchStatusCheck
# ---------------------------------------------------------------------------

class TestBatchStatusCheck:
    """Tests for batch status re-checking during processing loop."""

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_exits_if_batch_not_processing(self, MockJobService, mock_retry):
        """_process_batch exits if batch status is no longer 'processing' on re-check."""
        from api.upscale import _process_batch

        second_video = {**SAMPLE_VIDEO, "id": "video-002", "queue_position": 2}

        mock_job_svc = MockJobService.return_value
        mock_job_svc.get_next_pending_video = AsyncMock(
            side_effect=[SAMPLE_VIDEO, second_video, None]
        )
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)

        paused_batch = {**SAMPLE_BATCH, "status": "paused"}

        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            # First call returns processing batch, second returns paused batch
            mock_get_batch.side_effect = [SAMPLE_BATCH, paused_batch]

            mock_retry.return_value = ProcessingResult(success=True)

            await _process_batch("batch-001")

        # Only first video should have been processed (exits after re-check sees 'paused')
        assert mock_retry.call_count == 1


# ---------------------------------------------------------------------------
# _process_batch (updated existing tests)
# ---------------------------------------------------------------------------

class TestProcessBatch:
    """Tests for _process_batch background function."""

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_updates_batch_heartbeat(self, MockJobService, mock_retry):
        """_process_batch updates batch heartbeat during processing."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        # Return one video, then None (no more pending)
        mock_job_svc.get_next_pending_video = AsyncMock(side_effect=[SAMPLE_VIDEO, None])
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)

        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            mock_get_batch.return_value = SAMPLE_BATCH
            mock_retry.return_value = ProcessingResult(success=True)

            await _process_batch("batch-001")

        mock_job_svc.update_batch_heartbeat.assert_called()

    @pytest.mark.asyncio
    @patch("api.upscale._process_video_with_retry", new_callable=AsyncMock)
    @patch("api.upscale.UpscaleJobService")
    async def test_sets_batch_completed_when_no_more_pending(self, MockJobService, mock_retry):
        """_process_batch sets batch status to 'completed' when no more pending videos."""
        from api.upscale import _process_batch

        mock_job_svc = MockJobService.return_value
        mock_job_svc.get_next_pending_video = AsyncMock(side_effect=[SAMPLE_VIDEO, None])
        mock_job_svc.update_batch_heartbeat = AsyncMock(return_value=True)
        mock_job_svc.update_batch_status = AsyncMock(return_value=True)

        with patch("api.upscale._get_batch_for_processing", new_callable=AsyncMock) as mock_get_batch:
            mock_get_batch.return_value = SAMPLE_BATCH
            mock_retry.return_value = ProcessingResult(success=True)

            await _process_batch("batch-001")

        mock_job_svc.update_batch_status.assert_called_with("batch-001", "completed")
