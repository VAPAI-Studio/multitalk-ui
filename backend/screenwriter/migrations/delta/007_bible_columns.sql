-- Migration 007: Bible sections and episode duration on shows table (v4.2)
ALTER TABLE shows ADD COLUMN IF NOT EXISTS bible_characters TEXT DEFAULT '';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS bible_world_setting TEXT DEFAULT '';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS bible_season_arc TEXT DEFAULT '';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS bible_tone_style TEXT DEFAULT '';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS episode_duration_minutes INTEGER;
