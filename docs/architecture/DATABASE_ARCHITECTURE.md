# Database Architecture Analysis & Design

## Current State (As-Is)

### Existing Tables

We currently have **4 separate tables** for different workflow types:

#### 1. `multitalk_jobs`
**Purpose:** Video generation workflows (lipsync, video-to-video)
**Model:** `MultiTalkJob` in `backend/models/job.py`

```python
Fields:
- job_id: str (PK, from ComfyUI)
- status: 'submitted' | 'processing' | 'completed' | 'error'
- timestamp_submitted: datetime
- timestamp_completed: datetime | null
- filename: str | null (output file)
- subfolder: str | null
- image_filename: str | null (input)
- audio_filename: str | null (input)
- width: int (required)
- height: int (required)
- trim_to_audio: bool
- comfy_url: str
- error_message: str | null
- video_url: str | null (Supabase Storage URL)
- created_at: datetime
- updated_at: datetime
```

**Features using this:**
- Lipsync 1 Person
- Lipsync Multi Person
- Video Lipsync
- WAN I2V
- **img2img (currently forced to fit this schema)**

#### 2. `style_transfers`
**Purpose:** Style transfer workflow
**Model:** `StyleTransfer` in `backend/models/style_transfer.py`

```python
Fields:
- id: str (PK, UUID)
- created_at: datetime
- source_image_url: str (Supabase Storage URL)
- style_image_url: str (Supabase Storage URL)
- prompt: str
- result_image_url: str | null (Supabase Storage URL)
- workflow_name: str = "StyleTransfer"
- model_used: str | null
- processing_time_seconds: int | null
- user_ip: str | null
- status: 'pending' | 'processing' | 'completed' | 'failed'
- comfyui_prompt_id: str | null
- error_message: str | null
- updated_at: datetime | null
```

**Features using this:**
- Style Transfer

#### 3. `edited_images`
**Purpose:** Image editing workflow
**Model:** `EditedImage` in `backend/models/edited_image.py`

```python
Fields:
- id: str (PK, UUID)
- created_at: datetime
- source_image_url: str (Supabase Storage URL)
- prompt: str
- result_image_url: str | null (Supabase Storage URL)
- workflow_name: str = "image-edit"
- model_used: str | null
- processing_time_seconds: int | null
- user_ip: str | null
- status: 'pending' | 'processing' | 'completed' | 'failed'
```

**Features using this:**
- Image Edit

#### 4. `datasets`
**Purpose:** Character caption datasets
**Model:** `Dataset` in `backend/models/dataset.py`

```python
Fields:
- (Schema not examined yet, but used by Character Caption feature)
```

---

## Problems with Current Architecture

### 🚨 Critical Issues

1. **No unified job tracking across features**
   - UnifiedFeed can't filter by workflow type (no `workflow_type` field in `multitalk_jobs`)
   - Different status enums across tables (`submitted` vs `pending`)
   - Inconsistent field names and types

2. **Schema mismatch for new features**
   - img2img is forced into `multitalk_jobs` with irrelevant fields:
     - `trim_to_audio: bool` (doesn't apply to images)
     - `audio_filename` (img2img has no audio)
     - Required `width` and `height` (img2img might not care about these)

3. **Inconsistent storage patterns**
   - Video workflows: Upload to Supabase Storage → save URL
   - Style Transfer: Upload to Supabase Storage → save URL
   - Image Edit: Upload to Supabase Storage → save URL
   - **img2img: NOT uploading to Supabase (inconsistent!)**

4. **Duplicate logic**
   - Each table has its own service class
   - Similar CRUD operations repeated 4+ times
   - Status management duplicated

5. **No user association**
   - Only `style_transfers` and `edited_images` track `user_ip`
   - No `user_id` field anywhere (but authentication exists!)
   - Can't filter "my jobs" vs "all jobs"

---

## Design Options

### Option 1: Single Unified Table (Recommended)

Create one `workflow_jobs` table to handle all workflow types.

```sql
CREATE TABLE workflow_jobs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id TEXT UNIQUE NOT NULL,  -- ComfyUI prompt ID
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Workflow identification
  workflow_type TEXT NOT NULL,  -- 'lipsync-one', 'img2img', 'style-transfer', etc.
  workflow_name TEXT NOT NULL,  -- Workflow JSON filename

  -- Status tracking
  status TEXT NOT NULL,  -- 'pending', 'processing', 'completed', 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_seconds INTEGER,

  -- Input/Output files
  inputs JSONB,  -- Flexible storage for all input parameters
  outputs JSONB,  -- Flexible storage for all output info

  -- Results
  result_urls JSONB,  -- Array of result URLs (video_url, image_url, etc.)

  -- ComfyUI integration
  comfy_url TEXT NOT NULL,
  comfyui_output_filename TEXT,
  comfyui_output_subfolder TEXT,
  comfyui_output_type TEXT,

  -- Error handling
  error_message TEXT,

  -- Metadata
  model_used TEXT,
  user_ip TEXT,

  -- Indexes
  CREATE INDEX idx_workflow_jobs_user_id ON workflow_jobs(user_id);
  CREATE INDEX idx_workflow_jobs_workflow_type ON workflow_jobs(workflow_type);
  CREATE INDEX idx_workflow_jobs_status ON workflow_jobs(status);
  CREATE INDEX idx_workflow_jobs_created_at ON workflow_jobs(created_at DESC);
);
```

**JSONB Examples:**

```json
// Lipsync One Person
{
  "inputs": {
    "image_filename": "portrait.png",
    "audio_filename": "voice.mp3",
    "width": 640,
    "height": 360,
    "trim_to_audio": true
  },
  "outputs": {
    "video_filename": "output.mp4",
    "duration_seconds": 10.5
  },
  "result_urls": [
    "https://supabase.co/storage/videos/abc123.mp4"
  ]
}

// img2img
{
  "inputs": {
    "image_filename": "input.png",
    "prompt": "turn this into a watercolor painting"
  },
  "outputs": {
    "image_filename": "output.png",
    "width": 512,
    "height": 512
  },
  "result_urls": [
    "https://supabase.co/storage/images/xyz789.png"
  ]
}

// Style Transfer
{
  "inputs": {
    "source_image_url": "https://...",
    "style_image_url": "https://...",
    "prompt": "apply style"
  },
  "outputs": {
    "image_filename": "styled.png"
  },
  "result_urls": [
    "https://supabase.co/storage/images/styled123.png"
  ]
}
```

**Pros:**
✅ Single source of truth for all workflows
✅ Easy to add new workflow types (just add new workflow_type value)
✅ Unified filtering, sorting, pagination
✅ Consistent status tracking
✅ User association built-in
✅ UnifiedFeed works perfectly with workflow_type filter
✅ Flexible JSONB fields adapt to any workflow's unique needs

**Cons:**
❌ Migration required from existing tables
❌ JSONB queries are slightly more complex
❌ Need to define JSONB schema conventions

---

### Option 2: Separate Tables with Shared Interface

Keep existing tables but add a unified view/interface layer.

```sql
-- Keep existing tables: multitalk_jobs, style_transfers, edited_images, datasets

-- Create a view that unifies them
CREATE VIEW unified_workflow_jobs AS
  SELECT
    job_id as id,
    'lipsync' as workflow_type,
    status,
    timestamp_submitted as created_at,
    timestamp_completed as completed_at,
    video_url as result_url,
    comfy_url,
    error_message,
    NULL as user_id,
    NULL as user_ip
  FROM multitalk_jobs

  UNION ALL

  SELECT
    id,
    'style-transfer' as workflow_type,
    status,
    created_at,
    updated_at as completed_at,
    result_image_url as result_url,
    NULL as comfy_url,
    error_message,
    NULL as user_id,
    user_ip
  FROM style_transfers

  UNION ALL

  SELECT
    id,
    'image-edit' as workflow_type,
    status,
    created_at,
    NULL as completed_at,
    result_image_url as result_url,
    NULL as comfy_url,
    NULL as error_message,
    NULL as user_id,
    user_ip
  FROM edited_images;
```

**Pros:**
✅ No migration needed
✅ Existing workflows unchanged
✅ Can query unified view for feeds

**Cons:**
❌ Still have duplicate service logic
❌ Schema inconsistencies remain
❌ Adding new features still requires new tables
❌ View performance may be slower
❌ Can't easily filter or add common fields

---

### Option 3: Hybrid Approach (Short-term compromise)

1. Add `workflow_type` column to `multitalk_jobs` NOW
2. Use `multitalk_jobs` for all video/image generation workflows
3. Keep specialized tables only for truly unique features

```sql
-- Alter multitalk_jobs
ALTER TABLE multitalk_jobs
  ADD COLUMN workflow_type TEXT,
  ADD COLUMN user_id UUID REFERENCES auth.users(id),
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL,
  ALTER COLUMN trim_to_audio SET DEFAULT false;

-- Add index
CREATE INDEX idx_multitalk_jobs_workflow_type ON multitalk_jobs(workflow_type);
CREATE INDEX idx_multitalk_jobs_user_id ON multitalk_jobs(user_id);
```

**Pros:**
✅ Quick to implement
✅ Fixes UnifiedFeed filtering immediately
✅ Minimal code changes
✅ Works for img2img, lipsync, wan-i2v, etc.

**Cons:**
❌ Still have multiple tables
❌ Schema still has irrelevant fields for some workflows
❌ Not a long-term solution

---

## Recommended Strategy

### Phase 1: Immediate Fix (This Week)
✅ **Implement Option 3 (Hybrid Approach)**
1. Add `workflow_type` and `user_id` to `multitalk_jobs`
2. Make `width`, `height`, `trim_to_audio` nullable
3. Update img2img to use `workflow_type: 'img2img'`
4. Update UnifiedFeed to filter by `workflow_type`
5. Add user authentication to job creation

### Phase 2: Storage Standardization (Next Sprint)
✅ **Ensure all workflows upload to Supabase Storage**
1. Create helper function for uploading any file type to Supabase
2. Update img2img to upload result images
3. Create consistent URL structure: `/storage/workflows/{workflow_type}/{job_id}/{filename}`

### Phase 3: Full Migration (Future)
✅ **Migrate to Option 1 (Single Unified Table)**
1. Create new `workflow_jobs` table
2. Write migration script to copy data from all existing tables
3. Update all services to use unified table
4. Deprecate old tables
5. Update CLAUDE.md and documentation

---

## Storage Architecture

### Current Storage Buckets (Assumption)

```
supabase-storage/
├── videos/          # Video outputs
├── images/          # Image outputs
├── audio/           # Audio inputs
└── temp/            # Temporary uploads
```

### Proposed Unified Structure

```
supabase-storage/
└── workflows/
    ├── lipsync-one/
    │   ├── {job_id}/
    │   │   ├── input_image.png
    │   │   ├── input_audio.mp3
    │   │   └── output_video.mp4
    ├── img2img/
    │   ├── {job_id}/
    │   │   ├── input.png
    │   │   └── output.png
    ├── style-transfer/
    │   ├── {job_id}/
    │   │   ├── source.png
    │   │   ├── style.png
    │   │   └── result.png
    └── image-edit/
        └── {job_id}/
            ├── input.png
            └── output.png
```

**Benefits:**
- Clear organization by workflow type
- All files for a job in one place
- Easy cleanup (delete entire job folder)
- Consistent URL patterns

---

## Implementation Checklist

### Phase 1: Immediate Fix

- [ ] Run SQL migration to alter `multitalk_jobs` table
- [ ] Update `MultiTalkJob` model to include `workflow_type` and `user_id`
- [ ] Update `CreateJobPayload` to include `workflow_type`
- [ ] Make `width`, `height`, `trim_to_audio` optional in model
- [ ] Update img2img to set `workflow_type: 'img2img'`
- [ ] Update all existing features to set their workflow_type
- [ ] Add user_id to job creation (get from auth context)
- [ ] Update UnifiedFeed to filter by workflow_type
- [ ] Test filtering: Show Mine vs Show All

### Phase 2: Storage Standardization

- [ ] Create `uploadToSupabaseStorage` utility function
- [ ] Create Supabase storage buckets if not exist
- [ ] Update img2img to upload result images
- [ ] Update all workflows to use consistent storage paths
- [ ] Add storage cleanup for failed jobs
- [ ] Document storage structure

### Phase 3: Future Migration

- [ ] Design JSONB schema conventions
- [ ] Create `workflow_jobs` table
- [ ] Write data migration scripts
- [ ] Update all services to use unified table
- [ ] Update all API endpoints
- [ ] Update frontend models
- [ ] Run migration
- [ ] Archive old tables

---

## Questions to Answer

1. **User Authentication:**
   - Should jobs be public or private by default?
   - Can users see other users' jobs?
   - How do we handle anonymous users?

2. **Storage Limits:**
   - How long should we keep completed jobs?
   - Should we auto-delete old results?
   - What's the storage quota per user?

3. **Supabase RLS (Row Level Security):**
   - Should we enable RLS on job tables?
   - Users can only see their own jobs?
   - Admins can see all jobs?

4. **Workflow Type Values:**
   - Should we use enums or free text?
   - Standard values: 'lipsync-one', 'lipsync-multi', 'video-lipsync', 'img2img', 'style-transfer', 'image-edit', 'wan-i2v', 'character-caption'

---

## Next Steps

**Recommendation:** Start with Phase 1 immediately to fix the current issues with img2img and UnifiedFeed filtering.

Would you like me to:
1. Write the SQL migration for Phase 1?
2. Update the models and services?
3. Implement Supabase Storage upload for img2img?
4. All of the above?
