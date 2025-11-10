# Database Migration Progress

## ✅ PHASE 1: Backend Infrastructure (COMPLETE)

### Video Jobs System
- ✅ Created `VideoJobService` (backend/services/video_job_service.py)
  - CRUD operations for video_jobs table
  - create_job(), update_job(), update_to_processing(), complete_job()
  - get_job(), get_job_by_comfy_id(), get_recent_jobs(), get_completed_jobs()
  - Filtering by workflow_name and user_id

- ✅ Created `/api/video-jobs` endpoints (backend/api/video_jobs.py)
  - POST /video-jobs - Create job
  - GET /video-jobs - List jobs with filters (workflow_name, user_id, limit, offset)
  - GET /video-jobs/completed/recent - List completed jobs
  - GET /video-jobs/{id} - Get single job by UUID
  - GET /video-jobs/comfy/{comfy_job_id} - Get job by ComfyUI job ID
  - PUT /video-jobs/{id}/processing - Update to processing
  - PUT /video-jobs/{id} - Update job
  - PUT /video-jobs/{id}/complete - Complete job

- ✅ Registered router in main.py

### Image Jobs System
- ✅ Created `ImageJobService` (backend/services/image_job_service.py) - PREVIOUS SESSION
- ✅ Created `/api/image-jobs` endpoints (backend/api/image_jobs.py) - PREVIOUS SESSION
- ✅ Registered router in main.py - PREVIOUS SESSION

### API Client
- ✅ Added video job methods to apiClient.ts:
  - createVideoJob(), getVideoJobs(), getCompletedVideoJobs()
  - getVideoJob(), getVideoJobByComfyId()
  - updateVideoJobToProcessing(), updateVideoJob(), completeVideoJob()

- ✅ Added image job methods to apiClient.ts:
  - createImageJob(), getImageJobs(), getCompletedImageJobs()
  - getImageJob(), getImageJobByComfyId()
  - updateImageJobToProcessing(), updateImageJob(), completeImageJob()

## ✅ PHASE 2: Feed Components (COMPLETE)

### VideoFeed Component
- ✅ Added feature flag: `useNewJobSystem` in VideoFeedConfig
- ✅ Added new config options: `workflowName`, `userId`
- ✅ Updated loadFeed() to support both old and new systems
- ✅ Backward compatible - defaults to old multitalk_jobs system
- ✅ New system queries video_jobs table with workflow filtering
- ✅ Converts new job format to old format for UI compatibility

### ImageFeed Component
- ✅ Added feature flag: `useNewJobSystem` in ImageFeedConfig
- ✅ Added new config options: `workflowName`, `userId`
- ✅ Updated loadFeed() to support both old and new systems
- ✅ Backward compatible - defaults to old edited_images + style_transfers
- ✅ New system queries single image_jobs table
- ✅ Converts new job format to old format for UI compatibility

### UnifiedFeed Component
- ⏳ TODO: Add feature flag support
- ⏳ TODO: Query both video_jobs and image_jobs when enabled
- ⏳ TODO: Merge results by created_at timestamp
- ⏳ TODO: Support workflowName filtering

## ⏳ PHASE 3: Page Updates (TODO)

### Pages Using VideoFeed (4 pages)
All need: `useNewJobSystem: true` and correct `workflowName`

1. ⏳ MultiTalkOnePerson.tsx
   - Change: `useNewJobSystem: true, workflowName: 'lipsync-one'`
   - Update job creation to use apiClient.createVideoJob()
   - Update job completion to use apiClient.completeVideoJob()

2. ⏳ MultiTalkMultiplePeople.tsx
   - Change: `useNewJobSystem: true, workflowName: 'lipsync-multi'`
   - Update job creation and completion

3. ⏳ VideoLipsync.tsx
   - Change: `useNewJobSystem: true, workflowName: 'video-lipsync'`
   - Update job creation and completion

4. ⏳ WANI2V.tsx
   - Change: `useNewJobSystem: true, workflowName: 'wan-i2v'`
   - Update job creation and completion

### Pages Using ImageFeed (2 pages)

5. ⏳ ImageEdit.tsx
   - Change: `useNewJobSystem: true, workflowName: 'image-edit'`
   - Update job creation to use apiClient.createImageJob()
   - Update job completion to use apiClient.completeImageJob()

6. ⏳ StyleTransfer.tsx
   - Change: `useNewJobSystem: true, workflowName: 'style-transfer'`
   - Update job creation and completion

### Pages Using UnifiedFeed (1 page)

7. ⏳ CharacterCaption.tsx
   - Needs investigation - what does it output?
   - Decide if it's video, image, or text
   - Create appropriate feed

### Img2Img (LAST)

8. ⏳ Img2Img.tsx (DO THIS LAST)
   - Currently uses old system via jobTracking.ts
   - Change: `useNewJobSystem: true, workflowName: 'img2img'`
   - Update to use apiClient.createImageJob()
   - Update to use apiClient.completeImageJob()
   - Update UnifiedFeed config when UnifiedFeed is ready

## 📊 Current Architecture

### Old System (Still Active)
```
multitalk_jobs (video jobs)
├── Used by: getRecentJobs(), getCompletedJobsWithVideos()
└── Pages: All 4 video pages currently use this

edited_images (image edit jobs)
├── Used by: ImageFeed queries this
└── Pages: ImageEdit.tsx

style_transfers (style transfer jobs)
├── Used by: ImageFeed queries this
└── Pages: StyleTransfer.tsx

datasets (text jobs - captions)
└── Pages: CharacterCaption.tsx
```

### New System (Ready, Not Used Yet)
```
video_jobs
├── Columns: workflow_name, input_image_urls[], input_audio_urls[], output_video_urls[]
├── Workflows: lipsync-one, lipsync-multi, video-lipsync, wan-i2v
├── API: /api/video-jobs
└── Feed: VideoFeed (with useNewJobSystem: true)

image_jobs
├── Columns: workflow_name, input_image_urls[], prompt, output_image_urls[]
├── Workflows: img2img, style-transfer, image-edit
├── API: /api/image-jobs
└── Feed: ImageFeed (with useNewJobSystem: true)
```

## 🔑 Key Migration Pattern

For each page that needs updating:

1. **Update Feed Config**
   ```tsx
   <VideoFeed
     comfyUrl={comfyUrl}
     config={{
       useNewJobSystem: true,  // Enable new system
       workflowName: 'lipsync-one',  // Filter by workflow
       showCompletedOnly: false,
       maxItems: 10
     }}
   />
   ```

2. **Update Job Creation**
   ```tsx
   // OLD
   await createJob({
     job_id: id,
     comfy_url: comfyUrl,
     workflow_type: 'lipsync-one',  // This field doesn't exist!
     ...
   })

   // NEW
   await apiClient.createVideoJob({
     comfy_job_id: id,
     workflow_name: 'lipsync-one',  // Proper field
     comfy_url: comfyUrl,
     input_image_urls: [imageUrl],
     input_audio_urls: [audioUrl],
     width,
     height,
     parameters: { /* extra data */ }
   })
   ```

3. **Update Job Processing**
   ```tsx
   // OLD
   await updateJobToProcessing(id)

   // NEW
   await apiClient.updateVideoJobToProcessing(id)
   ```

4. **Update Job Completion**
   ```tsx
   // OLD
   await completeJob({
     job_id: id,
     status: 'completed',
     video_url: url,
     filename: 'video.mp4'
   })

   // NEW
   await apiClient.completeVideoJob(id, {
     job_id: id,
     status: 'completed',
     output_video_urls: [url]
   })
   ```

## 🧪 Testing Plan

For each page after migration:

1. ✅ Submit a new job
2. ✅ Verify job appears in video_jobs/image_jobs table
3. ✅ Verify workflow_name is correct
4. ✅ Verify feed shows the job
5. ✅ Verify filtering works (when userId is added)
6. ✅ Verify completion updates correctly
7. ✅ Verify output URLs are stored
8. ✅ Verify no regressions in old pages

## 📝 Notes

- **Backward Compatibility**: All feeds default to old system (useNewJobSystem: false)
- **No Breaking Changes**: Old pages continue to work during migration
- **Gradual Migration**: Pages can be migrated one at a time
- **Testing**: Test each page thoroughly after migration
- **User IDs**: Need to add user_id when available from AuthContext
- **Workflow Names**: Must match exactly between job creation and feed filtering

## 🎯 Next Steps

1. **Update UnifiedFeed** - Add new system support
2. **Migrate Video Pages** - One by one, test each
3. **Migrate Image Pages** - One by one, test each
4. **Migrate Img2Img** - Last, after everything else works
5. **Add User Filtering** - Once all pages use new system
6. **Clean Up Old Tables** - After full migration and verification

## 🚀 When Complete

All pages will:
- ✅ Use unified job tables (video_jobs, image_jobs)
- ✅ Have proper workflow_name filtering
- ✅ Support user_id filtering ("Show Mine" button)
- ✅ Have consistent schema and architecture
- ✅ Be easier to maintain and extend
- ✅ Support better analytics and reporting
