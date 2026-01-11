-- Migration: Add thumbnail_url column to video_jobs table
-- Purpose: Store pre-generated video thumbnails for faster feed loading
-- Date: 2025-01-11

-- Add thumbnail_url column to video_jobs table
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Optional: Add index for queries that filter by thumbnail presence
-- CREATE INDEX IF NOT EXISTS idx_video_jobs_thumbnail_url ON video_jobs(thumbnail_url) WHERE thumbnail_url IS NOT NULL;

-- Comment on the column for documentation
COMMENT ON COLUMN video_jobs.thumbnail_url IS 'URL to a pre-generated thumbnail image (first frame) of the video';
