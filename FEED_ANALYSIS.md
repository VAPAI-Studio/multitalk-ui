# Complete Feed Analysis - Current State & Migration Strategy

## Overview

This document analyzes what feed/result display system each feature page uses, what data they fetch, and how they need to be updated for the new database structure.

---

## Current Feed Components

### 1. VideoFeed.tsx
**Used by:** 3 pages
**Data Source:** `multitalk_jobs` table (OLD)
**API Methods:**
- `getRecentJobs()` → Queries `multitalk_jobs`
- `getCompletedJobsWithVideos()` → Queries `multitalk_jobs WHERE status='completed' AND video_url IS NOT NULL`

**Features:**
- Shows video jobs with thumbnails
- Real-time progress tracking via ComfyUI WebSocket
- "Fix stuck job" button
- "Show All" / "Show Mine" filter (but no user_id, so doesn't actually filter)
- Pagination/lazy loading

### 2. ImageFeed.tsx
**Used by:** 2 pages
**Data Source:** `edited_images` and `style_transfers` tables (OLD)
**API Methods:**
- `apiClient.getRecentEditedImages()` → Queries `edited_images` table
- `apiClient.getRecentStyleTransfers()` → Queries `style_transfers` table

**Features:**
- Shows image results in grid
- Supports both image-edit and style-transfer
- Modal for viewing full images
- No real-time progress (images generate fast)

### 3. UnifiedFeed.tsx
**Used by:** 1 page (img2img, and potentially more)
**Data Source:** **MIXED** - Queries multiple old tables
**API Methods:**
- `getRecentJobs()` → `multitalk_jobs` (for videos)
- `apiClient.getRecentEditedImages()` → `edited_images` (for images)
- `apiClient.getRecentStyleTransfers()` → `style_transfers` (for images)

**Features:**
- **Unifies** video and image jobs in one feed
- Type-based filtering (video/image/both)
- Modal for viewing results
- "Show All" / "Show Mine" filter
- **Has pageContext filtering** - attempts to filter by `workflow_type` (but field doesn't exist!)

---

## Page-by-Page Feed Usage

| Page | Feed Component | Data Source | Workflow Type | Output Type |
|------|---------------|-------------|---------------|-------------|
| **MultiTalkOnePerson** | VideoFeed | `multitalk_jobs` | lipsync-one | video |
| **MultiTalkMultiplePeople** | VideoFeed | `multitalk_jobs` | lipsync-multi | video |
| **VideoLipsync** | VideoFeed | `multitalk_jobs` | video-lipsync | video |
| **WANI2V** | VideoFeed | `multitalk_jobs` | wan-i2v | video |
| **ImageEdit** | ImageFeed | `edited_images` | image-edit | image |
| **StyleTransfer** | ImageFeed | `style_transfers` | style-transfer | image |
| **Img2Img** | UnifiedFeed | (none yet!) | img2img | image |
| **CharacterCaption** | ❌ None | N/A | character-caption | text/data |

---

## Problems with Current Implementation

### 🚨 Critical Issues

1. **No workflow_type field in old tables**
   - VideoFeed's `pageContext` can't filter by workflow type
   - UnifiedFeed tries to filter by `workflow_type` but field doesn't exist
   - All lipsync/video workflows show up together, can't separate

2. **Multiple data sources for UnifiedFeed**
   - Queries 3 different tables (`multitalk_jobs`, `edited_images`, `style_transfers`)
   - Complex logic to merge and deduplicate
   - Pagination doesn't work properly across tables

3. **ImageFeed has hardcoded dual queries**
   - Always queries BOTH `edited_images` AND `style_transfers`
   - Can't filter to just one workflow type
   - Lines 105 and 142 in ImageFeed.tsx

4. **No user filtering**
   - "Show Mine" button exists but doesn't work
   - Old tables have no `user_id` field
   - Can't properly filter user's own jobs

5. **Img2img has no feed yet**
   - Uses UnifiedFeed but no jobs exist in old structure
   - Will need to query new `image_jobs` table

6. **CharacterCaption has no results display**
   - No feed component at all
   - Results likely get lost

---

## Migration Strategy for New Database

### ✅ Good News

The new database structure **solves all these problems**:
- `workflow_name` field enables proper filtering
- `user_id` field enables "Show Mine" filtering
- Fewer tables to query (3 instead of 4+)

### 🎯 Recommended Approach

**Option A: Update All Feeds to Use New Tables (Cleanest)**

#### Step 1: Create New Feed Components

**Create: `NewVideoFeed.tsx`**
- Query `video_jobs` table instead of `multitalk_jobs`
- Filter by `workflow_name` (lipsync-one, lipsync-multi, video-lipsync, wan-i2v)
- Enable user filtering with `user_id`

**Create: `NewImageFeed.tsx`**
- Query `image_jobs` table instead of `edited_images` + `style_transfers`
- Filter by `workflow_name` (img2img, style-transfer, image-edit)
- Enable user filtering with `user_id`

**Update: `UnifiedFeed.tsx`**
- Query `video_jobs` and `image_jobs` (2 tables instead of 3)
- Merge by `created_at` timestamp
- Proper `workflow_name` filtering

#### Step 2: Update API Client

Add to `frontend/src/lib/apiClient.ts`:

```typescript
// Video Jobs
async getVideoJobs(limit = 50, offset = 0, workflow_name?: string, user_id?: string) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  })
  if (workflow_name) params.append('workflow_name', workflow_name)
  if (user_id) params.append('user_id', user_id)

  return this.request(`/video-jobs?${params}`)
}

async getCompletedVideoJobs(limit = 20, offset = 0, workflow_name?: string) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  })
  if (workflow_name) params.append('workflow_name', workflow_name)

  return this.request(`/video-jobs/completed/recent?${params}`)
}

// Image Jobs
async getImageJobs(limit = 50, offset = 0, workflow_name?: string, user_id?: string) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  })
  if (workflow_name) params.append('workflow_name', workflow_name)
  if (user_id) params.append('user_id', user_id)

  return this.request(`/image-jobs?${params}`)
}

async getCompletedImageJobs(limit = 20, offset = 0, workflow_name?: string) {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  })
  if (workflow_name) params.append('workflow_name', workflow_name)

  return this.request(`/image-jobs/completed/recent?${params}`)
}
```

#### Step 3: Update Each Page

**For Video Pages (MultiTalkOnePerson, MultiTalkMultiplePeople, VideoLipsync, WANI2V):**

Current:
```tsx
<VideoFeed
  comfyUrl={comfyUrl}
  config={{
    pageContext: 'lipsync-one',  // This doesn't actually filter!
    showCompletedOnly: false,
    maxItems: 10
  }}
/>
```

New:
```tsx
<VideoFeed
  comfyUrl={comfyUrl}
  config={{
    workflowName: 'lipsync-one',  // Now actually filters!
    showCompletedOnly: false,
    maxItems: 10,
    useNewJobSystem: true  // Flag to use video_jobs table
  }}
/>
```

**For Image Pages (ImageEdit, StyleTransfer):**

Current:
```tsx
<ImageFeed
  config={{
    pageContext: 'image-edit',  // Doesn't filter, shows both image-edit AND style-transfer
    maxItems: 10
  }}
/>
```

New:
```tsx
<ImageFeed
  config={{
    workflowName: 'image-edit',  // Now filters to JUST image-edit
    maxItems: 10,
    useNewJobSystem: true  // Flag to use image_jobs table
  }}
/>
```

**For Img2Img:**

Current:
```tsx
<UnifiedFeed
  comfyUrl={comfyUrl}
  config={{
    type: 'image',
    pageContext: 'img2img',  // Tries to filter but workflow_type doesn't exist
    maxItems: 10
  }}
/>
```

New:
```tsx
<UnifiedFeed
  comfyUrl={comfyUrl}
  config={{
    type: 'image',
    workflowName: 'img2img',  // Now properly filters to img2img jobs
    maxItems: 10,
    useNewJobSystem: true  // Flag to use image_jobs table
  }}
/>
```

---

## Implementation Plan

### Phase 1: Backward Compatible Changes

1. **Update VideoFeed.tsx**
   - Add `useNewJobSystem` config flag
   - If `true`, call `apiClient.getVideoJobs()` instead of `getRecentJobs()`
   - Filter by `workflowName` instead of `pageContext`
   - Keep old behavior as default for gradual migration

2. **Update ImageFeed.tsx**
   - Add `useNewJobSystem` config flag
   - If `true`, call `apiClient.getImageJobs()` instead of dual query
   - Filter by `workflowName`
   - Keep old behavior as default

3. **Update UnifiedFeed.tsx**
   - Add `useNewJobSystem` config flag
   - If `true`, query `video_jobs` + `image_jobs` instead of old tables
   - Proper `workflowName` filtering works now!

### Phase 2: Update Pages One by One

**Week 1:**
- ✅ Img2Img (new, use new system immediately)
- Update MultiTalkOnePerson
- Update MultiTalkMultiplePeople

**Week 2:**
- Update VideoLipsync
- Update WANI2V

**Week 3:**
- Update ImageEdit
- Update StyleTransfer

**Week 4:**
- Update CharacterCaption (create feed for it)
- Remove old feed logic completely

### Phase 3: Backend Endpoints Needed

Already have:
- ✅ `GET /api/image-jobs` (created)
- ✅ `GET /api/image-jobs/completed/recent` (created)
- ✅ `POST /api/image-jobs` (created)
- ✅ `PUT /api/image-jobs/{id}/complete` (created)

Still need:
- ⏳ `GET /api/video-jobs`
- ⏳ `GET /api/video-jobs/completed/recent`
- ⏳ `POST /api/video-jobs`
- ⏳ `PUT /api/video-jobs/{id}/complete`

---

## Code Changes Summary

### Files to Modify

**Backend:**
- [ ] `backend/api/video_jobs.py` - Create (similar to image_jobs.py)
- [ ] `backend/services/video_job_service.py` - Create (similar to image_job_service.py)
- [ ] `backend/main.py` - Register video_jobs router

**Frontend:**
- [ ] `frontend/src/lib/apiClient.ts` - Add getVideoJobs, getImageJobs methods
- [ ] `frontend/src/components/VideoFeed.tsx` - Add useNewJobSystem flag
- [ ] `frontend/src/components/ImageFeed.tsx` - Add useNewJobSystem flag
- [ ] `frontend/src/components/UnifiedFeed.tsx` - Add useNewJobSystem flag
- [ ] `frontend/src/Img2Img.tsx` - Set useNewJobSystem: true
- [ ] `frontend/src/MultiTalkOnePerson.tsx` - Set useNewJobSystem: true, workflowName: 'lipsync-one'
- [ ] `frontend/src/MultiTalkMultiplePeople.tsx` - Set useNewJobSystem: true, workflowName: 'lipsync-multi'
- [ ] `frontend/src/VideoLipsync.tsx` - Set useNewJobSystem: true, workflowName: 'video-lipsync'
- [ ] `frontend/src/WANI2V.tsx` - Set useNewJobSystem: true, workflowName: 'wan-i2v'
- [ ] `frontend/src/ImageEdit.tsx` - Set useNewJobSystem: true, workflowName: 'image-edit'
- [ ] `frontend/src/StyleTransfer.tsx` - Set useNewJobSystem: true, workflowName: 'style-transfer'

---

## Testing Checklist

For each page after migration:

- [ ] Jobs are created in the correct table (`video_jobs` or `image_jobs`)
- [ ] Jobs have correct `workflow_name` value
- [ ] Feed shows only jobs from that workflow (proper filtering)
- [ ] "Show All" shows all jobs from that workflow
- [ ] "Show Mine" shows only current user's jobs (after user_id is added)
- [ ] Real-time progress works (for videos)
- [ ] Result display works (video player or image modal)
- [ ] "Fix stuck job" button works (for videos)
- [ ] Pagination works correctly
- [ ] No duplicate jobs shown

---

## Quick Reference: Workflow Names

| Page | workflow_name | Output Type | Table |
|------|--------------|-------------|-------|
| MultiTalkOnePerson | `lipsync-one` | video | video_jobs |
| MultiTalkMultiplePeople | `lipsync-multi` | video | video_jobs |
| VideoLipsync | `video-lipsync` | video | video_jobs |
| WANI2V | `wan-i2v` | video | video_jobs |
| ImageEdit | `image-edit` | image | image_jobs |
| StyleTransfer | `style-transfer` | image | image_jobs |
| Img2Img | `img2img` | image | image_jobs |
| CharacterCaption | `character-caption` | text | text_jobs |

---

## Next Steps

1. Review this analysis
2. Decide: Update all feeds now, or gradual migration?
3. If gradual: Start with img2img (already using UnifiedFeed)
4. Create VideoJobService and video_jobs endpoints
5. Update feed components with `useNewJobSystem` flag
6. Test each page thoroughly

