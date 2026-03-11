# Phase 12: Output Delivery - Research

**Researched:** 2026-03-11
**Domain:** Supabase Storage upload, Google Drive upload, ZIP generation, httpx streaming
**Confidence:** HIGH

## Summary

Phase 12 adds the delivery pipeline after Freepik video upscaling completes. There are four requirements: auto-upload to Supabase Storage (DLVR-01), optional Google Drive upload (DLVR-02), individual video download (DLVR-03), and batch ZIP download (DLVR-04). The existing codebase already has all the building blocks -- `StorageService.upload_video_from_url()` downloads from a URL and uploads to Supabase, `GoogleDriveService.upload_file()` pushes bytes to Drive, and the HF download service demonstrates the in-memory background job pattern needed for ZIP generation.

The key technical finding is that the Supabase Python SDK (`storage3` v2.27.1) accepts `bytes`, `BufferedReader`, `FileIO`, `str`, or `Path` for uploads -- it does NOT support streaming/chunked uploads. The entire video file must be buffered in memory for the Supabase upload call. For upscaled videos (typically 50-200 MB), this is acceptable on a server with 512MB+ RAM (Heroku standard dynos have 512MB). The httpx `AsyncClient.stream()` method can download from Freepik in chunks, but the Supabase upload itself requires the full buffer. Given this constraint, download-then-upload-as-bytes is the correct approach (matching the existing `upload_video_from_url` pattern).

**Primary recommendation:** Extend `_process_single_video` to add Supabase upload + Google Drive upload steps after the `status == "COMPLETED"` block. Use the existing `StorageService.upload_video_from_url()` pattern (adapted for Freepik URLs), store public URLs via `get_public_url()`, and add a new `/upscale/batches/{batch_id}/download-zip` endpoint using the in-memory job store pattern from `hf_download_service.py`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Upload to Supabase Storage happens **inline after each video completes** -- right after Freepik returns COMPLETED, before moving to next video
- Google Drive upload also happens **inline per video** -- right after Supabase upload for each video, files appear in Drive progressively
- No post-batch sweep needed; delivery is part of the per-video processing pipeline
- If Supabase upload fails: video stays **completed** (upscaling succeeded), `supabase_upload_status='failed'`, Freepik temp URL preserved in `output_storage_url` temporarily
- If Google Drive upload fails: video stays **completed**, `drive_upload_status='failed'` -- Drive is optional delivery, never fails the video
- No retry logic for upload failures in this phase
- ZIP is **generated on demand** when user clicks "Download All" -- no pre-built ZIP in storage
- Filenames in ZIP use **original filenames with `_upscaled` suffix** (e.g., `my_video_upscaled.mp4`)
- Due to Heroku 30-second timeout: ZIP creation runs as a **background job with polling** -- backend returns job ID, frontend polls until ready, then downloads
- ZIP endpoint requires **standard JWT authentication** (no temporary tokens)
- Upscaled videos use **public URLs** (permanent, no expiration) -- store once, always accessible
- Videos stored in **existing `multitalk-videos` bucket** (not a new bucket) with a subfolder prefix to distinguish from ComfyUI outputs
- Individual video download (DLVR-03): **direct Supabase URL** -- frontend already has `output_storage_url` from batch detail response, no backend proxy needed

### Claude's Discretion
- Storage path structure within `multitalk-videos` bucket (user prefers Claude decides)
- Google Drive subfolder naming convention within the project folder
- Exact ZIP background job implementation (in-memory store like HF downloads, or DB-backed)
- Whether to use httpx streaming for Freepik download or full-buffer (based on file sizes)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DLVR-01 | Completed upscaled videos automatically saved to Supabase Storage | Adapt existing `upload_video_from_url` pattern: httpx download from Freepik output URL, then Supabase `.upload()` with bytes. Use `get_public_url()` for permanent URL. Store in `multitalk-videos` bucket with `upscaled/` prefix path. |
| DLVR-02 | If Google Drive project is selected, completed videos also uploaded to the project folder | Use existing `GoogleDriveService.get_or_create_folder()` + `upload_file()`. Video bytes already in memory from Supabase upload step. Create subfolder named after batch. |
| DLVR-03 | User can download individual completed videos from the UI | Frontend already receives `output_storage_url` (Supabase public URL) in batch detail response. No backend work needed -- frontend just opens the URL. |
| DLVR-04 | User can download all completed videos from a batch as a ZIP file | New endpoint `/upscale/batches/{batch_id}/download-zip` using background job pattern (in-memory job store). Download all completed video URLs, create ZIP in memory, return as StreamingResponse. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | (installed) | Async HTTP client for downloading Freepik output URLs | Already used throughout the codebase for HTTP operations |
| storage3 | 2.27.1 | Supabase Storage upload via `supabase.storage.from_().upload()` | Already the storage library in the project |
| google-api-python-client | (installed) | Google Drive file upload via `MediaInMemoryUpload` | Already used by `GoogleDriveService` |
| zipfile | stdlib | ZIP archive creation | Python standard library, no install needed |
| io.BytesIO | stdlib | In-memory buffer for ZIP and video bytes | Python standard library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| asyncio | stdlib | `asyncio.to_thread` for blocking Supabase/Drive calls | Wrapping sync SDK calls in async context |
| uuid | stdlib | Generate unique storage paths and ZIP job IDs | Storage path uniqueness and job tracking |
| concurrent.futures.ThreadPoolExecutor | stdlib | `_supabase_executor` for Supabase operations | Existing pattern for Supabase thread pool |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Full-buffer download | httpx streaming download | Supabase SDK requires full bytes anyway; streaming download adds complexity without benefit since we buffer for upload |
| In-memory ZIP job store | Database-backed job store | In-memory is simpler, matches HF download pattern, acceptable for single-dyno deployment |
| TUS resumable upload | Standard Supabase upload | TUS is for reliability on unreliable connections; server-to-server uploads are reliable enough |

**Installation:**
No new packages needed. All dependencies already installed.

## Architecture Patterns

### Recommended Changes

```
backend/
├── api/
│   └── upscale.py               # MODIFY: add delivery steps + ZIP endpoint
├── services/
│   ├── storage_service.py        # MODIFY: add upload_video_from_url_to_public()
│   ├── google_drive_service.py   # NO CHANGE: already has upload_file() + get_or_create_folder()
│   └── upscale_job_service.py    # MODIFY: add update methods for upload status fields
├── models/
│   └── upscale.py                # MODIFY: add ZIP job models, extend UpscaleVideo response
```

### Pattern 1: Inline Delivery After Completion

**What:** After Freepik returns COMPLETED, immediately download the output and upload to Supabase + Drive before processing the next video.

**When to use:** Always -- this is the locked decision from CONTEXT.md.

**Example:**
```python
# In _process_single_video, after status == "COMPLETED" block:

if status == "COMPLETED":
    # Step 1: Download from Freepik and upload to Supabase
    supabase_url = None
    try:
        storage = StorageService()
        success, public_url, error = await storage.upload_upscaled_video(
            source_url=output_url,
            batch_id=batch["id"],
            original_filename=video["input_filename"],
        )
        if success:
            supabase_url = public_url
            await job_service.update_video_upload_status(
                video_id, supabase_upload_status="completed",
                output_storage_url=public_url,
            )
        else:
            await job_service.update_video_upload_status(
                video_id, supabase_upload_status="failed",
                output_storage_url=output_url,  # preserve Freepik temp URL
            )
    except Exception as e:
        await job_service.update_video_upload_status(
            video_id, supabase_upload_status="failed",
            output_storage_url=output_url,
        )

    # Step 2: Google Drive upload (optional, never fails the video)
    if batch.get("project_id"):
        try:
            drive = GoogleDriveService()
            # ... upload to Drive subfolder
            await job_service.update_video_upload_status(
                video_id, drive_upload_status="completed",
                output_drive_file_id=file_id,
            )
        except Exception:
            await job_service.update_video_upload_status(
                video_id, drive_upload_status="failed",
            )
    else:
        await job_service.update_video_upload_status(
            video_id, drive_upload_status="skipped",
        )

    # Step 3: Mark video completed (already done above in existing code)
    await job_service.update_video_status(video_id, "completed", output_url=supabase_url or output_url)
    await job_service.increment_completed_count(batch_id)
```

### Pattern 2: Background ZIP Job (In-Memory Store)

**What:** ZIP generation runs as a background task with an in-memory job store, following the exact same pattern as `hf_download_service.py`.

**When to use:** For the DLVR-04 batch ZIP download.

**Example:**
```python
# In-memory job store (same pattern as HF downloads)
_ZIP_JOBS: dict[str, dict] = {}

def create_zip_job(batch_id: str) -> str:
    job_id = str(uuid.uuid4())
    _ZIP_JOBS[job_id] = {
        "status": "pending",
        "batch_id": batch_id,
        "progress": 0,
        "total_files": 0,
        "error": None,
        "zip_bytes": None,  # holds the completed ZIP
    }
    return job_id

def get_zip_job(job_id: str) -> Optional[dict]:
    return _ZIP_JOBS.get(job_id)

# API endpoints:
# POST /upscale/batches/{batch_id}/download-zip -> returns { job_id }
# GET /upscale/zip-jobs/{job_id}/status -> returns { status, progress }
# GET /upscale/zip-jobs/{job_id}/download -> StreamingResponse with ZIP bytes
```

### Pattern 3: Storage Path Structure

**What:** Use `upscaled/{user_id}/{batch_id}/{original_name}_upscaled.mp4` as the storage path in the `multitalk-videos` bucket.

**When to use:** For all DLVR-01 uploads.

**Rationale:**
- `upscaled/` prefix separates from existing ComfyUI outputs (which use `videos/YYYY-MM-DD/`)
- `user_id` prevents cross-user collisions
- `batch_id` groups batch outputs together
- `{original_name}_upscaled.mp4` preserves the original filename with an upscaled suffix (matches ZIP naming convention)

### Pattern 4: Google Drive Subfolder Naming

**What:** Create a subfolder named `Upscaled - {YYYY-MM-DD}` within the project folder.

**When to use:** For DLVR-02 when a project_id is set on the batch.

**Rationale:**
- Date-based naming avoids collisions across multiple batches
- "Upscaled" prefix clearly identifies content type
- Uses existing `get_or_create_folder()` which handles deduplication (finds existing folder if already created)

### Anti-Patterns to Avoid
- **Streaming Supabase upload:** The Python SDK does not support it. Do not try to pipe httpx chunks to Supabase -- buffer the full video first.
- **Pre-building ZIP on batch completion:** User decision is on-demand only. Do not add ZIP creation to the batch completion flow.
- **Failing video on upload failure:** User decision: upload failure does NOT fail the video. The video status stays "completed".
- **Creating a new Supabase bucket:** User decision: use existing `multitalk-videos` bucket with prefix.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video download from URL | Custom HTTP downloader | `StorageService._get_fresh_http_client()` + httpx | Already handles timeouts, redirects, connection pooling |
| Supabase upload | Direct REST API calls | `supabase.storage.from_().upload()` via thread pool | SDK handles auth, headers, multipart |
| Public URL generation | URL string concatenation | `supabase.storage.from_().get_public_url()` | Client-side URL construction, no API call, handles edge cases |
| Drive folder creation | Manual API calls | `GoogleDriveService.get_or_create_folder()` | Already handles find-or-create, shared drive support |
| Drive file upload | Custom upload code | `GoogleDriveService.upload_file()` | Already handles `MediaInMemoryUpload`, shared drive support |
| Background job tracking | Custom queue/celery | In-memory dict (`_ZIP_JOBS`) | Matches HF download pattern, sufficient for single-dyno |
| ZIP archive creation | Manual byte concatenation | `zipfile.ZipFile` + `io.BytesIO` | Standard library, handles compression, cross-platform |

**Key insight:** Every building block already exists in the codebase. This phase is primarily about wiring existing services together in the right order within `_process_single_video`, plus one new ZIP endpoint.

## Common Pitfalls

### Pitfall 1: Supabase Upload Memory Pressure
**What goes wrong:** Downloading a 200MB video into memory and then uploading it can cause memory issues on constrained dynos.
**Why it happens:** Supabase Python SDK requires full bytes for upload (no streaming). The video is buffered twice (download + upload).
**How to avoid:** Use `_get_fresh_http_client()` (separate from connection pool) with a generous timeout. Delete the bytes reference immediately after upload to allow GC. Process one video at a time (already enforced by sequential processing).
**Warning signs:** Heroku R14 (Memory quota exceeded) errors in logs.

### Pitfall 2: Freepik Temp URL Expiration
**What goes wrong:** Freepik output URLs are temporary (typically expire in hours). If Supabase upload fails and the temp URL is stored, it will stop working.
**Why it happens:** The CONTEXT.md says to preserve the Freepik URL in `output_storage_url` on upload failure. But this URL will expire.
**How to avoid:** This is an accepted trade-off per the locked decisions ("no retry logic for upload failures in this phase"). The temp URL gives a window for manual recovery. Future phases can add retry.
**Warning signs:** Users clicking download and getting 404s on old failed-upload videos.

### Pitfall 3: Heroku 30-Second Timeout on ZIP Generation
**What goes wrong:** ZIP endpoint times out because downloading multiple videos + creating ZIP exceeds 30 seconds.
**Why it happens:** Heroku terminates web requests after 30 seconds with no response.
**How to avoid:** Use the background job pattern (locked decision). POST returns job_id immediately (<1s). Frontend polls status. GET download only fires when ZIP is ready.
**Warning signs:** H12 timeout errors in Heroku logs.

### Pitfall 4: ZIP Memory Explosion
**What goes wrong:** 10 upscaled videos at 200MB each = 2GB in memory for ZIP creation.
**Why it happens:** All video bytes plus the ZIP archive itself must be in memory simultaneously.
**How to avoid:** Download each video, write to ZIP incrementally (use `zipfile.ZipFile.writestr()` one file at a time), then release the video bytes before downloading the next one. The final ZIP buffer will be large but the intermediate memory is bounded.
**Warning signs:** Worker process OOM kills, Heroku R15 errors.

### Pitfall 5: Race Condition on ZIP Job Cleanup
**What goes wrong:** ZIP jobs accumulate in the `_ZIP_JOBS` dict, consuming memory indefinitely.
**Why it happens:** No cleanup mechanism for completed/downloaded ZIP jobs.
**How to avoid:** Add a TTL-based cleanup: delete jobs older than 10 minutes on each new job creation. Or delete the job after successful download.
**Warning signs:** Gradually increasing memory usage over time.

### Pitfall 6: Google Drive Upload Without Credentials
**What goes wrong:** `GoogleDriveService.__init__()` silently sets `self.drive = None` when Drive is not configured. Upload then fails.
**Why it happens:** Not all deployments have Google Drive configured.
**How to avoid:** Check `is_drive_configured()` before attempting upload. Set `drive_upload_status='skipped'` when Drive is not configured.
**Warning signs:** "Google Drive not configured" errors in logs even though project_id is set.

## Code Examples

### Example 1: Upload Upscaled Video to Supabase Storage (Public URL)

```python
# Source: Adapted from StorageService.upload_video_from_url() in storage_service.py
async def upload_upscaled_video(
    self,
    source_url: str,
    user_id: str,
    batch_id: str,
    original_filename: str,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """Download video from Freepik and upload to Supabase with public URL."""
    try:
        # Download from Freepik output URL
        client = await self._get_fresh_http_client(timeout=300.0)
        async with client:
            response = await client.get(source_url)
            if response.status_code != 200:
                raise Exception(f"Download failed: HTTP {response.status_code}")
            video_content = response.content

        if len(video_content) == 0:
            raise Exception("Downloaded video is empty")

        # Build storage path
        name_stem = Path(original_filename).stem
        storage_path = f"upscaled/{user_id}/{batch_id}/{name_stem}_upscaled.mp4"

        # Upload to Supabase via thread pool
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            _supabase_executor,
            lambda: self.supabase.storage
            .from_('multitalk-videos')
            .upload(
                storage_path,
                video_content,
                file_options={
                    'content-type': 'video/mp4',
                    'cache-control': '3600',
                    'upsert': 'true'
                }
            )
        )

        # Get public URL (client-side construction, no API call)
        public_url = self.supabase.storage.from_('multitalk-videos').get_public_url(storage_path)

        return True, public_url, None

    except Exception as e:
        return False, None, str(e)
```

### Example 2: Google Drive Upload for Batch Video

```python
# Source: Adapted from GoogleDriveService methods
async def deliver_to_drive(
    video_content: bytes,
    original_filename: str,
    project_folder_id: str,
    batch_id: str,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """Upload upscaled video to Google Drive project subfolder."""
    drive = GoogleDriveService()
    if not drive.drive:
        return False, None, "Google Drive not configured"

    # Create or get batch subfolder
    from datetime import datetime
    subfolder_name = f"Upscaled - {datetime.now().strftime('%Y-%m-%d')}"
    success, folder_id, error = await drive.get_or_create_folder(
        parent_id=project_folder_id,
        folder_name=subfolder_name,
    )
    if not success:
        return False, None, error

    # Upload file
    name_stem = Path(original_filename).stem
    filename = f"{name_stem}_upscaled.mp4"
    success, file_id, error = await drive.upload_file(
        file_content=video_content,
        filename=filename,
        folder_id=folder_id,
        mime_type='video/mp4',
    )
    return success, file_id, error
```

### Example 3: Background ZIP Job Pattern

```python
# Source: Adapted from hf_download_service.py pattern
import io
import uuid
import zipfile
from pathlib import Path
from typing import Optional

_ZIP_JOBS: dict[str, dict] = {}

def create_zip_job(batch_id: str, video_count: int) -> str:
    job_id = str(uuid.uuid4())
    _ZIP_JOBS[job_id] = {
        "status": "pending",
        "batch_id": batch_id,
        "progress_pct": 0.0,
        "files_done": 0,
        "total_files": video_count,
        "error": None,
        "zip_bytes": None,
    }
    return job_id

async def _build_zip(job_id: str, videos: list[dict]) -> None:
    """Background task to download videos and create ZIP."""
    try:
        _ZIP_JOBS[job_id]["status"] = "building"
        buf = io.BytesIO()

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as zf:
                for i, video in enumerate(videos):
                    url = video.get("output_storage_url")
                    if not url:
                        continue
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    name_stem = Path(video["input_filename"]).stem
                    arcname = f"{name_stem}_upscaled.mp4"
                    zf.writestr(arcname, resp.content)
                    _ZIP_JOBS[job_id]["files_done"] = i + 1
                    _ZIP_JOBS[job_id]["progress_pct"] = round((i + 1) / len(videos) * 100, 1)

        buf.seek(0)
        _ZIP_JOBS[job_id]["zip_bytes"] = buf.getvalue()
        _ZIP_JOBS[job_id]["status"] = "ready"

    except Exception as e:
        _ZIP_JOBS[job_id]["status"] = "error"
        _ZIP_JOBS[job_id]["error"] = str(e)
```

### Example 4: ZIP Download Endpoint

```python
# Endpoint: GET /upscale/zip-jobs/{job_id}/download
from fastapi.responses import StreamingResponse

@router.get("/zip-jobs/{job_id}/download")
async def download_zip(job_id: str, user=Depends(get_current_user)):
    job = get_zip_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="ZIP job not found")
    if job["status"] != "ready":
        raise HTTPException(status_code=409, detail=f"ZIP not ready: {job['status']}")

    zip_bytes = job["zip_bytes"]
    # Clean up job after download
    _ZIP_JOBS.pop(job_id, None)

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=upscaled_batch.zip"},
    )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Signed URLs with expiration | Public URLs (permanent) | Decision locked for this phase | No URL refresh needed; simpler for frontend |
| Post-batch sweep for uploads | Inline per-video delivery | Decision locked for this phase | Progressive delivery; videos available immediately |
| Pre-built ZIP in storage | On-demand ZIP generation | Decision locked for this phase | No storage waste; ZIP only when requested |

**Deprecated/outdated:**
- `storage-py` repository is archived (Sep 2025), code is now in `supabase-py` monorepo. The API is the same -- just the repo location changed.

## Open Questions

1. **ZIP memory limits for large batches**
   - What we know: 10 videos x 200MB = 2GB ZIP in memory. Heroku Performance-M has 2.5GB.
   - What's unclear: What's the actual upper bound of video file sizes from Freepik 4K upscaling?
   - Recommendation: Implement ZIP with per-file download-and-write pattern (bounded memory per file). Add a guard: if total estimated size > 1GB, return an error suggesting individual downloads.

2. **Freepik output URL lifetime**
   - What we know: Freepik returns a URL in the `generated` array when status is COMPLETED.
   - What's unclear: How long does this URL remain valid? (Hours? Days?)
   - Recommendation: Upload to Supabase immediately inline (as decided). The inline approach minimizes the risk of URL expiration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio |
| Config file | backend/tests/conftest.py |
| Quick run command | `cd backend && pytest tests/test_upscale_api.py -x` |
| Full suite command | `cd backend && pytest` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DLVR-01 | Supabase upload after Freepik COMPLETED | unit | `pytest tests/test_upscale_api.py::test_delivery_supabase_upload -x` | Wave 0 |
| DLVR-01 | Supabase upload failure sets status=failed | unit | `pytest tests/test_upscale_api.py::test_delivery_supabase_failure -x` | Wave 0 |
| DLVR-02 | Drive upload when project_id present | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_upload -x` | Wave 0 |
| DLVR-02 | Drive upload failure does not fail video | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_failure_nonfatal -x` | Wave 0 |
| DLVR-02 | Drive upload skipped when no project_id | unit | `pytest tests/test_upscale_api.py::test_delivery_drive_skipped -x` | Wave 0 |
| DLVR-03 | Batch detail includes output_storage_url | unit | `pytest tests/test_upscale_api.py::test_batch_detail_includes_url -x` | Wave 0 |
| DLVR-04 | POST download-zip returns job_id | unit | `pytest tests/test_upscale_api.py::test_zip_job_creation -x` | Wave 0 |
| DLVR-04 | GET zip status returns progress | unit | `pytest tests/test_upscale_api.py::test_zip_job_status -x` | Wave 0 |
| DLVR-04 | GET zip download returns ZIP bytes | unit | `pytest tests/test_upscale_api.py::test_zip_download -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && pytest tests/test_upscale_api.py tests/test_upscale_job_service.py -x`
- **Per wave merge:** `cd backend && pytest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test functions in `tests/test_upscale_api.py` for delivery behavior (DLVR-01, DLVR-02)
- [ ] New test functions in `tests/test_upscale_api.py` for ZIP endpoints (DLVR-04)
- [ ] Update `tests/test_upscale_job_service.py` for new upload status methods

*(Test framework and conftest fixtures already exist -- no framework install or shared fixture changes needed)*

## Sources

### Primary (HIGH confidence)
- Supabase Python SDK `storage3` v2.27.1 source code -- inspected `_upload_or_update` method signature: accepts `Union[BufferedReader, bytes, FileIO, str, Path]`, no streaming support
- Supabase `get_public_url()` method source -- client-side URL construction, no API call
- Existing `StorageService.upload_video_from_url()` in `backend/services/storage_service.py` -- download-then-upload pattern
- Existing `GoogleDriveService.upload_file()` and `get_or_create_folder()` in `backend/services/google_drive_service.py`
- Existing `hf_download_service.py` in-memory job store pattern (`_HF_JOBS` dict)
- Existing `_process_single_video()` in `backend/api/upscale.py` -- integration point
- Database schema `backend/migrations/007_add_upscale_batches.sql` -- `supabase_upload_status`, `drive_upload_status`, `output_storage_url`, `output_drive_file_id` columns already exist

### Secondary (MEDIUM confidence)
- [Supabase Standard Uploads docs](https://supabase.com/docs/guides/storage/uploads/standard-uploads) -- confirms standard upload supports up to 5GB, recommends TUS for >6MB (but TUS not available in Python sync SDK)
- [Supabase Python upload reference](https://supabase.com/docs/reference/python/storage-from-upload) -- confirms upload API
- [Heroku Request Timeout docs](https://devcenter.heroku.com/articles/request-timeout) -- 30s initial timeout, 55s rolling window with streaming
- [FastAPI StreamingResponse docs](https://fastapi.tiangolo.com/advanced/custom-response/) -- ZIP response pattern
- [httpx async streaming docs](https://www.python-httpx.org/async/) -- `client.stream()` method for large downloads

### Tertiary (LOW confidence)
- None -- all findings verified against source code or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and used in codebase
- Architecture: HIGH - direct extension of existing patterns, all building blocks verified in source
- Pitfalls: HIGH - memory constraints identified from SDK source inspection, Heroku limits from official docs
- Delivery flow: HIGH - locked decisions from CONTEXT.md, existing code supports all integration points
- ZIP pattern: MEDIUM - in-memory job store follows HF download pattern, but memory limits for large batches need monitoring

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable -- no external API changes expected)
