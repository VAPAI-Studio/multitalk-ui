-- Migration: Add 3D Assets Support for Virtual Set
-- Date: 2026-03-31
-- Description: Adds storage bucket for 3D GLB files and table for tracking generated assets

-- =====================================================
-- 1. CREATE STORAGE BUCKET FOR 3D ASSETS
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    '3d-assets',
    '3d-assets',
    true,
    104857600,  -- 100MB limit for GLB files
    ARRAY['model/gltf-binary', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 2. CREATE STORAGE POLICIES FOR 3D ASSETS BUCKET
-- =====================================================

-- Allow anyone to view 3D assets (bucket is public)
CREATE POLICY IF NOT EXISTS "Public read access for 3d-assets"
ON storage.objects FOR SELECT
USING (bucket_id = '3d-assets');

-- Allow authenticated users to upload 3D assets
CREATE POLICY IF NOT EXISTS "Authenticated users can upload to 3d-assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = '3d-assets');

-- Allow users to update their own uploads
CREATE POLICY IF NOT EXISTS "Users can update their own 3d-assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = '3d-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own uploads
CREATE POLICY IF NOT EXISTS "Users can delete their own 3d-assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = '3d-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =====================================================
-- 3. CREATE TABLE FOR VIRTUAL SET ASSETS
-- =====================================================

CREATE TABLE IF NOT EXISTS virtual_set_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id TEXT,  -- ComfyUI job/prompt ID
    asset_name TEXT NOT NULL,
    glb_url TEXT NOT NULL,  -- Public URL to GLB file in Supabase Storage
    thumbnail_url TEXT,  -- URL to the front image used for generation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_virtual_set_assets_user_id ON virtual_set_assets(user_id);

-- Create index for faster lookups by job_id
CREATE INDEX IF NOT EXISTS idx_virtual_set_assets_job_id ON virtual_set_assets(job_id);

-- =====================================================
-- 4. ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE virtual_set_assets ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 5. CREATE RLS POLICIES FOR VIRTUAL_SET_ASSETS TABLE
-- =====================================================

-- Users can view their own assets
CREATE POLICY IF NOT EXISTS "Users can view their own assets"
ON virtual_set_assets FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own assets
CREATE POLICY IF NOT EXISTS "Users can insert their own assets"
ON virtual_set_assets FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own assets
CREATE POLICY IF NOT EXISTS "Users can update their own assets"
ON virtual_set_assets FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own assets
CREATE POLICY IF NOT EXISTS "Users can delete their own assets"
ON virtual_set_assets FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 6. GRANT PERMISSIONS
-- =====================================================

-- Grant permissions to authenticated users
GRANT ALL ON virtual_set_assets TO authenticated;

-- Grant usage on sequence if needed (for auto-increment, though we use UUID)
-- GRANT USAGE, SELECT ON SEQUENCE virtual_set_assets_id_seq TO authenticated;
