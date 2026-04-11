# backend/app/models/database.py

from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Text, JSON, func, Integer, Boolean, BigInteger, UniqueConstraint, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship as sa_relationship, deferred
from sqlalchemy.types import UserDefinedType
import uuid
import enum


class SafeVector(UserDefinedType):
    """Custom Vector type that safely handles both string and list values.

    pgvector's psycopg2 adapter may return values as Python lists, while
    the default pgvector SQLAlchemy Vector type expects strings. This wrapper
    handles both cases to avoid the 'list has no attribute split' error.
    """
    cache_ok = True

    def __init__(self, dim: int):
        self.dim = dim

    def get_col_spec(self) -> str:
        return f"vector({self.dim})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            if isinstance(value, (list, tuple)):
                return f"[{','.join(str(float(v)) for v in value)}]"
            return str(value)
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, list):
                return value
            if isinstance(value, str):
                return [float(v) for v in value[1:-1].split(',')]
            # numpy array or other array-like
            return list(value)
        return process

Base = declarative_base()

# ============================================================
# User model (v5.0 -- Phase 35)
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ============================================================
# API Key model (v5.0 -- Phase 43)
# ============================================================

class ApiKey(Base):
    __tablename__ = "sw_api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    key_prefix = Column(String(8), nullable=False)
    key_hash = Column(String(64), nullable=False, unique=True, index=True)
    scopes = Column(JSON, default=list)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)
    request_count = Column(Integer, nullable=False, default=0)
    rate_limit = Column(Integer, nullable=True)  # NULL = use default (1000 req/hour)


# ============================================================
# Show model (v4.2 -- Phase 36)
# ============================================================

class Show(Base):
    __tablename__ = "shows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Bible sections (Phase 37)
    bible_characters = Column(Text, default="")
    bible_world_setting = Column(Text, default="")
    bible_season_arc = Column(Text, default="")
    bible_tone_style = Column(Text, default="")
    episode_duration_minutes = Column(Integer, nullable=True)


class SectionType(str, enum.Enum):
    INCITING_INCIDENT = "inciting_incident"
    PLOT_POINT_1 = "plot_point_1"
    MIDPOINT = "midpoint"
    PLOT_POINT_2 = "plot_point_2"
    CLIMAX = "climax"
    RESOLUTION = "resolution"

class ChecklistStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETE = "complete"

class Framework(str, enum.Enum):
    THREE_ACT = "three_act"
    SAVE_THE_CAT = "save_the_cat"
    HERO_JOURNEY = "hero_journey"


class TemplateType(str, enum.Enum):
    SHORT_MOVIE = "short_movie"


class PhaseType(str, enum.Enum):
    IDEA = "idea"
    STORY = "story"
    SCENES = "scenes"
    WRITE = "write"


class BreakdownCategory(str, enum.Enum):
    CHARACTER = "character"
    LOCATION = "location"
    PROP = "prop"
    WARDROBE = "wardrobe"
    VEHICLE = "vehicle"


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    framework = Column(Enum(Framework), nullable=True)  # Legacy: kept for backward compat
    template = Column(Enum(TemplateType, values_callable=lambda x: [e.value for e in x]), nullable=True)
    current_phase = Column(Enum(PhaseType, values_callable=lambda x: [e.value for e in x]), default=PhaseType.IDEA)
    template_config = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    breakdown_stale = Column(Boolean, default=False)
    shotlist_stale = Column(Boolean, default=False)
    storyboard_style = Column(String(30), nullable=True)

    # Visual style prompt — project-level cinematic style anchor for AI image generation
    visual_style_prompt = Column(Text, default="")

    # Episode linking (Phase 39, v4.2)
    show_id = Column(UUID(as_uuid=True), ForeignKey("shows.id", ondelete="CASCADE"), nullable=True, index=True)
    episode_number = Column(Integer, nullable=True)

    sections = sa_relationship("Section", back_populates="project", cascade="all, delete-orphan")
    phase_data = sa_relationship("PhaseData", back_populates="project", cascade="all, delete-orphan")
    breakdown_elements = sa_relationship("BreakdownElement", back_populates="project",
                                          cascade="all, delete-orphan")
    breakdown_runs = sa_relationship("BreakdownRun", back_populates="project",
                                      cascade="all, delete-orphan")
    shots = sa_relationship("Shot", back_populates="project", cascade="all, delete-orphan")
    asset_media = sa_relationship("AssetMedia", back_populates="project", cascade="all, delete-orphan")
    snapshots = sa_relationship("ProjectSnapshot", back_populates="project", cascade="all, delete-orphan", order_by="ProjectSnapshot.created_at.desc()")

class Section(Base):
    __tablename__ = "sections"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    type = Column(Enum(SectionType), nullable=False)
    user_notes = Column(Text, default="")
    ai_suggestions = Column(JSON, default=dict)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    project = sa_relationship("Project", back_populates="sections")
    checklist_items = sa_relationship("ChecklistItem", back_populates="section", cascade="all, delete-orphan")

class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id = Column(UUID(as_uuid=True), ForeignKey("sections.id"), nullable=False, index=True)
    prompt = Column(Text, nullable=False)
    answer = Column(Text, default="")
    status = Column(Enum(ChecklistStatus), default=ChecklistStatus.PENDING)
    order = Column(Integer, default=0)

    section = sa_relationship("Section", back_populates="checklist_items")


# ============================================================
# Template system models
# ============================================================

class PhaseData(Base):
    __tablename__ = "phase_data"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    phase = Column(Enum(PhaseType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    subsection_key = Column(String(100), nullable=False)
    content = Column(JSON, default=dict)
    ai_suggestions = Column(JSON, default=dict)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = sa_relationship("Project", back_populates="phase_data")
    list_items = sa_relationship("ListItem", back_populates="phase_data", cascade="all, delete-orphan",
                              order_by="ListItem.sort_order")

    __table_args__ = (UniqueConstraint('project_id', 'phase', 'subsection_key', name='uq_phase_data_lookup'),)


class ListItem(Base):
    __tablename__ = "list_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phase_data_id = Column(UUID(as_uuid=True), ForeignKey("phase_data.id"), nullable=False, index=True)
    item_type = Column(String(50), nullable=False)
    sort_order = Column(Integer, default=0)
    content = Column(JSON, default=dict)
    ai_suggestions = Column(JSON, default=dict)
    status = Column(String(20), default="draft")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    phase_data = sa_relationship("PhaseData", back_populates="list_items")


class AISession(Base):
    __tablename__ = "ai_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    phase = Column(Enum(PhaseType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    subsection_key = Column(String(100), nullable=False)
    context_item_id = Column(UUID(as_uuid=True), ForeignKey("list_items.id"), nullable=True)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    messages = sa_relationship("AIMessage", back_populates="session", cascade="all, delete-orphan",
                            order_by="AIMessage.created_at")


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("ai_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String(30), default="chat")
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = sa_relationship("AISession", back_populates="messages")


class WizardRun(Base):
    __tablename__ = "wizard_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    wizard_type = Column(String(50), nullable=False)
    phase = Column(Enum(PhaseType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    config = Column(JSON, default=dict)
    result = Column(JSON, default=dict)
    status = Column(String(20), default="pending")
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))


class ScreenplayContent(Base):
    __tablename__ = "screenplay_content"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    list_item_id = Column(UUID(as_uuid=True), ForeignKey("list_items.id"), nullable=True)
    content = Column(Text, default="")
    formatted_content = Column(JSON, default=dict)
    version = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ============================================================
# Knowledge Graph + Agent models
# ============================================================

class BookStatus(str, enum.Enum):
    PENDING = "pending"
    EXTRACTING = "extracting"
    ANALYZING = "analyzing"
    EMBEDDING = "embedding"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class RelationshipType(str, enum.Enum):
    DEPENDS_ON = "depends_on"
    RELATED_TO = "related_to"
    PART_OF = "part_of"
    EXAMPLE_OF = "example_of"
    CONTRADICTS = "contradicts"
    EXTENDS = "extends"


class AgentType(str, enum.Enum):
    BOOK_BASED = "book_based"
    TAG_BASED = "tag_based"
    ORCHESTRATOR = "orchestrator"


class Book(Base):
    __tablename__ = "books"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    author = Column(String(500))
    filename = Column(String(500), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_size_bytes = Column(BigInteger, default=0)
    status = Column(Enum(BookStatus, values_callable=lambda x: [e.value for e in x]), default=BookStatus.PENDING)
    processing_step = Column(String(100))
    total_chunks = Column(Integer, default=0)
    total_concepts = Column(Integer, default=0)
    processing_error = Column(Text)
    chapters_total = Column(Integer, default=0)
    chapters_processed = Column(Integer, default=0)
    progress = Column(Integer, default=0)  # 0-100
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True))
    metadata_ = Column("metadata", JSON, default=dict)

    chunks = sa_relationship("BookChunk", back_populates="book", cascade="all, delete-orphan")
    concepts = sa_relationship("Concept", back_populates="book", cascade="all, delete-orphan")
    agents = sa_relationship("Agent", secondary="agent_books", back_populates="books")
    snippets = sa_relationship("Snippet", back_populates="book", cascade="all, delete-orphan")


class BookChunk(Base):
    __tablename__ = "book_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, default=0)
    embedding = deferred(Column(SafeVector(1536)))
    chapter_title = Column(String(500))
    page_number = Column(Integer)
    concept_ids = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Phase 1 — Snippet Manager
    is_deleted = Column(Boolean, default=False, nullable=False)
    is_user_created = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    book = sa_relationship("Book", back_populates="chunks")


class Snippet(Base):
    __tablename__ = "snippets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True)
    chapter_title = Column(String(500))
    page_number = Column(Integer)
    content = Column(Text, nullable=False)
    justification = Column(Text)
    concept_ids = Column(JSON, default=list)
    concept_names = Column(JSON, default=list)
    token_count = Column(Integer, default=0)
    embedding = deferred(Column(SafeVector(1536)))
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    book = sa_relationship("Book", back_populates="snippets")


class Concept(Base):
    __tablename__ = "concepts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    definition = Column(Text, nullable=False)
    chapter_source = Column(String(500))
    page_range = Column(String(50))
    examples = Column(JSON, default=list)
    actionable_questions = Column(JSON, default=list)
    section_relevance = Column(JSON, default=dict)
    tags = Column(JSON, default=list)
    quality_score = Column(Float, nullable=True)
    embedding = deferred(Column(SafeVector(1536)))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    book = sa_relationship("Book", back_populates="concepts")
    source_relationships = sa_relationship(
        "ConceptRelationship",
        foreign_keys="ConceptRelationship.source_concept_id",
        back_populates="source_concept",
        cascade="all, delete-orphan",
    )
    target_relationships = sa_relationship(
        "ConceptRelationship",
        foreign_keys="ConceptRelationship.target_concept_id",
        back_populates="target_concept",
        cascade="all, delete-orphan",
    )


class ConceptRelationship(Base):
    __tablename__ = "concept_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_concept_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False, index=True)
    target_concept_id = Column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False, index=True)
    relationship = Column(Enum(RelationshipType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    description = Column(Text)

    source_concept = sa_relationship("Concept", foreign_keys=[source_concept_id], back_populates="source_relationships")
    target_concept = sa_relationship("Concept", foreign_keys=[target_concept_id], back_populates="target_relationships")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    system_prompt_template = Column(Text, nullable=False)
    personality = Column(Text)
    color = Column(String(7), default="#6366f1")
    icon = Column(String(50), default="book")
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    agent_type = Column(
        Enum(AgentType, values_callable=lambda x: [e.value for e in x]),
        default=AgentType.BOOK_BASED,
        nullable=False,
    )
    tags_filter = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    books = sa_relationship("Book", secondary="agent_books", back_populates="agents")
    pipeline_maps = sa_relationship(
        "AgentPipelineMap",
        back_populates="agent",
        cascade="all, delete-orphan",
    )


class AgentBook(Base):
    __tablename__ = "agent_books"

    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), primary_key=True)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), primary_key=True)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    title = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    agent = sa_relationship("Agent")
    project = sa_relationship("Project")
    messages = sa_relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="chat")
    book_references = Column(JSON, default=list)
    concepts_used = Column(JSON, default=list)
    consulted_agents = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = sa_relationship("ChatSession", back_populates="messages")


# ============================================================
# Pipeline Orchestration models (Phase 1 — DB Foundation)
# ============================================================

class AgentPipelineMap(Base):
    __tablename__ = "agent_pipeline_maps"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id       = Column(UUID(as_uuid=True), nullable=False, index=True)
    agent_id       = Column(UUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, index=True)
    phase          = Column(String(50), nullable=False)
    subsection_key = Column(String(100), nullable=False)
    confidence     = Column(Float, nullable=False, default=0.0)
    rationale      = Column(Text)
    pipeline_dirty = Column(Boolean, nullable=False, default=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), onupdate=func.now())

    agent = sa_relationship("Agent", back_populates="pipeline_maps")

    __table_args__ = (
        UniqueConstraint(
            "owner_id", "agent_id", "phase", "subsection_key",
            name="uq_pipeline_map_lookup",
        ),
    )


# ============================================================
# Script Breakdown models (v2.0 — Phase 9 Data Foundation)
# ============================================================

class BreakdownElement(Base):
    __tablename__ = "breakdown_elements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    category = Column(String(50), nullable=False)
    name = Column(String(500), nullable=False)
    description = Column(Text, default="")
    metadata_ = Column("metadata", JSON, default=dict)
    source = Column(String(20), default="ai")
    user_modified = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = sa_relationship("Project", back_populates="breakdown_elements")
    scene_links = sa_relationship("ElementSceneLink", back_populates="element",
                                  cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('project_id', 'category', 'name', name='uq_breakdown_element'),
    )


class ElementSceneLink(Base):
    __tablename__ = "element_scene_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    element_id = Column(UUID(as_uuid=True), ForeignKey("breakdown_elements.id"), nullable=False, index=True)
    scene_item_id = Column(UUID(as_uuid=True), ForeignKey("list_items.id", ondelete="CASCADE"), nullable=False, index=True)
    context = Column(Text, default="")
    source = Column(String(20), default="ai")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    element = sa_relationship("BreakdownElement", back_populates="scene_links")

    __table_args__ = (
        UniqueConstraint('element_id', 'scene_item_id', name='uq_element_scene'),
    )


class BreakdownRun(Base):
    __tablename__ = "breakdown_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    status = Column(String(20), default="pending")
    config = Column(JSON, default=dict)
    result_summary = Column(JSON, default=dict)
    error_message = Column(Text)
    elements_created = Column(Integer, default=0)
    elements_updated = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))

    project = sa_relationship("Project", back_populates="breakdown_runs")


# ============================================================
# Shotlist models (v3.0 -- Phase 17 Data Foundation)
# ============================================================

class Shot(Base):
    __tablename__ = "shots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    scene_item_id = Column(UUID(as_uuid=True), ForeignKey("list_items.id", ondelete="SET NULL"), nullable=True, index=True)
    shot_number = Column(Integer, nullable=False, default=1)
    script_text = Column(Text, default="")
    script_range = Column(JSON, default=dict)
    fields = Column(JSON, default=dict)
    sort_order = Column(Integer, default=0)
    source = Column(String(20), default="user")
    user_modified = Column(Boolean, default=False)
    ai_generated = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = sa_relationship("Project", back_populates="shots")
    shot_elements = sa_relationship("ShotElement", back_populates="shot", cascade="all, delete-orphan")
    media = sa_relationship("AssetMedia", back_populates="shot", cascade="all, delete-orphan")
    storyboard_frames = sa_relationship("StoryboardFrame", back_populates="shot", cascade="all, delete-orphan")


class ShotElement(Base):
    __tablename__ = "shot_elements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shot_id = Column(UUID(as_uuid=True), ForeignKey("shots.id", ondelete="CASCADE"), nullable=False, index=True)
    element_id = Column(UUID(as_uuid=True), ForeignKey("breakdown_elements.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shot = sa_relationship("Shot", back_populates="shot_elements")
    element = sa_relationship("BreakdownElement")

    __table_args__ = (UniqueConstraint('shot_id', 'element_id', name='uq_shot_element'),)


class AssetMedia(Base):
    __tablename__ = "asset_media"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    element_id = Column(UUID(as_uuid=True), ForeignKey("breakdown_elements.id", ondelete="SET NULL"), nullable=True, index=True)
    shot_id = Column(UUID(as_uuid=True), ForeignKey("shots.id", ondelete="SET NULL"), nullable=True, index=True)
    file_type = Column(String(20), nullable=False)
    file_path = Column(String(1000), nullable=False)
    thumbnail_path = Column(String(1000), nullable=True)
    original_filename = Column(String(500), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=False, default=0)
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = sa_relationship("Project", back_populates="asset_media")
    element = sa_relationship("BreakdownElement")
    shot = sa_relationship("Shot", back_populates="media")


# ============================================================
# Storyboard models (v3.2 -- Phase 29)
# ============================================================

class StoryboardFrame(Base):
    __tablename__ = "storyboard_frames"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shot_id = Column(UUID(as_uuid=True), ForeignKey("shots.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(1000), nullable=False)
    thumbnail_path = Column(String(1000), nullable=True)
    file_type = Column(String(20), nullable=False)
    is_selected = Column(Boolean, default=False)
    generation_source = Column(String(20), default="user")
    generation_style = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    shot = sa_relationship("Shot", back_populates="storyboard_frames")


# ============================================================
# Version Control models (v5.0 -- Phase 45)
# ============================================================

class SnapshotTriggerType(str, enum.Enum):
    MANUAL = "manual"
    AUTO_WIZARD = "auto_wizard"
    AUTO_YOLO = "auto_yolo"
    PRE_RESTORE = "pre_restore"


class ProjectSnapshot(Base):
    __tablename__ = "project_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    label = Column(Text, nullable=True)
    trigger_type = Column(
        Enum(SnapshotTriggerType, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    data = deferred(Column(JSON, default=dict))
    metadata_ = Column("metadata", JSON, default=dict)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    project = sa_relationship("Project", back_populates="snapshots")

    __table_args__ = ()
