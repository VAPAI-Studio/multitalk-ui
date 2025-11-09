# Next Steps: Complete img2img Migration

## ✅ Completed So Far

1. **Database Migration** - DONE ✓
   - Created `video_jobs`, `image_jobs`, `text_jobs` tables
   - Migrated all existing data (262 video jobs, 33 image jobs)
   - Added RLS policies and indexes

2. **Backend Implementation** - DONE ✓
   - Created `ImageJob` and `VideoJob` models
   - Implemented `ImageJobService`
   - Created `/api/image-jobs` endpoints
   - Registered router in main.py

3. **Documentation** - DONE ✓
   - DATABASE_ARCHITECTURE.md
   - DATABASE_OPTIONS_COMPARISON.md
   - MIGRATION_GUIDE.md

## 🔄 TODO: Update img2img Frontend

### Current State
`frontend/src/Img2Img.tsx` currently uses the OLD job system:
- Calls `createJob()` with old multitalk_jobs structure
- Uses `updateJobToProcessing()` and `completeJob()` from jobTracking.ts

### Required Changes

#### 1. Update Frontend API Client

Add to `frontend/src/lib/apiClient.ts`:

```typescript
// Image Jobs
async createImageJob(payload: {
  workflow_name: string
  comfy_url: string
  comfy_job_id?: string
  input_image_urls?: string[]
  prompt?: string
  width?: number
  height?: number
  parameters?: Record<string, any>
}) {
  return this.request('/image-jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

async updateImageJobToProcessing(jobId: string) {
  return this.request(`/image-jobs/${jobId}/processing`, {
    method: 'PUT',
  })
}

async completeImageJob(jobId: string, payload: {
  job_id: string
  status: 'completed' | 'failed'
  output_image_urls?: string[]
  comfyui_output_filename?: string
  comfyui_output_subfolder?: string
  width?: number
  height?: number
  error_message?: string
}) {
  return this.request(`/image-jobs/${jobId}/complete`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
```

#### 2. Update Img2Img.tsx

**Replace line 112-120** (createJob call) with:

```typescript
// Create image job record
const createResponse = await apiClient.createImageJob({
  workflow_name: 'img2img',
  comfy_url: comfyUrl,
  comfy_job_id: id,
  input_image_urls: [imageFilename],  // Now an array
  prompt: prompt,
  width: 512,
  height: 512,
  parameters: {}
});

if (!createResponse.success) {
  throw new Error(createResponse.error || 'Failed to create job record');
}

const dbJobId = createResponse.image_job?.id; // Save the DB job ID
```

**Replace line 122** (updateJobToProcessing) with:

```typescript
if (dbJobId) {
  await apiClient.updateImageJobToProcessing(dbJobId);
}
```

**Replace line 183-190** (completeJob success) with:

```typescript
// Complete job in database
if (dbJobId) {
  await apiClient.completeImageJob(dbJobId, {
    job_id: dbJobId,
    status: 'completed',
    output_image_urls: [url],  // Now an array
    comfyui_output_filename: imageInfo.filename,
    comfyui_output_subfolder: imageInfo.subfolder || undefined,
    width: 512,
    height: 512
  }).catch(() => {});
}
```

**Replace line 153-157** (completeJob error) with:

```typescript
if (dbJobId) {
  await apiClient.completeImageJob(dbJobId, {
    job_id: dbJobId,
    status: 'failed',
    error_message: errorMsg
  }).catch(() => {});
}
```

**Replace line 211-215** (timeout completeJob) with:

```typescript
if (dbJobId) {
  await apiClient.completeImageJob(dbJobId, {
    job_id: dbJobId,
    status: 'failed',
    error_message: 'Timeout'
  }).catch(() => {});
}
```

**Add state variable** at the top of component (around line 35):

```typescript
const [dbJobId, setDbJobId] = useState<string>("");
```

#### 3. Remove Old Imports

**Remove from line 2:**
```typescript
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
```

These functions are for the old multitalk_jobs table.

#### 4. Update UnifiedFeed Configuration

**Update line 305** (UnifiedFeed config):

```typescript
<UnifiedFeed
  comfyUrl={comfyUrl}
  config={{
    type: 'image',
    title: 'Image to Image',
    showCompletedOnly: false,
    maxItems: 10,
    showFixButton: true,
    showProgress: true,
    pageContext: 'img2img',  // This will now work with workflow_name filtering
    useNewJobSystem: true  // Flag to use image_jobs endpoint
  }}
/>
```

## 🧪 Testing Checklist

After making the changes:

- [ ] Backend starts without errors
- [ ] `/api/image-jobs` endpoint is accessible
- [ ] Create an img2img job from the UI
- [ ] Job appears in Supabase `image_jobs` table with `workflow_name='img2img'`
- [ ] Job status updates (pending → processing → completed)
- [ ] Result image displays correctly
- [ ] UnifiedFeed shows the job
- [ ] "Show Mine" filter works (once user_id is added)

## 🔄 Optional: Update UnifiedFeed

UnifiedFeed currently queries the old tables. You may want to update it to query `image_jobs` and `video_jobs` tables instead.

This is a larger change and can be done separately.

## 📝 Commit Message Template

```
Update img2img to use new image_jobs table

- Updated apiClient with createImageJob, updateImageJobToProcessing, completeImageJob
- Modified Img2Img.tsx to use new image job endpoints
- Changed job creation to use workflow_name='img2img' and array fields
- Removed dependency on old jobTracking functions
- Job records now stored in image_jobs table with proper structure

Tested:
- Job creation successful
- Status updates work correctly
- Image results display properly
- Jobs appear in database with workflow_name='img2img'

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## 🎯 Current Branch Status

Branch: `feature/img2img`
Latest commit: Implemented output-type-based database architecture

**Ready to merge to dev after:**
1. Completing img2img frontend updates
2. Testing end-to-end
3. Verifying no regressions in existing features
