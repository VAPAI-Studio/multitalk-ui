-- backend/migrations/003_templates_overhaul.sql
-- Template system: replaces rigid framework model with flexible template-based architecture

-- New enum types
CREATE TYPE template_type AS ENUM ('short_movie');
CREATE TYPE phase_type AS ENUM ('idea', 'story', 'scenes', 'write');

-- Extend projects table (non-destructive: keep framework column for backward compat)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template template_type;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_phase phase_type DEFAULT 'idea';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_config JSONB DEFAULT '{}';

-- Per-subsection structured content
CREATE TABLE phase_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase phase_type NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    content JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, phase, subsection_key)
);

-- Repeatable items: episodes, scenes, characters
CREATE TABLE list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phase_data_id UUID NOT NULL REFERENCES phase_data(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    content JSONB DEFAULT '{}',
    ai_suggestions JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contextual AI chat sessions scoped to phase/subsection/item
CREATE TABLE ai_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase phase_type NOT NULL,
    subsection_key VARCHAR(100) NOT NULL,
    context_item_id UUID REFERENCES list_items(id) ON DELETE SET NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(30) DEFAULT 'chat',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wizard execution tracking
CREATE TABLE wizard_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    wizard_type VARCHAR(50) NOT NULL,
    phase phase_type NOT NULL,
    config JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Screenplay content stored per episode/scene
CREATE TABLE screenplay_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    list_item_id UUID REFERENCES list_items(id) ON DELETE CASCADE,
    content TEXT DEFAULT '',
    formatted_content JSONB DEFAULT '{}',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_phase_data_project ON phase_data(project_id, phase);
CREATE INDEX idx_phase_data_lookup ON phase_data(project_id, phase, subsection_key);
CREATE INDEX idx_list_items_phase_data ON list_items(phase_data_id, sort_order);
CREATE INDEX idx_list_items_type ON list_items(phase_data_id, item_type);
CREATE INDEX idx_ai_sessions_project ON ai_sessions(project_id, phase, subsection_key);
CREATE INDEX idx_ai_messages_session ON ai_messages(session_id, created_at);
CREATE INDEX idx_wizard_runs_project ON wizard_runs(project_id, wizard_type);
CREATE INDEX idx_screenplay_project ON screenplay_content(project_id);
CREATE INDEX idx_screenplay_item ON screenplay_content(list_item_id);

-- Triggers for updated_at
CREATE TRIGGER update_phase_data_updated_at
    BEFORE UPDATE ON phase_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_list_items_updated_at
    BEFORE UPDATE ON list_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_sessions_updated_at
    BEFORE UPDATE ON ai_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_screenplay_content_updated_at
    BEFORE UPDATE ON screenplay_content FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
