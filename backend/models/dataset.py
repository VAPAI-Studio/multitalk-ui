from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime

class WorkflowSettings(BaseModel):
    caption_type: str
    caption_length: str
    max_new_tokens: int
    temperature: float
    character_name: str
    refer_character_name: bool
    exclude_people_info: bool
    include_lighting: bool
    include_camera_angle: bool
    include_watermark: bool
    include_JPEG_artifacts: bool
    include_exif: bool
    exclude_sexual: bool
    exclude_image_resolution: bool
    include_aesthetic_quality: bool
    include_composition_style: bool
    exclude_text: bool
    specify_depth_field: bool
    specify_lighting_sources: bool
    do_not_use_ambiguous_language: bool
    include_nsfw: bool
    only_describe_most_important_elements: bool
    do_not_include_artist_name_or_title: bool
    identify_image_orientation: bool
    use_vulgar_slang_and_profanity: bool
    do_not_use_polite_euphemisms: bool
    include_character_age: bool
    include_camera_shot_type: bool
    exclude_mood_feeling: bool
    include_camera_vantage_height: bool
    mention_watermark: bool
    avoid_meta_descriptive_phrases: bool
    top_p: float
    top_k: int
    user_prompt: str

class Dataset(BaseModel):
    id: str
    name: str
    character_trigger: str
    created_at: datetime
    updated_at: datetime
    settings: WorkflowSettings

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }

class DataEntry(BaseModel):
    id: str
    dataset_id: str
    image_url: str
    image_name: str
    caption: str
    created_at: datetime

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None
        }

class CreateDatasetPayload(BaseModel):
    name: str
    character_trigger: str
    settings: WorkflowSettings

class ImageWithCaption(BaseModel):
    image_name: str
    caption: Optional[str] = None

class SaveDatasetPayload(BaseModel):
    name: str
    character_trigger: str
    settings: WorkflowSettings
    images: list[ImageWithCaption]

class DatasetResponse(BaseModel):
    success: bool
    dataset: Optional[Dataset] = None
    data: list[DataEntry] = []
    error: Optional[str] = None

class DatasetListResponse(BaseModel):
    success: bool
    datasets: list[Dataset] = []
    error: Optional[str] = None