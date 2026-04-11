-- Migration 009: breakdown tables for v2.0 Script Breakdown
-- Creates breakdown_elements, element_scene_links, breakdown_runs tables
-- Adds breakdown_stale column to projects table
--
-- breakdown_elements: master list of production elements (characters, locations, props, etc.)
-- element_scene_links: junction table linking elements to scene ListItems
-- breakdown_runs: audit trail for AI extraction runs

CREATE TABLE IF NOT EXISTS breakdown_elements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category        VARCHAR(50) NOT NULL,
    name            VARCHAR(500) NOT NULL,
    description     TEXT DEFAULT '',
    metadata        JSONB DEFAULT '{}',
    source          VARCHAR(20) DEFAULT 'ai',
    user_modified   BOOLEAN DEFAULT FALSE,
    is_deleted      BOOLEAN DEFAULT FALSE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_breakdown_element UNIQUE (project_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_elements_project
    ON breakdown_elements(project_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_elements_category
    ON breakdown_elements(project_id, category);
-- Partial index: active elements lookup (excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_breakdown_elements_active
    ON breakdown_elements(project_id, category) WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS element_scene_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    element_id      UUID NOT NULL REFERENCES breakdown_elements(id) ON DELETE CASCADE,
    scene_item_id   UUID NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
    context         TEXT DEFAULT '',
    source          VARCHAR(20) DEFAULT 'ai',
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_element_scene UNIQUE (element_id, scene_item_id)
);

CREATE INDEX IF NOT EXISTS idx_element_scene_element
    ON element_scene_links(element_id);
CREATE INDEX IF NOT EXISTS idx_element_scene_scene
    ON element_scene_links(scene_item_id);

CREATE TABLE IF NOT EXISTS breakdown_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'pending',
    config          JSONB DEFAULT '{}',
    result_summary  JSONB DEFAULT '{}',
    error_message   TEXT,
    elements_created INTEGER DEFAULT 0,
    elements_updated INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_breakdown_runs_project
    ON breakdown_runs(project_id);

-- Add staleness tracking to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS breakdown_stale BOOLEAN DEFAULT FALSE;
