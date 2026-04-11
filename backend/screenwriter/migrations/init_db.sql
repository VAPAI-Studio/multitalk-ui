-- backend/migrations/init_db.sql
-- Consolidated schema — single source of truth for all tables.
-- All statements are idempotent (IF NOT EXISTS / DO...EXCEPTION guards).
-- Updated: merged 001–009 migrations.

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- Enum types  (DO blocks make them idempotent)
-- ============================================================
DO $$ BEGIN CREATE TYPE section_type AS ENUM (
    'inciting_incident','plot_point_1','midpoint','plot_point_2','climax','resolution'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE checklist_status AS ENUM ('pending','complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE framework AS ENUM ('three_act','save_the_cat','hero_journey');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE book_status AS ENUM (
    'pending','extracting','analyzing','embedding','completed','failed','paused'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE relationship_type AS ENUM (
    'depends_on','related_to','part_of','example_of','contradicts','extends'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE agent_type AS ENUM ('book_based','tag_based','orchestrator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE template_type AS ENUM ('short_movie');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE phase_type AS ENUM ('idea','story','scenes','write');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Shared trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Core tables
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id         UUID NOT NULL,
    title            VARCHAR(255) NOT NULL,
    framework        framework DEFAULT 'three_act',
    template         template_type,
    current_phase    phase_type DEFAULT 'idea',
    template_config  JSONB DEFAULT '{}',
    breakdown_stale  BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type           section_type NOT NULL,
    user_notes     TEXT DEFAULT '',
    ai_suggestions JSONB DEFAULT '{}',
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checklist_items (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    prompt     TEXT NOT NULL,
    answer     TEXT DEFAULT '',
    status     checklist_status DEFAULT 'pending',
    "order"    INTEGER DEFAULT 0
);

-- ============================================================
-- Books / RAG / Knowledge graph
-- ============================================================

CREATE TABLE IF NOT EXISTS books (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id            UUID NOT NULL,
    title               VARCHAR(500) NOT NULL,
    author              VARCHAR(500),
    filename            VARCHAR(500) NOT NULL,
    file_type           VARCHAR(50) NOT NULL,
    file_size_bytes     BIGINT DEFAULT 0,
    status              book_status DEFAULT 'pending',
    processing_step     VARCHAR(100),
    total_chunks        INTEGER DEFAULT 0,
    total_concepts      INTEGER DEFAULT 0,
    processing_error    TEXT,
    chapters_total      INTEGER DEFAULT 0,
    chapters_processed  INTEGER DEFAULT 0,
    progress            INTEGER DEFAULT 0,
    uploaded_at         TIMESTAMPTZ DEFAULT NOW(),
    processed_at        TIMESTAMPTZ,
    metadata            JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS book_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER DEFAULT 0,
    embedding       vector(1536),
    chapter_title   VARCHAR(500),
    page_number     INTEGER,
    concept_ids     JSONB DEFAULT '[]',
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    is_user_created BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS concepts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id              UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    name                 VARCHAR(255) NOT NULL,
    definition           TEXT NOT NULL,
    chapter_source       VARCHAR(500),
    page_range           VARCHAR(50),
    examples             JSONB DEFAULT '[]',
    actionable_questions JSONB DEFAULT '[]',
    section_relevance    JSONB DEFAULT '{}',
    tags                 JSONB DEFAULT '[]',
    quality_score        FLOAT,
    embedding            vector(1536),
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS concept_relationships (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    relationship      relationship_type NOT NULL,
    description       TEXT,
    UNIQUE (source_concept_id, target_concept_id, relationship)
);

-- ============================================================
-- Agents / Chat
-- ============================================================

CREATE TABLE IF NOT EXISTS agents (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id               UUID NOT NULL,
    name                   VARCHAR(255) NOT NULL,
    description            TEXT,
    system_prompt_template TEXT NOT NULL,
    personality            TEXT,
    color                  VARCHAR(7) DEFAULT '#6366f1',
    icon                   VARCHAR(50) DEFAULT 'book',
    agent_type             agent_type NOT NULL DEFAULT 'book_based',
    tags_filter            JSONB DEFAULT '[]',
    is_active              BOOLEAN DEFAULT TRUE,
    is_default             BOOLEAN DEFAULT FALSE,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_books (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    book_id  UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, book_id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL,
    agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id       UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role             VARCHAR(20) NOT NULL,
    content          TEXT NOT NULL,
    message_type     VARCHAR(20) DEFAULT 'chat',
    book_references  JSONB DEFAULT '[]',
    concepts_used    JSONB DEFAULT '[]',
    consulted_agents JSONB DEFAULT '[]',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Template / Phase system
-- ============================================================

CREATE TABLE IF NOT EXISTS phase_data (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase          phase_type NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    content        JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    sort_order     INTEGER DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_phase_data_lookup UNIQUE (project_id, phase, subsection_key)
);

CREATE TABLE IF NOT EXISTS list_items (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phase_data_id  UUID NOT NULL REFERENCES phase_data(id) ON DELETE CASCADE,
    item_type      VARCHAR(50) NOT NULL,
    sort_order     INTEGER DEFAULT 0,
    content        JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    status         VARCHAR(20) DEFAULT 'draft',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase           phase_type NOT NULL,
    subsection_key  VARCHAR(100) NOT NULL,
    context_item_id UUID REFERENCES list_items(id) ON DELETE SET NULL,
    user_id         UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id   UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL,
    content      TEXT NOT NULL,
    message_type VARCHAR(30) DEFAULT 'chat',
    metadata     JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wizard_runs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wizard_type   VARCHAR(50) NOT NULL,
    phase         phase_type NOT NULL,
    config        JSONB DEFAULT '{}',
    result        JSONB DEFAULT '{}',
    status        VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS screenplay_content (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    list_item_id      UUID REFERENCES list_items(id) ON DELETE CASCADE,
    content           TEXT DEFAULT '',
    formatted_content JSONB DEFAULT '{}',
    version           INTEGER DEFAULT 1,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Snippets
-- ============================================================

CREATE TABLE IF NOT EXISTS snippets (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id       UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_title VARCHAR(500),
    page_number   INTEGER,
    content       TEXT NOT NULL,
    justification TEXT,
    concept_ids   JSONB DEFAULT '[]',
    concept_names JSONB DEFAULT '[]',
    token_count   INTEGER DEFAULT 0,
    embedding     vector(1536),
    is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ
);

-- ============================================================
-- Agent pipeline maps
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_pipeline_maps (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id       UUID NOT NULL,
    agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    phase          VARCHAR(50) NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    confidence     FLOAT NOT NULL DEFAULT 0.0,
    rationale      TEXT,
    pipeline_dirty BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_pipeline_map_lookup UNIQUE (owner_id, agent_id, phase, subsection_key)
);

-- ============================================================
-- Breakdown (Script Breakdown v2.0)
-- ============================================================

CREATE TABLE IF NOT EXISTS breakdown_elements (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category      VARCHAR(50) NOT NULL,
    name          VARCHAR(500) NOT NULL,
    description   TEXT DEFAULT '',
    metadata      JSONB DEFAULT '{}',
    source        VARCHAR(20) DEFAULT 'ai',
    user_modified BOOLEAN DEFAULT FALSE,
    is_deleted    BOOLEAN DEFAULT FALSE,
    sort_order    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_breakdown_element UNIQUE (project_id, category, name)
);

CREATE TABLE IF NOT EXISTS element_scene_links (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    element_id    UUID NOT NULL REFERENCES breakdown_elements(id) ON DELETE CASCADE,
    scene_item_id UUID NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
    context       TEXT DEFAULT '',
    source        VARCHAR(20) DEFAULT 'ai',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_element_scene UNIQUE (element_id, scene_item_id)
);

CREATE TABLE IF NOT EXISTS breakdown_runs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status           VARCHAR(20) DEFAULT 'pending',
    config           JSONB DEFAULT '{}',
    result_summary   JSONB DEFAULT '{}',
    error_message    TEXT,
    elements_created INTEGER DEFAULT 0,
    elements_updated INTEGER DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);
CREATE INDEX IF NOT EXISTS idx_checklist_section ON checklist_items(section_id);
CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_book_chunks_book ON book_chunks(book_id);
CREATE INDEX IF NOT EXISTS idx_book_chunks_embedding ON book_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_book_chunks_not_deleted ON book_chunks(book_id, chunk_index) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_book_chunks_user_created ON book_chunks(book_id) WHERE is_user_created = TRUE;
CREATE INDEX IF NOT EXISTS idx_concepts_book ON concepts(book_id);
CREATE INDEX IF NOT EXISTS idx_concepts_embedding ON concepts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_concepts_tags ON concepts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_concepts_quality ON concepts(quality_score);
CREATE INDEX IF NOT EXISTS idx_concept_rels_source ON concept_relationships(source_concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_rels_target ON concept_relationships(target_concept_id);
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(is_active);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, agent_id, project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_phase_data_project ON phase_data(project_id, phase);
CREATE INDEX IF NOT EXISTS idx_phase_data_lookup ON phase_data(project_id, phase, subsection_key);
CREATE INDEX IF NOT EXISTS idx_list_items_phase_data ON list_items(phase_data_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_list_items_type ON list_items(phase_data_id, item_type);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_project ON ai_sessions(project_id, phase, subsection_key);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wizard_runs_project ON wizard_runs(project_id, wizard_type);
CREATE INDEX IF NOT EXISTS idx_screenplay_project ON screenplay_content(project_id);
CREATE INDEX IF NOT EXISTS idx_screenplay_item ON screenplay_content(list_item_id);
CREATE INDEX IF NOT EXISTS idx_snippets_book ON snippets(book_id);
CREATE INDEX IF NOT EXISTS idx_snippets_not_deleted ON snippets(book_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_snippets_embedding ON snippets USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_pipeline_map_lookup ON agent_pipeline_maps(owner_id, phase, subsection_key);
CREATE INDEX IF NOT EXISTS idx_pipeline_map_dirty ON agent_pipeline_maps(owner_id, pipeline_dirty) WHERE pipeline_dirty = TRUE;
CREATE INDEX IF NOT EXISTS idx_breakdown_elements_project ON breakdown_elements(project_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_elements_category ON breakdown_elements(project_id, category);
CREATE INDEX IF NOT EXISTS idx_breakdown_elements_active ON breakdown_elements(project_id, category) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_element_scene_element ON element_scene_links(element_id);
CREATE INDEX IF NOT EXISTS idx_element_scene_scene ON element_scene_links(scene_item_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_runs_project ON breakdown_runs(project_id);

-- ============================================================
-- Shotlist (v3.0 — Shotlist & Production Breakdown)
-- ============================================================

CREATE TABLE IF NOT EXISTS shots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_item_id   UUID REFERENCES list_items(id) ON DELETE SET NULL,
    shot_number     INTEGER NOT NULL DEFAULT 1,
    script_text     TEXT DEFAULT '',
    script_range    JSONB DEFAULT '{}',
    fields          JSONB DEFAULT '{}',
    sort_order      INTEGER DEFAULT 0,
    source          VARCHAR(20) DEFAULT 'user',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shot_elements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shot_id         UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    element_id      UUID NOT NULL REFERENCES breakdown_elements(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_shot_element UNIQUE (shot_id, element_id)
);

CREATE TABLE IF NOT EXISTS asset_media (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    element_id        UUID REFERENCES breakdown_elements(id) ON DELETE SET NULL,
    shot_id           UUID REFERENCES shots(id) ON DELETE SET NULL,
    file_type         VARCHAR(20) NOT NULL,
    file_path         VARCHAR(1000) NOT NULL,
    thumbnail_path    VARCHAR(1000),
    original_filename VARCHAR(500) NOT NULL,
    file_size_bytes   BIGINT NOT NULL DEFAULT 0,
    metadata          JSONB DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Shotlist staleness tracking
ALTER TABLE projects ADD COLUMN IF NOT EXISTS shotlist_stale BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_scene ON shots(scene_item_id);
CREATE INDEX IF NOT EXISTS idx_shots_project_sort ON shots(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shot_elements_shot ON shot_elements(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_elements_element ON shot_elements(element_id);
CREATE INDEX IF NOT EXISTS idx_asset_media_project ON asset_media(project_id);
CREATE INDEX IF NOT EXISTS idx_asset_media_element ON asset_media(element_id);
CREATE INDEX IF NOT EXISTS idx_asset_media_shot ON asset_media(shot_id);

-- ============================================================
-- Schema migration tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    id         SERIAL PRIMARY KEY,
    migration  VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mark this file as the baseline on fresh installs
INSERT INTO schema_migrations (migration)
VALUES ('000_baseline')
ON CONFLICT (migration) DO NOTHING;

-- ============================================================
-- Triggers
-- ============================================================

CREATE OR REPLACE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_sections_updated_at
    BEFORE UPDATE ON sections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_phase_data_updated_at
    BEFORE UPDATE ON phase_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_list_items_updated_at
    BEFORE UPDATE ON list_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_ai_sessions_updated_at
    BEFORE UPDATE ON ai_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_screenplay_content_updated_at
    BEFORE UPDATE ON screenplay_content FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_shots_updated_at
    BEFORE UPDATE ON shots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_asset_media_updated_at
    BEFORE UPDATE ON asset_media FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
