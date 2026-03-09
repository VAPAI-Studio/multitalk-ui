-- Migration: Add RunPod Serverless Support
-- Date: 2026-03-03
-- Description: Add fields to support dual execution backends (ComfyUI and RunPod)

-- ============================================================================
-- STEP 1: Create execution_backend ENUM type
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'execution_backend') THEN
        CREATE TYPE execution_backend AS ENUM ('comfyui', 'runpod');
        RAISE NOTICE 'Created execution_backend ENUM type';
    ELSE
        RAISE NOTICE 'execution_backend ENUM type already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Add RunPod fields to video_jobs
-- ============================================================================

-- Add execution_backend column (defaults to comfyui for backward compatibility)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_jobs' AND column_name = 'execution_backend'
    ) THEN
        ALTER TABLE video_jobs
            ADD COLUMN execution_backend execution_backend NOT NULL DEFAULT 'comfyui';
        RAISE NOTICE 'Added execution_backend column to video_jobs';
    ELSE
        RAISE NOTICE 'execution_backend column already exists in video_jobs';
    END IF;
END $$;

-- Add runpod_job_id column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_jobs' AND column_name = 'runpod_job_id'
    ) THEN
        ALTER TABLE video_jobs
            ADD COLUMN runpod_job_id TEXT;
        RAISE NOTICE 'Added runpod_job_id column to video_jobs';
    ELSE
        RAISE NOTICE 'runpod_job_id column already exists in video_jobs';
    END IF;
END $$;

-- Add runpod_endpoint_id column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_jobs' AND column_name = 'runpod_endpoint_id'
    ) THEN
        ALTER TABLE video_jobs
            ADD COLUMN runpod_endpoint_id TEXT;
        RAISE NOTICE 'Added runpod_endpoint_id column to video_jobs';
    ELSE
        RAISE NOTICE 'runpod_endpoint_id column already exists in video_jobs';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Add RunPod fields to image_jobs
-- ============================================================================

-- Add execution_backend column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'image_jobs' AND column_name = 'execution_backend'
    ) THEN
        ALTER TABLE image_jobs
            ADD COLUMN execution_backend execution_backend NOT NULL DEFAULT 'comfyui';
        RAISE NOTICE 'Added execution_backend column to image_jobs';
    ELSE
        RAISE NOTICE 'execution_backend column already exists in image_jobs';
    END IF;
END $$;

-- Add runpod_job_id column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'image_jobs' AND column_name = 'runpod_job_id'
    ) THEN
        ALTER TABLE image_jobs
            ADD COLUMN runpod_job_id TEXT;
        RAISE NOTICE 'Added runpod_job_id column to image_jobs';
    ELSE
        RAISE NOTICE 'runpod_job_id column already exists in image_jobs';
    END IF;
END $$;

-- Add runpod_endpoint_id column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'image_jobs' AND column_name = 'runpod_endpoint_id'
    ) THEN
        ALTER TABLE image_jobs
            ADD COLUMN runpod_endpoint_id TEXT;
        RAISE NOTICE 'Added runpod_endpoint_id column to image_jobs';
    ELSE
        RAISE NOTICE 'runpod_endpoint_id column already exists in image_jobs';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create indexes for RunPod job lookups
-- ============================================================================

-- Index for video_jobs runpod_job_id lookups (partial index, only for RunPod jobs)
CREATE INDEX IF NOT EXISTS idx_video_jobs_runpod_job_id
    ON video_jobs(runpod_job_id)
    WHERE runpod_job_id IS NOT NULL;

-- Index for image_jobs runpod_job_id lookups
CREATE INDEX IF NOT EXISTS idx_image_jobs_runpod_job_id
    ON image_jobs(runpod_job_id)
    WHERE runpod_job_id IS NOT NULL;

-- Index for execution_backend filtering (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_video_jobs_execution_backend
    ON video_jobs(execution_backend);

CREATE INDEX IF NOT EXISTS idx_image_jobs_execution_backend
    ON image_jobs(execution_backend);

-- Composite index for user-specific backend queries
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_backend_created
    ON video_jobs(user_id, execution_backend, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_jobs_user_backend_created
    ON image_jobs(user_id, execution_backend, created_at DESC);

-- ============================================================================
-- STEP 5: Add column comments
-- ============================================================================

COMMENT ON COLUMN video_jobs.execution_backend IS 'Which backend was used to execute this job: comfyui (local/self-hosted) or runpod (serverless cloud)';
COMMENT ON COLUMN video_jobs.runpod_job_id IS 'RunPod job ID if execution_backend is runpod (null for ComfyUI jobs)';
COMMENT ON COLUMN video_jobs.runpod_endpoint_id IS 'RunPod endpoint ID used for this job (null for ComfyUI jobs)';

COMMENT ON COLUMN image_jobs.execution_backend IS 'Which backend was used to execute this job: comfyui (local/self-hosted) or runpod (serverless cloud)';
COMMENT ON COLUMN image_jobs.runpod_job_id IS 'RunPod job ID if execution_backend is runpod (null for ComfyUI jobs)';
COMMENT ON COLUMN image_jobs.runpod_endpoint_id IS 'RunPod endpoint ID used for this job (null for ComfyUI jobs)';

-- ============================================================================
-- STEP 6: Verify migration
-- ============================================================================

DO $$
DECLARE
    video_jobs_backend_exists BOOLEAN;
    image_jobs_backend_exists BOOLEAN;
BEGIN
    -- Check video_jobs columns
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_jobs'
        AND column_name = 'execution_backend'
    ) INTO video_jobs_backend_exists;

    -- Check image_jobs columns
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'image_jobs'
        AND column_name = 'execution_backend'
    ) INTO image_jobs_backend_exists;

    IF video_jobs_backend_exists AND image_jobs_backend_exists THEN
        RAISE NOTICE '✅ Migration 004_add_runpod_support completed successfully!';
        RAISE NOTICE 'video_jobs and image_jobs now support dual execution backends';
    ELSE
        RAISE WARNING '❌ Migration may have failed - please check column creation';
    END IF;
END $$;
