"""
Tests for startup recovery of interrupted upscale batches.

Verifies the lifespan context manager finds batches with status='processing'
and resumes them on server startup.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Startup recovery tests
# ---------------------------------------------------------------------------


class TestStartupRecovery:
    """Tests for lifespan-based startup recovery."""

    @pytest.mark.asyncio
    @patch("main.asyncio")
    @patch("main.UpscaleJobService")
    async def test_resumes_interrupted_batches(self, MockService, mock_asyncio):
        """On startup, batches with status 'processing' are found and _process_batch is called."""
        from main import lifespan, app

        # Mock create_task to close the coroutine
        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batches_by_status = AsyncMock(return_value=[
            {"id": "batch-interrupted-1"},
            {"id": "batch-interrupted-2"},
        ])
        instance.fail_current_processing_video = AsyncMock(return_value=True)

        async with lifespan(app):
            pass

        # Should have queried for processing batches
        instance.get_batches_by_status.assert_called_once_with("processing")

        # Should have failed current processing video for each
        assert instance.fail_current_processing_video.call_count == 2

        # Should have launched background tasks for each
        assert mock_asyncio.create_task.call_count == 2

    @pytest.mark.asyncio
    @patch("main.asyncio")
    @patch("main.UpscaleJobService")
    async def test_marks_processing_video_as_failed(self, MockService, mock_asyncio):
        """On startup, the video that was 'processing' when server died is marked 'failed'."""
        from main import lifespan, app

        def _close_coro(coro):
            coro.close()
            return MagicMock()
        mock_asyncio.create_task.side_effect = _close_coro

        instance = MockService.return_value
        instance.get_batches_by_status = AsyncMock(return_value=[
            {"id": "batch-crashed"},
        ])
        instance.fail_current_processing_video = AsyncMock(return_value=True)

        async with lifespan(app):
            pass

        instance.fail_current_processing_video.assert_called_once_with(
            "batch-crashed",
            "Server restart interrupted processing",
        )

    @pytest.mark.asyncio
    @patch("main.asyncio")
    @patch("main.UpscaleJobService")
    async def test_no_interrupted_batches_no_error(self, MockService, mock_asyncio):
        """On startup, if no interrupted batches exist, nothing happens (no errors)."""
        from main import lifespan, app

        instance = MockService.return_value
        instance.get_batches_by_status = AsyncMock(return_value=[])

        async with lifespan(app):
            pass

        instance.get_batches_by_status.assert_called_once_with("processing")
        mock_asyncio.create_task.assert_not_called()

    @pytest.mark.asyncio
    @patch("main.asyncio")
    @patch("main.UpscaleJobService")
    async def test_lifespan_yields_cleanly(self, MockService, mock_asyncio):
        """Lifespan yields cleanly (no shutdown errors)."""
        from main import lifespan, app

        instance = MockService.return_value
        instance.get_batches_by_status = AsyncMock(return_value=[])

        # Should not raise
        async with lifespan(app):
            # Startup complete -- app running
            pass
        # Shutdown complete -- no errors

    @pytest.mark.asyncio
    @patch("main.asyncio")
    @patch("main.UpscaleJobService")
    async def test_recovery_error_is_non_fatal(self, MockService, mock_asyncio):
        """Recovery errors are caught and logged (non-fatal -- app still starts)."""
        from main import lifespan, app

        instance = MockService.return_value
        instance.get_batches_by_status = AsyncMock(side_effect=Exception("DB connection failed"))

        # Should NOT raise even though get_batches_by_status raises
        async with lifespan(app):
            pass
