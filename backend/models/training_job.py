"""Pydantic models for Flux LoRA training jobs."""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict, Any
from datetime import datetime
from enum import Enum


class TrainingStatus(str, Enum):
    """Training job status enum."""
    PENDING = "pending"
    PREPARING = "preparing"
    TRAINING = "training"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrainingJobCreate(BaseModel):
    """Request model for creating a new training job."""
    job_name: str = Field(..., min_length=1, max_length=255, description="Name for this training job")
    instance_prompt: str = Field(..., min_length=1, max_length=255, description="Subject identifier (e.g., 'Jenn')")
    class_prompt: str = Field(..., min_length=1, max_length=255, description="General class (e.g., 'woman')")

    # Training parameters
    num_epochs: int = Field(default=20, ge=1, le=1000, description="Number of training epochs")
    learning_rate: float = Field(default=0.0001, gt=0, le=1, description="Learning rate")
    network_rank: int = Field(default=16, ge=4, le=256, description="Network rank (LoRA dimension)")
    network_alpha: int = Field(default=8, ge=1, le=256, description="Network alpha (regularization)")
    repeats: int = Field(default=5, ge=1, le=100, description="Image repetition count")

    # Optional advanced settings
    config_params: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Advanced configuration")

    @field_validator('network_alpha')
    @classmethod
    def validate_alpha(cls, v, info):
        """Validate that alpha is reasonable relative to rank."""
        # Note: info.data contains other validated fields
        if 'network_rank' in info.data:
            rank = info.data['network_rank']
            if v > rank:
                raise ValueError(f"network_alpha ({v}) should not exceed network_rank ({rank})")
        return v


class TrainingJobUpdate(BaseModel):
    """Request model for updating training job status."""
    status: Optional[TrainingStatus] = None
    progress_percentage: Optional[int] = Field(None, ge=0, le=100)
    current_step: Optional[int] = Field(None, ge=0)
    current_epoch: Optional[int] = Field(None, ge=0)
    loss: Optional[float] = None
    error_message: Optional[str] = None
    training_log: Optional[str] = None


class TrainingJobResponse(BaseModel):
    """Response model for training job."""
    id: str
    user_id: str
    job_name: str
    status: TrainingStatus
    progress_percentage: int

    # Configuration
    instance_prompt: str
    class_prompt: str
    num_epochs: int
    learning_rate: float
    network_rank: int
    network_alpha: int
    repeats: int
    config_params: Dict[str, Any]

    # Training data
    num_images: int
    dataset_folder: Optional[str]

    # Results
    output_lora_path: Optional[str]
    output_lora_url: Optional[str]
    model_size_mb: Optional[float]

    # Metrics
    current_step: int
    total_steps: int
    current_epoch: int
    loss: Optional[float]

    # Error info
    error_message: Optional[str]

    # Timestamps
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class TrainingJobList(BaseModel):
    """Response model for list of training jobs."""
    jobs: list[TrainingJobResponse]
    total: int
    page: int
    page_size: int


class TrainingConfigTOML(BaseModel):
    """Model for generating TOML configuration file."""
    # Model paths
    pretrained_model_name_or_path: str = Field(default="black-forest-labs/FLUX.1-dev")

    # Dataset
    train_data_dir: str
    output_dir: str
    output_name: str

    # Training parameters
    max_train_epochs: int
    learning_rate: float
    lr_scheduler: str = Field(default="constant")
    optimizer_type: str = Field(default="adamw8bit")

    # Network config
    network_module: str = Field(default="networks.lora_flux")
    network_dim: int  # network_rank
    network_alpha: int

    # Training settings
    train_batch_size: int = Field(default=1)
    gradient_accumulation_steps: int = Field(default=1)
    mixed_precision: str = Field(default="bf16")
    save_precision: str = Field(default="bf16")

    # Memory optimization
    cache_latents: bool = Field(default=True)
    cache_latents_to_disk: bool = Field(default=True)

    # Saving
    save_every_n_epochs: int = Field(default=1)
    save_model_as: str = Field(default="safetensors")

    # Miscellaneous
    seed: int = Field(default=42)
    clip_skip: int = Field(default=2)

    def to_toml_string(self) -> str:
        """Convert model to TOML format string."""
        lines = []
        for field_name, field_value in self.model_dump().items():
            if isinstance(field_value, str):
                lines.append(f'{field_name} = "{field_value}"')
            elif isinstance(field_value, bool):
                lines.append(f'{field_name} = {str(field_value).lower()}')
            else:
                lines.append(f'{field_name} = {field_value}')
        return '\n'.join(lines)
