"""
Shared pytest fixtures and configuration for all tests
"""
import os
import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add backend to Python path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

@pytest.fixture
def workflow_service():
    """Provide a WorkflowService instance"""
    from services.workflow_service import WorkflowService
    return WorkflowService()

@pytest.fixture
def workflows_dir():
    """Provide path to workflows directory"""
    return Path(__file__).parent.parent / "workflows"

@pytest.fixture
def all_workflow_names(workflows_dir):
    """Get list of all workflow names (without .json extension)"""
    return [f.stem for f in workflows_dir.glob("*.json")]

@pytest.fixture
def sample_params():
    """Provide sample parameters for testing"""
    return {
        "VIDEO_FILENAME": "test_video.mp4",
        "AUDIO_FILENAME": "test_audio.wav",
        "IMAGE_FILENAME": "test_image.png",
        "WIDTH": 640,
        "HEIGHT": 360,
        "AUDIO_SCALE": 1.0,
        "AUDIO_START_TIME": 0,
        "AUDIO_END_TIME": 10,
        "CUSTOM_PROMPT": "test prompt",
        "PROMPT": "test prompt",
        "subject_image": "subject.png",
        "style_image": "style.png"
    }


# --- Freepik service fixtures ---

@pytest.fixture
def mock_freepik_settings():
    """Patch settings with Freepik test configuration."""
    # Import so the module is loaded before we patch its settings reference
    from services import freepik_service as _fs_module  # noqa: F841
    with patch("services.freepik_service.settings") as mock_settings:
        mock_settings.FREEPIK_API_KEY = "test-key"
        mock_settings.FREEPIK_API_BASE_URL = "https://api.freepik.com/v1/ai"
        mock_settings.FREEPIK_POLL_INTERVAL = 1  # fast for tests
        mock_settings.FREEPIK_TASK_TIMEOUT = 10  # short timeout for tests
        yield mock_settings


@pytest.fixture
def freepik_service(mock_freepik_settings):
    """Provide a FreepikUpscalerService instance with mocked settings."""
    from services.freepik_service import FreepikUpscalerService
    return FreepikUpscalerService()


# --- Global Supabase singleton mock (CI / no-credentials environments) ---

@pytest.fixture(autouse=True, scope="session")
def mock_supabase_singleton():
    """Pre-populate the SupabaseClient singleton with a mock when no real
    credentials are present (e.g. CI).  This prevents the ValueError raised
    by core/supabase.py from crashing tests that go through FastAPI's DI
    layer (Depends(get_supabase)) before the auth guard even runs.

    Tests that already inject their own mock supabase (e.g. service-layer
    unit tests) are unaffected because they pass the mock directly to the
    service constructor instead of calling get_supabase().
    """
    if os.environ.get("SUPABASE_URL"):
        yield  # real credentials available — leave singleton alone
        return

    from core.supabase import SupabaseClient

    mock_client = MagicMock()
    # auth.get_user returns an object with user=None so unauthenticated
    # requests still correctly produce 401 responses.
    mock_auth_response = MagicMock()
    mock_auth_response.user = None
    mock_client.auth.get_user.return_value = mock_auth_response

    original = SupabaseClient._instance
    SupabaseClient._instance = mock_client
    yield
    SupabaseClient._instance = original


# --- Supabase mock fixtures ---

def _build_chainable_mock():
    """Build a MagicMock with chainable .table().select/insert/update/delete().eq().order().limit().execute() pattern."""
    mock_client = MagicMock()
    mock_table = MagicMock()
    mock_client.table.return_value = mock_table

    # Each query method returns the mock_table itself for chaining
    for method in ("select", "insert", "update", "delete", "upsert"):
        getattr(mock_table, method).return_value = mock_table
    for method in ("eq", "neq", "gt", "gte", "lt", "lte", "order", "limit", "range", "single", "is_"):
        getattr(mock_table, method).return_value = mock_table

    # Default execute returns empty data
    mock_execute = MagicMock()
    mock_execute.data = []
    mock_execute.count = 0
    mock_table.execute.return_value = mock_execute

    return mock_client


@pytest.fixture
def mock_supabase():
    """Provide a chainable MagicMock Supabase client."""
    return _build_chainable_mock()


@pytest.fixture
def upscale_job_service(mock_supabase):
    """Provide an UpscaleJobService instance with mocked Supabase client."""
    from services.upscale_job_service import UpscaleJobService
    return UpscaleJobService(supabase=mock_supabase)


@pytest.fixture
def custom_workflow_service(mock_supabase):
    """Provide a CustomWorkflowService instance with mocked Supabase client."""
    from services.custom_workflow_service import CustomWorkflowService
    return CustomWorkflowService(supabase=mock_supabase)
