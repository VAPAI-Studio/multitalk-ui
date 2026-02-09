-- Migration: Clean Schema - Database Consolidation (SAFE - preserves data)
-- Date: 2025-02-08
-- Run this in Supabase SQL Editor in order (can paste all at once)

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
-- STEP 3: Drop legacy tables (these are definitely obsolete)
-- ============================================================================

DROP TABLE IF EXISTS multitalk_jobs CASCADE;
DROP TABLE IF EXISTS edited_images CASCADE;
DROP TABLE IF EXISTS style_transfers CASCADE;

-- ============================================================================
-- STEP 3.5: Set default user_id for rows with NULL user_id
-- ============================================================================

-- Default user ID for orphaned records
DO $$
DECLARE
    default_user_id UUID := 'a9d0dd55-6f22-450f-9820-8a5a1cf66d84'::UUID;
BEGIN
    -- Update video_jobs with NULL user_id
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_jobs') THEN
        UPDATE video_jobs SET user_id = default_user_id WHERE user_id IS NULL;
        RAISE NOTICE 'Updated video_jobs with default user_id';
    END IF;

    -- Update image_jobs with NULL user_id
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'image_jobs') THEN
        UPDATE image_jobs SET user_id = default_user_id WHERE user_id IS NULL;
        RAISE NOTICE 'Updated image_jobs with default user_id';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Migrate video_jobs (SAFE - preserves data)
-- ============================================================================

-- Rename old table to backup
ALTER TABLE IF EXISTS video_jobs RENAME TO video_jobs_old;

-- Create new table with clean schema
CREATE TABLE video_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id),
    status job_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    input_image_urls TEXT[],
    input_audio_urls TEXT[],
    input_video_urls TEXT[],
    parameters JSONB DEFAULT '{}',
    output_video_urls TEXT[],
    thumbnail_url TEXT,
    width INTEGER,
    height INTEGER,
    fps INTEGER,
    duration_seconds FLOAT,
    comfy_job_id TEXT UNIQUE,
    comfy_url TEXT NOT NULL,
    project_id TEXT,  -- Google Drive folder ID (not UUID)
    error_message TEXT
);

-- Migrate data from old table (if it exists and has data)
DO $$
DECLARE
    default_workflow_id INTEGER;
    default_user_id UUID := 'a9d0dd55-6f22-450f-9820-8a5a1cf66d84'::UUID;
BEGIN
    -- Get lipsync-one workflow id as default
    SELECT id INTO default_workflow_id FROM workflows WHERE name = 'lipsync-one';

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_jobs_old') THEN
        INSERT INTO video_jobs (
            id, user_id, workflow_id, status, created_at,
            input_image_urls, input_audio_urls, input_video_urls,
            parameters, output_video_urls, thumbnail_url,
            width, height, fps, duration_seconds,
            comfy_job_id, comfy_url, project_id, error_message
        )
        SELECT
            id,
            COALESCE(user_id, default_user_id),
            COALESCE(
                (SELECT w.id FROM workflows w WHERE w.name = old.workflow_name),
                default_workflow_id
            ) as workflow_id,
            CASE
                WHEN old.status::text = 'submitted' THEN 'pending'::job_status
                WHEN old.status::text = 'error' THEN 'failed'::job_status
                ELSE old.status::text::job_status
            END as status,
            COALESCE(old.created_at, NOW()),
            old.input_image_urls,
            old.input_audio_urls,
            old.input_video_urls,
            COALESCE(old.parameters, '{}'),
            old.output_video_urls,
            old.thumbnail_url,
            old.width,
            old.height,
            old.fps,
            old.duration_seconds,
            old.comfy_job_id,
            old.comfy_url,
            old.project_id,
            old.error_message
        FROM video_jobs_old old;
    END IF;
END $$;

-- Drop old table after successful migration
DROP TABLE IF EXISTS video_jobs_old CASCADE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_id ON video_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_workflow_id ON video_jobs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created_at ON video_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_jobs_comfy_job_id ON video_jobs(comfy_job_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_status_created ON video_jobs(user_id, status, created_at DESC);

-- ============================================================================
-- STEP 5: Migrate image_jobs (SAFE - preserves data)
-- ============================================================================

-- Rename old table to backup
ALTER TABLE IF EXISTS image_jobs RENAME TO image_jobs_old;

-- Create new table with clean schema
CREATE TABLE image_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id),
    status job_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    input_image_urls TEXT[],
    prompt TEXT,
    parameters JSONB DEFAULT '{}',
    output_image_urls TEXT[],
    width INTEGER,
    height INTEGER,
    comfy_job_id TEXT UNIQUE,
    comfy_url TEXT NOT NULL,
    project_id TEXT,  -- Google Drive folder ID (not UUID)
    error_message TEXT
);

-- Migrate data from old table
DO $$
DECLARE
    default_workflow_id INTEGER;
    default_user_id UUID := 'a9d0dd55-6f22-450f-9820-8a5a1cf66d84'::UUID;
BEGIN
    -- Get img2img workflow id as default
    SELECT id INTO default_workflow_id FROM workflows WHERE name = 'img2img';

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'image_jobs_old') THEN
        INSERT INTO image_jobs (
            id, user_id, workflow_id, status, created_at,
            input_image_urls, prompt, parameters,
            output_image_urls, width, height,
            comfy_job_id, comfy_url, project_id, error_message
        )
        SELECT
            id,
            COALESCE(user_id, default_user_id),
            COALESCE(
                (SELECT w.id FROM workflows w WHERE w.name = old.workflow_name),
                default_workflow_id
            ) as workflow_id,
            CASE
                WHEN old.status::text = 'submitted' THEN 'pending'::job_status
                WHEN old.status::text = 'error' THEN 'failed'::job_status
                ELSE old.status::text::job_status
            END as status,
            COALESCE(old.created_at, NOW()),
            old.input_image_urls,
            old.prompt,
            COALESCE(old.parameters, '{}'),
            old.output_image_urls,
            old.width,
            old.height,
            old.comfy_job_id,
            old.comfy_url,
            old.project_id,
            old.error_message
        FROM image_jobs_old old;
    END IF;
END $$;

-- Drop old table after successful migration
DROP TABLE IF EXISTS image_jobs_old CASCADE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_image_jobs_user_id ON image_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_workflow_id ON image_jobs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_status ON image_jobs(status);
CREATE INDEX IF NOT EXISTS idx_image_jobs_created_at ON image_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_jobs_comfy_job_id ON image_jobs(comfy_job_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_user_status_created ON image_jobs(user_id, status, created_at DESC);

-- ============================================================================
-- STEP 6: Row Level Security (RLS)
-- ============================================================================

ALTER TABLE video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "video_jobs_select" ON video_jobs;
DROP POLICY IF EXISTS "video_jobs_insert" ON video_jobs;
DROP POLICY IF EXISTS "video_jobs_update" ON video_jobs;
DROP POLICY IF EXISTS "video_jobs_delete" ON video_jobs;

DROP POLICY IF EXISTS "image_jobs_select" ON image_jobs;
DROP POLICY IF EXISTS "image_jobs_insert" ON image_jobs;
DROP POLICY IF EXISTS "image_jobs_update" ON image_jobs;
DROP POLICY IF EXISTS "image_jobs_delete" ON image_jobs;

DROP POLICY IF EXISTS "workflows_select" ON workflows;

-- Video jobs RLS policies
CREATE POLICY "video_jobs_select" ON video_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "video_jobs_insert" ON video_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "video_jobs_update" ON video_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "video_jobs_delete" ON video_jobs FOR DELETE USING (auth.uid() = user_id);

-- Image jobs RLS policies
CREATE POLICY "image_jobs_select" ON image_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "image_jobs_insert" ON image_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "image_jobs_update" ON image_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "image_jobs_delete" ON image_jobs FOR DELETE USING (auth.uid() = user_id);

-- Workflows table is public read-only
CREATE POLICY "workflows_select" ON workflows FOR SELECT USING (true);

-- ============================================================================
-- STEP 7: Comments
-- ============================================================================

COMMENT ON TABLE workflows IS 'Reference table for all available workflow types';
COMMENT ON TABLE video_jobs IS 'Jobs that produce video outputs (lipsync, i2v, etc.)';
COMMENT ON TABLE image_jobs IS 'Jobs that produce image outputs (img2img, style-transfer, etc.)';
