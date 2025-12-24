# Database Migration Guide - Output Type Tables

This guide walks through migrating from the current feature-specific tables to the new output-type-based tables.

## Overview

**From:** `multitalk_jobs`, `style_transfers`, `edited_images`, `datasets`
**To:** `video_jobs`, `image_jobs`, `text_jobs`

---

## Step 1: Run SQL Migration (Create New Tables)

### Using Supabase Dashboard

1. Go to your Supabase project → **SQL Editor**
2. Create a new query
3. Copy the entire content of `backend/sql/migrations/001_create_output_type_tables.sql`
4. Run the query
5. Verify tables were created:
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('video_jobs', 'image_jobs', 'text_jobs');
   ```

### Using Supabase CLI (Alternative)

```bash
# If you have Supabase CLI installed
supabase db push backend/sql/migrations/001_create_output_type_tables.sql
```

---

## Step 2: Data Migration (Copy Existing Data)

Create and run this migration script to copy data from old tables to new ones:

```sql
-- ============================================================================
-- Data Migration: Copy from old tables to new tables
-- ============================================================================

-- Migrate from multitalk_jobs → video_jobs
-- (Assuming all multitalk_jobs are video workflows)
INSERT INTO video_jobs (
  user_id,
  workflow_name,
  status,
  created_at,
  started_at,
  completed_at,
  processing_time_seconds,
  input_image_urls,
  input_audio_urls,
  output_video_urls,
  width,
  height,
  parameters,
  comfy_job_id,
  comfy_url,
  comfyui_output_filename,
  comfyui_output_subfolder,
  comfyui_output_type,
  error_message,
  updated_at
)
SELECT
  NULL as user_id,  -- Old table didn't have user_id
  'lipsync-one' as workflow_name,  -- Default, update manually if needed
  CASE
    WHEN status = 'submitted' THEN 'pending'
    WHEN status = 'processing' THEN 'processing'
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'error' THEN 'failed'
    ELSE 'pending'
  END as status,
  timestamp_submitted as created_at,
  NULL as started_at,  -- Not tracked in old table
  timestamp_completed as completed_at,
  EXTRACT(EPOCH FROM (timestamp_completed - timestamp_submitted))::INTEGER as processing_time_seconds,
  ARRAY[image_filename]::TEXT[] as input_image_urls,  -- Convert to array
  ARRAY[audio_filename]::TEXT[] as input_audio_urls,  -- Convert to array
  ARRAY[video_url]::TEXT[] as output_video_urls,  -- Convert to array
  width,
  height,
  jsonb_build_object('trim_to_audio', trim_to_audio) as parameters,
  job_id as comfy_job_id,
  comfy_url,
  filename as comfyui_output_filename,
  subfolder as comfyui_output_subfolder,
  'output' as comfyui_output_type,
  error_message,
  updated_at
FROM multitalk_jobs
WHERE job_id IS NOT NULL;

-- Migrate from style_transfers → image_jobs
INSERT INTO image_jobs (
  user_id,
  workflow_name,
  status,
  created_at,
  completed_at,
  processing_time_seconds,
  input_image_urls,
  prompt,
  output_image_urls,
  parameters,
  comfy_job_id,
  comfy_url,
  error_message,
  model_used,
  user_ip,
  updated_at
)
SELECT
  NULL as user_id,  -- Map from user_ip if you have user mapping
  'style-transfer' as workflow_name,
  CASE
    WHEN status = 'pending' THEN 'pending'
    WHEN status = 'processing' THEN 'processing'
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'pending'
  END as status,
  created_at,
  updated_at as completed_at,
  processing_time_seconds,
  ARRAY[source_image_url, style_image_url]::TEXT[] as input_image_urls,
  prompt,
  ARRAY[result_image_url]::TEXT[] as output_image_urls,
  '{}'::JSONB as parameters,
  comfyui_prompt_id as comfy_job_id,
  'https://comfy.vapai.studio' as comfy_url,  -- Update with actual URL
  error_message,
  model_used,
  user_ip,
  updated_at
FROM style_transfers;

-- Migrate from edited_images → image_jobs
INSERT INTO image_jobs (
  user_id,
  workflow_name,
  status,
  created_at,
  processing_time_seconds,
  input_image_urls,
  prompt,
  output_image_urls,
  comfy_url,
  model_used,
  user_ip
)
SELECT
  NULL as user_id,
  'image-edit' as workflow_name,
  CASE
    WHEN status = 'pending' THEN 'pending'
    WHEN status = 'processing' THEN 'processing'
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'pending'
  END as status,
  created_at,
  processing_time_seconds,
  ARRAY[source_image_url]::TEXT[] as input_image_urls,
  prompt,
  ARRAY[result_image_url]::TEXT[] as output_image_urls,
  'https://comfy.vapai.studio' as comfy_url,  -- Update with actual URL
  model_used,
  user_ip
FROM edited_images;

-- Verify migration counts
SELECT
  (SELECT COUNT(*) FROM video_jobs) as video_jobs_count,
  (SELECT COUNT(*) FROM image_jobs) as image_jobs_count,
  (SELECT COUNT(*) FROM multitalk_jobs) as old_multitalk_count,
  (SELECT COUNT(*) FROM style_transfers) as old_style_transfers_count,
  (SELECT COUNT(*) FROM edited_images) as old_edited_images_count;
```

---

## Step 3: Backend Code Changes

### A. Update `__init__.py` in models

```python
# backend/models/__init__.py

# New models
from .video_job import (
    VideoJob,
    CreateVideoJobPayload,
    UpdateVideoJobPayload,
    CompleteVideoJobPayload,
    VideoJobResponse,
    VideoJobListResponse
)

from .image_job import (
    ImageJob,
    CreateImageJobPayload,
    UpdateImageJobPayload,
    CompleteImageJobPayload,
    ImageJobResponse,
    ImageJobListResponse
)

# Keep old models for backward compatibility during transition
from .job import MultiTalkJob, CreateJobPayload, CompleteJobPayload
from .style_transfer import StyleTransfer
from .edited_image import EditedImage
```

### B. Create Service Classes

Follow the implementation in the next steps (will be created separately).

---

## Step 4: Frontend Changes

### A. Update Type Definitions

```typescript
// frontend/src/lib/supabase.ts

export interface VideoJob {
  id: string
  user_id?: string
  workflow_name: string  // 'lipsync-one', 'lipsync-multi', etc.
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  input_image_urls?: string[]
  input_audio_urls?: string[]
  output_video_urls?: string[]
  width?: number
  height?: number
  parameters: Record<string, any>
  comfy_job_id?: string
  comfy_url: string
  error_message?: string
}

export interface ImageJob {
  id: string
  user_id?: string
  workflow_name: string  // 'img2img', 'style-transfer', 'image-edit'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
  completed_at?: string
  input_image_urls?: string[]
  prompt?: string
  output_image_urls?: string[]
  width?: number
  height?: number
  parameters: Record<string, any>
  comfy_job_id?: string
  comfy_url: string
  error_message?: string
}
```

### B. Update API Client

```typescript
// frontend/src/lib/apiClient.ts

class ApiClient {
  // ... existing methods

  // Video Jobs
  async createVideoJob(payload: CreateVideoJobPayload) {
    return this.request('/video-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getVideoJobs(limit = 50, offset = 0, workflow_name?: string) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    })
    if (workflow_name) params.append('workflow_name', workflow_name)

    return this.request(`/video-jobs?${params}`)
  }

  // Image Jobs
  async createImageJob(payload: CreateImageJobPayload) {
    return this.request('/image-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getImageJobs(limit = 50, offset = 0, workflow_name?: string) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    })
    if (workflow_name) params.append('workflow_name', workflow_name)

    return this.request(`/image-jobs?${params}`)
  }

  async completeImageJob(jobId: string, payload: CompleteImageJobPayload) {
    return this.request(`/image-jobs/${jobId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }
}
```

---

## Step 5: Update img2img to Use New Structure

Update `Img2Img.tsx` to use the new `image_jobs` table:

```typescript
// Create image job
await apiClient.createImageJob({
  workflow_name: 'img2img',
  comfy_url: comfyUrl,
  comfy_job_id: id,
  input_image_urls: [imageFilename],  // Note: Now an array
  prompt: prompt,
  parameters: {}
})

// Complete image job
await apiClient.completeImageJob(jobId, {
  job_id: jobId,
  status: 'completed',
  output_image_urls: [imageUrl],
  comfyui_output_filename: imageInfo.filename,
  comfyui_output_subfolder: imageInfo.subfolder || undefined,
  width: 512,
  height: 512
})
```

---

## Step 6: Testing Checklist

- [ ] Run SQL migration successfully
- [ ] Verify new tables exist with correct schema
- [ ] Run data migration script
- [ ] Verify data was copied correctly (check counts)
- [ ] Test img2img with new `image_jobs` table
- [ ] Verify job appears in UnifiedFeed
- [ ] Test lipsync workflows with new `video_jobs` table
- [ ] Test style transfer with new `image_jobs` table
- [ ] Verify RLS policies work (users only see their jobs)
- [ ] Test "Show Mine" vs "Show All" filtering

---

## Step 7: Rollback Plan (If Needed)

If something goes wrong:

```sql
-- Drop new tables
DROP TABLE IF EXISTS video_jobs CASCADE;
DROP TABLE IF EXISTS image_jobs CASCADE;
DROP TABLE IF EXISTS text_jobs CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS update_video_jobs_updated_at CASCADE;
DROP FUNCTION IF EXISTS update_image_jobs_updated_at CASCADE;
DROP FUNCTION IF EXISTS update_text_jobs_updated_at CASCADE;

-- Old tables remain untouched, revert code changes
```

---

## Step 8: Deprecation Timeline

1. **Week 1:** Create new tables, migrate data, run parallel (both old and new)
2. **Week 2:** Switch new features to use new tables
3. **Week 3:** Monitor for issues, verify everything works
4. **Week 4:** Archive old tables (rename to `_archived_multitalk_jobs`, etc.)

---

## Notes

- **DO NOT delete old tables immediately** - keep them for at least 2 weeks
- **Verify user_id migration** - If you want to associate old jobs with users, you'll need a mapping strategy
- **Update CLAUDE.md** - Document the new structure for future feature development
- **Update new_feature_guide.md** - Update examples to use new table structure

---

## Next Steps

Would you like me to:
1. Create the service classes (VideoJobService, ImageJobService)?
2. Create the API endpoints?
3. Update img2img to use the new structure?
4. All of the above?
