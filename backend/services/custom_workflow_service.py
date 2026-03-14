"""
Custom Workflow Service

Handles workflow parsing (format detection, node extraction, link filtering)
and CRUD operations for custom workflow configurations. The parser is the core
intelligence of the Workflow Builder -- it takes raw ComfyUI API-format JSON
and extracts structured node/input data, filtering out link arrays.

CRUD methods provide create/read/update/delete/list/publish operations.
execute_dynamic_workflow is the single code path for both test runner and
production renderer (satisfies TEST-04).
"""
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from core.supabase import get_supabase
from models.custom_workflow import (
    CreateCustomWorkflowRequest,
    ParsedNode,
    ParsedNodeInput,
    ParseWorkflowResponse,
    UpdateCustomWorkflowRequest,
    generate_slug,
)
from services.comfyui_service import ComfyUIService
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

    # ------------------------------------------------------------------
    # Template File Management
    # ------------------------------------------------------------------

    def _save_template_file(self, slug: str, workflow_json: dict) -> None:
        """
        Write workflow JSON template to backend/workflows/custom/{slug}.json.

        Creates the custom/ subdirectory if it does not exist.

        Args:
            slug: URL-safe workflow identifier.
            workflow_json: The ComfyUI API-format workflow dict.
        """
        custom_dir = self.workflow_service.workflows_dir / "custom"
        os.makedirs(custom_dir, exist_ok=True)
        file_path = custom_dir / f"{slug}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(workflow_json, f, indent=2)

    def _delete_template_file(self, slug: str) -> None:
        """
        Remove workflow JSON template from disk if it exists.

        Does not raise if the file is missing.

        Args:
            slug: URL-safe workflow identifier.
        """
        file_path = self.workflow_service.workflows_dir / "custom" / f"{slug}.json"
        if file_path.exists():
            os.remove(file_path)

    # ------------------------------------------------------------------
    # CRUD Operations
    # ------------------------------------------------------------------

    async def create(
        self,
        data: CreateCustomWorkflowRequest,
        created_by: Optional[str] = None,
    ) -> Tuple[bool, Optional[dict], Optional[str]]:
        """
        Create a new custom workflow configuration.

        Generates slug from name if not provided, saves the template file
        to disk, and inserts a row into the custom_workflows table.

        Args:
            data: CreateCustomWorkflowRequest with workflow details.
            created_by: Optional user ID of the creator.

        Returns:
            (success, row_dict, error_message)
        """
        try:
            slug = data.slug if data.slug else generate_slug(data.name)

            # Save template file to disk
            self._save_template_file(slug, data.workflow_json)

            # Build the DB row
            row = {
                "name": data.name,
                "slug": slug,
                "description": data.description,
                "template_filename": f"{slug}.json",
                "original_workflow": data.workflow_json,
                "variable_config": [],
                "section_config": [],
                "output_type": data.output_type,
                "studio": data.studio,
                "icon": data.icon,
                "gradient": data.gradient,
            }
            if created_by:
                row["created_by"] = created_by

            result = (
                self.supabase.table("custom_workflows")
                .insert(row)
                .execute()
            )

            if result.data:
                row_data = result.data[0] if isinstance(result.data, list) else result.data
                return True, row_data, None
            return False, None, "Failed to create workflow"

        except Exception as e:
            error_str = str(e).lower()
            if "duplicate" in error_str or "unique" in error_str:
                return False, None, f"A workflow with slug '{slug}' already exists. Please choose a different name."
            return False, None, str(e)

    async def get(self, workflow_id: str) -> Optional[dict]:
        """
        Retrieve a single workflow by ID.

        Args:
            workflow_id: UUID of the workflow.

        Returns:
            Row dict or None if not found.
        """
        try:
            result = (
                self.supabase.table("custom_workflows")
                .select("*")
                .eq("id", workflow_id)
                .single()
                .execute()
            )
            return result.data if result.data else None
        except Exception:
            return None

    async def list_all(self) -> List[dict]:
        """
        List all custom workflows ordered by created_at descending.

        Returns:
            List of row dicts.
        """
        try:
            result = (
                self.supabase.table("custom_workflows")
                .select("*")
                .order("created_at", desc=True)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    async def list_published(self) -> List[dict]:
        """
        List only published custom workflows ordered by created_at descending.

        Returns:
            List of row dicts where is_published is True.
        """
        try:
            result = (
                self.supabase.table("custom_workflows")
                .select("*")
                .eq("is_published", True)
                .order("created_at", desc=True)
                .execute()
            )
            return result.data or []
        except Exception:
            return []

    async def update(
        self,
        workflow_id: str,
        data: UpdateCustomWorkflowRequest,
    ) -> Tuple[bool, Optional[dict], Optional[str]]:
        """
        Partially update a custom workflow configuration.

        Only non-None fields from the request are applied. Always sets
        updated_at to the current UTC time.

        Args:
            workflow_id: UUID of the workflow to update.
            data: UpdateCustomWorkflowRequest with optional fields.

        Returns:
            (success, updated_row_dict, error_message)
        """
        try:
            update_dict = data.model_dump(exclude_none=True)
            update_dict["updated_at"] = datetime.now(timezone.utc).isoformat()

            result = (
                self.supabase.table("custom_workflows")
                .update(update_dict)
                .eq("id", workflow_id)
                .execute()
            )

            if result.data:
                row_data = result.data[0] if isinstance(result.data, list) else result.data
                return True, row_data, None
            return False, None, "Workflow not found"

        except Exception as e:
            return False, None, str(e)

    async def delete(self, workflow_id: str) -> Tuple[bool, Optional[str]]:
        """
        Delete a custom workflow: remove DB row and template file.

        Args:
            workflow_id: UUID of the workflow to delete.

        Returns:
            (success, error_message)
        """
        try:
            # Get the workflow first (need slug for file deletion)
            workflow = await self.get(workflow_id)
            if not workflow:
                return False, "Workflow not found"

            slug = workflow.get("slug", "")

            # Delete the DB row
            self.supabase.table("custom_workflows").delete().eq("id", workflow_id).execute()

            # Delete the template file from disk
            if slug:
                self._delete_template_file(slug)

            return True, None

        except Exception as e:
            return False, str(e)

    async def toggle_publish(
        self,
        workflow_id: str,
        publish: bool,
    ) -> Tuple[bool, Optional[dict], Optional[str]]:
        """
        Set the is_published flag on a workflow.

        Args:
            workflow_id: UUID of the workflow.
            publish: True to publish, False to unpublish.

        Returns:
            (success, updated_row_dict, error_message)
        """
        try:
            update_data = {
                "is_published": publish,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

            result = (
                self.supabase.table("custom_workflows")
                .update(update_data)
                .eq("id", workflow_id)
                .execute()
            )

            if result.data:
                row_data = result.data[0] if isinstance(result.data, list) else result.data
                return True, row_data, None
            return False, None, "Workflow not found"

        except Exception as e:
            return False, None, str(e)

    # ------------------------------------------------------------------
    # Workflow Execution
    # ------------------------------------------------------------------

    async def execute_dynamic_workflow(
        self,
        workflow_config: dict,
        user_params: dict,
        base_url: str,
        client_id: str,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Execute a custom workflow through the standard pipeline.

        This is the single code path used by both the test runner (Phase 16)
        and the production renderer, satisfying TEST-04. It orchestrates:
        1. Template loading and parameter substitution via WorkflowService
        2. Workflow validation via WorkflowService
        3. Prompt submission via ComfyUIService

        Args:
            workflow_config: Row dict from the custom_workflows table.
            user_params: User-provided parameter values to substitute.
            base_url: ComfyUI server URL.
            client_id: WebSocket client ID for progress tracking.

        Returns:
            (success, prompt_id, error_message)
        """
        slug = workflow_config.get("slug", "")
        template_name = f"custom/{slug}"

        # Step 1: Load template and substitute parameters
        success, workflow, error = await self.workflow_service.build_workflow(
            template_name, user_params
        )
        if not success:
            return False, None, error

        # Step 2: Validate the built workflow
        valid, validation_error = await self.workflow_service.validate_workflow(workflow)
        if not valid:
            return False, None, validation_error

        # Step 3: Submit to ComfyUI
        comfyui_service = ComfyUIService()
        success, prompt_id, submit_error = await comfyui_service.submit_prompt(
            base_url,
            {"prompt": workflow, "client_id": client_id},
        )

        return success, prompt_id, submit_error

    async def execute_dynamic_workflow_runpod(
        self,
        workflow_config: dict,
        user_params: dict,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Execute a custom workflow via RunPod serverless.

        Builds full workflow JSON then submits to the universal RUNPOD_ENDPOINT_ID
        via RunPodService.submit_built_workflow (avoids double template loading).

        Args:
            workflow_config: Row dict from the custom_workflows table.
            user_params: User-provided parameter values to substitute.

        Returns:
            (success, job_id, error_message)
        """
        from services.runpod_service import RunPodService
        slug = workflow_config.get("slug", "")
        template_name = f"custom/{slug}"

        # Step 1: Build workflow (same as ComfyUI path)
        success, workflow, error = await self.workflow_service.build_workflow(
            template_name, user_params
        )
        if not success:
            return False, None, error

        # Step 2: Submit built workflow JSON directly to RunPod
        runpod_service = RunPodService()
        return await runpod_service.submit_built_workflow(workflow)
