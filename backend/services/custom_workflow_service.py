"""
Custom Workflow Service

Handles workflow parsing (format detection, node extraction, link filtering)
and CRUD operations for custom workflow configurations. The parser is the core
intelligence of the Workflow Builder -- it takes raw ComfyUI API-format JSON
and extracts structured node/input data, filtering out link arrays.

CRUD and execute methods will be added in Plan 02.
"""
from typing import Dict, List, Optional, Tuple

from core.supabase import get_supabase
from models.custom_workflow import (
    ParsedNode,
    ParsedNodeInput,
    ParseWorkflowResponse,
)
from services.workflow_service import WorkflowService


class CustomWorkflowService:
    """Service for managing custom workflow configurations and parsing."""

    def __init__(self, supabase=None):
        self.supabase = supabase or get_supabase()
        self.workflow_service = WorkflowService()

    # ------------------------------------------------------------------
    # Format Detection
    # ------------------------------------------------------------------

    @staticmethod
    def detect_workflow_format(data: dict) -> str:
        """
        Detect whether JSON is ComfyUI API format or UI format.

        API format: dict with numeric string keys, each value has 'class_type'
          {"3": {"class_type": "KSampler", "inputs": {...}}, "6": {...}}

        UI format: dict with 'nodes' (array) and/or 'links' (array),
          or a numeric 'version' key.

        Returns:
            "api", "ui", or "unknown"
        """
        # UI format markers
        if "nodes" in data and isinstance(data["nodes"], list):
            return "ui"
        if "links" in data and isinstance(data["links"], list):
            return "ui"
        if "version" in data and isinstance(data.get("version"), (int, float)):
            return "ui"

        # API format: at least one top-level value (ignoring "_"-prefixed keys)
        # must be a dict with "class_type"
        has_class_type = False
        for key, value in data.items():
            if key.startswith("_"):
                continue
            if isinstance(value, dict) and "class_type" in value:
                has_class_type = True
                break

        if has_class_type:
            return "api"

        return "unknown"

    # ------------------------------------------------------------------
    # Link Detection
    # ------------------------------------------------------------------

    @staticmethod
    def is_link_input(value) -> bool:
        """
        Check if an input value is a node-to-node link.

        Links are arrays of [node_id: str, output_index: int],
        e.g. ["14", 0]. Used to filter non-configurable inputs.

        Args:
            value: The input value to check.

        Returns:
            True if the value is a link array [str, int].
        """
        return (
            isinstance(value, list)
            and len(value) == 2
            and isinstance(value[0], str)
            and isinstance(value[1], int)
            and not isinstance(value[1], bool)
        )

    # ------------------------------------------------------------------
    # Node Parsing
    # ------------------------------------------------------------------

    def parse_workflow_nodes(self, workflow_json: dict) -> List[ParsedNode]:
        """
        Parse ComfyUI API-format JSON and extract structured nodes.

        For each top-level key (skipping "_"-prefixed keys):
        - Extracts node_id (the key), class_type, title from _meta.title
        - For each input: creates ParsedNodeInput with is_link detection
        - Populates configurable_inputs as subset where is_link=False

        Args:
            workflow_json: ComfyUI API-format workflow dict.

        Returns:
            List of ParsedNode objects.
        """
        nodes: List[ParsedNode] = []

        for node_id, node_data in workflow_json.items():
            # Skip metadata keys
            if node_id.startswith("_"):
                continue

            if not isinstance(node_data, dict):
                continue

            class_type = node_data.get("class_type", "")
            if not class_type:
                continue

            # Extract title from _meta.title if available
            meta = node_data.get("_meta", {})
            title = meta.get("title") if isinstance(meta, dict) else None

            # Parse inputs
            raw_inputs = node_data.get("inputs", {})
            all_inputs: List[ParsedNodeInput] = []
            configurable_inputs: List[ParsedNodeInput] = []

            for input_name, input_value in raw_inputs.items():
                is_link = self.is_link_input(input_value)
                parsed_input = ParsedNodeInput(
                    name=input_name,
                    value=input_value,
                    is_link=is_link,
                )
                all_inputs.append(parsed_input)
                if not is_link:
                    configurable_inputs.append(parsed_input)

            nodes.append(ParsedNode(
                node_id=node_id,
                class_type=class_type,
                title=title,
                inputs=all_inputs,
                configurable_inputs=configurable_inputs,
            ))

        return nodes

    # ------------------------------------------------------------------
    # Parse Orchestrator
    # ------------------------------------------------------------------

    async def parse_workflow(
        self, workflow_json: dict
    ) -> Tuple[bool, Optional[ParseWorkflowResponse], Optional[str]]:
        """
        Orchestrate workflow parsing: detect format, reject UI/unknown,
        parse nodes, and return structured response.

        Args:
            workflow_json: Raw ComfyUI workflow JSON dict.

        Returns:
            (success, ParseWorkflowResponse, error_message)
        """
        fmt = self.detect_workflow_format(workflow_json)

        if fmt == "ui":
            response = ParseWorkflowResponse(
                success=False,
                format="ui",
                error=(
                    "This appears to be a UI-format workflow. Please enable "
                    "Dev Mode in ComfyUI settings and use 'Save (API Format)' "
                    "to export."
                ),
            )
            return False, response, response.error

        if fmt == "unknown":
            response = ParseWorkflowResponse(
                success=False,
                format="unknown",
                error=(
                    "Unrecognized workflow format. Expected ComfyUI API-format "
                    "JSON with numeric string keys and class_type fields."
                ),
            )
            return False, response, response.error

        # API format -- parse nodes
        nodes = self.parse_workflow_nodes(workflow_json)

        response = ParseWorkflowResponse(
            success=True,
            format="api",
            nodes=nodes,
        )
        return True, response, None
