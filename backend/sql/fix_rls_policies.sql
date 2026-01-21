-- Temporary fix: Allow anonymous job creation
-- This allows the backend to create jobs even when using ANON_KEY
-- IMPORTANT: In production, use SERVICE_ROLE_KEY instead

-- Drop existing policies
DROP POLICY IF EXISTS "Users can insert their own image jobs" ON image_jobs;
DROP POLICY IF EXISTS "Users can insert their own video jobs" ON video_jobs;
DROP POLICY IF EXISTS "Users can insert their own text jobs" ON text_jobs;

-- Create new policies that allow anonymous insertion
CREATE POLICY "Users can insert image jobs"
  ON image_jobs FOR INSERT
  WITH CHECK (
    -- Allow if user_id IS NULL (anonymous)
    user_id IS NULL
    -- OR if authenticated and matches user_id
    OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  );

CREATE POLICY "Users can insert video jobs"
  ON video_jobs FOR INSERT
  WITH CHECK (
    -- Allow if user_id IS NULL (anonymous)
    user_id IS NULL
    -- OR if authenticated and matches user_id
    OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  );

CREATE POLICY "Users can insert text jobs"
  ON text_jobs FOR INSERT
  WITH CHECK (
    -- Allow if user_id IS NULL (anonymous)
    user_id IS NULL
    -- OR if authenticated and matches user_id
    OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  );

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('image_jobs', 'video_jobs', 'text_jobs')
AND policyname LIKE '%insert%';
