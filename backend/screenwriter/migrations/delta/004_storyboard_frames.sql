-- Migration 004: Storyboard frames table and project style setting
CREATE TABLE IF NOT EXISTS storyboard_frames (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    file_path VARCHAR(1000) NOT NULL,
    thumbnail_path VARCHAR(1000),
    file_type VARCHAR(20) NOT NULL,
    is_selected BOOLEAN DEFAULT FALSE,
    generation_source VARCHAR(20) DEFAULT 'user',
    generation_style VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_storyboard_frames_shot_id ON storyboard_frames(shot_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS storyboard_style VARCHAR(30);
