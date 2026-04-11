-- 004_agent_type_and_quality.sql
-- Adds agent type system (book_based / tag_based / orchestrator),
-- quality scoring for concepts, and consulted_agents tracking on chat messages.

-- Step 1: Add agent_type enum
DO $$ BEGIN
    CREATE TYPE agent_type AS ENUM ('book_based', 'tag_based', 'orchestrator');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add new columns to agents table
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS agent_type agent_type NOT NULL DEFAULT 'book_based',
    ADD COLUMN IF NOT EXISTS tags_filter JSONB DEFAULT '[]';

-- Step 3: Add quality_score to concepts (nullable — existing concepts get NULL, treated as passing threshold)
ALTER TABLE concepts
    ADD COLUMN IF NOT EXISTS quality_score FLOAT;

-- Step 4: Add consulted_agents to chat_messages for orchestrator transparency
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS consulted_agents JSONB DEFAULT '[]';

-- Step 5: GIN index on concepts.tags for fast tag containment queries
CREATE INDEX IF NOT EXISTS idx_concepts_tags ON concepts USING GIN (tags);

-- Step 6: Index for filtering by quality_score
CREATE INDEX IF NOT EXISTS idx_concepts_quality ON concepts(quality_score);

-- Step 7: Index for agent_type queries
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
