-- Migration 011: Project snapshots table (v5.0 -- Phase 45)
-- Stores full-copy JSONB snapshots of project writing state (PhaseData + ListItems + ScreenplayContent)

CREATE TABLE IF NOT EXISTS project_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT,
    trigger_type VARCHAR(50) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index for efficient listing: newest snapshots first per project
CREATE INDEX IF NOT EXISTS ix_project_snapshots_project_created
    ON project_snapshots(project_id, created_at DESC);
