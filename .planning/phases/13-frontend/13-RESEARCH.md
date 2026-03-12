# Phase 13: Frontend - Research

**Researched:** 2026-03-11
**Domain:** React frontend for batch video upscale: multi-file upload, video queue UI, status polling, batch history, navigation integration
**Confidence:** HIGH

## Summary

Phase 13 builds the complete frontend for the Batch Video Upscale feature. The backend API surface is fully built across Phases 10-12: 11 endpoints under `/api/upscale/*` covering batch CRUD, video management, queue reorder, resume/retry, and ZIP download. The frontend must create a new page component, add apiClient methods for all backend endpoints, implement multi-file upload with client-side validation, build the batch queue UI with real-time status polling, and integrate the page into the existing studio navigation system.

The existing codebase provides strong patterns for every frontend concern. The app uses a studio-based navigation system (`studioConfig.ts` defines studios with nested apps, `StudioPage.tsx` renders them via a component map, `App.tsx` conditionally renders pages). Feature pages follow a consistent layout: Section/Field/Label UI primitives, ResizableFeedSidebar for generation history, gradient-based styling with dark mode support. The existing `VideoUpscale.tsx` page (ComfyUI-based single-video upscaler) lives in the Video Studio and provides styling patterns, but the batch upscale is a fundamentally different UX -- it is a standalone page with its own batch creation/management flow, not a ComfyUI workflow submission.

**Primary recommendation:** Build in order: (1) apiClient methods for all 11 backend endpoints, (2) BatchVideoUpscale page component with upload + settings + queue UI, (3) status polling with interval-based batch detail refresh, (4) batch history feed, (5) navigation integration (studioConfig + App.tsx + Homepage). The page is a new standalone app within Video Studio.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPLD-01 | User can upload multiple video files via file picker or drag-and-drop | Multi-file input with `multiple` + drag-and-drop zone; files uploaded to Supabase via new backend endpoint, then added to batch via `POST /upscale/batches/{id}/videos` |
| UPLD-02 | System validates video format (MP4, MOV, AVI, WebM) and shows clear error for invalid files | Client-side `accept` attribute + JavaScript validation of file.type before upload; reject with inline error message |
| UPLD-03 | System shows preview thumbnail, filename, duration, resolution, and file size for each queued video | Use `<video>` element for metadata extraction (duration, videoWidth, videoHeight) and canvas-based thumbnail generation (pattern from `useVideoThumbnail` hook) |
| UPLD-04 | System warns user if video exceeds Freepik duration/size limits before submission | Client-side checks: >15s duration, >150MB file size; show yellow warning badge per video; do NOT block submission (backend is authoritative) |
| STAT-01 | Each video displays its current status with visual indicator (pending/processing/completed/failed/paused) | Color-coded status badges; poll `GET /upscale/batches/{id}` every 3-5 seconds during processing |
| STAT-02 | Batch summary shows total, completed, processing, pending, and failed counts with progress bar | Derive from `UpscaleBatch` response: `total_videos`, `completed_videos`, `failed_videos`; calculate pending from difference |
| STAT-03 | Estimated time remaining displayed after at least one video completes | Track completion timestamps client-side; calculate average processing time per video; multiply by remaining count |
| STAT-04 | User can view past batches grouped in a feed/history view | Call `GET /upscale/batches` to list all user batches; render as collapsible cards sorted by creation date |
| STAT-05 | User can re-run a past batch with the same settings | Read settings from past batch response; pre-fill the settings form; user still needs to upload new videos |
| INFR-03 | New feature page linked from homepage, accessible to all authenticated users | Add `batch-upscale` app to `video-studio` in `studioConfig.ts`; add component to `StudioPage.tsx` app map |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.1.1 (installed) | Component framework | Already the app framework |
| TypeScript | 5.8.3 (installed) | Type safety | Already configured project-wide |
| TailwindCSS | 3.4.17 (installed) | Styling | Already the styling system with dark mode support |
| apiClient | Existing singleton | Backend API communication | All API calls go through `apiClient.request()` with auth token, retry, and token refresh |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| useVideoThumbnail hook | Existing | Generate video thumbnails from URLs | For preview thumbnails in the queue list |
| ResizableFeedSidebar | Existing component | History/feed sidebar | NOT used for batch upscale -- the page has its own built-in batch history panel |
| useAuth context | Existing | Get current user ID | For batch ownership and API auth |
| useProject context | Existing | Get selected Google Drive project | For optional Drive upload association |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Interval polling for status | WebSocket | Overkill; batch processing is slow (minutes per video), 3-5s polling is fine. No WS infrastructure exists for custom events |
| Inline batch history | Separate page | Batch history is small (10-50 items); inline is more convenient. Separate page adds navigation complexity |
| Client-side Supabase upload | Backend upload endpoint | Client has no Supabase client (removed per architecture). All storage goes through backend API |

**Installation:**
```bash
# No new packages needed -- everything is already installed
```

## Architecture Patterns

### Recommended Project Structure

```
frontend/src/
├── pages/
│   └── BatchVideoUpscale.tsx      # Main page component (~500-700 lines)
├── lib/
│   └── apiClient.ts               # + 8-10 new methods for /upscale/* endpoints
├── components/
│   └── StudioPage.tsx             # + import and map entry for batch-upscale
└── lib/
    └── studioConfig.ts            # + new app entry in video-studio
```

### Pattern 1: API Client Methods for Batch Upscale

**What:** Add typed methods to the existing `ApiClient` class for all 11 backend endpoints.
**When to use:** All communication with `/upscale/*` endpoints.
**Example:**
```typescript
// Source: existing apiClient.ts patterns (request method with auth)

// Types matching backend Pydantic models
interface UpscaleSettings {
  resolution: '1k' | '2k' | '4k';
  creativity: number;
  sharpen: number;
  grain: number;
  fps_boost: boolean;
  flavor: 'vivid' | 'natural';
}

interface UpscaleBatch {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  resolution: string;
  creativity: number;
  sharpen: number;
  grain: number;
  fps_boost: boolean;
  flavor: string;
  project_id: string | null;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  videos: UpscaleVideo[];
}

interface UpscaleVideo {
  id: string;
  batch_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
  queue_position: number;
  input_filename: string;
  input_storage_url: string;
  output_storage_url: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Methods to add to ApiClient class:
async createUpscaleBatch(settings: UpscaleSettings, projectId?: string) {
  return this.request('/upscale/batches', {
    method: 'POST',
    body: JSON.stringify({ settings, project_id: projectId || null }),
  });
}

async addVideoToBatch(batchId: string, payload: {
  input_filename: string;
  input_storage_url: string;
  input_file_size?: number;
  duration_seconds?: number;
  width?: number;
  height?: number;
}) {
  return this.request(`/upscale/batches/${batchId}/videos`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async startBatch(batchId: string) {
  return this.request(`/upscale/batches/${batchId}/start`, { method: 'POST' });
}

async getBatchDetail(batchId: string) {
  return this.request(`/upscale/batches/${batchId}`);
}

async listBatches() {
  return this.request('/upscale/batches');
}

async resumeBatch(batchId: string) {
  return this.request(`/upscale/batches/${batchId}/resume`, { method: 'POST' });
}

async retryVideo(batchId: string, videoId: string) {
  return this.request(`/upscale/batches/${batchId}/videos/${videoId}/retry`, { method: 'POST' });
}

async reorderBatchQueue(batchId: string, videoIds: string[]) {
  return this.request(`/upscale/batches/${batchId}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ video_ids: videoIds }),
  });
}

async createZipDownload(batchId: string) {
  return this.request(`/upscale/batches/${batchId}/download-zip`, { method: 'POST' });
}

async getZipJobStatus(jobId: string) {
  return this.request(`/upscale/zip-jobs/${jobId}/status`);
}

// Note: ZIP download is a direct fetch (binary), not JSON
async downloadZip(jobId: string): Promise<Blob> {
  const token = this.getAuthToken();
  const response = await fetch(`${this.baseURL}/upscale/zip-jobs/${jobId}/download`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Download failed');
  return response.blob();
}
```

### Pattern 2: Video File Upload Flow

**What:** Upload raw video files from the browser to Supabase Storage via a new backend endpoint, then register them in the batch.
**When to use:** When user selects files for upscaling.
**Critical insight:** The backend `AddVideoPayload` requires `input_storage_url` (a Supabase public URL). There is currently NO backend endpoint for uploading raw video files to Supabase (existing endpoints only download from ComfyUI URLs). Phase 13 MUST create a new backend endpoint.

**Example:**
```typescript
// NEW backend endpoint needed: POST /upscale/upload-video (multipart form)
// Accepts: video file + batch_id
// Returns: { success: true, storage_url: "https://...supabase.co/..." }

// Frontend flow:
async function uploadAndAddVideo(batchId: string, file: File, metadata: VideoMetadata) {
  // Step 1: Upload raw video to Supabase via backend
  const formData = new FormData();
  formData.append('file', file);
  formData.append('batch_id', batchId);

  const uploadResponse = await apiClient.uploadVideoForUpscale(formData);
  if (!uploadResponse.success) throw new Error(uploadResponse.error);

  // Step 2: Add video to batch with the storage URL
  await apiClient.addVideoToBatch(batchId, {
    input_filename: file.name,
    input_storage_url: uploadResponse.storage_url,
    input_file_size: file.size,
    duration_seconds: metadata.duration,
    width: metadata.width,
    height: metadata.height,
  });
}
```

### Pattern 3: Status Polling with useEffect + setInterval

**What:** Poll batch detail every 3-5 seconds while batch is processing; stop when terminal.
**When to use:** Active batch monitoring.
**Example:**
```typescript
// Source: Pattern derived from existing startJobMonitoring in utils.ts
useEffect(() => {
  if (!activeBatchId) return;

  const poll = async () => {
    const response = await apiClient.getBatchDetail(activeBatchId);
    if (response.success && response.batch) {
      setBatch(response.batch);
      // Stop polling when terminal
      if (['completed', 'failed', 'paused', 'cancelled'].includes(response.batch.status)) {
        clearInterval(intervalId);
      }
    }
  };

  poll(); // Initial fetch
  const intervalId = setInterval(poll, 4000); // 4 second interval

  return () => clearInterval(intervalId);
}, [activeBatchId]);
```

### Pattern 4: Client-Side Video Metadata Extraction

**What:** Extract duration, resolution, and file size from video files before upload.
**When to use:** Populating the queue list with metadata for UPLD-03/UPLD-04.
**Example:**
```typescript
interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  size: number;
  thumbnailUrl: string | null;
}

async function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      // Generate thumbnail
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      video.currentTime = 0.1; // seek to first frame
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        const thumbnailUrl = blob ? URL.createObjectURL(blob) : null;
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          size: file.size,
          thumbnailUrl,
        });
        URL.revokeObjectURL(video.src);
      }, 'image/jpeg', 0.7);
    };

    video.onerror = () => reject(new Error('Failed to load video metadata'));
    video.src = URL.createObjectURL(file);
  });
}
```

### Pattern 5: Navigation Integration (Studio System)

**What:** Register the new page as an app within Video Studio.
**When to use:** Making the page accessible from sidebar and homepage.
**Example:**
```typescript
// In studioConfig.ts - add to video-studio apps array:
{
  id: 'batch-upscale',
  title: 'Batch Upscale',
  icon: '📦',
  gradient: 'from-amber-500 to-orange-600',
  description: 'Upscale multiple videos at once with Freepik AI. Configure settings, queue videos, and download results.',
  features: ['Multi-video batch processing', 'Queue management', 'API: Freepik Video Upscaler']
}

// In StudioPage.tsx - add to appComponents map:
import BatchVideoUpscale from '../pages/BatchVideoUpscale';
// ...
'batch-upscale': BatchVideoUpscale,
```

### Anti-Patterns to Avoid

- **Direct Supabase client from frontend:** The frontend has NO Supabase client. All storage operations MUST go through backend API endpoints.
- **ComfyUI workflow submission:** This feature does NOT use ComfyUI. It uses Freepik API through the backend `/upscale/*` endpoints. Do not import ComfyUI utilities.
- **UnifiedFeed/GenerationFeed for batch history:** The existing feed components track ComfyUI jobs. Batch upscale has its own data model (`upscale_batches` table) and needs its own inline history panel.
- **Creating job records in video_jobs table:** Batch upscale tracks jobs in `upscale_batches` + `upscale_videos` tables, not the general `video_jobs` table.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video metadata extraction | Custom FFMPEG/wasm parser | HTML5 `<video>` element + `loadedmetadata` event | Browser-native, zero dependencies, works for all supported formats |
| Thumbnail generation | Server-side thumbnail generation | Canvas API + video element seeked event | Already proven in `useVideoThumbnail` hook; no backend round-trip |
| File type validation | Regex on filename | `file.type` check + `accept` attribute on input | Browser provides MIME type; filename extensions can lie |
| Status badge colors | Custom color mapping | Tailwind utility classes with a status-to-color map object | Consistent with existing codebase patterns |
| Interval-based polling | Custom setTimeout chains | `setInterval` in `useEffect` with cleanup return | Standard React pattern; cleanup prevents memory leaks |
| Drag-and-drop file upload | Custom drag event handling | `onDragOver` + `onDrop` on a div with `e.dataTransfer.files` | Standard DOM API; simple 4-event pattern (dragenter, dragover, dragleave, drop) |
| Format human file sizes | Custom division logic | Utility function: `formatBytes(bytes)` | Already exists in `FileUpload.tsx` (lines 187-192); copy the pattern |
| Format duration | Custom time formatting | Utility function: `formatDuration(seconds)` | Simple `Math.floor(s/60):${s%60}` pattern |

## Common Pitfalls

### Pitfall 1: Missing Video Upload Endpoint

**What goes wrong:** The frontend tries to call `addVideoToBatch` with a file URL, but the backend requires `input_storage_url` -- a Supabase public URL. There is NO existing backend endpoint to upload raw video files to Supabase Storage (existing endpoints only download from ComfyUI).
**Why it happens:** Phases 10-12 assumed videos would already have storage URLs when added to the batch. The frontend is the first consumer and needs to create that URL.
**How to avoid:** Phase 13 MUST create a new backend endpoint: `POST /upscale/upload-video` that accepts a multipart form upload, stores the file in Supabase Storage (path: `upscale-inputs/{user_id}/{batch_id}/{filename}`), and returns the public URL. This endpoint is the bridge between "user selected a file" and "backend has a URL to process."
**Warning signs:** `input_storage_url` field in `AddVideoPayload` with no frontend mechanism to generate it.

### Pitfall 2: Polling After Unmount

**What goes wrong:** `setInterval` continues after component unmounts, causing "setState on unmounted component" errors.
**Why it happens:** Forgetting to return cleanup function from `useEffect`.
**How to avoid:** Always return `() => clearInterval(intervalId)` from polling useEffect. Also clear interval when batch reaches terminal state.
**Warning signs:** Console warnings about state updates on unmounted components.

### Pitfall 3: Video Metadata Extraction Fails Silently

**What goes wrong:** `video.onloadedmetadata` never fires for certain file formats, causing the metadata to show as "unknown" or "0".
**Why it happens:** Some browsers cannot decode certain codecs (e.g., AVI with DivX). The video element loads but cannot extract dimensions/duration.
**How to avoid:** Set a timeout (5 seconds). If metadata extraction fails, use `file.size` (always available) and show "N/A" for duration/resolution. Do NOT block the upload flow on metadata extraction failure.
**Warning signs:** Duration showing as 0, NaN, or Infinity.

### Pitfall 4: Large File Upload Timeout

**What goes wrong:** Uploading a 150MB video file to the backend times out (default 60s in apiClient).
**Why it happens:** The `apiClient.request()` method has a 60-second AbortController timeout. Large file uploads over slow connections can exceed this.
**How to avoid:** The video upload endpoint should use a direct `fetch` call (not `apiClient.request()`) with a longer timeout (300 seconds) or no timeout. Alternatively, add a progress callback using `XMLHttpRequest` for upload progress.
**Warning signs:** Network errors on large files; works fine for small test files.

### Pitfall 5: Stale Batch State During Concurrent Operations

**What goes wrong:** User clicks "retry" on a video while the polling interval is also fetching batch state. The UI flickers between old and new states.
**Why it happens:** Two concurrent requests return batch state at different points in time.
**How to avoid:** After any mutation (retry, resume, reorder), immediately refresh batch state and restart the polling interval. Use a "version" counter or timestamp to ignore stale responses.
**Warning signs:** Status badges flickering between states.

### Pitfall 6: Forgetting Dark Mode Classes

**What goes wrong:** New components look fine in light mode but are unreadable in dark mode.
**Why it happens:** Not including `dark:` variant Tailwind classes.
**How to avoid:** Every text color, background, and border MUST have a `dark:` variant. Follow the existing pattern in `VideoUpscale.tsx` which uses `dark:text-dark-text-primary`, `dark:bg-dark-surface-primary`, `dark:border-dark-border-primary` classes throughout.
**Warning signs:** White text on white background in dark mode.

## Code Examples

### Example 1: Status Badge Component

```typescript
// Source: Derived from existing status patterns in the codebase
const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
  processing: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500 animate-pulse' },
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  paused: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${colors.bg} ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
```

### Example 2: Drag-and-Drop Upload Zone

```typescript
// Source: Standard DOM drag-and-drop API
function DropZone({ onFilesAdded }: { onFilesAdded: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm'];

  function validateFiles(fileList: FileList): File[] {
    const valid: File[] = [];
    const invalid: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext)) {
        valid.push(file);
      } else {
        invalid.push(file.name);
      }
    }

    if (invalid.length > 0) {
      alert(`Invalid format: ${invalid.join(', ')}. Accepted: MP4, MOV, AVI, WebM`);
    }
    return valid;
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = validateFiles(e.dataTransfer.files);
        if (files.length) onFilesAdded(files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
        isDragging
          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
          : 'border-gray-300 dark:border-gray-600 hover:border-amber-400 dark:hover:border-amber-500 bg-gray-50/50 dark:bg-dark-surface-secondary/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            const files = validateFiles(e.target.files);
            if (files.length) onFilesAdded(files);
          }
          e.target.value = ''; // Reset for re-selection
        }}
      />
      <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
        {isDragging ? 'Drop videos here' : 'Drag & drop videos or click to browse'}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
        Accepted formats: MP4, MOV, AVI, WebM
      </p>
    </div>
  );
}
```

### Example 3: Progress Bar with Batch Summary

```typescript
// Source: Derived from batch data model
function BatchProgress({ batch }: { batch: UpscaleBatch }) {
  const pending = batch.total_videos - batch.completed_videos - batch.failed_videos;
  const progressPct = batch.total_videos > 0
    ? Math.round((batch.completed_videos / batch.total_videos) * 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          className="h-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Counts */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-4">
          <span className="text-green-600 dark:text-green-400 font-medium">
            {batch.completed_videos} completed
          </span>
          {batch.failed_videos > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              {batch.failed_videos} failed
            </span>
          )}
          <span className="text-gray-500 dark:text-gray-400">
            {pending} pending
          </span>
        </div>
        <span className="font-bold text-gray-800 dark:text-gray-200">
          {progressPct}%
        </span>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct page imports in App.tsx | Studio system with `studioConfig.ts` + `StudioPage.tsx` component map | Current codebase | New pages register as apps in studios, not as standalone conditionals in App.tsx |
| UnifiedFeed sidebar for all features | ResizableFeedSidebar per feature page | Current codebase | Batch upscale does NOT use the feed sidebar; it has its own batch-specific history panel |
| Frontend Supabase client for storage | Backend API for all storage operations | Current codebase (removed) | All file uploads MUST go through backend endpoints |

## Key Backend API Surface (Phase 10-12)

The following endpoints are available for the frontend to consume. All require JWT authentication via `Authorization: Bearer {token}` header.

| Method | Endpoint | Purpose | Request | Response |
|--------|----------|---------|---------|----------|
| POST | `/upscale/batches` | Create batch | `{ settings: UpscaleSettings, project_id?: string }` | `{ success, batch_id, status }` |
| POST | `/upscale/batches/{id}/videos` | Add video | `{ input_filename, input_storage_url, input_file_size?, duration_seconds?, width?, height? }` | `{ success, video_id }` |
| POST | `/upscale/batches/{id}/start` | Start processing | (empty) | `{ success, batch_id, status }` |
| GET | `/upscale/batches/{id}` | Get batch + videos | - | `{ success, batch: UpscaleBatch }` |
| GET | `/upscale/batches` | List user batches | - | `UpscaleBatch[]` |
| POST | `/upscale/batches/{id}/resume` | Resume paused batch | (empty) | `{ success, batch_id, status }` |
| POST | `/upscale/batches/{id}/videos/{vid}/retry` | Retry failed video | (empty) | `{ success, video_id, status }` |
| PATCH | `/upscale/batches/{id}/reorder` | Reorder queue | `{ video_ids: string[] }` | `{ success }` |
| POST | `/upscale/batches/{id}/download-zip` | Create ZIP job | (empty) | `{ success, job_id }` |
| GET | `/upscale/zip-jobs/{id}/status` | Poll ZIP progress | - | `{ status, progress_pct, files_done, total_files }` |
| GET | `/upscale/zip-jobs/{id}/download` | Download ZIP | - | Binary (application/zip) |

**Missing endpoint (must be created in Phase 13):**

| Method | Endpoint | Purpose | Request | Response |
|--------|----------|---------|---------|----------|
| POST | `/upscale/upload-video` | Upload raw video file to Supabase Storage | Multipart form: `file` + `batch_id` | `{ success, storage_url }` |

## Freepik Video Limits (for client-side validation)

| Constraint | Value | Source |
|------------|-------|--------|
| Max duration | 15 seconds | Freepik product page (MEDIUM) |
| Max frames | 450 | Freepik product page (MEDIUM) |
| Max file size | 150 MB | Freepik product page (MEDIUM) |
| Accepted formats | MP4, MOV, WebM | Freepik product page + project docs |
| Daily limits | Free: 10/day, Tier 1: 125/day | Freepik rate limits docs |

## Open Questions

1. **Video upload endpoint location**
   - What we know: The backend needs a new endpoint for raw file upload to Supabase Storage. Phase 13 must create it.
   - What's unclear: Should it live in `api/upscale.py` (keeps all upscale logic together) or `api/storage.py` (keeps all storage logic together)?
   - Recommendation: Put it in `api/upscale.py` since it's specific to the upscale workflow and needs auth. Pattern: `POST /upscale/upload-video` with `UploadFile` from FastAPI.

2. **Upload progress indication**
   - What we know: Large video files (up to 150MB) will take time to upload. The `apiClient.request()` method doesn't support progress callbacks.
   - What's unclear: Whether to use `XMLHttpRequest` for progress or just show an indeterminate spinner.
   - Recommendation: Use `XMLHttpRequest` with `upload.onprogress` for per-file upload progress bars. This is the established pattern for file uploads in the existing `FileUpload.tsx` component.

3. **Batch re-run semantics (STAT-05)**
   - What we know: User can "re-run" a past batch with the same settings. The settings (resolution, creativity, etc.) are stored on the batch record.
   - What's unclear: Does "re-run" mean creating a new batch with the same settings but requiring new video uploads, or does it re-process the same videos?
   - Recommendation: Create a new batch with the same settings pre-filled. The user must upload new videos (or the same videos again). The original videos' Supabase URLs may have been cleaned up. This is the safest interpretation.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 + @testing-library/react 16.3.2 |
| Config file | `frontend/vitest.config.ts` (check if exists, may need Wave 0 creation) |
| Quick run command | `cd frontend && npm test -- --run` |
| Full suite command | `cd frontend && npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPLD-01 | Multi-file upload via picker or drag-and-drop | unit | `npm test -- --run tests/BatchVideoUpscale.test.tsx` | Wave 0 |
| UPLD-02 | Format validation (MP4, MOV, AVI, WebM) | unit | Same file | Wave 0 |
| UPLD-03 | Preview thumbnail, filename, duration, resolution, file size | unit | Same file | Wave 0 |
| UPLD-04 | Warning for videos exceeding Freepik limits | unit | Same file | Wave 0 |
| STAT-01 | Color-coded status badges | unit | Same file | Wave 0 |
| STAT-02 | Batch progress bar with counts | unit | Same file | Wave 0 |
| STAT-03 | Estimated time remaining | unit | Same file | Wave 0 |
| STAT-04 | Past batches history feed | unit | Same file | Wave 0 |
| STAT-05 | Re-run past batch with same settings | unit | Same file | Wave 0 |
| INFR-03 | Page accessible from homepage/sidebar | manual-only | Verify studioConfig entry + StudioPage map | N/A |
| BACKEND | New upload-video endpoint | unit (backend) | `cd backend && pytest tests/test_upscale_api.py -x` | Extend existing |

### Sampling Rate

- **Per task commit:** `cd frontend && npm test -- --run` (if tests exist)
- **Per wave merge:** `cd frontend && npm run build` (build must succeed)
- **Phase gate:** Build succeeds + backend tests pass + manual verification of navigation

### Wave 0 Gaps

- [ ] `frontend/vitest.config.ts` -- verify exists; create if missing
- [ ] `frontend/src/__tests__/BatchVideoUpscale.test.tsx` -- covers UPLD-01 through STAT-05
- [ ] Backend test extension in `backend/tests/test_upscale_api.py` -- covers new upload-video endpoint

## Sources

### Primary (HIGH confidence)

- Existing codebase: `frontend/src/App.tsx`, `frontend/src/lib/studioConfig.ts`, `frontend/src/components/StudioPage.tsx` -- Navigation and studio system patterns
- Existing codebase: `frontend/src/pages/VideoUpscale.tsx` -- Feature page UI patterns with Section/Field/Label
- Existing codebase: `frontend/src/lib/apiClient.ts` -- API client patterns for authenticated requests
- Existing codebase: `frontend/src/hooks/useVideoThumbnail.ts` -- Video thumbnail generation pattern
- Existing codebase: `frontend/src/components/FileUpload.tsx` -- Multi-file upload queue UI pattern with progress
- Existing codebase: `backend/api/upscale.py` -- All 11 backend API endpoints
- Existing codebase: `backend/models/upscale.py` -- All Pydantic models defining API contracts

### Secondary (MEDIUM confidence)

- Phase 10-12 summaries -- Backend implementation decisions and patterns
- Freepik product page -- Video duration/size limits (15s, 150MB)

### Tertiary (LOW confidence)

- None -- all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and used in the project
- Architecture: HIGH -- all patterns verified against existing codebase (studioConfig, StudioPage, apiClient)
- Pitfalls: HIGH -- identified from actual code gaps (missing upload endpoint, timeout issues)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable; no external dependencies changing)
