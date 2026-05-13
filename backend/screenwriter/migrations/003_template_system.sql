-- backend/migrations/003_template_system.sql
-- Adds template/phase system columns and tables

-- New enum types
DO $$ BEGIN
    CREATE TYPE template_type AS ENUM ('short_movie');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE phase_type AS ENUM ('idea', 'story', 'scenes', 'write');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add new columns to projects
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS template template_type,
    ADD COLUMN IF NOT EXISTS current_phase phase_type DEFAULT 'idea',
    ADD COLUMN IF NOT EXISTS template_config JSONB DEFAULT '{}';

-- Phase data table
CREATE TABLE IF NOT EXISTS phase_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase phase_type NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    content JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_phase_data_lookup UNIQUE (project_id, phase, subsection_key)
);

-- List items table
CREATE TABLE IF NOT EXISTS list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phase_data_id UUID NOT NULL REFERENCES phase_data(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    content JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI sessions table
CREATE TABLE IF NOT EXISTS ai_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase phase_type NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    context_item_id UUID REFERENCES list_items(id),
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI messages table
CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(30) DEFAULT 'chat',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Wizard runs table
CREATE TABLE IF NOT EXISTS wizard_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wizard_type VARCHAR(50) NOT NULL,
    phase phase_type NOT NULL,
    config JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Screenplay content table
CREATE TABLE IF NOT EXISTS screenplay_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    list_item_id UUID REFERENCES list_items(id),
    content TEXT DEFAULT '',
    formatted_content JSONB DEFAULT '{}',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_phase_data_project ON phase_data(project_id);
CREATE INDEX IF NOT EXISTS idx_list_items_phase_data ON list_items(phase_data_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_project ON ai_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id);
