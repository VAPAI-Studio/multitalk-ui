-- ============================================
-- Supabase Storage Policies for Profile Pictures
-- ============================================
-- Run these SQL commands in the Supabase SQL Editor after creating the 'user-avatars' bucket
-- Dashboard: https://app.supabase.com/project/rwbhfxltyxaegtalgxdx/sql

-- Policy 1: Allow users to upload their own avatar
CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 2: Allow anyone to view avatars (read access)
CREATE POLICY "Anyone can view avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'user-avatars');

-- Policy 3: Allow users to update their own avatar
CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy 4: Allow users to delete their own avatar
CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'user-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================
-- Verification Queries (Optional)
-- ============================================

-- Check if policies were created successfully
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'objects'
  AND policyname LIKE '%avatar%';

-- ============================================
-- NOTES:
-- ============================================
-- 1. These policies ensure users can only manage their own profile pictures
-- 2. The folder structure is: avatars/{user_id}/profile.{ext}
-- 3. auth.uid() returns the current authenticated user's ID
-- 4. (storage.foldername(name))[1] extracts the user_id from the path
