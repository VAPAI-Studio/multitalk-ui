-- Migration: Add composite indexes for optimized feed queries
-- Purpose: Speed up common query patterns that filter by user/workflow + order by created_at
-- Date: 2025-01-21
-- Note: Using regular CREATE INDEX (not CONCURRENTLY) for Supabase compatibility

-- =============================================================================
-- COMPOSITE INDEXES
-- These indexes optimize queries that filter AND sort (most common pattern)
-- =============================================================================

-- Video jobs: user_id + created_at (for "my jobs" queries)
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_created
  ON video_jobs(user_id, created_at DESC);

-- Video jobs: workflow_name + created_at (for workflow-filtered feeds)
CREATE INDEX IF NOT EXISTS idx_video_jobs_workflow_created
  ON video_jobs(workflow_name, created_at DESC);

-- Video jobs: status + created_at (for completed/processing filters)
CREATE INDEX IF NOT EXISTS idx_video_jobs_status_created
  ON video_jobs(status, created_at DESC);

-- Image jobs: user_id + created_at
CREATE INDEX IF NOT EXISTS idx_image_jobs_user_created
  ON image_jobs(user_id, created_at DESC);

-- Image jobs: workflow_name + created_at
CREATE INDEX IF NOT EXISTS idx_image_jobs_workflow_created
  ON image_jobs(workflow_name, created_at DESC);

-- Image jobs: status + created_at
CREATE INDEX IF NOT EXISTS idx_image_jobs_status_created
  ON image_jobs(status, created_at DESC);

-- =============================================================================
-- PARTIAL INDEXES
-- These indexes only include rows matching a condition (smaller, faster)
-- =============================================================================

-- Video jobs: active jobs only (pending/processing) - frequently queried in feeds
CREATE INDEX IF NOT EXISTS idx_video_jobs_active
  ON video_jobs(created_at DESC)
  WHERE status IN ('pending', 'processing');

-- Image jobs: active jobs only
CREATE INDEX IF NOT EXISTS idx_image_jobs_active
  ON image_jobs(created_at DESC)
  WHERE status IN ('pending', 'processing');

-- Video jobs: completed jobs only (for gallery/history views)
CREATE INDEX IF NOT EXISTS idx_video_jobs_completed
  ON video_jobs(created_at DESC)
  WHERE status = 'completed';

-- Image jobs: completed jobs only
CREATE INDEX IF NOT EXISTS idx_image_jobs_completed
  ON image_jobs(created_at DESC)
  WHERE status = 'completed';
