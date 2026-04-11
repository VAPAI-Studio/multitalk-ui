# backend/app/models/schemas.py

from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator, model_validator
from typing import List, Optional, Dict
from datetime import datetime
from uuid import UUID
from .database import SectionType, ChecklistStatus, Framework, TemplateType, PhaseType, AgentType, SnapshotTriggerType

# Base models
class ChecklistItemBase(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=500)
    answer: Optional[str] = Field(default="", max_length=1000)
    status: ChecklistStatus = ChecklistStatus.PENDING
    order: int = Field(default=0, ge=0)

    @field_validator('prompt')
    def validate_prompt(cls, v):
        if not v.strip():
            raise ValueError("Prompt cannot be empty or just whitespace")
        return v.strip()

    @field_validator('answer')
    def validate_answer(cls, v):
        if v is None:
            return ""
        return v.strip()

class ChecklistItemCreate(ChecklistItemBase):
    pass

class ChecklistItem(ChecklistItemBase):
    id: UUID
    section_id: UUID
    
    model_config = ConfigDict(from_attributes=True)

class SectionBase(BaseModel):
    type: SectionType
    user_notes: Optional[str] = Field(default="", max_length=10000)

    @field_validator('user_notes')
    def validate_notes(cls, v):
        if v is None:
            return ""
        return v.strip()

class SectionCreate(SectionBase):
    pass

class SectionUpdate(BaseModel):
    user_notes: Optional[str] = Field(None, max_length=10000)

    @field_validator('user_notes')
    def validate_notes(cls, v):
        if v is None:
            return v
        return v.strip()

class Section(SectionBase):
    id: UUID
    project_id: UUID
    ai_suggestions: Dict = Field(default_factory=dict)
    updated_at: Optional[datetime] = None
    checklist_items: List[ChecklistItem] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

class ProjectBase(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    framework: Framework = Framework.THREE_ACT

    @field_validator('title')
    def validate_title(cls, v):
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()

class ProjectCreate(ProjectBase):
    pass

class ProjectUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=255)
    framework: Optional[Framework] = None
    storyboard_style: Optional[str] = Field(None, pattern=r'^(photorealistic|cinematic|animated)$')
    visual_style_prompt: Optional[str] = None

    @field_validator('title')
    def validate_title(cls, v):
        if v is None:
            return v
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()

class Project(ProjectBase):
    id: UUID
    owner_id: UUID
    framework: Optional[Framework] = None  # Nullable for template-based projects
    template: Optional[TemplateType] = None
    current_phase: Optional[str] = None
    template_config: Dict = Field(default_factory=dict)
    storyboard_style: Optional[str] = None
    visual_style_prompt: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    show_id: Optional[UUID] = None
    episode_number: Optional[int] = None
    sections: List[Section] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

# Review models
class ReviewRequest(BaseModel):
    section_id: UUID
    text: str = Field(..., min_length=20, max_length=10000)
    framework: Framework = Framework.THREE_ACT

    @field_validator('text')
    def validate_text(cls, v):
        if not v.strip():
            raise ValueError("Review text cannot be empty or just whitespace")
        if len(v.strip()) < 20:
            raise ValueError("Review text must be at least 20 characters for meaningful analysis")
        return v.strip()

class ReviewResponse(BaseModel):
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)

# Auth models
class User(BaseModel):
    id: UUID
    email: EmailStr
    display_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    display_name: Optional[str] = Field(None, max_length=255)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)

class UserUpdate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=255)

class MagicLinkRequest(BaseModel):
    email: EmailStr

class MagicLinkResponse(BaseModel):
    message: str
    magic_link: str  # In production, this would be sent via email


# ============================================================
# Book schemas
# ============================================================

class BookResponse(BaseModel):
    id: UUID
    title: str
    author: Optional[str] = None
    filename: str
    file_type: str
    file_size_bytes: int
    status: str
    processing_step: Optional[str] = None
    total_chunks: int = 0
    total_concepts: int = 0
    processing_error: Optional[str] = None
    uploaded_at: datetime
    processed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class BookUploadResponse(BaseModel):
    id: str
    status: str
    message: str


# ============================================================
# Concept schemas
# ============================================================

class ConceptResponse(BaseModel):
    id: UUID
    name: str
    definition: str
    chapter_source: Optional[str] = None
    page_range: Optional[str] = None
    examples: List[Dict] = Field(default_factory=list)
    actionable_questions: List[str] = Field(default_factory=list)
    section_relevance: Dict = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    quality_score: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class ConceptRelationshipResponse(BaseModel):
    source_concept: str
    target_concept: str
    relationship: str
    description: Optional[str] = None


# ============================================================
# Agent schemas
# ============================================================

class AgentCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    system_prompt_template: str = Field(..., min_length=50)
    personality: Optional[str] = None
    color: str = Field(default="#6366f1", pattern=r'^#[0-9a-fA-F]{6}$')
    icon: str = Field(default="book", max_length=50)
    agent_type: AgentType = AgentType.BOOK_BASED
    tags_filter: List[str] = Field(default_factory=list)


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = None
    system_prompt_template: Optional[str] = Field(None, min_length=50)
    personality: Optional[str] = None
    color: Optional[str] = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')
    icon: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    agent_type: Optional[AgentType] = None
    tags_filter: Optional[List[str]] = None


class AgentResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    personality: Optional[str] = None
    color: str
    icon: str
    is_active: bool
    is_default: bool
    agent_type: str = "book_based"
    tags_filter: List[str] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# Chat schemas
# ============================================================

class ChatSessionCreate(BaseModel):
    agent_id: UUID
    project_id: UUID
    title: Optional[str] = None


class ChatSessionResponse(BaseModel):
    id: UUID
    agent_id: UUID
    project_id: UUID
    title: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    field_context: Optional[Dict] = None

    @field_validator('content')
    def validate_content(cls, v):
        if not v.strip():
            raise ValueError("Message cannot be empty")
        return v.strip()


class ChatReviewRequest(BaseModel):
    section_id: UUID


class BookReferenceSchema(BaseModel):
    concept_name: Optional[str] = None
    book_title: Optional[str] = None
    chapter: Optional[str] = None
    page: Optional[str] = None


class ChatMessageResponse(BaseModel):
    id: UUID
    role: str
    content: str
    message_type: str = "chat"
    book_references: List[BookReferenceSchema] = Field(default_factory=list)
    consulted_agents: List[Dict] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# Multi-agent review schemas
# ============================================================

class MultiAgentReviewRequest(BaseModel):
    section_id: UUID
    text: str = Field(..., min_length=20, max_length=10000)
    framework: Framework = Framework.THREE_ACT
    agent_ids: Optional[List[UUID]] = None

    @field_validator('text')
    def validate_text(cls, v):
        if not v.strip():
            raise ValueError("Review text cannot be empty")
        return v.strip()


class AgentReviewResult(BaseModel):
    agent_id: str
    agent_name: str
    agent_color: str
    agent_icon: str
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    book_references: List[Dict] = Field(default_factory=list)
    status: str
    error: Optional[str] = None


class ReviewSummary(BaseModel):
    total_agents: int
    completed: int
    errors: int
    total_issues: int
    total_suggestions: int


class MultiAgentReviewResponse(BaseModel):
    agent_reviews: List[AgentReviewResult]
    summary: ReviewSummary


# ============================================================
# Template system schemas
# ============================================================

class TemplateListItem(BaseModel):
    id: str
    name: str
    description: str
    icon: str


class ProjectCreateV2(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    template: TemplateType

    @field_validator('title')
    def validate_title(cls, v):
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()


class ProjectResponseV2(BaseModel):
    id: UUID
    owner_id: UUID
    title: str
    template: Optional[TemplateType] = None
    current_phase: Optional[str] = None
    template_config: Dict = Field(default_factory=dict)
    visual_style_prompt: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PhaseDataUpdate(BaseModel):
    content: Dict = Field(default_factory=dict)


class PhaseDataResponse(BaseModel):
    id: UUID
    project_id: UUID
    phase: str
    subsection_key: str
    content: Dict = Field(default_factory=dict)
    ai_suggestions: Dict = Field(default_factory=dict)
    sort_order: int = 0
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ListItemCreate(BaseModel):
    item_type: str = Field(..., max_length=50)
    content: Dict = Field(default_factory=dict)
    sort_order: Optional[int] = None


class ListItemUpdate(BaseModel):
    content: Optional[Dict] = None
    status: Optional[str] = None


class ListItemResponse(BaseModel):
    id: UUID
    phase_data_id: UUID
    item_type: str
    sort_order: int
    content: Dict = Field(default_factory=dict)
    ai_suggestions: Dict = Field(default_factory=dict)
    status: str = "draft"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ReorderItem(BaseModel):
    id: UUID
    sort_order: int


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


class AISessionCreate(BaseModel):
    project_id: UUID
    phase: str
    subsection_key: str
    context_item_id: Optional[UUID] = None


class AISessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    phase: str
    subsection_key: str
    context_item_id: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AIMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    mode: str = Field(default="brainstorm", pattern="^(brainstorm|action)$")
    allow_field_suggestions: bool = False

    @field_validator('content')
    def validate_content(cls, v):
        if not v.strip():
            raise ValueError("Message cannot be empty")
        return v.strip()


class AIMessageResponse(BaseModel):
    id: UUID
    session_id: UUID
    role: str
    content: str
    message_type: str = "chat"
    metadata: Dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class WizardRunRequest(BaseModel):
    project_id: UUID
    wizard_type: str = Field(..., max_length=50)
    phase: str
    config: Dict = Field(default_factory=dict)


class WizardRunResponse(BaseModel):
    id: UUID
    project_id: UUID
    wizard_type: str
    phase: str
    status: str
    config: Dict = Field(default_factory=dict)
    result: Dict = Field(default_factory=dict)
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    agents_consulted: List[Dict] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def extract_agents_consulted(self):
        """Extract agents_consulted from result._meta for convenient access."""
        if not self.agents_consulted and self.result:
            meta = self.result.get("_meta", {})
            self.agents_consulted = meta.get("agents_consulted", [])
        return self


class FillBlanksRequest(BaseModel):
    project_id: UUID
    phase: str
    subsection_key: str
    item_id: Optional[UUID] = None
    field_key: Optional[str] = None


class YoloFillRequest(BaseModel):
    project_id: UUID


class GiveNotesRequest(BaseModel):
    project_id: UUID
    phase: str
    subsection_key: str
    item_id: Optional[UUID] = None


class AnalyzeStructureRequest(BaseModel):
    project_id: UUID
    phase: str
    subsection_key: str


class AIActionResponse(BaseModel):
    content: Dict = Field(default_factory=dict)
    notes: List[str] = Field(default_factory=list)


class ScreenplayContentUpdate(BaseModel):
    content: str = ""
    formatted_content: Dict = Field(default_factory=dict)


class ScreenplayContentResponse(BaseModel):
    id: UUID
    project_id: UUID
    list_item_id: Optional[UUID] = None
    content: str = ""
    formatted_content: Dict = Field(default_factory=dict)
    version: int = 1
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# Snippet schemas (Phase 1 — Snippet Manager)
# ============================================================

class SnippetResponse(BaseModel):
    """Single chunk returned in list or after edit/create."""
    id: str
    book_id: str
    chunk_index: int
    content: str
    token_count: int
    chapter_title: Optional[str] = None
    page_number: Optional[int] = None
    is_deleted: bool
    is_user_created: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class SnippetListResponse(BaseModel):
    """Paginated list of snippets."""
    items: List[SnippetResponse]
    total: int
    page: int
    per_page: int
    pages: int


class SnippetEdit(BaseModel):
    """Body for PATCH /api/books/{book_id}/snippets/{chunk_id}."""
    content: str = Field(..., min_length=1, max_length=50000)


class SnippetCreate(BaseModel):
    """Body for POST /api/books/{book_id}/snippets."""
    content: str = Field(..., min_length=1, max_length=50000)
    chapter_title: Optional[str] = Field(None, max_length=500)
    page_number: Optional[int] = Field(None, ge=1)


# ============================================================
# Snippet Manager schemas (Phase 2 — /api/snippets endpoint)
# Distinct from SnippetResponse (Phase 1 BookChunk-based)
# ============================================================

class SnippetManagerResponse(BaseModel):
    id: str
    book_id: str
    chapter_title: Optional[str] = None
    page_number: Optional[int] = None
    content: str
    justification: Optional[str] = None
    concept_ids: list = []
    concept_names: list = []
    token_count: int
    is_deleted: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class SnippetManagerListResponse(BaseModel):
    items: List[SnippetManagerResponse]
    total: int
    page: int
    per_page: int
    pages: int
    book_status: str


# ============================================================
# Pipeline Map schemas (Phase 1 — DB Foundation)
# Used by Phase 3 GET /api/agents/pipeline-map endpoint.
# ============================================================

class PipelineMapEntry(BaseModel):
    """Single agent-to-step mapping row. Enables ORM round-trips and list serialization."""
    id: UUID
    owner_id: UUID
    agent_id: UUID
    phase: str
    subsection_key: str
    confidence: float = 0.0
    rationale: Optional[str] = None
    pipeline_dirty: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PipelineMapResponse(BaseModel):
    """Response shape for GET /api/agents/pipeline-map (Phase 3 endpoint).
    Flat list of entries; frontend or Phase 3 logic groups by phase/subsection_key."""
    owner_id: UUID
    entries: List[PipelineMapEntry] = Field(default_factory=list)
    total_mappings: int = 0

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# Breakdown Schemas (v2.0 — Phase 9 Data Foundation)
# ============================================================

class BreakdownElementCreate(BaseModel):
    category: str = Field(..., pattern="^(character|location|prop|wardrobe|vehicle)$")
    name: str = Field(..., min_length=1, max_length=500)
    description: str = ""
    metadata: Dict = Field(default_factory=dict)


class BreakdownElementUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = None
    metadata: Optional[Dict] = None


class SceneLinkResponse(BaseModel):
    id: UUID
    scene_item_id: UUID
    context: str = ""
    source: str
    scene_title: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class BreakdownElementResponse(BaseModel):
    id: UUID
    project_id: UUID
    category: str
    name: str
    description: str
    metadata: Dict = Field(default_factory=dict, validation_alias="metadata_")
    source: str
    user_modified: bool
    is_deleted: bool
    sort_order: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    scene_links: List[SceneLinkResponse] = Field(default_factory=list)
    synced_to_characters: bool = False

    model_config = ConfigDict(from_attributes=True)


class BreakdownRunResponse(BaseModel):
    id: UUID
    project_id: UUID
    status: str
    config: Dict = Field(default_factory=dict)
    result_summary: Dict = Field(default_factory=dict)
    elements_created: int = 0
    elements_updated: int = 0
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class BreakdownSummaryResponse(BaseModel):
    project_id: UUID
    is_stale: bool
    total_elements: int
    counts_by_category: Dict[str, int] = Field(default_factory=dict)
    last_run: Optional[BreakdownRunResponse] = None


class SceneLinkCreate(BaseModel):
    scene_item_id: UUID
    context: str = ""


# ============================================================
# Shotlist Schemas (v3.0 -- Phase 17 Data Foundation)
# ============================================================

class ScriptRange(BaseModel):
    scene_index: int = 0
    start_offset: int = 0
    end_offset: int = 0
    content_hash: str = ""


class ShotCreate(BaseModel):
    scene_item_id: Optional[UUID] = None
    shot_number: int = Field(default=1, ge=1)
    script_text: str = ""
    script_range: Optional[Dict] = Field(default_factory=dict)
    fields: Dict = Field(default_factory=dict)
    sort_order: Optional[int] = None
    source: str = Field(default="user", pattern="^(user|ai)$")
    ai_generated: bool = False


class ShotUpdate(BaseModel):
    scene_item_id: Optional[UUID] = None
    shot_number: Optional[int] = Field(None, ge=1)
    script_text: Optional[str] = None
    script_range: Optional[Dict] = None
    fields: Optional[Dict] = None
    sort_order: Optional[int] = None


class ShotResponse(BaseModel):
    id: UUID
    project_id: UUID
    scene_item_id: Optional[UUID] = None
    shot_number: int
    script_text: str = ""
    script_range: Dict = Field(default_factory=dict)
    fields: Dict = Field(default_factory=dict)
    sort_order: int = 0
    source: str = "user"
    user_modified: bool = False
    ai_generated: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ShotElementCreate(BaseModel):
    element_id: UUID


class ShotElementResponse(BaseModel):
    id: UUID
    shot_id: UUID
    element_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetMediaCreate(BaseModel):
    element_id: Optional[UUID] = None
    shot_id: Optional[UUID] = None
    file_type: str = Field(..., pattern="^(image|audio)$")
    original_filename: str = Field(..., min_length=1, max_length=500)
    file_size_bytes: int = Field(..., ge=0)


class AssetMediaResponse(BaseModel):
    id: UUID
    project_id: UUID
    element_id: Optional[UUID] = None
    shot_id: Optional[UUID] = None
    file_type: str
    file_path: str
    thumbnail_path: Optional[str] = None
    original_filename: str
    file_size_bytes: int = 0
    metadata: Dict = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================================
# Breakdown Chat (v3.0 — Phase 24)
# ============================================================

class BreakdownChatShotContext(BaseModel):
    id: str
    shot_number: int
    scene_item_id: Optional[str] = None
    fields: Dict = Field(default_factory=dict)
    source: str = "user"


class BreakdownChatElementContext(BaseModel):
    id: str
    category: str
    name: str
    description: str = ""


class BreakdownChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class BreakdownChatRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    message_history: List[BreakdownChatMessage] = Field(default_factory=list)
    shots_context: List[BreakdownChatShotContext] = Field(default_factory=list)
    elements_context: List[BreakdownChatElementContext] = Field(default_factory=list)


# ============================================================
# Storyboard Schemas (v3.2 -- Phase 29)
# ============================================================

class StoryboardFrameResponse(BaseModel):
    id: UUID
    shot_id: UUID
    file_path: str
    thumbnail_path: Optional[str] = None
    file_type: str
    is_selected: bool = False
    generation_source: str = "user"
    generation_style: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class StoryboardFrameUpdate(BaseModel):
    is_selected: Optional[bool] = None


# ============================================================
# Show Schemas (v4.2 -- Phase 36)
# ============================================================

class ShowCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    description: str = Field(default="", max_length=5000)

    @field_validator('title')
    def validate_title(cls, v):
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()


class ShowUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)

    @field_validator('title')
    def validate_title(cls, v):
        if v is None:
            return v
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()


class ShowResponse(BaseModel):
    id: UUID
    owner_id: UUID
    title: str
    description: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class BibleUpdate(BaseModel):
    """Request body for PUT /api/shows/{id}/bible. All fields optional for partial updates."""
    bible_characters: Optional[str] = Field(None, max_length=50000)
    bible_world_setting: Optional[str] = Field(None, max_length=50000)
    bible_season_arc: Optional[str] = Field(None, max_length=50000)
    bible_tone_style: Optional[str] = Field(None, max_length=50000)
    episode_duration_minutes: Optional[int] = Field(None, ge=1, le=480)


class BibleResponse(BaseModel):
    """Response for GET/PUT /api/shows/{id}/bible."""
    show_id: UUID
    bible_characters: str = ""
    bible_world_setting: str = ""
    bible_season_arc: str = ""
    bible_tone_style: str = ""
    episode_duration_minutes: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class EpisodeCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    episode_number: Optional[int] = Field(None, ge=1)
    framework: Framework = Framework.THREE_ACT

    @field_validator('title')
    def validate_title(cls, v):
        if not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()


# ============================================================
# API Key Schemas (v5.0 -- Phase 43)
# ============================================================

class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[datetime] = None


class ApiKeyCreateResponse(BaseModel):
    """Returned ONLY on creation -- includes the full key."""
    id: UUID
    name: str
    key: str  # Full sa_<prefix>_<secret> -- shown exactly once
    key_prefix: str
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApiKeyResponse(BaseModel):
    """Returned on list/get -- NO secret."""
    id: UUID
    name: str
    key_prefix: str
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[datetime] = None
    created_at: datetime
    last_used_at: Optional[datetime] = None
    request_count: int = 0
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# ============================================================
# Snapshot schemas (v5.0 -- Phase 45)
# ============================================================

class SnapshotListItemData(BaseModel):
    """Serialized ListItem within a snapshot blob (per D-01)."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    phase_data_id: str
    item_type: str
    sort_order: int = 0
    content: Dict = {}
    ai_suggestions: Dict = {}
    status: str = "draft"

class SnapshotPhaseDataEntry(BaseModel):
    """Serialized PhaseData with nested ListItems within a snapshot blob (per D-01)."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    phase: str
    subsection_key: str
    content: Dict = {}
    ai_suggestions: Dict = {}
    sort_order: int = 0
    list_items: List[SnapshotListItemData] = []

class SnapshotScreenplayContentEntry(BaseModel):
    """Serialized ScreenplayContent within a snapshot blob."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    list_item_id: Optional[str] = None
    content: str = ""
    formatted_content: Dict = {}
    version: int = 1

class SnapshotDataEnvelope(BaseModel):
    """Top-level version envelope for snapshot JSONB data (per D-02)."""
    version: int = 1
    phase_data: List[SnapshotPhaseDataEntry] = []
    screenplay_content: List[SnapshotScreenplayContentEntry] = []

class SnapshotMetadata(BaseModel):
    """Metadata stored alongside the snapshot blob (per D-03)."""
    phase_data_count: int = 0
    list_item_count: int = 0
    screenplay_count: int = 0
    blob_bytes: int = 0

class SnapshotCreate(BaseModel):
    """Request body for manual snapshot creation (SNAP-01)."""
    label: Optional[str] = Field(default=None, max_length=200)

class SnapshotResponse(BaseModel):
    """Response schema for snapshot metadata (excludes data blob)."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: UUID
    project_id: UUID
    label: Optional[str] = None
    trigger_type: str
    metadata_: Optional[Dict] = Field(default=None, alias="metadata", validation_alias="metadata_")
    version: int
    created_at: datetime


class SnapshotDetailResponse(BaseModel):
    """Response schema for single snapshot with full data blob (HIST-02)."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: UUID
    project_id: UUID
    label: Optional[str] = None
    trigger_type: str
    metadata_: Optional[Dict] = Field(default=None, alias="metadata", validation_alias="metadata_")
    version: int
    created_at: datetime
    data: Optional[Dict] = None


class RestoreResponse(BaseModel):
    """Response from snapshot restore operation (REST-01)."""
    safety_snapshot_id: UUID
    restored_snapshot_id: UUID
    phase_data_count: int
    list_item_count: int
    screenplay_count: int


class RestoreRequest(BaseModel):
    """Request body for partial restore (REST-04). If phase_ids is None, full restore."""
    phase_ids: Optional[List[str]] = Field(default=None, description="If provided, only restore these phase names")


class RemoveScreenplayResponse(BaseModel):
    """Response from screenplay removal operation (SCRP-01)."""
    safety_snapshot_id: UUID
    removed_screenplay_count: int
    cleared_phase_data_count: int
