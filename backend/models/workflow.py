from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime

OutputType = Literal['video', 'image', 'text']

class Workflow(BaseModel):
    """Model for workflow reference table"""
    id: int = Field(..., description="Primary key")
    name: str = Field(..., description="Workflow identifier (e.g., 'lipsync-one')")
    output_type: OutputType = Field(..., description="Type of output: video, image, or text")
    display_name: str = Field(..., description="Human-readable name")
    description: Optional[str] = Field(None, description="Workflow description")
    is_active: bool = Field(True, description="Whether workflow is active")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }


class WorkflowResponse(BaseModel):
    """Response for workflow operations"""
    success: bool
    workflow: Optional[Workflow] = None
    error: Optional[str] = None


class WorkflowListResponse(BaseModel):
    """Response for listing workflows"""
    success: bool
    workflows: list[Workflow] = []
    error: Optional[str] = None


# Mapping of workflow names to their output types
WORKFLOW_OUTPUT_TYPES = {
    # Video workflows
    'lipsync-one': 'video',
    'lipsync-multi': 'video',
    'video-lipsync': 'video',
    'wan-i2v': 'video',
    'wan-move': 'video',
    'ltx-i2v': 'video',
    # Image workflows
    'img2img': 'image',
    'style-transfer': 'image',
    'image-edit': 'image',
    # Text workflows
    'character-caption': 'text',
}


def get_output_type(workflow_name: str) -> OutputType:
    """Get the output type for a workflow name"""
    return WORKFLOW_OUTPUT_TYPES.get(workflow_name, 'video')


def is_video_workflow(workflow_name: str) -> bool:
    """Check if a workflow produces video output"""
    return get_output_type(workflow_name) == 'video'


def is_image_workflow(workflow_name: str) -> bool:
    """Check if a workflow produces image output"""
    return get_output_type(workflow_name) == 'image'


def is_text_workflow(workflow_name: str) -> bool:
    """Check if a workflow produces text output"""
    return get_output_type(workflow_name) == 'text'
