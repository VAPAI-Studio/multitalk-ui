"""
Shared pytest fixtures and configuration for all tests
"""
import pytest
import sys
from pathlib import Path

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
