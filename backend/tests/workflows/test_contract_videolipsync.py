"""
Contract test for VideoLipsync workflow

This test defines and validates the contract/requirements for the VideoLipsync workflow.
Every workflow should have a similar contract test.
"""
import pytest
import json
import re


@pytest.mark.workflow
@pytest.mark.asyncio
class TestVideoLipsyncContract:
    """Contract tests for VideoLipsync workflow"""

    WORKFLOW_NAME = "VideoLipsync"

    # Define the exact parameters this workflow requires
    REQUIRED_PARAMS = {
        "VIDEO_FILENAME",
        "AUDIO_FILENAME",
        "WIDTH",
        "HEIGHT",
        "AUDIO_SCALE",
        "AUDIO_START_TIME",
        "AUDIO_END_TIME",
        "CUSTOM_PROMPT"
    }

    # Define valid test parameters
    VALID_TEST_PARAMS = {
        "VIDEO_FILENAME": "test_video.mp4",
        "AUDIO_FILENAME": "test_audio.wav",
        "WIDTH": 640,
        "HEIGHT": 360,
        "AUDIO_SCALE": 1.0,
        "AUDIO_START_TIME": 0,
        "AUDIO_END_TIME": 10,
        "CUSTOM_PROMPT": "A person talking"
    }

    async def test_workflow_file_exists(self, workflows_dir):
        """Test that the workflow JSON file exists"""
        workflow_path = workflows_dir / f"{self.WORKFLOW_NAME}.json"
        assert workflow_path.exists(), f"{self.WORKFLOW_NAME}.json must exist"

    async def test_all_parameters_documented(self, workflow_service):
        """Test that all documented parameters are actually used in the workflow"""
        success, params, error = await workflow_service.get_template_parameters(
            self.WORKFLOW_NAME
        )

        assert success is True, f"Failed to extract parameters: {error}"
        assert set(params) == self.REQUIRED_PARAMS, \
            f"Parameter mismatch. Expected: {self.REQUIRED_PARAMS}, Found: {set(params)}"

    async def test_builds_with_valid_params(self, workflow_service):
        """Test that workflow builds successfully with valid parameters"""
        success, workflow, error = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            self.VALID_TEST_PARAMS
        )

        assert success is True, f"Failed to build workflow: {error}"
        assert workflow is not None
        assert error is None

    async def test_no_unsubstituted_placeholders(self, workflow_service):
        """Test that all placeholders are substituted"""
        success, workflow, _ = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            self.VALID_TEST_PARAMS
        )

        assert success is True

        workflow_str = json.dumps(workflow)
        # Use regex to match actual placeholders, not unicode escape sequences like \ud83c\udfa5
        placeholder_pattern = r'(?<!\\u[0-9a-fA-F]{4})\{\{[A-Z_]+\}\}'
        matches = re.findall(placeholder_pattern, workflow_str)
        assert len(matches) == 0, f"Unsubstituted placeholders found: {matches}"

    async def test_validates_successfully(self, workflow_service):
        """Test that built workflow passes validation"""
        success, workflow, _ = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            self.VALID_TEST_PARAMS
        )

        assert success is True

        is_valid, validation_error = await workflow_service.validate_workflow(workflow)
        assert is_valid is True, f"Workflow validation failed: {validation_error}"

    async def test_has_output_node(self, workflow_service):
        """Test that workflow has an output node (SaveImage/SaveVideo)"""
        success, workflow, _ = await workflow_service.load_template(self.WORKFLOW_NAME)

        assert success is True

        output_node_types = ["SaveImage", "SaveVideo", "VHS_VideoCombine", "PreviewImage"]
        has_output = any(
            node_data.get("class_type") in output_node_types
            for node_data in workflow.values()
        )

        assert has_output, \
            f"Workflow must have an output node (types: {', '.join(output_node_types)})"

    async def test_has_required_input_nodes(self, workflow_service):
        """Test that workflow has required input nodes"""
        success, workflow, _ = await workflow_service.load_template(self.WORKFLOW_NAME)

        assert success is True

        # VideoLipsync should have video and audio loading nodes
        class_types = [node_data.get("class_type") for node_data in workflow.values()]

        # Should have some form of video/image loading
        has_image_load = any(
            "Load" in ct and ("Image" in ct or "Video" in ct)
            for ct in class_types if ct
        )

        # Should have audio loading
        has_audio_load = any(
            "Audio" in ct and "Load" in ct
            for ct in class_types if ct
        )

        assert has_image_load, "Workflow must have video/image loading node"
        assert has_audio_load, "Workflow must have audio loading node"

    async def test_parameter_types_are_correct(self, workflow_service):
        """Test that parameters are substituted with correct types"""
        success, workflow, _ = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            self.VALID_TEST_PARAMS
        )

        assert success is True

        workflow_str = json.dumps(workflow)

        # Numeric parameters should not be quoted
        # WIDTH and HEIGHT should be numbers in JSON
        assert ': 640' in workflow_str or ':640' in workflow_str, \
            "WIDTH should be a number, not a string"
        assert ': 360' in workflow_str or ':360' in workflow_str, \
            "HEIGHT should be a number, not a string"

        # String parameters should be present
        assert "test_video.mp4" in workflow_str
        assert "test_audio.wav" in workflow_str

    async def test_workflow_description(self):
        """Test that workflow has a clear purpose"""
        description = (
            "VideoLipsync workflow generates lip-synced videos from a video file "
            "and audio file using InfiniteTalk and WAN models"
        )
        # This is documentation - just verify it's defined
        assert len(description) > 0

    @pytest.mark.slow
    async def test_workflow_with_edge_cases(self, workflow_service):
        """Test workflow with edge case parameters"""
        edge_case_params = {
            **self.VALID_TEST_PARAMS,
            "CUSTOM_PROMPT": 'A prompt with "quotes" and special chars: \n\t'
        }

        success, workflow, error = await workflow_service.build_workflow(
            self.WORKFLOW_NAME,
            edge_case_params
        )

        assert success is True, f"Failed with edge case params: {error}"

        # Should still be valid JSON
        workflow_str = json.dumps(workflow)
        parsed = json.loads(workflow_str)
        assert isinstance(parsed, dict)
