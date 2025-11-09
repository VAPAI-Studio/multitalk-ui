-- Migration: Create output-type-based job tables
-- This replaces the feature-specific tables with output-type tables
-- Date: 2025-01-09
-- Description: Implements Option C - One table per output type (video, image, text)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- VIDEO JOBS TABLE
-- For workflows that produce video outputs
-- Features: lipsync-one, lipsync-multi, video-lipsync, wan-i2v
-- ============================================================================

CREATE TABLE IF NOT EXISTS video_jobs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workflow identification
  workflow_name TEXT NOT NULL,  -- 'lipsync-one', 'lipsync-multi', 'video-lipsync', 'wan-i2v'

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_seconds INTEGER,

  -- Common video inputs
  input_image_urls TEXT[],      -- Array of input image URLs
  input_audio_urls TEXT[],      -- Array of input audio URLs
  input_video_urls TEXT[],      -- Array of input video URLs

  -- Common video outputs
  output_video_urls TEXT[],     -- Array of output video URLs (usually just one)
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  duration_seconds FLOAT,

  -- Feature-specific parameters (flexible JSONB for unique workflow params)
  parameters JSONB DEFAULT '{}',
  -- Examples:
  -- lipsync: {"trim_to_audio": true, "mask_info": [...]}
  -- wan-i2v: {"motion_strength": 0.8, "prompt": "..."}

  -- ComfyUI integration
  comfy_job_id TEXT UNIQUE,     -- ComfyUI prompt ID
  comfy_url TEXT NOT NULL,
  comfyui_output_filename TEXT,
  comfyui_output_subfolder TEXT,
  comfyui_output_type TEXT DEFAULT 'output',

  -- Error handling
  error_message TEXT,

  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for video_jobs
CREATE INDEX idx_video_jobs_user_id ON video_jobs(user_id);
CREATE INDEX idx_video_jobs_workflow_name ON video_jobs(workflow_name);
CREATE INDEX idx_video_jobs_status ON video_jobs(status);
CREATE INDEX idx_video_jobs_created_at ON video_jobs(created_at DESC);
CREATE INDEX idx_video_jobs_comfy_job_id ON video_jobs(comfy_job_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_video_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_jobs_updated_at_trigger
  BEFORE UPDATE ON video_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_video_jobs_updated_at();

-- ============================================================================
-- IMAGE JOBS TABLE
-- For workflows that produce image outputs
-- Features: img2img, style-transfer, image-edit
-- ============================================================================

CREATE TABLE IF NOT EXISTS image_jobs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workflow identification
  workflow_name TEXT NOT NULL,  -- 'img2img', 'style-transfer', 'image-edit'

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_seconds INTEGER,

  -- Common image inputs
  input_image_urls TEXT[],      -- Array of input image URLs (source, style, etc.)
  prompt TEXT,                  -- Text prompt for generation/editing

  -- Common image outputs
  output_image_urls TEXT[],     -- Array of output image URLs (usually just one)
  width INTEGER,
  height INTEGER,

  -- Feature-specific parameters (flexible JSONB for unique workflow params)
  parameters JSONB DEFAULT '{}',
  -- Examples:
  -- img2img: {"strength": 0.8, "steps": 50}
  -- style-transfer: {"style_strength": 0.7}
  -- image-edit: {"mask_url": "...", "inpaint": true}

  -- ComfyUI integration
  comfy_job_id TEXT UNIQUE,     -- ComfyUI prompt ID
  comfy_url TEXT NOT NULL,
  comfyui_output_filename TEXT,
  comfyui_output_subfolder TEXT,
  comfyui_output_type TEXT DEFAULT 'output',

  -- Error handling
  error_message TEXT,

  -- Metadata
  model_used TEXT,              -- e.g., "Dreamshaper 8", "Flux", etc.
  user_ip TEXT,                 -- For anonymous tracking
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for image_jobs
CREATE INDEX idx_image_jobs_user_id ON image_jobs(user_id);
CREATE INDEX idx_image_jobs_workflow_name ON image_jobs(workflow_name);
CREATE INDEX idx_image_jobs_status ON image_jobs(status);
CREATE INDEX idx_image_jobs_created_at ON image_jobs(created_at DESC);
CREATE INDEX idx_image_jobs_comfy_job_id ON image_jobs(comfy_job_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_image_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER image_jobs_updated_at_trigger
  BEFORE UPDATE ON image_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_image_jobs_updated_at();

-- ============================================================================
-- TEXT JOBS TABLE
-- For workflows that produce text/data outputs
-- Features: character-caption, future text-generation workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS text_jobs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workflow identification
  workflow_name TEXT NOT NULL,  -- 'character-caption', future text workflows

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_seconds INTEGER,

  -- Common text inputs
  input_image_urls TEXT[],      -- Images for captioning/analysis
  input_text TEXT,              -- Text prompts or inputs

  -- Common text outputs
  output_text TEXT,             -- Generated text, captions, etc.
  output_data JSONB,            -- Structured data outputs (datasets, JSON, etc.)

  -- Feature-specific parameters
  parameters JSONB DEFAULT '{}',
  -- Examples:
  -- character-caption: {"caption_type": "training", "length": "detailed"}

  -- ComfyUI integration (if applicable)
  comfy_job_id TEXT UNIQUE,
  comfy_url TEXT,

  -- Error handling
  error_message TEXT,

  -- Metadata
  model_used TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for text_jobs
CREATE INDEX idx_text_jobs_user_id ON text_jobs(user_id);
CREATE INDEX idx_text_jobs_workflow_name ON text_jobs(workflow_name);
CREATE INDEX idx_text_jobs_status ON text_jobs(status);
CREATE INDEX idx_text_jobs_created_at ON text_jobs(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_text_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER text_jobs_updated_at_trigger
  BEFORE UPDATE ON text_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_text_jobs_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS so users can only see their own jobs
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_jobs ENABLE ROW LEVEL SECURITY;

-- Video Jobs RLS Policies
CREATE POLICY "Users can view their own video jobs"
  ON video_jobs FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own video jobs"
  ON video_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own video jobs"
  ON video_jobs FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete their own video jobs"
  ON video_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Image Jobs RLS Policies
CREATE POLICY "Users can view their own image jobs"
  ON image_jobs FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own image jobs"
  ON image_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own image jobs"
  ON image_jobs FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete their own image jobs"
  ON image_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Text Jobs RLS Policies
CREATE POLICY "Users can view their own text jobs"
  ON text_jobs FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own text jobs"
  ON text_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own text jobs"
  ON text_jobs FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete their own text jobs"
  ON text_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE video_jobs IS 'Stores jobs for video-generating workflows (lipsync, video-lipsync, wan-i2v)';
COMMENT ON TABLE image_jobs IS 'Stores jobs for image-generating workflows (img2img, style-transfer, image-edit)';
COMMENT ON TABLE text_jobs IS 'Stores jobs for text/data-generating workflows (character-caption)';

COMMENT ON COLUMN video_jobs.workflow_name IS 'Identifies which workflow generated this job (lipsync-one, lipsync-multi, etc.)';
COMMENT ON COLUMN image_jobs.workflow_name IS 'Identifies which workflow generated this job (img2img, style-transfer, etc.)';
COMMENT ON COLUMN text_jobs.workflow_name IS 'Identifies which workflow generated this job (character-caption, etc.)';

COMMENT ON COLUMN video_jobs.parameters IS 'JSONB field for workflow-specific parameters that don''t fit in common columns';
COMMENT ON COLUMN image_jobs.parameters IS 'JSONB field for workflow-specific parameters that don''t fit in common columns';
COMMENT ON COLUMN text_jobs.parameters IS 'JSONB field for workflow-specific parameters that don''t fit in common columns';
