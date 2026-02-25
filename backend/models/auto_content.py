"""Pydantic models for Auto Content feature."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

# Type definitions
BatchJobStatus = Literal[
    'pending',
    'validating',
    'analyzing',
    'generating_master',
    'completed',
    'failed',
    'cancelled'
]

BatchItemType = Literal['master_frame', 'scene_image']

BatchItemStatus = Literal[
    'pending',
    'queued',
    'processing',
    'completed',
    'failed'
]


# Outline structure (for reference, not used in MVP generation)
class Scene(BaseModel):
    """Represents a scene in the outline."""
    scene_number: int
    description: str
    characters: List[str] = []  # Filenames from Characters/ folder
    props: List[str] = []  # Filenames from Props/ folder
    settings: List[str] = []  # Filenames from Settings/ folder
    action: str
    prompt: str


class Outline(BaseModel):
    """Collection of scenes parsed from script."""
    scenes: List[Scene]


# Database models
class ProjectFolder(BaseModel):
    """Cached Google Drive folder structure."""
    id: str
    project_folder_id: str
    user_id: str
    project_name: str

    # Subfolder IDs (cached from Drive)
    general_assets_folder_id: Optional[str] = None
    script_folder_id: Optional[str] = None
    master_frames_folder_id: Optional[str] = None
    characters_folder_id: Optional[str] = None
    props_folder_id: Optional[str] = None
    settings_folder_id: Optional[str] = None
    txtai_folder_id: Optional[str] = None
    imagesai_folder_id: Optional[str] = None
    imagesai_starred_folder_id: Optional[str] = None

    # Validation
    structure_valid: bool
    validation_error: Optional[str] = None
    last_validated_at: Optional[datetime] = None

    # Metadata
    last_synced_at: datetime
    created_at: datetime


class BatchJob(BaseModel):
    """Main container for Auto Content batch operations."""
    id: str
    user_id: str
    project_folder_id: str
    project_name: str
    status: BatchJobStatus
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    # Progress tracking
    total_master_frames: int = 0
    completed_master_frames: int = 0
    total_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0

    # Script analysis (stored for reference, not used in MVP)
    script_filename: Optional[str] = None
    outline_json: Optional[Dict[str, Any]] = None
    outline_last_updated: Optional[datetime] = None

    # Configuration
    master_frame_variations: int = 3

    # Error handling
    error_message: Optional[str] = None
    comfy_url: str


class BatchJobItem(BaseModel):
    """Individual image generation job within a batch."""
    id: str
    batch_job_id: str
    item_type: BatchItemType
    source_index: int  # Master frame number or scene number
    variation_number: int  # Which variation (1-3 for masters, 1-2 for scenes)
    image_job_id: Optional[str] = None
    status: BatchItemStatus
    created_at: datetime
    completed_at: Optional[datetime] = None

    # Output tracking (10 URLs: 1 grid + 9 crops)
    output_urls: Optional[List[str]] = None
    drive_file_ids: Optional[List[str]] = None

    # User actions
    starred: bool = False
    deleted: bool = False

    # Error handling
    error_message: Optional[str] = None


# Request/Response models
class CreateBatchJobPayload(BaseModel):
    """Request to create a new batch job."""
    user_id: str
    project_folder_id: str
    comfy_url: str


class UpdateOutlinePayload(BaseModel):
    """Request to update batch job outline."""
    outline: Outline


class StartGenerationPayload(BaseModel):
    """Request to start batch generation."""
    master_frame_variations: int = Field(
        3,
        ge=1,
        le=5,
        description="Number of variations to generate per master frame"
    )


class BatchJobResponse(BaseModel):
    """Response for batch job operations."""
    success: bool
    batch_job: Optional[BatchJob] = None
    error: Optional[str] = None


class BatchJobDetailResponse(BaseModel):
    """Response for batch job with all items."""
    success: bool
    batch_job: Optional[BatchJob] = None
    items: List[BatchJobItem] = []
    error: Optional[str] = None


class OutlineResponse(BaseModel):
    """Response for outline operations."""
    success: bool
    outline: Optional[Outline] = None
    error: Optional[str] = None


class BatchItemsResponse(BaseModel):
    """Response for paginated batch items."""
    success: bool
    items: List[BatchJobItem] = []
    total_count: int = 0
    error: Optional[str] = None


class BatchItemResponse(BaseModel):
    """Response for single batch item operations."""
    success: bool
    item: Optional[BatchJobItem] = None
    error: Optional[str] = None
