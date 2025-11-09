"""
Layer 2: Workflow service unit tests

These tests validate the WorkflowService business logic in isolation.
"""
import pytest
import json


@pytest.mark.unit
@pytest.mark.asyncio
class TestWorkflowServiceLoad:
    """Tests for workflow loading functionality"""

    async def test_load_existing_workflow(self, workflow_service):
        """Test loading an existing workflow succeeds"""
        success, workflow, error = await workflow_service.load_template("VideoLipsync")

        assert success is True
        assert workflow is not None
        assert error is None
        assert isinstance(workflow, dict)
        assert len(workflow) > 0

    async def test_load_nonexistent_workflow(self, workflow_service):
        """Test loading non-existent workflow returns error"""
        success, workflow, error = await workflow_service.load_template("NonExistentWorkflow")

        assert success is False
        assert workflow is None
        assert error is not None
        assert "not found" in error.lower()

    async def test_load_workflow_returns_valid_json(self, workflow_service):
        """Test that loaded workflow is valid JSON structure"""
        success, workflow, error = await workflow_service.load_template("WANI2V")

        assert success is True

        # Should be able to serialize back to JSON
        try:
            json_str = json.dumps(workflow)
            assert len(json_str) > 0
        except (TypeError, ValueError) as e:
            pytest.fail(f"Workflow cannot be serialized to JSON: {e}")


@pytest.mark.unit
@pytest.mark.asyncio
class TestWorkflowServiceBuild:
    """Tests for workflow building/parameter substitution"""

    async def test_build_workflow_with_string_params(self, workflow_service):
        """Test string parameter substitution"""
        success, workflow, error = await workflow_service.build_workflow(
            "VideoLipsync",
            {
                "VIDEO_FILENAME": "test_video.mp4",
                "AUDIO_FILENAME": "test_audio.wav",
                "WIDTH": 640,
                "HEIGHT": 360,
                "AUDIO_SCALE": 1.0,
                "AUDIO_START_TIME": 0,
                "AUDIO_END_TIME": 10,
                "CUSTOM_PROMPT": "test prompt"
            }
        )

        assert success is True
        assert error is None

        # Verify string substitution worked
        workflow_str = json.dumps(workflow)
        assert "test_video.mp4" in workflow_str
        assert "test_audio.wav" in workflow_str

    async def test_build_workflow_with_numeric_params(self, workflow_service):
        """Test numeric parameter substitution"""
        success, workflow, error = await workflow_service.build_workflow(
            "VideoLipsync",
            {
                "VIDEO_FILENAME": "video.mp4",
                "AUDIO_FILENAME": "audio.wav",
                "WIDTH": 1280,
                "HEIGHT": 720,
                "AUDIO_SCALE": 1.5,
                "AUDIO_START_TIME": 5,
                "AUDIO_END_TIME": 15,
                "CUSTOM_PROMPT": "prompt"
            }
        )

        assert success is True

        workflow_str = json.dumps(workflow)
        # Numbers should not be quoted
        assert ': 1280' in workflow_str or ':1280' in workflow_str
        assert ': 720' in workflow_str or ':720' in workflow_str
        assert '1.5' in workflow_str

    async def test_build_workflow_no_placeholders_remain(self, workflow_service):
        """Test that all placeholders are substituted"""
        # Get required parameters first
        success, params, _ = await workflow_service.get_template_parameters("VideoLipsync")
        assert success is True

        # Build workflow with all required params
        test_params = {param: f"value_{param}" if isinstance(param, str) else 0
                      for param in params}
        # Override with appropriate types
        test_params.update({
            "WIDTH": 640,
            "HEIGHT": 360,
            "AUDIO_SCALE": 1.0,
            "AUDIO_START_TIME": 0,
            "AUDIO_END_TIME": 10
        })

        success, workflow, error = await workflow_service.build_workflow(
            "VideoLipsync",
            test_params
        )

        assert success is True

        # Check no placeholders remain
        workflow_str = json.dumps(workflow)
        assert "{{" not in workflow_str, "Unsubstituted placeholders found"
        assert "}}" not in workflow_str, "Unsubstituted placeholders found"

    async def test_build_workflow_escapes_special_characters(self, workflow_service):
        """Test that special characters in strings are properly escaped"""
        success, workflow, error = await workflow_service.build_workflow(
            "VideoLipsync",
            {
                "VIDEO_FILENAME": "video.mp4",
                "AUDIO_FILENAME": "audio.wav",
                "WIDTH": 640,
                "HEIGHT": 360,
                "AUDIO_SCALE": 1.0,
                "AUDIO_START_TIME": 0,
                "AUDIO_END_TIME": 10,
                "CUSTOM_PROMPT": 'A prompt with "quotes" and \n newlines'
            }
        )

        assert success is True
        assert error is None

        # Should be valid JSON even with special chars
        workflow_str = json.dumps(workflow)
        parsed = json.loads(workflow_str)
        assert isinstance(parsed, dict)

    async def test_build_nonexistent_workflow(self, workflow_service):
        """Test building non-existent workflow returns error"""
        success, workflow, error = await workflow_service.build_workflow(
            "NonExistent",
            {"param": "value"}
        )

        assert success is False
        assert workflow is None
        assert error is not None


@pytest.mark.unit
@pytest.mark.asyncio
class TestWorkflowServiceValidation:
    """Tests for workflow validation functionality"""

    async def test_validate_valid_workflow(self, workflow_service):
        """Test that valid workflow passes validation"""
        success, workflow, _ = await workflow_service.load_template("VideoLipsync")
        assert success is True

        is_valid, error = await workflow_service.validate_workflow(workflow)

        assert is_valid is True
        assert error is None

    async def test_validate_empty_workflow(self, workflow_service):
        """Test that empty workflow fails validation"""
        is_valid, error = await workflow_service.validate_workflow({})

        assert is_valid is False
        assert error is not None
        assert "empty" in error.lower()

    async def test_validate_workflow_missing_class_type(self, workflow_service):
        """Test that workflow with missing class_type fails"""
        invalid_workflow = {
            "1": {
                "inputs": {}
            }
        }

        is_valid, error = await workflow_service.validate_workflow(invalid_workflow)

        assert is_valid is False
        assert error is not None
        assert "class_type" in error.lower()

    async def test_validate_workflow_missing_inputs(self, workflow_service):
        """Test that workflow with missing inputs fails"""
        invalid_workflow = {
            "1": {
                "class_type": "SomeNode"
            }
        }

        is_valid, error = await workflow_service.validate_workflow(invalid_workflow)

        assert is_valid is False
        assert error is not None
        assert "inputs" in error.lower()

    async def test_validate_workflow_non_dict(self, workflow_service):
        """Test that non-dictionary workflow fails"""
        is_valid, error = await workflow_service.validate_workflow([])

        assert is_valid is False
        assert error is not None


@pytest.mark.unit
@pytest.mark.asyncio
class TestWorkflowServiceParameters:
    """Tests for parameter extraction functionality"""

    async def test_get_parameters_from_workflow(self, workflow_service):
        """Test extracting parameters from workflow"""
        success, params, error = await workflow_service.get_template_parameters("VideoLipsync")

        assert success is True
        assert error is None
        assert isinstance(params, list)
        assert len(params) > 0

        # VideoLipsync should have these parameters
        expected_params = {
            "VIDEO_FILENAME", "AUDIO_FILENAME",
            "WIDTH", "HEIGHT", "AUDIO_SCALE",
            "AUDIO_START_TIME", "AUDIO_END_TIME",
            "CUSTOM_PROMPT"
        }

        assert set(params) == expected_params

    async def test_get_parameters_no_duplicates(self, workflow_service):
        """Test that duplicate placeholders are deduplicated"""
        success, params, error = await workflow_service.get_template_parameters("VideoLipsync")

        assert success is True

        # Should not have duplicates
        assert len(params) == len(set(params))

    async def test_get_parameters_from_nonexistent(self, workflow_service):
        """Test extracting parameters from non-existent workflow"""
        success, params, error = await workflow_service.get_template_parameters("NonExistent")

        assert success is False
        assert params is None
        assert error is not None


@pytest.mark.unit
def test_list_templates(workflow_service):
    """Test listing all available templates"""
    templates = workflow_service.list_templates()

    assert isinstance(templates, dict)
    assert len(templates) > 0

    # Should include known workflows
    known_workflows = {"VideoLipsync", "WANI2V", "MultiTalkMultiplePeople"}
    template_names = set(templates.keys())

    assert known_workflows.issubset(template_names)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_load_and_fill_integration(workflow_service):
    """Integration test: load and fill in one operation"""
    params = {
        "VIDEO_FILENAME": "test.mp4",
        "AUDIO_FILENAME": "test.wav",
        "WIDTH": 640,
        "HEIGHT": 360,
        "AUDIO_SCALE": 1.0,
        "AUDIO_START_TIME": 0,
        "AUDIO_END_TIME": 10,
        "CUSTOM_PROMPT": "test"
    }

    # This tests the full workflow service pipeline
    success, workflow, error = await workflow_service.build_workflow(
        "VideoLipsync",
        params
    )

    assert success is True
    assert error is None

    # Validate the result
    is_valid, validation_error = await workflow_service.validate_workflow(workflow)
    assert is_valid is True
    assert validation_error is None

    # Ensure no placeholders remain
    workflow_str = json.dumps(workflow)
    assert "{{" not in workflow_str
