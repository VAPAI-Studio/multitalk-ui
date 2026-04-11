-- Migration 002: shotlist tables for v3.0 Shotlist & Production Breakdown
-- Creates shots, shot_elements, asset_media tables
-- Adds shotlist_stale column to projects table
--
-- shots: individual camera shots linked to scenes, with JSONB fields for extensibility
-- shot_elements: junction table linking shots to breakdown_elements
-- asset_media: media files (images, audio) attached to elements or shots

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

CREATE INDEX IF NOT EXISTS idx_shots_project
    ON shots(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_scene
    ON shots(scene_item_id);
CREATE INDEX IF NOT EXISTS idx_shots_project_sort
    ON shots(project_id, sort_order);

CREATE TABLE IF NOT EXISTS shot_elements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shot_id         UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    element_id      UUID NOT NULL REFERENCES breakdown_elements(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_shot_element UNIQUE (shot_id, element_id)
);

CREATE INDEX IF NOT EXISTS idx_shot_elements_shot
    ON shot_elements(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_elements_element
    ON shot_elements(element_id);

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

CREATE INDEX IF NOT EXISTS idx_asset_media_project
    ON asset_media(project_id);
CREATE INDEX IF NOT EXISTS idx_asset_media_element
    ON asset_media(element_id);
CREATE INDEX IF NOT EXISTS idx_asset_media_shot
    ON asset_media(shot_id);

-- Add staleness tracking to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS shotlist_stale BOOLEAN DEFAULT FALSE;

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER update_shots_updated_at
    BEFORE UPDATE ON shots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_asset_media_updated_at
    BEFORE UPDATE ON asset_media FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
