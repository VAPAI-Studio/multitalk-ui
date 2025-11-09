"""
Layer 1: Static workflow validation tests

These tests validate the structure and syntax of workflow JSON files
without actually executing them.
"""
import pytest
import json
import re
from pathlib import Path


@pytest.mark.unit
@pytest.mark.parametrize("workflow_name", [
    "VideoLipsync",
    "WANI2V",
    "MultiTalkMultiplePeople",
    "StyleTransfer",
    "style_transfer_v1",
    "multitalk_one_person",
    "infinite_talk_one_person"
])
class TestWorkflowStaticValidation:
    """Static validation tests for all workflows"""

    def test_workflow_file_exists(self, workflows_dir, workflow_name):
        """Test that workflow JSON file exists"""
        workflow_path = workflows_dir / f"{workflow_name}.json"
        assert workflow_path.exists(), f"Workflow file {workflow_name}.json not found"

    def test_workflow_is_valid_json(self, workflows_dir, workflow_name):
        """Test that workflow file contains valid JSON"""
        workflow_path = workflows_dir / f"{workflow_name}.json"

        try:
            with open(workflow_path, 'r', encoding='utf-8') as f:
                workflow = json.load(f)
        except json.JSONDecodeError as e:
            pytest.fail(f"Invalid JSON in {workflow_name}: {e}")

        assert isinstance(workflow, dict), f"{workflow_name} must be a JSON object"
        assert len(workflow) > 0, f"{workflow_name} cannot be empty"

    def test_workflow_nodes_have_required_fields(self, workflows_dir, workflow_name):
        """Test that all nodes have required fields (class_type, inputs)"""
        workflow_path = workflows_dir / f"{workflow_name}.json"

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        for node_id, node_data in workflow.items():
            assert isinstance(node_data, dict), \
                f"Node {node_id} in {workflow_name} must be a dictionary"

            assert "class_type" in node_data, \
                f"Node {node_id} in {workflow_name} missing 'class_type' field"

            assert "inputs" in node_data, \
                f"Node {node_id} in {workflow_name} missing 'inputs' field"

            assert isinstance(node_data["inputs"], dict), \
                f"Node {node_id} in {workflow_name} 'inputs' must be a dictionary"

    def test_workflow_has_output_node(self, workflows_dir, workflow_name):
        """Test that workflow has at least one output node"""
        workflow_path = workflows_dir / f"{workflow_name}.json"

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        output_node_types = [
            "SaveImage",
            "SaveVideo",
            "VHS_VideoCombine",
            "PreviewImage"
        ]

        has_output = any(
            node_data.get("class_type") in output_node_types
            for node_data in workflow.values()
        )

        assert has_output, \
            f"{workflow_name} must have at least one output node " \
            f"(types: {', '.join(output_node_types)})"

    def test_workflow_placeholders_are_valid(self, workflows_dir, workflow_name):
        """Test that all placeholders use valid format {{PARAM_NAME}}"""
        workflow_path = workflows_dir / f"{workflow_name}.json"

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow_str = f.read()

        # Find all {{...}} patterns
        placeholders = re.findall(r'\{\{([^}]+)\}\}', workflow_str)

        for placeholder in placeholders:
            # Check placeholder naming convention (alphanumeric + underscore)
            assert re.match(r'^[A-Z0-9_]+$', placeholder), \
                f"Placeholder '{placeholder}' in {workflow_name} must use " \
                f"SCREAMING_SNAKE_CASE (only A-Z, 0-9, and _)"

    def test_workflow_no_orphaned_nodes(self, workflows_dir, workflow_name):
        """Test that there are no orphaned node references"""
        workflow_path = workflows_dir / f"{workflow_name}.json"

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        node_ids = set(workflow.keys())

        # Check all node references in inputs
        for node_id, node_data in workflow.items():
            inputs = node_data.get("inputs", {})

            for input_key, input_value in inputs.items():
                # Node references are arrays like ["123", 0]
                if isinstance(input_value, list) and len(input_value) >= 1:
                    ref_node_id = str(input_value[0])

                    # Skip if it's not a numeric reference
                    if not ref_node_id.isdigit():
                        continue

                    assert ref_node_id in node_ids, \
                        f"Node {node_id} in {workflow_name} references " \
                        f"non-existent node {ref_node_id} in input '{input_key}'"


@pytest.mark.unit
def test_all_workflows_discovered(all_workflow_names):
    """Test that we found all expected workflows"""
    expected_workflows = {
        "VideoLipsync",
        "WANI2V",
        "MultiTalkMultiplePeople",
        "StyleTransfer",
        "style_transfer_v1",
        "multitalk_one_person",
        "infinite_talk_one_person"
    }

    found_workflows = set(all_workflow_names)

    assert expected_workflows.issubset(found_workflows), \
        f"Missing workflows: {expected_workflows - found_workflows}"

    # Report any extra workflows
    extra = found_workflows - expected_workflows
    if extra:
        print(f"\nNote: Found additional workflows: {extra}")


@pytest.mark.unit
def test_no_duplicate_workflow_names(workflows_dir):
    """Test that there are no case-insensitive duplicate workflow names"""
    workflow_files = list(workflows_dir.glob("*.json"))
    workflow_names_lower = [f.stem.lower() for f in workflow_files]

    duplicates = [
        name for name in set(workflow_names_lower)
        if workflow_names_lower.count(name) > 1
    ]

    assert len(duplicates) == 0, \
        f"Found duplicate workflow names (case-insensitive): {duplicates}"
