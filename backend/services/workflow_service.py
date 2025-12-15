import json
import os
import re
from typing import Dict, Any, Tuple, Optional
from pathlib import Path

class WorkflowService:
    """Service for managing ComfyUI workflow templates"""

    def __init__(self):
        # Get the workflows directory path
        self.workflows_dir = Path(__file__).parent.parent / "workflows"

    def _find_template_path(self, template_name: str) -> Optional[Path]:
        """
        Find a template file by name, searching in root and subdirectories

        Args:
            template_name: Name of the template file (without .json extension)

        Returns:
            Path to the template file, or None if not found
        """
        # First check root workflows directory
        root_path = self.workflows_dir / f"{template_name}.json"
        if root_path.exists():
            return root_path

        # Then check subdirectories
        for subdir in self.workflows_dir.iterdir():
            if subdir.is_dir():
                subdir_path = subdir / f"{template_name}.json"
                if subdir_path.exists():
                    return subdir_path

        return None

    async def load_template(self, template_name: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Load a workflow template from the workflows directory or subdirectories

        Args:
            template_name: Name of the template file (e.g., "VideoLipsync", "WANI2V", "FluxLora")

        Returns:
            (success, template_dict, error_message)
        """
        try:
            template_path = self._find_template_path(template_name)

            if template_path is None:
                return False, None, f"Template '{template_name}' not found"

            with open(template_path, 'r', encoding='utf-8') as f:
                template = json.load(f)

            return True, template, None

        except json.JSONDecodeError as e:
            return False, None, f"Invalid JSON in template '{template_name}': {str(e)}"
        except Exception as e:
            return False, None, f"Error loading template '{template_name}': {str(e)}"
    
    async def build_workflow(self, template_name: str, parameters: Dict[str, Any]) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Build a complete workflow from a template and parameters
        
        Args:
            template_name: Name of the template to use
            parameters: Dictionary of parameters to substitute in the template
            
        Returns:
            (success, workflow_dict, error_message)
        """
        try:
            # Load the template
            success, template, error = await self.load_template(template_name)
            if not success:
                return False, None, error
            
            # Convert template to string for placeholder replacement
            template_str = json.dumps(template)
            
            # Replace placeholders
            for key, value in parameters.items():
                placeholder = f"{{{{{key}}}}}"
                
                # Handle different value types
                if isinstance(value, bool):
                    # For boolean values - handle this FIRST before str check
                    template_str = template_str.replace(f'"{placeholder}"', str(value).lower())
                elif isinstance(value, str):
                    # For string values, ensure proper JSON escaping
                    escaped_value = value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                    template_str = template_str.replace(f'"{placeholder}"', f'"{escaped_value}"')
                elif isinstance(value, (int, float)):
                    # For numeric values, replace without quotes
                    template_str = template_str.replace(f'"{placeholder}"', str(value))
                else:
                    # For other types, convert to string
                    template_str = template_str.replace(f'"{placeholder}"', f'"{str(value)}"')
            
            # Additional safety: fix any remaining Python boolean literals
            template_str = template_str.replace(': True,', ': true,')
            template_str = template_str.replace(': False,', ': false,')
            template_str = template_str.replace(': True}', ': true}')
            template_str = template_str.replace(': False}', ': false}')
            
            # Check for any remaining placeholders
            remaining = re.findall(r'\{\{[^}]+\}\}', template_str)
            if remaining:
                return False, None, f"Unsubstituted placeholders found: {', '.join(remaining)}"
            
            # Parse back to dictionary
            try:
                workflow = json.loads(template_str)
            except json.JSONDecodeError as e:
                # For debugging, print the problematic area
                start = max(0, e.pos - 50)
                end = min(len(template_str), e.pos + 50)
                context = template_str[start:end]
                return False, None, f"Invalid JSON after substitution at position {e.pos}: ...{context}..."
            
            return True, workflow, None
            
        except json.JSONDecodeError as e:
            return False, None, f"Error building workflow: Invalid JSON after substitution - {str(e)}"
        except Exception as e:
            return False, None, f"Error building workflow: {str(e)}"
    
    def list_templates(self) -> Dict[str, str]:
        """
        List all available workflow templates from root and subdirectories

        Returns:
            Dictionary mapping template names to their descriptions
        """
        templates = {}

        try:
            # Get templates from root directory
            for template_file in self.workflows_dir.glob("*.json"):
                template_name = template_file.stem
                templates[template_name] = f"Workflow template: {template_name}"

            # Get templates from subdirectories
            for subdir in self.workflows_dir.iterdir():
                if subdir.is_dir():
                    for template_file in subdir.glob("*.json"):
                        template_name = template_file.stem
                        folder_name = subdir.name
                        templates[template_name] = f"Workflow template: {template_name} (in {folder_name}/)"

        except Exception as e:
            print(f"Error listing templates: {e}")

        return templates
    
    async def validate_workflow(self, workflow: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """
        Basic validation of a workflow dictionary
        
        Args:
            workflow: The workflow dictionary to validate
            
        Returns:
            (is_valid, error_message)
        """
        try:
            # Check if workflow is a dictionary
            if not isinstance(workflow, dict):
                return False, "Workflow must be a dictionary"
            
            # Check if workflow has nodes
            if not workflow:
                return False, "Workflow cannot be empty"
            
            # Check for basic node structure
            for node_id, node_data in workflow.items():
                if not isinstance(node_data, dict):
                    return False, f"Node {node_id} must be a dictionary"
                
                if "class_type" not in node_data:
                    return False, f"Node {node_id} missing required 'class_type' field"
                
                if "inputs" not in node_data:
                    return False, f"Node {node_id} missing required 'inputs' field"
            
            return True, None
            
        except Exception as e:
            return False, f"Validation error: {str(e)}"

    async def get_template_parameters(self, template_name: str) -> Tuple[bool, Optional[list], Optional[str]]:
        """
        Extract parameters (placeholders) from a template
        
        Args:
            template_name: Name of the template to analyze
            
        Returns:
            (success, list_of_parameters, error_message)
        """
        try:
            success, template, error = await self.load_template(template_name)
            if not success:
                return False, None, error
            
            # Convert to string and find all placeholders
            template_str = json.dumps(template)
            import re
            
            # Find all {{PARAMETER}} patterns
            placeholders = re.findall(r'\{\{([^}]+)\}\}', template_str)
            
            # Remove duplicates and return as list
            unique_parameters = list(set(placeholders))
            
            return True, unique_parameters, None
            
        except Exception as e:
            return False, None, f"Error extracting parameters: {str(e)}"