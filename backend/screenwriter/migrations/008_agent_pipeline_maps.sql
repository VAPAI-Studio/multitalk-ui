-- Migration 008: agent_pipeline_maps table for pipeline orchestration
-- Stores AI-computed mappings of agents to template pipeline steps.
-- One row per agent-step pairing. Looked up at generation time by phase/subsection_key.
-- Phase 2 (pipeline_composer.py) writes rows; Phase 5 (agent_review_middleware.py) reads them.

CREATE TABLE IF NOT EXISTS agent_pipeline_maps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL,
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    phase           VARCHAR(50) NOT NULL,
    subsection_key  VARCHAR(100) NOT NULL,
    confidence      FLOAT NOT NULL DEFAULT 0.0,
    rationale       TEXT,
    pipeline_dirty  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_pipeline_map_lookup
        UNIQUE (owner_id, agent_id, phase, subsection_key)
);

-- Composite lookup index: used at generation time to find agents for a step
CREATE INDEX IF NOT EXISTS idx_pipeline_map_lookup
    ON agent_pipeline_maps (owner_id, phase, subsection_key);

-- Secondary index: used by Phase 2 composer to find dirty rows per owner
CREATE INDEX IF NOT EXISTS idx_pipeline_map_dirty
    ON agent_pipeline_maps (owner_id, pipeline_dirty)
    WHERE pipeline_dirty = TRUE;
