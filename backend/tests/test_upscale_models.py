"""
Tests for upscale Pydantic models: UpscaleSettings, CreateBatchPayload,
AddVideoPayload, BatchResponse, UpscaleBatch, UpscaleVideo, BatchDetailResponse.

Tests validation ranges, default values, Literal type constraints,
and model instantiation.
"""
import pytest
from datetime import datetime


class TestUpscaleSettingsDefaults:
    """Test that UpscaleSettings defaults match SETT-02 specification."""

    def test_defaults_match_sett02(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings()
        assert s.resolution == '2k'
        assert s.creativity == 0
        assert s.sharpen == 0
        assert s.grain == 0
        assert s.fps_boost is False
        assert s.flavor == 'vivid'

    def test_model_dump_defaults(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings()
        d = s.model_dump()
        assert d == {
            'resolution': '2k',
            'creativity': 0,
            'sharpen': 0,
            'grain': 0,
            'fps_boost': False,
            'flavor': 'vivid',
        }


class TestUpscaleSettingsValidRanges:
    """Test that valid values are accepted."""

    def test_creativity_valid_mid(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(creativity=50)
        assert s.creativity == 50

    def test_creativity_valid_max(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(creativity=100)
        assert s.creativity == 100

    def test_creativity_valid_min(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(creativity=0)
        assert s.creativity == 0

    def test_sharpen_valid(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(sharpen=75)
        assert s.sharpen == 75

    def test_grain_valid(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(grain=100)
        assert s.grain == 100

    def test_resolution_1k(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(resolution='1k')
        assert s.resolution == '1k'

    def test_resolution_4k(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(resolution='4k')
        assert s.resolution == '4k'

    def test_flavor_natural(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(flavor='natural')
        assert s.flavor == 'natural'

    def test_fps_boost_true(self):
        from models.upscale import UpscaleSettings
        s = UpscaleSettings(fps_boost=True)
        assert s.fps_boost is True


class TestUpscaleSettingsInvalidValues:
    """Test that invalid values raise ValidationError."""

    def test_creativity_too_high(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(creativity=101)

    def test_creativity_negative(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(creativity=-1)

    def test_sharpen_too_high(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(sharpen=101)

    def test_sharpen_negative(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(sharpen=-1)

    def test_grain_too_high(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(grain=200)

    def test_grain_negative(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(grain=-5)

    def test_resolution_8k_invalid(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(resolution='8k')

    def test_flavor_cinematic_invalid(self):
        from pydantic import ValidationError
        from models.upscale import UpscaleSettings
        with pytest.raises(ValidationError):
            UpscaleSettings(flavor='cinematic')


class TestCreateBatchPayload:
    """Test CreateBatchPayload defaults and custom settings."""

    def test_default_settings(self):
        from models.upscale import CreateBatchPayload, UpscaleSettings
        p = CreateBatchPayload()
        assert isinstance(p.settings, UpscaleSettings)
        assert p.settings.resolution == '2k'
        assert p.project_id is None

    def test_custom_settings(self):
        from models.upscale import CreateBatchPayload, UpscaleSettings
        p = CreateBatchPayload(settings=UpscaleSettings(resolution='4k'))
        assert p.settings.resolution == '4k'

    def test_with_project_id(self):
        from models.upscale import CreateBatchPayload
        p = CreateBatchPayload(project_id='drive-folder-123')
        assert p.project_id == 'drive-folder-123'


class TestAddVideoPayload:
    """Test AddVideoPayload requires input_filename and input_storage_url."""

    def test_requires_input_filename(self):
        from pydantic import ValidationError
        from models.upscale import AddVideoPayload
        with pytest.raises(ValidationError):
            AddVideoPayload(input_storage_url='https://example.com/video.mp4')

    def test_requires_input_storage_url(self):
        from pydantic import ValidationError
        from models.upscale import AddVideoPayload
        with pytest.raises(ValidationError):
            AddVideoPayload(input_filename='video.mp4')

    def test_valid_payload(self):
        from models.upscale import AddVideoPayload
        p = AddVideoPayload(
            input_filename='video.mp4',
            input_storage_url='https://example.com/video.mp4'
        )
        assert p.input_filename == 'video.mp4'
        assert p.input_storage_url == 'https://example.com/video.mp4'
        assert p.input_file_size is None
        assert p.duration_seconds is None
        assert p.width is None
        assert p.height is None

    def test_with_optional_fields(self):
        from models.upscale import AddVideoPayload
        p = AddVideoPayload(
            input_filename='video.mp4',
            input_storage_url='https://example.com/video.mp4',
            input_file_size=50_000_000,
            duration_seconds=12.5,
            width=1920,
            height=1080
        )
        assert p.input_file_size == 50_000_000
        assert p.duration_seconds == 12.5
        assert p.width == 1920
        assert p.height == 1080


class TestStatusLiterals:
    """Test BatchStatus and VideoStatus Literal types accept valid values."""

    def test_batch_status_values(self):
        from models.upscale import BatchResponse
        for status in ['pending', 'processing', 'completed', 'failed', 'paused', 'cancelled']:
            r = BatchResponse(success=True, status=status)
            assert r.status == status

    def test_video_status_values(self):
        from models.upscale import UpscaleVideo
        for status in ['pending', 'processing', 'completed', 'failed', 'paused']:
            v = UpscaleVideo(
                id='test-id',
                batch_id='batch-id',
                status=status,
                queue_position=0,
                input_filename='video.mp4',
                input_storage_url='https://example.com/video.mp4',
                created_at=datetime(2026, 3, 11)
            )
            assert v.status == status


class TestResponseModels:
    """Test response models can be instantiated with valid data."""

    def test_batch_response(self):
        from models.upscale import BatchResponse
        r = BatchResponse(success=True, batch_id='abc-123', status='pending')
        assert r.success is True
        assert r.batch_id == 'abc-123'
        assert r.status == 'pending'
        assert r.error is None

    def test_batch_response_error(self):
        from models.upscale import BatchResponse
        r = BatchResponse(success=False, error='Something failed')
        assert r.success is False
        assert r.batch_id is None
        assert r.error == 'Something failed'

    def test_upscale_video(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='video-id-1',
            batch_id='batch-id-1',
            status='completed',
            queue_position=1,
            input_filename='input.mp4',
            input_storage_url='https://storage.example.com/input.mp4',
            freepik_task_id='freepik-123',
            output_storage_url='https://storage.example.com/output.mp4',
            created_at=datetime(2026, 3, 11, 10, 0, 0),
            started_at=datetime(2026, 3, 11, 10, 1, 0),
            completed_at=datetime(2026, 3, 11, 10, 5, 0)
        )
        assert v.id == 'video-id-1'
        assert v.freepik_task_id == 'freepik-123'
        assert v.output_storage_url == 'https://storage.example.com/output.mp4'

    def test_upscale_batch(self):
        from models.upscale import UpscaleBatch
        b = UpscaleBatch(
            id='batch-id-1',
            user_id='user-123',
            status='processing',
            resolution='2k',
            creativity=0,
            sharpen=0,
            grain=0,
            fps_boost=False,
            flavor='vivid',
            total_videos=5,
            completed_videos=2,
            failed_videos=0,
            created_at=datetime(2026, 3, 11),
            started_at=datetime(2026, 3, 11, 10, 0, 0)
        )
        assert b.id == 'batch-id-1'
        assert b.status == 'processing'
        assert b.total_videos == 5
        assert b.videos == []

    def test_upscale_batch_with_videos(self):
        from models.upscale import UpscaleBatch, UpscaleVideo
        video = UpscaleVideo(
            id='v1',
            batch_id='b1',
            status='pending',
            queue_position=0,
            input_filename='video.mp4',
            input_storage_url='https://example.com/video.mp4',
            created_at=datetime(2026, 3, 11)
        )
        b = UpscaleBatch(
            id='b1',
            user_id='user-1',
            status='pending',
            resolution='4k',
            creativity=50,
            sharpen=25,
            grain=10,
            fps_boost=True,
            flavor='natural',
            total_videos=1,
            completed_videos=0,
            failed_videos=0,
            created_at=datetime(2026, 3, 11),
            videos=[video]
        )
        assert len(b.videos) == 1
        assert b.videos[0].id == 'v1'

    def test_batch_detail_response(self):
        from models.upscale import BatchDetailResponse, UpscaleBatch
        batch = UpscaleBatch(
            id='b1',
            user_id='u1',
            status='completed',
            resolution='2k',
            creativity=0,
            sharpen=0,
            grain=0,
            fps_boost=False,
            flavor='vivid',
            total_videos=3,
            completed_videos=3,
            failed_videos=0,
            created_at=datetime(2026, 3, 11),
            completed_at=datetime(2026, 3, 11, 12, 0, 0)
        )
        r = BatchDetailResponse(success=True, batch=batch)
        assert r.success is True
        assert r.batch is not None
        assert r.batch.id == 'b1'
        assert r.error is None

    def test_batch_detail_response_error(self):
        from models.upscale import BatchDetailResponse
        r = BatchDetailResponse(success=False, error='Not found')
        assert r.success is False
        assert r.batch is None
        assert r.error == 'Not found'


# ---------------------------------------------------------------------------
# ProcessingResult dataclass
# ---------------------------------------------------------------------------

class TestProcessingResult:
    """Test ProcessingResult dataclass instantiation and defaults."""

    def test_success_result(self):
        from models.upscale import ProcessingResult
        r = ProcessingResult(success=True)
        assert r.success is True
        assert r.failure_type is None
        assert r.should_pause_batch is False
        assert r.error_message is None

    def test_transient_failure(self):
        from models.upscale import ProcessingResult
        r = ProcessingResult(success=False, failure_type="transient", error_message="timeout")
        assert r.success is False
        assert r.failure_type == "transient"
        assert r.should_pause_batch is False

    def test_credit_exhaustion_failure(self):
        from models.upscale import ProcessingResult
        r = ProcessingResult(success=False, failure_type="credit_exhaustion", should_pause_batch=True)
        assert r.success is False
        assert r.failure_type == "credit_exhaustion"
        assert r.should_pause_batch is True

    def test_permanent_failure(self):
        from models.upscale import ProcessingResult
        r = ProcessingResult(success=False, failure_type="permanent", error_message="bad input")
        assert r.success is False
        assert r.failure_type == "permanent"
        assert r.should_pause_batch is False


# ---------------------------------------------------------------------------
# _classify_error function
# ---------------------------------------------------------------------------

class TestClassifyError:
    """Test _classify_error classifies error messages into failure types."""

    def test_402_payment_required(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP error 402 Payment Required") == "credit_exhaustion"

    def test_429_quota_exceeded(self):
        from models.upscale import _classify_error
        assert _classify_error("429 quota exceeded") == "credit_exhaustion"

    def test_429_limit_exceeded(self):
        from models.upscale import _classify_error
        assert _classify_error("429 limit exceeded for account") == "credit_exhaustion"

    def test_429_insufficient_credits(self):
        from models.upscale import _classify_error
        assert _classify_error("429 insufficient credits") == "credit_exhaustion"

    def test_500_internal_server_error(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP 500 Internal Server Error") == "transient"

    def test_502_bad_gateway(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP 502 Bad Gateway") == "transient"

    def test_503_service_unavailable(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP 503 Service Unavailable") == "transient"

    def test_request_timed_out(self):
        from models.upscale import _classify_error
        assert _classify_error("Request timed out") == "transient"

    def test_connection_refused(self):
        from models.upscale import _classify_error
        assert _classify_error("Connection refused") == "transient"

    def test_429_generic_too_many_requests(self):
        from models.upscale import _classify_error
        assert _classify_error("429 Too Many Requests") == "transient"

    def test_400_bad_request(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP 400 Bad Request") == "permanent"

    def test_401_unauthorized(self):
        from models.upscale import _classify_error
        assert _classify_error("HTTP 401 Unauthorized") == "permanent"

    def test_unknown_error(self):
        from models.upscale import _classify_error
        assert _classify_error("Unknown error occurred") == "permanent"


# ---------------------------------------------------------------------------
# ReorderPayload model
# ---------------------------------------------------------------------------

class TestReorderPayload:
    """Test ReorderPayload Pydantic model."""

    def test_valid_payload(self):
        from models.upscale import ReorderPayload
        p = ReorderPayload(video_ids=["id1", "id2"])
        assert p.video_ids == ["id1", "id2"]

    def test_empty_list_valid(self):
        from models.upscale import ReorderPayload
        p = ReorderPayload(video_ids=[])
        assert p.video_ids == []


# ---------------------------------------------------------------------------
# UpscaleVideo upload status fields (Phase 12)
# ---------------------------------------------------------------------------

class TestUpscaleVideoUploadStatusFields:
    """Test UpscaleVideo includes upload status fields for delivery tracking."""

    def test_supabase_upload_status_defaults_none(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='v1', batch_id='b1', status='completed', queue_position=1,
            input_filename='vid.mp4', input_storage_url='https://example.com/vid.mp4',
            created_at=datetime(2026, 3, 11),
        )
        assert v.supabase_upload_status is None

    def test_drive_upload_status_defaults_none(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='v1', batch_id='b1', status='completed', queue_position=1,
            input_filename='vid.mp4', input_storage_url='https://example.com/vid.mp4',
            created_at=datetime(2026, 3, 11),
        )
        assert v.drive_upload_status is None

    def test_output_drive_file_id_defaults_none(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='v1', batch_id='b1', status='completed', queue_position=1,
            input_filename='vid.mp4', input_storage_url='https://example.com/vid.mp4',
            created_at=datetime(2026, 3, 11),
        )
        assert v.output_drive_file_id is None

    def test_upload_status_fields_can_be_set(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='v1', batch_id='b1', status='completed', queue_position=1,
            input_filename='vid.mp4', input_storage_url='https://example.com/vid.mp4',
            created_at=datetime(2026, 3, 11),
            supabase_upload_status='completed',
            drive_upload_status='failed',
            output_drive_file_id='drive-file-abc',
        )
        assert v.supabase_upload_status == 'completed'
        assert v.drive_upload_status == 'failed'
        assert v.output_drive_file_id == 'drive-file-abc'

    def test_upload_status_fields_in_model_dump(self):
        from models.upscale import UpscaleVideo
        v = UpscaleVideo(
            id='v1', batch_id='b1', status='completed', queue_position=1,
            input_filename='vid.mp4', input_storage_url='https://example.com/vid.mp4',
            created_at=datetime(2026, 3, 11),
            supabase_upload_status='completed',
            drive_upload_status='skipped',
            output_drive_file_id=None,
        )
        d = v.model_dump()
        assert 'supabase_upload_status' in d
        assert 'drive_upload_status' in d
        assert 'output_drive_file_id' in d
        assert d['supabase_upload_status'] == 'completed'
        assert d['drive_upload_status'] == 'skipped'
