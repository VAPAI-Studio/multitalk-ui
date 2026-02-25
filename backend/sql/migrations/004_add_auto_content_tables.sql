-- Migration 004: Add Auto Content tables
-- Created: 2026-02-12
-- Description: Adds tables for Auto Content batch job system

-- Main batch job container
CREATE TABLE IF NOT EXISTS public.batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Google Drive integration
    project_folder_id TEXT NOT NULL,
    project_name TEXT NOT NULL,

    -- Status tracking
    status TEXT NOT NULL CHECK (status IN ('pending', 'validating', 'analyzing', 'generating_master', 'completed', 'failed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Progress tracking
    total_master_frames INT NOT NULL DEFAULT 0,
    completed_master_frames INT NOT NULL DEFAULT 0,
    total_jobs INT NOT NULL DEFAULT 0,
    completed_jobs INT NOT NULL DEFAULT 0,
    failed_jobs INT NOT NULL DEFAULT 0,

    -- Script analysis (stored for reference, not used for generation in MVP)
    script_filename TEXT,
    outline_json JSONB,
    outline_last_updated TIMESTAMPTZ,

    -- Configuration
    master_frame_variations INT NOT NULL DEFAULT 3,

    -- Error handling
    error_message TEXT,
    comfy_url TEXT NOT NULL
);

-- Individual image generation jobs within a batch
CREATE TABLE IF NOT EXISTS public.batch_job_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_job_id UUID NOT NULL REFERENCES public.batch_jobs(id) ON DELETE CASCADE,

    -- Type (MVP: only 'master_frame', future: 'scene_image')
    item_type TEXT NOT NULL CHECK (item_type IN ('master_frame', 'scene_image')),

    -- Source references
    source_index INT NOT NULL,  -- Master frame number or scene number
    variation_number INT NOT NULL,  -- Which variation (1-3 for masters, 1-2 for scenes)

    -- Image job reference
    image_job_id UUID REFERENCES public.image_jobs(id) ON DELETE SET NULL,

    -- Status
    status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Output tracking (10 URLs: 1 grid + 9 crops)
    output_urls TEXT[],
    drive_file_ids TEXT[],

    -- User actions
    starred BOOLEAN NOT NULL DEFAULT FALSE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,

    error_message TEXT
);

-- Cache Drive folder structure to reduce API calls
CREATE TABLE IF NOT EXISTS public.project_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_folder_id TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    project_name TEXT NOT NULL,

    -- Subfolders (cached Drive IDs)
    general_assets_folder_id TEXT,
    script_folder_id TEXT,
    master_frames_folder_id TEXT,
    characters_folder_id TEXT,
    props_folder_id TEXT,
    settings_folder_id TEXT,
    txtai_folder_id TEXT,
    imagesai_folder_id TEXT,
    imagesai_starred_folder_id TEXT,

    -- Validation
    structure_valid BOOLEAN NOT NULL DEFAULT FALSE,
    last_validated_at TIMESTAMPTZ,
    validation_error TEXT,

    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_batch_jobs_user_id ON public.batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON public.batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_at ON public.batch_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_batch_job_items_batch_job ON public.batch_job_items(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_batch_job_items_status ON public.batch_job_items(status);
CREATE INDEX IF NOT EXISTS idx_batch_job_items_type ON public.batch_job_items(item_type);
CREATE INDEX IF NOT EXISTS idx_batch_job_items_starred ON public.batch_job_items(starred) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS idx_batch_job_items_composite ON public.batch_job_items(batch_job_id, status, item_type) WHERE NOT deleted;

CREATE INDEX IF NOT EXISTS idx_project_folders_user_id ON public.project_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_project_folders_project_id ON public.project_folders(project_folder_id);

-- Link existing image_jobs to batch system
ALTER TABLE public.image_jobs ADD COLUMN IF NOT EXISTS batch_job_id UUID REFERENCES public.batch_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.image_jobs ADD COLUMN IF NOT EXISTS batch_item_id UUID REFERENCES public.batch_job_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_image_jobs_batch_job ON public.image_jobs(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_image_jobs_batch_item ON public.image_jobs(batch_item_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_folders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for batch_jobs
CREATE POLICY "Users can view their own batch jobs"
    ON public.batch_jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own batch jobs"
    ON public.batch_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own batch jobs"
    ON public.batch_jobs FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own batch jobs"
    ON public.batch_jobs FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for batch_job_items
CREATE POLICY "Users can view items from their batch jobs"
    ON public.batch_job_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.batch_jobs
            WHERE batch_jobs.id = batch_job_items.batch_job_id
            AND batch_jobs.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert items to their batch jobs"
    ON public.batch_job_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.batch_jobs
            WHERE batch_jobs.id = batch_job_items.batch_job_id
            AND batch_jobs.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update items from their batch jobs"
    ON public.batch_job_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.batch_jobs
            WHERE batch_jobs.id = batch_job_items.batch_job_id
            AND batch_jobs.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete items from their batch jobs"
    ON public.batch_job_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.batch_jobs
            WHERE batch_jobs.id = batch_job_items.batch_job_id
            AND batch_jobs.user_id = auth.uid()
        )
    );

-- RLS Policies for project_folders
CREATE POLICY "Users can view their own project folders"
    ON public.project_folders FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own project folders"
    ON public.project_folders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own project folders"
    ON public.project_folders FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own project folders"
    ON public.project_folders FOR DELETE
    USING (auth.uid() = user_id);

-- Add helpful comments
COMMENT ON TABLE public.batch_jobs IS 'Batch jobs for Auto Content feature - orchestrates multiple image generations from master frames';
COMMENT ON TABLE public.batch_job_items IS 'Individual image generation items within a batch job - links to image_jobs table';
COMMENT ON TABLE public.project_folders IS 'Cached Google Drive folder structure to reduce API calls and improve performance';

COMMENT ON COLUMN public.batch_jobs.status IS 'Current status: pending (created), validating (checking folders), analyzing (parsing script), generating_master (creating images), completed, failed, cancelled';
COMMENT ON COLUMN public.batch_job_items.item_type IS 'Type of generation: master_frame (from Master_Frames folder) or scene_image (from outline - future)';
COMMENT ON COLUMN public.batch_job_items.output_urls IS 'Array of 10 Supabase Storage URLs: [0]=grid, [1-9]=individual crops';
COMMENT ON COLUMN public.batch_job_items.drive_file_ids IS 'Array of 10 Google Drive file IDs corresponding to output_urls';
