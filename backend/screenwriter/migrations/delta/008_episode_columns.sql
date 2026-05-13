-- Migration 008: Episode columns on projects table (v4.2)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS show_id UUID REFERENCES shows(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS episode_number INTEGER;
CREATE INDEX IF NOT EXISTS ix_projects_show_id ON projects(show_id);
