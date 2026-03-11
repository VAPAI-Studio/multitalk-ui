"""
Unit tests for UpscaleJobService.

All Supabase operations are mocked via the mock_supabase fixture in conftest.py.
Tests verify the correct table names, query methods, parameters, and return values.
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_execute_result(data=None, count=0):
    """Build a mock Supabase execute() result."""
    result = MagicMock()
    result.data = data if data is not None else []
    result.count = count
    return result


def _sample_batch_row(**overrides):
    """Return a sample batch row dict (as returned by Supabase)."""
    row = {
        "id": "batch-001",
        "user_id": "user-abc",
        "status": "pending",
        "resolution": "2k",
        "creativity": 0,
        "sharpen": 0,
        "grain": 0,
        "fps_boost": False,
        "flavor": "vivid",
        "project_id": None,
        "total_videos": 0,
        "completed_videos": 0,
        "failed_videos": 0,
        "created_at": "2026-03-11T12:00:00Z",
        "started_at": None,
        "completed_at": None,
        "error_message": None,
    }
    row.update(overrides)
    return row


def _sample_video_row(**overrides):
    """Return a sample video row dict (as returned by Supabase)."""
    row = {
        "id": "video-001",
        "batch_id": "batch-001",
        "status": "pending",
        "queue_position": 1,
        "input_filename": "video.mp4",
        "input_storage_url": "https://storage.example.com/video.mp4",
        "freepik_task_id": None,
        "output_storage_url": None,
        "error_message": None,
        "created_at": "2026-03-11T12:00:00Z",
        "started_at": None,
        "completed_at": None,
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# create_batch
# ---------------------------------------------------------------------------

class TestCreateBatch:

    @pytest.mark.asyncio
    async def test_create_batch_success(self, upscale_job_service, mock_supabase):
        """create_batch inserts into upscale_batches and returns batch data."""
        batch_row = _sample_batch_row()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_execute_result(data=[batch_row])
        )

        from models.upscale import UpscaleSettings
        success, data, error = await upscale_job_service.create_batch(
            user_id="user-abc",
            settings=UpscaleSettings(),
        )

        assert success is True
        assert data is not None
        assert data["id"] == "batch-001"
        assert error is None

        # Verify correct table was used
        mock_supabase.table.assert_called_with("upscale_batches")


# ---------------------------------------------------------------------------
# add_video_to_batch
# ---------------------------------------------------------------------------

class TestAddVideoToBatch:

    @pytest.mark.asyncio
    async def test_add_video_success(self, upscale_job_service, mock_supabase):
        """add_video_to_batch inserts into upscale_videos with correct queue_position."""
        video_row = _sample_video_row()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = (
            _make_execute_result(data=[video_row])
        )
        # Mock the update for total_videos increment
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            _make_execute_result(data=[_sample_batch_row(total_videos=1)])
        )

        success, data, error = await upscale_job_service.add_video_to_batch(
            batch_id="batch-001",
            user_id="user-abc",
            input_filename="video.mp4",
            input_storage_url="https://storage.example.com/video.mp4",
            queue_position=1,
        )

        assert success is True
        assert data is not None
        assert error is None


# ---------------------------------------------------------------------------
# get_batch
# ---------------------------------------------------------------------------

class TestGetBatch:

    @pytest.mark.asyncio
    async def test_get_batch_with_videos(self, upscale_job_service, mock_supabase):
        """get_batch returns batch with nested videos list."""
        batch_row = _sample_batch_row()

        # Mock batch query
        mock_table = mock_supabase.table.return_value
        mock_table.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = (
            _make_execute_result(data=batch_row)
        )

        # For the videos sub-query, we need a separate table call
        # Since mock_supabase.table always returns the same mock_table,
        # we'll configure a side effect
        videos = [_sample_video_row(queue_position=1), _sample_video_row(id="video-002", queue_position=2)]

        call_count = [0]
        original_table = mock_supabase.table

        def table_side_effect(name):
            call_count[0] += 1
            mock = MagicMock()
            for method in ("select", "insert", "update", "delete", "upsert"):
                getattr(mock, method).return_value = mock
            for method in ("eq", "neq", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "is_"):
                getattr(mock, method).return_value = mock

            if name == "upscale_batches":
                mock.execute.return_value = _make_execute_result(data=batch_row)
            elif name == "upscale_videos":
                mock.execute.return_value = _make_execute_result(data=videos)
            return mock

        mock_supabase.table.side_effect = table_side_effect

        result = await upscale_job_service.get_batch("batch-001", "user-abc")

        assert result is not None
        assert result["id"] == "batch-001"
        assert "videos" in result

    @pytest.mark.asyncio
    async def test_get_batch_not_found(self, upscale_job_service, mock_supabase):
        """get_batch returns None for non-existent batch_id."""
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.side_effect = (
            Exception("No rows found")
        )

        result = await upscale_job_service.get_batch("nonexistent", "user-abc")

        assert result is None


# ---------------------------------------------------------------------------
# list_user_batches
# ---------------------------------------------------------------------------

class TestListUserBatches:

    @pytest.mark.asyncio
    async def test_list_user_batches(self, upscale_job_service, mock_supabase):
        """list_user_batches returns batches for given user_id ordered by created_at desc."""
        batches = [
            _sample_batch_row(id="batch-002", created_at="2026-03-11T13:00:00Z"),
            _sample_batch_row(id="batch-001", created_at="2026-03-11T12:00:00Z"),
        ]
        mock_supabase.table.return_value.execute.return_value = _make_execute_result(data=batches)

        result = await upscale_job_service.list_user_batches("user-abc")

        assert len(result) == 2
        assert result[0]["id"] == "batch-002"


# ---------------------------------------------------------------------------
# update_batch_status
# ---------------------------------------------------------------------------

class TestUpdateBatchStatus:

    @pytest.mark.asyncio
    async def test_update_status_to_processing(self, upscale_job_service, mock_supabase):
        """update_batch_status sets started_at when transitioning to 'processing'."""
        mock_supabase.table.return_value.execute.return_value = (
            _make_execute_result(data=[_sample_batch_row(status="processing")])
        )

        result = await upscale_job_service.update_batch_status("batch-001", "processing")

        assert result is True
        # Verify update was called with started_at
        call_args = mock_supabase.table.return_value.update.call_args
        update_dict = call_args[0][0] if call_args[0] else call_args.kwargs.get("data", {})
        assert "started_at" in update_dict


# ---------------------------------------------------------------------------
# update_video_status
# ---------------------------------------------------------------------------

class TestUpdateVideoStatus:

    @pytest.mark.asyncio
    async def test_update_video_to_processing(self, upscale_job_service, mock_supabase):
        """update_video_status sets started_at when status='processing'."""
        mock_supabase.table.return_value.execute.return_value = (
            _make_execute_result(data=[_sample_video_row(status="processing")])
        )

        result = await upscale_job_service.update_video_status("video-001", "processing")

        assert result is True
        call_args = mock_supabase.table.return_value.update.call_args
        update_dict = call_args[0][0] if call_args[0] else call_args.kwargs.get("data", {})
        assert "started_at" in update_dict


# ---------------------------------------------------------------------------
# increment_completed_count / increment_failed_count
# ---------------------------------------------------------------------------

class TestIncrementCounts:

    @pytest.mark.asyncio
    async def test_increment_completed_count(self, upscale_job_service, mock_supabase):
        """increment_completed_count increments completed_videos on batch."""
        # First query: get current count
        mock_table = mock_supabase.table.return_value
        batch_row = _sample_batch_row(completed_videos=2)

        call_count = [0]

        def table_side_effect(name):
            call_count[0] += 1
            mock = MagicMock()
            for method in ("select", "insert", "update", "delete", "upsert"):
                getattr(mock, method).return_value = mock
            for method in ("eq", "neq", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "is_"):
                getattr(mock, method).return_value = mock
            mock.execute.return_value = _make_execute_result(data=[batch_row])
            return mock

        mock_supabase.table.side_effect = table_side_effect

        result = await upscale_job_service.increment_completed_count("batch-001")

        assert result is True

    @pytest.mark.asyncio
    async def test_increment_failed_count(self, upscale_job_service, mock_supabase):
        """increment_failed_count increments failed_videos on batch."""
        batch_row = _sample_batch_row(failed_videos=1)

        def table_side_effect(name):
            mock = MagicMock()
            for method in ("select", "insert", "update", "delete", "upsert"):
                getattr(mock, method).return_value = mock
            for method in ("eq", "neq", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "is_"):
                getattr(mock, method).return_value = mock
            mock.execute.return_value = _make_execute_result(data=[batch_row])
            return mock

        mock_supabase.table.side_effect = table_side_effect

        result = await upscale_job_service.increment_failed_count("batch-001")

        assert result is True


# ---------------------------------------------------------------------------
# get_next_pending_video
# ---------------------------------------------------------------------------

class TestGetNextPendingVideo:

    @pytest.mark.asyncio
    async def test_get_next_pending_video(self, upscale_job_service, mock_supabase):
        """get_next_pending_video returns lowest queue_position video with status 'pending'."""
        video_row = _sample_video_row(status="pending", queue_position=1)
        mock_supabase.table.return_value.execute.return_value = (
            _make_execute_result(data=[video_row])
        )

        result = await upscale_job_service.get_next_pending_video("batch-001")

        assert result is not None
        assert result["status"] == "pending"
        assert result["queue_position"] == 1


# ---------------------------------------------------------------------------
# get_batches_by_status
# ---------------------------------------------------------------------------

class TestGetBatchesByStatus:

    @pytest.mark.asyncio
    async def test_get_batches_by_status(self, upscale_job_service, mock_supabase):
        """get_batches_by_status returns all batches matching given status."""
        batches = [
            _sample_batch_row(id="batch-001", status="processing"),
            _sample_batch_row(id="batch-002", status="processing"),
        ]
        mock_supabase.table.return_value.execute.return_value = _make_execute_result(data=batches)

        result = await upscale_job_service.get_batches_by_status("processing")

        assert len(result) == 2
        assert all(b["status"] == "processing" for b in result)


# ---------------------------------------------------------------------------
# update_batch_heartbeat
# ---------------------------------------------------------------------------

class TestUpdateBatchHeartbeat:

    @pytest.mark.asyncio
    async def test_update_batch_heartbeat(self, upscale_job_service, mock_supabase):
        """update_batch_heartbeat updates last_heartbeat timestamp."""
        mock_supabase.table.return_value.execute.return_value = (
            _make_execute_result(data=[_sample_batch_row()])
        )

        result = await upscale_job_service.update_batch_heartbeat("batch-001")

        assert result is True
        call_args = mock_supabase.table.return_value.update.call_args
        update_dict = call_args[0][0] if call_args[0] else call_args.kwargs.get("data", {})
        assert "last_heartbeat" in update_dict


# ---------------------------------------------------------------------------
# fail_current_processing_video
# ---------------------------------------------------------------------------

class TestFailCurrentProcessingVideo:

    @pytest.mark.asyncio
    async def test_fail_current_processing_video(self, upscale_job_service, mock_supabase):
        """fail_current_processing_video finds video with status='processing' and marks failed."""
        video_row = _sample_video_row(status="processing")

        call_count = [0]

        def table_side_effect(name):
            call_count[0] += 1
            mock = MagicMock()
            for method in ("select", "insert", "update", "delete", "upsert"):
                getattr(mock, method).return_value = mock
            for method in ("eq", "neq", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "is_"):
                getattr(mock, method).return_value = mock
            # First call (select processing video), second call (update)
            mock.execute.return_value = _make_execute_result(data=[video_row])
            return mock

        mock_supabase.table.side_effect = table_side_effect

        result = await upscale_job_service.fail_current_processing_video(
            "batch-001", "Connection lost"
        )

        assert result is True
