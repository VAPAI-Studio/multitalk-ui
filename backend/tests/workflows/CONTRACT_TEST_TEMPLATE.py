"""
CONTRACT TEST TEMPLATE

Copy this file and rename to test_contract_{your_workflow}.py
Replace all TEMPLATE placeholders with your workflow details.

Example: test_contract_my_workflow.py
"""
import pytest
import json


@pytest.mark.workflow
@pytest.mark.asyncio
class TestTEMPLATEWorkflowContract:
    """Contract tests for TEMPLATE_WORKFLOW workflow"""

    # STEP 1: Set the workflow name (must match the JSON filename without .json)
    WORKFLOW_NAME = "TEMPLATE_WORKFLOW"

    # STEP 2: Define all required parameters (extract from workflow JSON)
    # Run: python -c "from services.workflow_service import WorkflowService; import asyncio; ws = WorkflowService(); print(asyncio.run(ws.get_template_parameters('YourWorkflow')))"
    REQUIRED_PARAMS = {
        "PARAM1",
        "PARAM2",
        "PARAM3",
        # Add all parameters here
    }

    # STEP 3: Define valid test parameters
    VALID_TEST_PARAMS = {
        "PARAM1": "test_value_1",  # String example
        "PARAM2": 640,              # Number example
        "PARAM3": 1.0,              # Float example
        # Add all parameters with appropriate test values
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
        assert "{{" not in workflow_str, "Found unsubstituted placeholders"
        assert "}}" not in workflow_str, "Found unsubstituted placeholders"

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

    # OPTIONAL: Add workflow-specific tests below
    # Example:
    # async def test_has_required_input_nodes(self, workflow_service):
    #     """Test that workflow has required input nodes"""
    #     success, workflow, _ = await workflow_service.load_template(self.WORKFLOW_NAME)
    #     assert success is True
    #
    #     # Add your specific assertions
    #     class_types = [node_data.get("class_type") for node_data in workflow.values()]
    #     assert "YourRequiredNode" in class_types
