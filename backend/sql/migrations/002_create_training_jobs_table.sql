-- Migration: Create training_jobs table for Flux LoRA training
-- Created: 2025-01-14

-- Create training_jobs table
CREATE TABLE IF NOT EXISTS public.training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Job metadata
    job_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'training', 'completed', 'failed', 'cancelled')),
    progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),

    -- Training configuration
    instance_prompt TEXT NOT NULL,
    class_prompt TEXT NOT NULL,
    num_epochs INTEGER NOT NULL DEFAULT 20,
    learning_rate FLOAT NOT NULL DEFAULT 0.0001,
    network_rank INTEGER NOT NULL DEFAULT 16,
    network_alpha INTEGER NOT NULL DEFAULT 8,
    repeats INTEGER NOT NULL DEFAULT 5,

    -- Advanced settings (JSON for flexibility)
    config_params JSONB DEFAULT '{}',

    -- Training data
    num_images INTEGER DEFAULT 0,
    dataset_folder TEXT,

    -- Results
    output_lora_path TEXT,
    output_lora_url TEXT,
    model_size_mb FLOAT,

    -- Training metrics
    current_step INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    current_epoch INTEGER DEFAULT 0,
    loss FLOAT,

    -- Error handling
    error_message TEXT,
    error_details JSONB,

    -- Logs
    training_log TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_training_jobs_user_id ON public.training_jobs(user_id);
CREATE INDEX idx_training_jobs_status ON public.training_jobs(status);
CREATE INDEX idx_training_jobs_created_at ON public.training_jobs(created_at DESC);
CREATE INDEX idx_training_jobs_user_status ON public.training_jobs(user_id, status);

-- Enable Row Level Security
ALTER TABLE public.training_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own training jobs
CREATE POLICY "Users can view own training jobs"
    ON public.training_jobs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own training jobs
CREATE POLICY "Users can create own training jobs"
    ON public.training_jobs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own training jobs
CREATE POLICY "Users can update own training jobs"
    ON public.training_jobs
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own training jobs
CREATE POLICY "Users can delete own training jobs"
    ON public.training_jobs
    FOR DELETE
    USING (auth.uid() = user_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_training_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_training_jobs_updated_at
    BEFORE UPDATE ON public.training_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_training_jobs_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.training_jobs IS 'Stores Flux LoRA training job information and progress';
COMMENT ON COLUMN public.training_jobs.instance_prompt IS 'Subject/character identifier (e.g., "Jenn")';
COMMENT ON COLUMN public.training_jobs.class_prompt IS 'General class (e.g., "woman")';
COMMENT ON COLUMN public.training_jobs.network_rank IS 'LoRA network rank (higher = more detailed but larger file)';
COMMENT ON COLUMN public.training_jobs.network_alpha IS 'Network alpha (typically half of network_rank)';
COMMENT ON COLUMN public.training_jobs.repeats IS 'Number of times to repeat each image during training';
