"""
Pydantic models for the custom workflow builder.

Defines request/response schemas for workflow parsing and CRUD operations.
Used by the API router, custom workflow service, and builder UI.
"""
import re
from typing import Optional, List, Any, Literal

from pydantic import BaseModel, Field


# --- Slug utility ---


def generate_slug(name: str) -> str:
    """
    Generate a URL-safe slug from a feature name.

    Converts to lowercase, strips special characters, replaces
    spaces/hyphens with single hyphens, and removes leading/trailing hyphens.
    """
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s-]+', '-', slug)
    slug = slug.strip('-')
    return slug


# --- Workflow parsing models ---


class ParsedNodeInput(BaseModel):
    """A single input field on a ComfyUI workflow node."""
    name: str
    value: Any
    is_link: bool = False


class ParsedNode(BaseModel):
    """A parsed ComfyUI workflow node with its inputs."""
    node_id: str
    class_type: str
    title: Optional[str] = None
    inputs: List[ParsedNodeInput] = []
    configurable_inputs: List[ParsedNodeInput] = []


class ParseWorkflowRequest(BaseModel):
    """Request to parse a raw ComfyUI workflow JSON."""
    workflow_json: dict


class ParseWorkflowResponse(BaseModel):
    """Response from parsing a ComfyUI workflow JSON."""
    success: bool
    format: Optional[str] = None
    nodes: List[ParsedNode] = []
    error: Optional[str] = None


# --- CRUD models ---


class CreateCustomWorkflowRequest(BaseModel):
    """Request to create a new custom workflow configuration."""
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    workflow_json: dict
    output_type: Literal['image', 'video', 'audio'] = 'image'
    studio: Optional[str] = None
    icon: str = '\u26a1'
    gradient: str = 'from-blue-500 to-purple-600'


class UpdateCustomWorkflowRequest(BaseModel):
    """Request to partially update a custom workflow configuration."""
    name: Optional[str] = None
    description: Optional[str] = None
    variable_config: Optional[List[dict]] = None
    section_config: Optional[List[dict]] = None
    output_type: Optional[Literal['image', 'video', 'audio']] = None
    studio: Optional[str] = None
    icon: Optional[str] = None
    gradient: Optional[str] = None


class CustomWorkflowResponse(BaseModel):
    """Response for single custom workflow operations."""
    success: bool
    workflow: Optional[dict] = None
    error: Optional[str] = None


class CustomWorkflowListResponse(BaseModel):
    """Response for listing custom workflows."""
    success: bool
    workflows: List[dict] = []
    error: Optional[str] = None
