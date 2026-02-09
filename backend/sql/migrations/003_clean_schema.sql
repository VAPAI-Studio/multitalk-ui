-- Migration: Clean Schema - Database Consolidation
-- Date: 2025-02-08
-- Description:
--   1. Create job_status ENUM
--   2. Create workflows reference table
--   3. Recreate video_jobs and image_jobs with clean schema
--   4. Drop legacy tables (multitalk_jobs, edited_images, style_transfers)
--   5. Add indexes and RLS policies

-- ============================================================================
-- STEP 1: Create job_status ENUM
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create workflows reference table
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflows (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    output_type TEXT NOT NULL CHECK (output_type IN ('video', 'image', 'text')),
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial workflows (only if table is empty)
INSERT INTO workflows (name, output_type, display_name, description)
SELECT * FROM (VALUES
    ('lipsync-one', 'video', 'Lipsync 1 Person', 'Generate talking videos from a single person image with custom audio'),
    ('lipsync-multi', 'video', 'Lipsync Multi Person', 'Create conversations between multiple people with synchronized audio'),
    ('video-lipsync', 'video', 'Video Lipsync', 'Add lip-sync to existing videos with new audio tracks'),
    ('wan-i2v', 'video', 'WAN I2V', 'Transform images into videos with AI-powered generation'),
    ('wan-move', 'video', 'WAN Move', 'Add motion to images using WAN model'),
    ('ltx-i2v', 'video', 'LTX I2V', 'Image to video using LTX model'),
    ('img2img', 'image', 'Img2Img', 'Transform images using AI'),
    ('style-transfer', 'image', 'Style Transfer', 'Transfer artistic styles between images'),
    ('image-edit', 'image', 'Image Edit', 'Edit images using AI with natural language instructions'),
    ('character-caption', 'text', 'Character Caption', 'Generate detailed captions for character images')
) AS v(name, output_type, display_name, description)
WHERE NOT EXISTS (SELECT 1 FROM workflows LIMIT 1);

-- ============================================================================
-- STEP 3: Drop legacy tables
-- ============================================================================

DROP TABLE IF EXISTS multitalk_jobs CASCADE;
DROP TABLE IF EXISTS edited_images CASCADE;
DROP TABLE IF EXISTS style_transfers CASCADE;

-- ============================================================================
-- STEP 4: Recreate video_jobs (clean schema)
-- ============================================================================

DROP TABLE IF EXISTS video_jobs CASCADE;

CREATE TABLE video_jobs (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id),

    -- Status
    status job_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Inputs
    input_image_urls TEXT[],
    input_audio_urls TEXT[],
    input_video_urls TEXT[],
    parameters JSONB DEFAULT '{}',

    -- Outputs
    output_video_urls TEXT[],
    thumbnail_url TEXT,
    width INTEGER,
    height INTEGER,
    fps INTEGER,
    duration_seconds FLOAT,

    -- ComfyUI Integration
    comfy_job_id TEXT UNIQUE,
    comfy_url TEXT NOT NULL,

    -- Google Drive Integration
    project_id UUID,

    -- Error Handling
    error_message TEXT
);

-- Video jobs indexes
CREATE INDEX idx_video_jobs_user_id ON video_jobs(user_id);
CREATE INDEX idx_video_jobs_workflow_id ON video_jobs(workflow_id);
CREATE INDEX idx_video_jobs_status ON video_jobs(status);
CREATE INDEX idx_video_jobs_created_at ON video_jobs(created_at DESC);
CREATE INDEX idx_video_jobs_comfy_job_id ON video_jobs(comfy_job_id);

-- Composite index for common feed queries
CREATE INDEX idx_video_jobs_user_status_created ON video_jobs(user_id, status, created_at DESC);

-- ============================================================================
-- STEP 5: Recreate image_jobs (clean schema)
-- ============================================================================

DROP TABLE IF EXISTS image_jobs CASCADE;

CREATE TABLE image_jobs (
    -- Identity
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id),

    -- Status
    status job_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Inputs
    input_image_urls TEXT[],
    prompt TEXT,
    parameters JSONB DEFAULT '{}',

    -- Outputs
    output_image_urls TEXT[],
    width INTEGER,
    height INTEGER,

    -- ComfyUI Integration
    comfy_job_id TEXT UNIQUE,
    comfy_url TEXT NOT NULL,

    -- Google Drive Integration
    project_id UUID,

    -- Error Handling
    error_message TEXT
);

-- Image jobs indexes
CREATE INDEX idx_image_jobs_user_id ON image_jobs(user_id);
CREATE INDEX idx_image_jobs_workflow_id ON image_jobs(workflow_id);
CREATE INDEX idx_image_jobs_status ON image_jobs(status);
CREATE INDEX idx_image_jobs_created_at ON image_jobs(created_at DESC);
CREATE INDEX idx_image_jobs_comfy_job_id ON image_jobs(comfy_job_id);

-- Composite index for common feed queries
CREATE INDEX idx_image_jobs_user_status_created ON image_jobs(user_id, status, created_at DESC);

-- ============================================================================
-- STEP 6: Update text_jobs to use new schema (if exists)
-- ============================================================================

-- Add workflow_id to text_jobs if it doesn't have it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'text_jobs') THEN
        -- Add workflow_id column if not exists
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'text_jobs' AND column_name = 'workflow_id') THEN
            ALTER TABLE text_jobs ADD COLUMN workflow_id INTEGER REFERENCES workflows(id);
        END IF;

        -- Make user_id required if it's nullable
        ALTER TABLE text_jobs ALTER COLUMN user_id SET NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- STEP 7: Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on job tables
ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own video jobs" ON video_jobs;
DROP POLICY IF EXISTS "Users can insert their own video jobs" ON video_jobs;
DROP POLICY IF EXISTS "Users can update their own video jobs" ON video_jobs;
DROP POLICY IF EXISTS "Users can delete their own video jobs" ON video_jobs;
DROP POLICY IF EXISTS "Users can CRUD their own video jobs" ON video_jobs;

DROP POLICY IF EXISTS "Users can view their own image jobs" ON image_jobs;
DROP POLICY IF EXISTS "Users can insert their own image jobs" ON image_jobs;
DROP POLICY IF EXISTS "Users can update their own image jobs" ON image_jobs;
DROP POLICY IF EXISTS "Users can delete their own image jobs" ON image_jobs;
DROP POLICY IF EXISTS "Users can CRUD their own image jobs" ON image_jobs;

-- Video jobs RLS policies
CREATE POLICY "video_jobs_select" ON video_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "video_jobs_insert" ON video_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "video_jobs_update" ON video_jobs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "video_jobs_delete" ON video_jobs
    FOR DELETE USING (auth.uid() = user_id);

-- Image jobs RLS policies
CREATE POLICY "image_jobs_select" ON image_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "image_jobs_insert" ON image_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "image_jobs_update" ON image_jobs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "image_jobs_delete" ON image_jobs
    FOR DELETE USING (auth.uid() = user_id);

-- Workflows table is public read-only
CREATE POLICY "workflows_select" ON workflows
    FOR SELECT USING (true);

-- ============================================================================
-- STEP 8: Comments / Documentation
-- ============================================================================

COMMENT ON TABLE workflows IS 'Reference table for all available workflow types';
COMMENT ON TABLE video_jobs IS 'Jobs that produce video outputs (lipsync, i2v, etc.)';
COMMENT ON TABLE image_jobs IS 'Jobs that produce image outputs (img2img, style-transfer, etc.)';

COMMENT ON COLUMN video_jobs.workflow_id IS 'Foreign key to workflows table';
COMMENT ON COLUMN video_jobs.parameters IS 'JSONB for workflow-specific parameters (trim_to_audio, motion_strength, etc.)';
COMMENT ON COLUMN video_jobs.project_id IS 'Google Drive folder ID for saving outputs';

COMMENT ON COLUMN image_jobs.workflow_id IS 'Foreign key to workflows table';
COMMENT ON COLUMN image_jobs.parameters IS 'JSONB for workflow-specific parameters (style_strength, seed, etc.)';
COMMENT ON COLUMN image_jobs.project_id IS 'Google Drive folder ID for saving outputs';

COMMENT ON TYPE job_status IS 'Enum for job status: pending, processing, completed, failed, cancelled';
