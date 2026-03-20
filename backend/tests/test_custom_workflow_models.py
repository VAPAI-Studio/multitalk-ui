"""
Tests for custom workflow Pydantic models.
Validates all model shapes, defaults, and the generate_slug utility.
"""
import pytest


def test_parsed_node_input_defaults():
    """ParsedNodeInput has name, value, is_link (default False)."""
    from models.custom_workflow import ParsedNodeInput

    inp = ParsedNodeInput(name="seed", value=42)
    assert inp.name == "seed"
    assert inp.value == 42
    assert inp.is_link is False


def test_parsed_node_input_link():
    """ParsedNodeInput can mark an input as a link."""
    from models.custom_workflow import ParsedNodeInput

    inp = ParsedNodeInput(name="model", value=["14", 0], is_link=True)
    assert inp.is_link is True


def test_parsed_node_structure():
    """ParsedNode has node_id, class_type, title, inputs, configurable_inputs."""
    from models.custom_workflow import ParsedNode, ParsedNodeInput

    node = ParsedNode(
        node_id="3",
        class_type="KSampler",
        title="KSampler",
        inputs=[ParsedNodeInput(name="seed", value=42)],
        configurable_inputs=[ParsedNodeInput(name="seed", value=42)],
    )
    assert node.node_id == "3"
    assert node.class_type == "KSampler"
    assert node.title == "KSampler"
    assert len(node.inputs) == 1
    assert len(node.configurable_inputs) == 1


def test_parsed_node_optional_title():
    """ParsedNode title is Optional and defaults to None."""
    from models.custom_workflow import ParsedNode

    node = ParsedNode(node_id="1", class_type="LoadImage")
    assert node.title is None
    assert node.inputs == []
    assert node.configurable_inputs == []


def test_parse_workflow_request():
    """ParseWorkflowRequest has workflow_json dict field."""
    from models.custom_workflow import ParseWorkflowRequest

    req = ParseWorkflowRequest(workflow_json={"3": {"class_type": "KSampler"}})
    assert isinstance(req.workflow_json, dict)


def test_parse_workflow_response():
    """ParseWorkflowResponse has success, format, nodes, error."""
    from models.custom_workflow import ParseWorkflowResponse

    resp = ParseWorkflowResponse(success=True, format="api", nodes=[])
    assert resp.success is True
    assert resp.format == "api"
    assert resp.nodes == []
    assert resp.error is None


def test_create_custom_workflow_request_defaults():
    """CreateCustomWorkflowRequest has proper defaults."""
    from models.custom_workflow import CreateCustomWorkflowRequest

    req = CreateCustomWorkflowRequest(
        name="Test Workflow",
        workflow_json={"1": {"class_type": "Test"}},
        gradient="from-blue-500 to-purple-600",
    )
    assert req.name == "Test Workflow"
    assert req.slug is None
    assert req.description is None
    assert req.output_type == "image"
    assert req.studio is None
    assert req.icon == "\u26a1"
    assert req.gradient == "from-blue-500 to-purple-600"


def test_update_custom_workflow_request_all_optional():
    """UpdateCustomWorkflowRequest has all optional fields for partial updates."""
    from models.custom_workflow import UpdateCustomWorkflowRequest

    req = UpdateCustomWorkflowRequest()
    assert req.name is None
    assert req.description is None
    assert req.variable_config is None
    assert req.section_config is None
    assert req.output_type is None
    assert req.studio is None
    assert req.icon is None
    assert req.gradient is None


def test_custom_workflow_response():
    """CustomWorkflowResponse has success, workflow, error."""
    from models.custom_workflow import CustomWorkflowResponse

    resp = CustomWorkflowResponse(success=True, workflow={"id": "abc"})
    assert resp.success is True
    assert resp.workflow == {"id": "abc"}
    assert resp.error is None


def test_custom_workflow_list_response():
    """CustomWorkflowListResponse has success, workflows list, error."""
    from models.custom_workflow import CustomWorkflowListResponse

    resp = CustomWorkflowListResponse(success=True, workflows=[{"id": "1"}, {"id": "2"}])
    assert resp.success is True
    assert len(resp.workflows) == 2


def test_generate_slug_basic():
    """generate_slug converts name to URL-safe slug."""
    from models.custom_workflow import generate_slug

    assert generate_slug("My Cool Workflow") == "my-cool-workflow"


def test_generate_slug_special_chars():
    """generate_slug strips special characters."""
    from models.custom_workflow import generate_slug

    assert generate_slug("Test! @#$ Workflow") == "test-workflow"


def test_generate_slug_leading_trailing_hyphens():
    """generate_slug strips leading/trailing hyphens."""
    from models.custom_workflow import generate_slug

    assert generate_slug("  --Hello World--  ") == "hello-world"


def test_generate_slug_multiple_spaces():
    """generate_slug collapses multiple spaces to single hyphen."""
    from models.custom_workflow import generate_slug

    assert generate_slug("one   two   three") == "one-two-three"


def test_all_models_importable():
    """All 8 models + generate_slug can be imported."""
    from models.custom_workflow import (
        ParsedNodeInput,
        ParsedNode,
        ParseWorkflowRequest,
        ParseWorkflowResponse,
        CreateCustomWorkflowRequest,
        UpdateCustomWorkflowRequest,
        CustomWorkflowResponse,
        CustomWorkflowListResponse,
        generate_slug,
    )
    # Just verifying import doesn't raise
    assert ParsedNodeInput is not None
    assert ParsedNode is not None
    assert ParseWorkflowRequest is not None
    assert ParseWorkflowResponse is not None
    assert CreateCustomWorkflowRequest is not None
    assert UpdateCustomWorkflowRequest is not None
    assert CustomWorkflowResponse is not None
    assert CustomWorkflowListResponse is not None
    assert generate_slug is not None
