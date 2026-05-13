-- Migration 014: Add visual_style_prompt to projects
-- Project-level cinematic style anchor for AI image generation prompts
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visual_style_prompt TEXT DEFAULT '';
