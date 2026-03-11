-- Migration: Add Batch Video Upscale Support
-- Date: 2026-03-11
-- Description: Create upscale_batches and upscale_videos tables with indexes
--              for the Freepik video upscaler batch processing system.
--              Includes all columns for Phases 10-12 (future columns default to NULL).

-- ============================================================================
-- STEP 1: Create upscale_batches table
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'upscale_batches'
    ) THEN
        CREATE TABLE upscale_batches (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES auth.users(id),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused', 'cancelled')),

            -- Upscale settings (individual columns for queryability + DB defaults)
            resolution TEXT NOT NULL DEFAULT '2k',
            creativity INTEGER NOT NULL DEFAULT 0,
            sharpen INTEGER NOT NULL DEFAULT 0,
            grain INTEGER NOT NULL DEFAULT 0,
            fps_boost BOOLEAN NOT NULL DEFAULT false,
            flavor TEXT NOT NULL DEFAULT 'vivid',

            -- Google Drive output (Phase 12, column exists from start)
            project_id TEXT,

            -- Counts (denormalized for fast reads)
            total_videos INTEGER NOT NULL DEFAULT 0,
            completed_videos INTEGER NOT NULL DEFAULT 0,
            failed_videos INTEGER NOT NULL DEFAULT 0,

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,

            -- Processing health (Phase 11 uses, column exists from start)
            last_heartbeat TIMESTAMPTZ,

            -- Pause/resume (Phase 11 uses, column exists from start)
            paused_at TIMESTAMPTZ,
            pause_reason TEXT,

            -- Error
            error_message TEXT
        );
        RAISE NOTICE 'Created upscale_batches table';
    ELSE
        RAISE NOTICE 'upscale_batches table already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create upscale_videos table
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'upscale_videos'
    ) THEN
        CREATE TABLE upscale_videos (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            batch_id UUID NOT NULL REFERENCES upscale_batches(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES auth.users(id),

            -- Status
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'paused')),
            queue_position INTEGER NOT NULL,

            -- Input
            input_filename TEXT NOT NULL,
            input_storage_url TEXT NOT NULL,
            input_file_size BIGINT,

            -- Freepik tracking
            freepik_task_id TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,

            -- Output (Phase 12 populates, columns exist from start)
            output_storage_url TEXT,
            output_drive_file_id TEXT,
            supabase_upload_status TEXT DEFAULT 'pending'
                CHECK (supabase_upload_status IN ('pending', 'completed', 'failed', 'skipped')),
            drive_upload_status TEXT DEFAULT 'pending'
                CHECK (drive_upload_status IN ('pending', 'completed', 'failed', 'skipped')),

            -- Metadata
            duration_seconds FLOAT,
            width INTEGER,
            height INTEGER,

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,

            -- Error
            error_message TEXT
        );
        RAISE NOTICE 'Created upscale_videos table';
    ELSE
        RAISE NOTICE 'upscale_videos table already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Create indexes
-- ============================================================================

-- User lookup with recent-first ordering
CREATE INDEX IF NOT EXISTS idx_upscale_batches_user
    ON upscale_batches(user_id, created_at DESC);

-- Batch status filtering
CREATE INDEX IF NOT EXISTS idx_upscale_batches_status
    ON upscale_batches(status);

-- Heartbeat monitoring for stale processing detection (partial index)
CREATE INDEX IF NOT EXISTS idx_upscale_batches_heartbeat
    ON upscale_batches(status, last_heartbeat)
    WHERE status = 'processing';

-- Video lookup by batch and queue position
CREATE INDEX IF NOT EXISTS idx_upscale_videos_batch
    ON upscale_videos(batch_id, queue_position);

-- Video status filtering within a batch
CREATE INDEX IF NOT EXISTS idx_upscale_videos_status
    ON upscale_videos(batch_id, status);

-- Freepik task ID lookup (partial index, only for videos with a task)
CREATE INDEX IF NOT EXISTS idx_upscale_videos_freepik
    ON upscale_videos(freepik_task_id)
    WHERE freepik_task_id IS NOT NULL;

-- ============================================================================
-- STEP 4: Add column comments
-- ============================================================================

COMMENT ON TABLE upscale_batches IS 'Groups multiple videos for a single batch upscale run via Freepik API';
COMMENT ON TABLE upscale_videos IS 'Individual video within an upscale batch, tracks Freepik task status and output delivery';

COMMENT ON COLUMN upscale_batches.status IS 'Batch lifecycle: pending -> processing -> completed/failed/paused/cancelled';
COMMENT ON COLUMN upscale_batches.last_heartbeat IS 'Updated during processing to detect stale/crashed batches on server restart';
COMMENT ON COLUMN upscale_batches.pause_reason IS 'Why batch was paused (e.g., credit_exhaustion, user_request)';

COMMENT ON COLUMN upscale_videos.queue_position IS 'Processing order within batch (0-based)';
COMMENT ON COLUMN upscale_videos.freepik_task_id IS 'Freepik API task ID for polling status';
COMMENT ON COLUMN upscale_videos.retry_count IS 'Number of retry attempts for transient failures';
COMMENT ON COLUMN upscale_videos.supabase_upload_status IS 'Status of upload to Supabase Storage after upscale completes';
COMMENT ON COLUMN upscale_videos.drive_upload_status IS 'Status of upload to Google Drive after upscale completes';

-- ============================================================================
-- STEP 5: Verify migration
-- ============================================================================

DO $$
DECLARE
    batches_exists BOOLEAN;
    videos_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'upscale_batches'
    ) INTO batches_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'upscale_videos'
    ) INTO videos_exists;

    IF batches_exists AND videos_exists THEN
        RAISE NOTICE 'Migration 007_add_upscale_batches completed successfully!';
        RAISE NOTICE 'upscale_batches and upscale_videos tables ready for batch video upscaling';
    ELSE
        RAISE WARNING 'Migration may have failed - please check table creation';
    END IF;
END $$;
