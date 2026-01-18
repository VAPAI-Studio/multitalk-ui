# Database Architecture - Three Approaches Compared

## Context

MultiTalk is **one feature** of the sideOUTsticks platform, which offers multiple AI workflow tools. We need a database structure that:
- Scales as we add new features
- Makes sense from a product perspective
- Is easy to query and maintain
- Handles different output types (video, image, audio, text)

---

## Option A: One Table Per Feature

`img2img_jobs`, `style_transfer_jobs`, `lipsync_jobs`, `wan_i2v_jobs`, etc.

### Structure Example

```sql
-- One table per feature
CREATE TABLE img2img_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Feature-specific inputs
  input_image_url TEXT,
  prompt TEXT,

  -- Feature-specific outputs
  output_image_url TEXT,

  -- Common fields
  comfy_job_id TEXT,
  comfy_url TEXT,
  error_message TEXT
);

CREATE TABLE style_transfer_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Feature-specific inputs
  source_image_url TEXT,
  style_image_url TEXT,
  prompt TEXT,

  -- Feature-specific outputs
  output_image_url TEXT,

  -- Common fields
  comfy_job_id TEXT,
  comfy_url TEXT,
  error_message TEXT
);

CREATE TABLE lipsync_one_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  status TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Feature-specific inputs
  input_image_url TEXT,
  input_audio_url TEXT,
  width INT,
  height INT,
  trim_to_audio BOOL,

  -- Feature-specific outputs
  output_video_url TEXT,
  duration_seconds FLOAT,

  -- Common fields
  comfy_job_id TEXT,
  comfy_url TEXT,
  error_message TEXT
);

-- And so on for each feature...
```

### Pros ✅
- **Crystal clear** - Each feature has its own dedicated schema
- **Type safety** - Exact fields for each feature (no nullable fields that don't apply)
- **Feature isolation** - Changes to one feature don't affect others
- **Easy to understand** - New developers immediately see what each feature needs
- **No wasted space** - No unused fields in any row
- **Custom indexes per feature** - Optimize each table for its specific queries

### Cons ❌
- **Lots of tables** - 10 features = 10 tables (but is this really a problem?)
- **Code duplication** - Need separate service class for each table
- **Harder to query across features** - "Show me all my jobs" requires UNION
- **UnifiedFeed complexity** - Needs to query multiple tables
- **Migrations** - Adding common fields (like user_id) requires updating all tables

### Best For
- Platforms where features are **very different** from each other
- When features have **complex, unique schemas**
- When you want **maximum clarity** and **feature independence**

---

## Option B: One Unified Job Table

Single `jobs` table with `output_type` field

### Structure Example

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),

  -- Feature identification
  feature_name TEXT NOT NULL,  -- 'img2img', 'style-transfer', 'lipsync-one', etc.
  output_type TEXT NOT NULL,   -- 'image', 'video', 'audio', 'text'

  -- Status tracking
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_seconds INT,

  -- Flexible inputs/outputs
  inputs JSONB,      -- All input parameters
  outputs JSONB,     -- All output information
  metadata JSONB,    -- Feature-specific metadata

  -- Results
  result_urls TEXT[],  -- Array of result URLs

  -- ComfyUI integration
  comfy_job_id TEXT UNIQUE,
  comfy_url TEXT,

  -- Error handling
  error_message TEXT,

  -- Indexes
  CREATE INDEX idx_jobs_user_id ON jobs(user_id);
  CREATE INDEX idx_jobs_feature_name ON jobs(feature_name);
  CREATE INDEX idx_jobs_output_type ON jobs(output_type);
  CREATE INDEX idx_jobs_status ON jobs(status);
  CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
);
```

### Example Data

```json
// img2img job
{
  "id": "uuid-1",
  "feature_name": "img2img",
  "output_type": "image",
  "inputs": {
    "image_url": "https://...",
    "prompt": "turn into watercolor"
  },
  "outputs": {
    "image_url": "https://...",
    "width": 512,
    "height": 512
  },
  "result_urls": ["https://..."]
}

// lipsync job
{
  "id": "uuid-2",
  "feature_name": "lipsync-one",
  "output_type": "video",
  "inputs": {
    "image_url": "https://...",
    "audio_url": "https://...",
    "width": 640,
    "height": 360,
    "trim_to_audio": true
  },
  "outputs": {
    "video_url": "https://...",
    "duration_seconds": 10.5
  },
  "result_urls": ["https://..."]
}
```

### Pros ✅
- **Single source of truth** - One table for everything
- **Easy cross-feature queries** - "Show all my jobs" is simple
- **UnifiedFeed is trivial** - Just query one table
- **Easy to add features** - No schema changes needed
- **Consistent status tracking** - One set of status values
- **Global analytics** - Easy to see platform-wide metrics
- **One service class** - Reusable job service for all features

### Cons ❌
- **JSONB queries** - More complex queries for specific fields
- **Schema validation** - Need to validate JSONB structure in code
- **No type safety** - Database doesn't enforce field requirements per feature
- **Generic** - Less clear what fields each feature uses
- **Potentially slower** - JSONB indexing not as fast as regular columns
- **Large table** - All jobs in one table (could be millions of rows)

### Best For
- Platforms with **many similar features**
- When features share **common patterns**
- When you want **maximum flexibility** to add features quickly
- When **cross-feature analytics** are important

---

## Option C: One Table Per Output Type

`video_jobs`, `image_jobs`, `audio_jobs`, `text_jobs`

### Structure Example

```sql
CREATE TABLE image_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),

  -- Feature identification
  workflow_name TEXT NOT NULL,  -- 'img2img', 'style-transfer', 'image-edit'

  -- Status tracking
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  processing_time_seconds INT,

  -- Common image inputs
  input_image_urls TEXT[],  -- Array of input images
  prompt TEXT,

  -- Common image outputs
  output_image_urls TEXT[],  -- Array of output images
  width INT,
  height INT,

  -- Feature-specific parameters
  parameters JSONB,  -- For unique params per workflow

  -- ComfyUI integration
  comfy_job_id TEXT,
  comfy_url TEXT,

  -- Error handling
  error_message TEXT,

  CREATE INDEX idx_image_jobs_workflow_name ON image_jobs(workflow_name);
  CREATE INDEX idx_image_jobs_user_id ON image_jobs(user_id);
);

CREATE TABLE video_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),

  -- Feature identification
  workflow_name TEXT NOT NULL,  -- 'lipsync-one', 'lipsync-multi', 'wan-i2v'

  -- Status tracking
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  processing_time_seconds INT,

  -- Common video inputs
  input_image_urls TEXT[],
  input_audio_urls TEXT[],
  input_video_urls TEXT[],

  -- Common video outputs
  output_video_urls TEXT[],
  width INT,
  height INT,
  fps INT,
  duration_seconds FLOAT,

  -- Feature-specific parameters
  parameters JSONB,

  -- ComfyUI integration
  comfy_job_id TEXT,
  comfy_url TEXT,

  -- Error handling
  error_message TEXT,

  CREATE INDEX idx_video_jobs_workflow_name ON video_jobs(workflow_name);
  CREATE INDEX idx_video_jobs_user_id ON video_jobs(user_id);
);

CREATE TABLE audio_jobs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),

  -- Feature identification
  workflow_name TEXT NOT NULL,  -- Future audio features

  -- Status tracking
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Common audio inputs/outputs
  input_audio_urls TEXT[],
  output_audio_urls TEXT[],
  duration_seconds FLOAT,
  sample_rate INT,

  -- Feature-specific parameters
  parameters JSONB,

  -- ComfyUI integration
  comfy_job_id TEXT,
  comfy_url TEXT,

  -- Error handling
  error_message TEXT
);
```

### Example Data

```sql
-- img2img in image_jobs
INSERT INTO image_jobs VALUES (
  id: 'uuid-1',
  workflow_name: 'img2img',
  input_image_urls: ['https://input.png'],
  output_image_urls: ['https://output.png'],
  prompt: 'turn into watercolor',
  parameters: '{"strength": 0.8}'
);

-- style-transfer in image_jobs
INSERT INTO image_jobs VALUES (
  id: 'uuid-2',
  workflow_name: 'style-transfer',
  input_image_urls: ['https://source.png', 'https://style.png'],
  output_image_urls: ['https://result.png'],
  prompt: 'apply style',
  parameters: '{}'
);

-- lipsync in video_jobs
INSERT INTO video_jobs VALUES (
  id: 'uuid-3',
  workflow_name: 'lipsync-one',
  input_image_urls: ['https://portrait.png'],
  input_audio_urls: ['https://voice.mp3'],
  output_video_urls: ['https://video.mp4'],
  width: 640,
  height: 360,
  duration_seconds: 10.5,
  parameters: '{"trim_to_audio": true}'
);
```

### Pros ✅
- **Balanced approach** - Not too many tables, not too few
- **Output-focused** - Grouped by what users care about (videos, images)
- **Common fields per type** - Images all have width/height, videos have fps/duration
- **Easy filtering** - "Show me all image generations" is simple
- **Moderate code reuse** - 4 service classes instead of 10+
- **Type-appropriate indexes** - Optimize for output type (e.g., duration for videos)
- **UnifiedFeed moderate** - Query 2-3 tables instead of 10+

### Cons ❌
- **Mixed workflows** - img2img, style-transfer, image-edit all in same table
- **Some JSONB needed** - Still need parameters field for unique features
- **Cross-type queries harder** - "All my jobs" requires UNION
- **Output type ambiguity** - What if a feature produces both image AND video?
- **Not as clear as Option A** - Multiple workflows share same table

### Best For
- Platforms where **output type is the primary concern**
- When features of the same output type have **similar schemas**
- When you want **balance between clarity and simplicity**
- When **users think in terms of output types**

---

## Deep Comparison

| Criterion | Option A: Per Feature | Option B: Unified | Option C: Per Output Type |
|-----------|----------------------|-------------------|--------------------------|
| **Tables needed (for 10 features)** | 10 tables | 1 table | 3-4 tables |
| **Schema clarity** | ⭐⭐⭐⭐⭐ Perfect | ⭐⭐ Generic | ⭐⭐⭐⭐ Good |
| **Type safety** | ⭐⭐⭐⭐⭐ Full | ⭐⭐ JSONB only | ⭐⭐⭐⭐ Most fields |
| **Query simplicity (single feature)** | ⭐⭐⭐⭐⭐ Trivial | ⭐⭐⭐ Filter needed | ⭐⭐⭐⭐ Filter needed |
| **Query simplicity (all jobs)** | ⭐⭐ UNION needed | ⭐⭐⭐⭐⭐ Simple | ⭐⭐⭐ UNION needed |
| **Adding new features** | ⭐⭐⭐ New table + migration | ⭐⭐⭐⭐⭐ Just code | ⭐⭐⭐⭐ Might reuse table |
| **Code reusability** | ⭐⭐ Low (many services) | ⭐⭐⭐⭐⭐ High (one service) | ⭐⭐⭐⭐ Moderate |
| **Storage efficiency** | ⭐⭐⭐⭐⭐ No wasted columns | ⭐⭐⭐ JSONB overhead | ⭐⭐⭐⭐ Some nulls |
| **UnifiedFeed complexity** | ⭐⭐ Complex (many queries) | ⭐⭐⭐⭐⭐ Simple | ⭐⭐⭐ Moderate |
| **Migration effort** | ⭐⭐ High (current state → this) | ⭐⭐⭐ Moderate | ⭐⭐⭐ Moderate |
| **Future scalability** | ⭐⭐⭐ Good (if features differ) | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐ Very good |

---

## Recommendation Based on sideOUTsticks Context

Looking at your current features:

**Video Outputs:**
- Lipsync 1 Person
- Lipsync Multi Person
- Video Lipsync
- WAN I2V

**Image Outputs:**
- img2img
- Style Transfer
- Image Edit

**Text/Data Outputs:**
- Character Caption (creates datasets)

### 🏆 I Recommend: **Option C (One Table Per Output Type)**

**Why:**

1. **Natural grouping** - Your features naturally cluster by output type
2. **User perspective** - Users think "I want to generate a video" or "I want to edit an image"
3. **Shared optimization** - All video jobs need similar performance tuning
4. **Moderate complexity** - 3-4 tables is manageable, not overwhelming
5. **Flexible enough** - JSONB `parameters` field handles unique features
6. **Growth ready** - Adding a new image feature doesn't need a new table

### Proposed Tables

```sql
-- For img2img, style-transfer, image-edit, future image workflows
CREATE TABLE image_jobs (...);

-- For lipsync-one, lipsync-multi, video-lipsync, wan-i2v, future video workflows
CREATE TABLE video_jobs (...);

-- For character-caption, future text/data workflows
CREATE TABLE text_jobs (...);

-- Optional: audio_jobs for future audio-only features
CREATE TABLE audio_jobs (...);
```

### Implementation Details

**Service Architecture:**
```
backend/services/
├── image_job_service.py    # Handles all image workflows
├── video_job_service.py    # Handles all video workflows
└── text_job_service.py     # Handles all text/data workflows
```

**UnifiedFeed Query:**
```typescript
// Get all user jobs across output types
const [imageJobs, videoJobs] = await Promise.all([
  apiClient.getImageJobs(userId, workflowName),
  apiClient.getVideoJobs(userId, workflowName)
]);

// Merge and sort by created_at
const allJobs = [...imageJobs, ...videoJobs].sort(...)
```

---

## Questions to Decide

1. **Do you agree with Option C?** Or do you prefer A or B?

2. **Output type edge cases:**
   - What if a future feature generates BOTH image and video?
   - Solution: Pick primary output type, or store both job IDs

3. **Workflow naming:**
   - Use existing: 'img2img', 'lipsync-one', 'style-transfer'?
   - Or standardize: 'image-to-image', 'lipsync-single', 'style-transfer'?

4. **Migration path:**
   - Current: `multitalk_jobs`, `style_transfers`, `edited_images`, `datasets`
   - Target: `video_jobs`, `image_jobs`, `text_jobs`
   - Migrate immediately or gradual transition?

---

## Next Steps (If you choose Option C)

1. **Create new tables**
   - `video_jobs` (migrate from `multitalk_jobs`)
   - `image_jobs` (migrate from `style_transfers`, `edited_images`, add `img2img`)
   - `text_jobs` (migrate from `datasets`)

2. **Update services**
   - Create `ImageJobService`, `VideoJobService`, `TextJobService`
   - Reuse common logic via base class

3. **Update frontend**
   - Update UnifiedFeed to query multiple tables
   - Add output type filter

4. **Migration script**
   - Copy existing data to new tables
   - Add workflow_name field
   - Keep old tables for rollback

What do you think? Which option feels right for sideOUTsticks?
