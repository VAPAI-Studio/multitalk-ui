-- Migration: Add performance indexes for common query patterns
-- Purpose: Speed up filtered queries on job tables
-- Date: 2025-01-21

-- Video jobs indexes
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_id ON video_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_workflow_name ON video_jobs(workflow_name);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created_at ON video_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_comfy_job_id ON video_jobs(comfy_job_id);

-- Image jobs indexes
CREATE INDEX IF NOT EXISTS idx_image_jobs_user_id ON image_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_workflow_name ON image_jobs(workflow_name);
CREATE INDEX IF NOT EXISTS idx_image_jobs_created_at ON image_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_jobs_status ON image_jobs(status);
CREATE INDEX IF NOT EXISTS idx_image_jobs_comfy_job_id ON image_jobs(comfy_job_id);

-- Style transfers indexes
CREATE INDEX IF NOT EXISTS idx_style_transfers_status ON style_transfers(status);
CREATE INDEX IF NOT EXISTS idx_style_transfers_created_at ON style_transfers(created_at DESC);

-- Edited images indexes
CREATE INDEX IF NOT EXISTS idx_edited_images_status ON edited_images(status);
CREATE INDEX IF NOT EXISTS idx_edited_images_created_at ON edited_images(created_at DESC);

-- Data entries index for dataset lookups (fixes N+1 query)
CREATE INDEX IF NOT EXISTS idx_data_dataset_id ON data(dataset_id);

-- Datasets index for ordering
CREATE INDEX IF NOT EXISTS idx_datasets_updated_at ON datasets(updated_at DESC);
