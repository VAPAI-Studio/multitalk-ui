"""
Unit tests for FreepikUpscalerService.

All HTTP calls are mocked via httpx.AsyncClient patching.
Settings are patched via the mock_freepik_settings fixture in conftest.py.
"""
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# submit_task tests
# ---------------------------------------------------------------------------

class TestSubmitTask:
    """Tests for FreepikUpscalerService.submit_task"""

    @pytest.mark.asyncio
    async def test_submit_task_success(self, freepik_service):
        """submit_task returns (True, task_id, None) on successful 200 response."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": {"task_id": "abc123"}}
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            success, task_id, error = await freepik_service.submit_task(
                video_url="https://example.com/video.mp4",
                resolution="2k",
            )

        assert success is True
        assert task_id == "abc123"
        assert error is None

    @pytest.mark.asyncio
    async def test_submit_task_missing_api_key(self, mock_freepik_settings):
        """submit_task returns (False, None, error_msg) when FREEPIK_API_KEY is empty."""
        mock_freepik_settings.FREEPIK_API_KEY = ""

        from services.freepik_service import FreepikUpscalerService
        service = FreepikUpscalerService()

        success, task_id, error = await service.submit_task(
            video_url="https://example.com/video.mp4",
            resolution="2k",
        )

        assert success is False
        assert task_id is None
        assert error is not None
        assert "api key" in error.lower() or "API key" in error

    @pytest.mark.asyncio
    async def test_submit_task_http_error(self, freepik_service):
        """submit_task returns (False, None, error_msg) on HTTP 400/422/500 error."""
        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.json.return_value = {"error": "Invalid parameters"}
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "422 Unprocessable Entity",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            success, task_id, error = await freepik_service.submit_task(
                video_url="https://example.com/video.mp4",
                resolution="2k",
            )

        assert success is False
        assert task_id is None
        assert error is not None

    @pytest.mark.asyncio
    async def test_submit_task_timeout(self, freepik_service):
        """submit_task returns (False, None, error_msg) on timeout."""
        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.side_effect = httpx.TimeoutException("Connection timed out")
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            success, task_id, error = await freepik_service.submit_task(
                video_url="https://example.com/video.mp4",
                resolution="2k",
            )

        assert success is False
        assert task_id is None
        assert error is not None
        assert "timed out" in error.lower() or "timeout" in error.lower()

    @pytest.mark.asyncio
    async def test_submit_task_resolution_mapping(self, freepik_service):
        """submit_task maps resolution '2k' to '1440p' in payload."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": {"task_id": "xyz789"}}
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            await freepik_service.submit_task(
                video_url="https://example.com/video.mp4",
                resolution="2k",
            )

            # Inspect the JSON payload sent to the API
            call_kwargs = mock_client_instance.post.call_args
            payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
            assert payload is not None
            assert payload.get("resolution") == "1440p"


# ---------------------------------------------------------------------------
# check_task_status tests
# ---------------------------------------------------------------------------

class TestCheckTaskStatus:
    """Tests for FreepikUpscalerService.check_task_status"""

    @pytest.mark.asyncio
    async def test_check_status_completed(self, freepik_service):
        """check_task_status returns ('COMPLETED', output_url, None) when task is done."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "status": "COMPLETED",
                "generated": ["https://cdn.freepik.com/output/video.mp4"],
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            status, output_url, error = await freepik_service.check_task_status("abc123")

        assert status == "COMPLETED"
        assert output_url == "https://cdn.freepik.com/output/video.mp4"
        assert error is None

    @pytest.mark.asyncio
    async def test_check_status_in_progress(self, freepik_service):
        """check_task_status returns ('IN_PROGRESS', None, None) when task is processing."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "status": "IN_PROGRESS",
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            status, output_url, error = await freepik_service.check_task_status("abc123")

        assert status == "IN_PROGRESS"
        assert output_url is None
        assert error is None

    @pytest.mark.asyncio
    async def test_check_status_failed(self, freepik_service):
        """check_task_status returns ('FAILED', None, error_msg) when task failed."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": {
                "status": "FAILED",
                "error": "Video processing failed",
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            status, output_url, error = await freepik_service.check_task_status("abc123")

        assert status == "FAILED"
        assert output_url is None
        assert error is not None

    @pytest.mark.asyncio
    async def test_check_status_http_error(self, freepik_service):
        """check_task_status returns ('ERROR', None, error_msg) on HTTP error."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.json.return_value = {}
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.get.return_value = mock_response
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client_instance

            status, output_url, error = await freepik_service.check_task_status("abc123")

        assert status == "ERROR"
        assert output_url is None
        assert error is not None


# ---------------------------------------------------------------------------
# poll_until_complete tests
# ---------------------------------------------------------------------------

class TestPollUntilComplete:
    """Tests for FreepikUpscalerService.poll_until_complete"""

    @pytest.mark.asyncio
    async def test_poll_returns_terminal_state(self, freepik_service):
        """poll_until_complete returns terminal state within timeout."""
        # First call: IN_PROGRESS, second call: COMPLETED
        with patch.object(
            freepik_service, "check_task_status",
            new_callable=AsyncMock,
            side_effect=[
                ("IN_PROGRESS", None, None),
                ("COMPLETED", "https://cdn.freepik.com/output.mp4", None),
            ],
        ), patch("asyncio.sleep", new_callable=AsyncMock):
            status, output_url, error = await freepik_service.poll_until_complete("abc123")

        assert status == "COMPLETED"
        assert output_url == "https://cdn.freepik.com/output.mp4"
        assert error is None

    @pytest.mark.asyncio
    async def test_poll_timeout(self, freepik_service):
        """poll_until_complete returns ('TIMEOUT', None, error_msg) when exceeding timeout."""
        # Always return IN_PROGRESS -- will exceed the 10s test timeout
        with patch.object(
            freepik_service, "check_task_status",
            new_callable=AsyncMock,
            return_value=("IN_PROGRESS", None, None),
        ), patch("asyncio.sleep", new_callable=AsyncMock):
            status, output_url, error = await freepik_service.poll_until_complete(
                "abc123", timeout=0  # immediate timeout
            )

        assert status == "TIMEOUT"
        assert output_url is None
        assert error is not None
        assert "timeout" in error.lower() or "exceeded" in error.lower()
