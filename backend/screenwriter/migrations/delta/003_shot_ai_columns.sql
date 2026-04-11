-- Migration 003: Add AI generation tracking columns to shots table
-- user_modified: set to TRUE when user manually edits a shot
-- ai_generated: set to TRUE for shots created by AI generation
ALTER TABLE shots ADD COLUMN IF NOT EXISTS user_modified BOOLEAN DEFAULT FALSE;
ALTER TABLE shots ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE;
