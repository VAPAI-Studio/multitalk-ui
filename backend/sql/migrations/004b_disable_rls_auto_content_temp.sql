-- Migration 004b: Temporarily disable RLS for Auto Content tables (Phase 1)
-- Created: 2026-02-12
-- Description: Disables RLS for auto_content tables during Phase 1 development
--              Will be re-enabled with proper backend authentication in later phase

-- Disable Row Level Security temporarily for Phase 1
ALTER TABLE public.batch_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_job_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_folders DISABLE ROW LEVEL SECURITY;

-- Drop existing policies (we'll recreate them when re-enabling RLS)
DROP POLICY IF EXISTS "Users can view their own batch jobs" ON public.batch_jobs;
DROP POLICY IF EXISTS "Users can insert their own batch jobs" ON public.batch_jobs;
DROP POLICY IF EXISTS "Users can update their own batch jobs" ON public.batch_jobs;
DROP POLICY IF EXISTS "Users can delete their own batch jobs" ON public.batch_jobs;

DROP POLICY IF EXISTS "Users can view items from their batch jobs" ON public.batch_job_items;
DROP POLICY IF EXISTS "Users can insert items to their batch jobs" ON public.batch_job_items;
DROP POLICY IF EXISTS "Users can update items from their batch jobs" ON public.batch_job_items;
DROP POLICY IF EXISTS "Users can delete items from their batch jobs" ON public.batch_job_items;

DROP POLICY IF EXISTS "Users can view their own project folders" ON public.project_folders;
DROP POLICY IF EXISTS "Users can insert their own project folders" ON public.project_folders;
DROP POLICY IF EXISTS "Users can update their own project folders" ON public.project_folders;
DROP POLICY IF EXISTS "Users can delete their own project folders" ON public.project_folders;

COMMENT ON TABLE public.batch_jobs IS 'Batch jobs for Auto Content feature - RLS DISABLED for Phase 1 development';
COMMENT ON TABLE public.batch_job_items IS 'Batch job items - RLS DISABLED for Phase 1 development';
COMMENT ON TABLE public.project_folders IS 'Project folder cache - RLS DISABLED for Phase 1 development';
