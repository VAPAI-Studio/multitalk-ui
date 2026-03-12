# Phase 5: HuggingFace Integration - Research

**Researched:** 2026-03-04
**Domain:** HuggingFace Hub download API + FastAPI background jobs + S3 upload pipeline
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HF-01 | Admin can paste HuggingFace model URL into download interface | URL parsing section covers regex pattern for `huggingface.co/{owner}/{repo}/resolve/{branch}/{path}` and `huggingface.co/{owner}/{repo}/blob/{branch}/{path}` |
| HF-02 | System validates HuggingFace URL before starting download | URL validation + dry_run=True on hf_hub_download returns DryRunFileInfo with size before committing download |
| HF-03 | System downloads HuggingFace model directly to RunPod network volume (no local intermediary) | Two-phase pattern: hf_hub_download to /tmp then boto3 multipart upload to S3; no local storage persists |
| HF-04 | Download progress shows percentage and file size being downloaded | In-memory job store + asyncio.to_thread pattern with tqdm_class hook for HF download progress; S3 upload part progress tracked separately |
| HF-05 | HuggingFace downloads run as background jobs (not blocking HTTP requests) | asyncio.to_thread wraps blocking hf_hub_download; job ID returned immediately; poll endpoint for status |
| HF-06 | Admin can select target directory on volume for downloaded model | target_path field on HFDownloadRequest mirrors existing infrastructure upload pattern |
| HF-07 | System handles HuggingFace authentication for gated models | token parameter on hf_hub_download accepts HF access token string; GatedRepoError maps to 403 |
</phase_requirements>

## Summary

Phase 5 adds a HuggingFace model download feature to the Infrastructure admin page. The admin pastes a HuggingFace URL, picks a target directory on the RunPod network volume, and the system downloads the model file server-to-server — without the file ever passing through the admin's browser.

The core technical challenge is that HuggingFace downloads are blocking synchronous operations (the `huggingface_hub` library uses `httpx` under the hood but exposes a synchronous API), while the FastAPI server is async. The solution is `asyncio.to_thread` to run the blocking download without blocking the event loop. Progress tracking is achieved by (a) using a custom `tqdm_class` to intercept HF download progress and write it to an in-memory dict keyed by job ID, and (b) tracking S3 multipart upload progress separately. A polling endpoint lets the frontend read job status without SSE complexity.

The download pipeline is: parse URL → validate (dry_run=True) → start background thread → `hf_hub_download(local_dir=/tmp/hf-{job_id})` → stream temp file into boto3 multipart S3 upload → delete temp file. The temp file approach is required because `huggingface_hub` cannot write directly to an S3 destination, and the RunPod S3 endpoint does not support presigned PUT URLs that HF could stream into directly.

**Primary recommendation:** Use `hf_hub_download` with `local_dir=/tmp/hf-{job_id}` for download, then boto3 multipart upload to S3, delete temp after. In-memory dict for job state (no Redis needed at this scale). Polling over SSE (simpler, no streaming complexity).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `huggingface_hub` | 1.5.0 (latest as of 2026-02-26) | Download files from HuggingFace Hub with auth support | Official Python client; handles auth, retries, LFS, caching |
| `boto3` | >=1.34.0 (already in requirements.txt) | S3 multipart upload to RunPod volume | Already established in project; battle-tested for large files |
| `asyncio.to_thread` | stdlib (Python 3.9+) | Run blocking hf_hub_download without blocking event loop | Correct tool for sync-in-async; already pattern in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tempfile` | stdlib | Create /tmp working directory per download job | Avoids disk space collisions between concurrent downloads |
| `pathlib` | stdlib | Path manipulation for local_dir and filename extraction | Cleaner than os.path for cross-platform paths |
| `uuid` | stdlib | Generate unique job IDs | Already used in the project for comfyui job IDs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| polling `/hf-downloads/{job_id}` | SSE streaming | Polling is simpler; SSE requires keepalive connection management and Heroku kills idle connections. Polling with 2-3s interval is sufficient for UX |
| in-memory dict | Redis/Supabase job table | In-memory is sufficient for single-process Heroku dyno; Redis adds infrastructure dependency not justified at this scale |
| temp file then S3 upload | Direct S3 streaming from HF | HF downloads to local filesystem only; S3 presigned PUT not supported on RunPod endpoint; temp approach is only viable path |

**Installation:**
```bash
pip install huggingface_hub>=1.5.0
```

Add to `backend/requirements.txt`:
```
huggingface_hub>=0.21.0
```

## Architecture Patterns

### Recommended Project Structure

New files for Phase 5:
```
backend/
├── api/
│   └── infrastructure.py          # Add HF download endpoints here (existing file)
├── models/
│   └── infrastructure.py          # Add HFDownloadRequest, HFDownloadJob models (existing file)
└── services/
    └── hf_download_service.py     # NEW: HuggingFace download service with job tracking
frontend/src/
└── components/
    └── HFDownload.tsx             # NEW: HuggingFace download UI component
```

### Pattern 1: URL Parsing

HuggingFace model URLs follow these patterns:

```
https://huggingface.co/{owner}/{repo}/blob/{branch}/{path/to/file}
https://huggingface.co/{owner}/{repo}/resolve/{branch}/{path/to/file}
https://huggingface.co/{owner}/{repo}           (repo root — full snapshot)
```

Parsing regex (Python):
```python
import re

HF_FILE_URL_PATTERN = re.compile(
    r"https://huggingface\.co/"
    r"(?P<repo_id>[^/]+/[^/]+)"
    r"(?:/(blob|resolve)/[^/]+"
    r"(?P<filename>/.+))?"
)

def parse_hf_url(url: str) -> tuple[str, str | None]:
    """
    Returns (repo_id, filename_in_repo) or raises ValueError.
    filename_in_repo is None if the URL points to the repo root (use snapshot_download).
    """
    m = HF_FILE_URL_PATTERN.match(url.strip())
    if not m:
        raise ValueError(f"Not a valid HuggingFace URL: {url!r}")
    repo_id = m.group("repo_id")
    filename = m.group("filename")
    if filename:
        filename = filename.lstrip("/")
    return repo_id, filename
```

Confidence: MEDIUM — tested against real HF URL examples. Edge cases (spaces in filenames, encoded chars) should be handled by stripping and normalizing.

### Pattern 2: Background Job with In-Memory State

```python
# Source: FastAPI background task pattern + asyncio.to_thread (stdlib)
import asyncio
import uuid
from typing import Optional

# Module-level job store (lives for process lifetime)
_HF_JOBS: dict[str, dict] = {}
# Schema: { job_id: { status, progress_pct, bytes_done, total_bytes, filename, error, s3_key } }

def new_job(filename: str, s3_key: str) -> str:
    job_id = str(uuid.uuid4())
    _HF_JOBS[job_id] = {
        "status": "pending",       # pending | downloading | uploading | done | error
        "progress_pct": 0,
        "bytes_done": 0,
        "total_bytes": None,
        "filename": filename,
        "s3_key": s3_key,
        "error": None,
    }
    return job_id

def get_job(job_id: str) -> Optional[dict]:
    return _HF_JOBS.get(job_id)
```

### Pattern 3: HuggingFace Download with Progress

`hf_hub_download` does NOT expose a byte-level progress callback directly — it uses `tqdm` internally. The cleanest approach for progress tracking is a custom `tqdm_class`:

```python
# Source: huggingface_hub official docs (tqdm_class parameter)
from tqdm.auto import tqdm

def make_tqdm_class(job_id: str):
    """Returns a tqdm subclass that writes progress to in-memory job store."""
    class ProgressTqdm(tqdm):
        def update(self, n=1):
            super().update(n)
            job = _HF_JOBS.get(job_id)
            if job:
                job["bytes_done"] = self.n
                job["total_bytes"] = self.total
                if self.total and self.total > 0:
                    job["progress_pct"] = round(self.n / self.total * 100, 1)
    return ProgressTqdm
```

Then call:
```python
from huggingface_hub import hf_hub_download
import tempfile, pathlib

local_dir = pathlib.Path(tempfile.mkdtemp(prefix=f"hf-{job_id}-"))
local_path = hf_hub_download(
    repo_id=repo_id,
    filename=filename,
    token=hf_token or None,           # None = public access, str = authenticated
    local_dir=str(local_dir),
    tqdm_class=make_tqdm_class(job_id),
)
```

### Pattern 4: S3 Multipart Upload After Download

After `hf_hub_download` returns the local path, upload to S3 using the existing `s3_client` pattern from Phase 3:

```python
# Source: Established project pattern from backend/services/infrastructure_service.py
import os
from core.s3_client import s3_client
from config.settings import settings

CHUNK_SIZE = 5 * 1024 * 1024  # 5MB minimum S3 part size

def upload_to_s3(local_path: str, s3_key: str, job_id: str) -> None:
    file_size = os.path.getsize(local_path)
    _HF_JOBS[job_id]["status"] = "uploading"
    _HF_JOBS[job_id]["total_bytes"] = file_size
    _HF_JOBS[job_id]["bytes_done"] = 0

    resp = s3_client.create_multipart_upload(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=s3_key
    )
    upload_id = resp["UploadId"]
    parts = []
    part_number = 0

    try:
        with open(local_path, "rb") as f:
            while chunk := f.read(CHUNK_SIZE):
                part_number += 1
                part_resp = s3_client.upload_part(
                    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                    Key=s3_key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_number, "ETag": part_resp["ETag"]})
                _HF_JOBS[job_id]["bytes_done"] += len(chunk)
                _HF_JOBS[job_id]["progress_pct"] = round(
                    _HF_JOBS[job_id]["bytes_done"] / file_size * 100, 1
                )
        s3_client.complete_multipart_upload(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=s3_key,
            UploadId=upload_id,
            MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])},
        )
    except Exception:
        s3_client.abort_multipart_upload(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID, Key=s3_key, UploadId=upload_id
        )
        raise
```

### Pattern 5: FastAPI Endpoint Design

```python
# POST /api/infrastructure/hf-download — starts download, returns job_id immediately
# GET  /api/infrastructure/hf-download/{job_id} — returns job status (poll every 2-3s)

@router.post("/hf-download")
async def start_hf_download(
    payload: HFDownloadRequest,
    background_tasks: BackgroundTasks,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    # 1. Parse and validate URL synchronously (fast — just regex + HEAD request)
    # 2. Determine s3_key from target_path + filename
    # 3. Create job record
    # 4. Add background task: asyncio.to_thread(run_download, job_id, ...)
    # 5. Return {"job_id": job_id, "success": True} immediately
    ...

@router.get("/hf-download/{job_id}")
async def get_hf_download_status(
    job_id: str,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
```

### Anti-Patterns to Avoid

- **Blocking the event loop:** Never call `hf_hub_download` directly in an async endpoint. Always use `asyncio.to_thread` or `background_tasks.add_task` (which runs sync functions in a threadpool automatically).
- **Leaving temp files on error:** Always wrap the temp dir cleanup in a `finally` block. Leaked /tmp dirs from failed downloads accumulate and fill disk.
- **Returning progress from blocking tqdm:** Do not use `tqdm` output streams for progress — write directly to the `_HF_JOBS` dict. tqdm writes to stderr which is useless for API progress tracking.
- **Storing HF tokens in job state dict:** Accept token per-request, pass to hf_hub_download, do not persist to memory store or logs.
- **Running validation as a full download:** Use `dry_run=True` for URL validation (returns `DryRunFileInfo` with file size) — avoids downloading before the job starts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HF auth, retries, LFS download | Custom HTTP client with bearer token | `hf_hub_download` with `token=` param | Handles LFS pointers, CDN redirects, ETag caching, error classification (GatedRepoError, RepositoryNotFoundError) |
| URL parsing | Complex regex for all HF URL variants | Simple regex for `huggingface.co/{owner}/{repo}` prefix, then delegate to `hf_hub_download` | HF URL structure has edge cases (spaces, encoded chars, Xet storage pointers) |
| Streaming HF to S3 directly | Custom streaming bridge | Download to /tmp then multipart upload | RunPod S3 doesn't support presigned PUT; HF only downloads to local filesystem |
| Background job queue | Celery + Redis | FastAPI `BackgroundTasks` + asyncio.to_thread | Single-dyno Heroku; Celery adds infrastructure not justified at this scale |
| Disk space management | Quota tracking | `tempfile.mkdtemp` + `shutil.rmtree` in finally block | OS manages /tmp; explicit cleanup sufficient |

**Key insight:** `huggingface_hub` does the hard work (LFS, auth, CDN, retries). The only custom logic needed is the progress-tracking tqdm hook and the S3 upload after download completes.

## Common Pitfalls

### Pitfall 1: BackgroundTasks vs asyncio.to_thread
**What goes wrong:** Using `background_tasks.add_task(async_function, ...)` where async_function awaits other coroutines causes "coroutine was never awaited" errors or blocks unexpectedly.
**Why it happens:** FastAPI `BackgroundTasks.add_task` runs async functions with `await` in the event loop and sync functions in a thread pool. `hf_hub_download` is synchronous — if wrapped in a coroutine that awaits it, the sync call blocks the event loop.
**How to avoid:** Make the background task a plain `def` function (not `async def`). FastAPI will automatically run it in a threadpool. OR use `await asyncio.to_thread(sync_fn, args)` inside an `async def` background task.
**Warning signs:** Server freezes during download; no response from other endpoints while download runs.

### Pitfall 2: Heroku 30-second Request Timeout
**What goes wrong:** A long-polling frontend request to `/hf-download/{job_id}` times out after 30 seconds on Heroku.
**Why it happens:** Heroku kills any HTTP request that doesn't receive a response within 30 seconds.
**How to avoid:** The poll endpoint returns immediately with current status — it's just a dict lookup, not a blocking wait. Frontend polls every 2-3 seconds with short-lived requests. Never make the status endpoint wait/block.
**Warning signs:** Frontend poll requests returning 503 "Request timeout" from Heroku router.

### Pitfall 3: Disk Space on Heroku
**What goes wrong:** Large model downloads fill the Heroku dyno's ephemeral disk (512MB limit for free tier, but `/tmp` is shared with the process).
**Why it happens:** Heroku dynos have limited ephemeral storage. A 5GB model download to /tmp will likely fail.
**How to avoid:** For Phase 5, this is a known constraint. Document it clearly. One mitigation: stream download in chunks and upload each chunk to S3 multipart without keeping the full file. But `hf_hub_download` downloads the whole file first. The cleaner solution is to stream directly from HF HTTP response to S3, bypassing the HF library — but that loses auth/LFS support.
**Recommended approach for Phase 5:** Accept the constraint. Document that Heroku deployment has a model size limit (~400MB safe, ~1GB risky). Note in UI. Full streaming bypass is v2 scope.
**Warning signs:** Download task fails with "No space left on device" or disk write errors.

### Pitfall 4: GatedRepoError Not Caught
**What goes wrong:** User pastes URL of a gated model (e.g., Llama) without providing an HF token; error propagates as unhandled exception.
**Why it happens:** `hf_hub_download` raises `huggingface_hub.errors.GatedRepoError` (which inherits from `RepositoryNotFoundError`) if the repo requires agreement.
**How to avoid:** Wrap `hf_hub_download` call in try/except catching `GatedRepoError`, `RepositoryNotFoundError`, `EntryNotFoundError` from `huggingface_hub.errors` and map them to descriptive job error messages.
**Warning signs:** Background task crashes silently; job stuck in "downloading" status forever.

### Pitfall 5: In-Memory State Lost on Dyno Restart
**What goes wrong:** Active download job is in-memory; Heroku restarts the dyno; job state is gone; frontend shows "job not found".
**Why it happens:** `_HF_JOBS` dict is process-scoped. Heroku dynos restart periodically (daily cycling, deploys).
**How to avoid:** This is acceptable for Phase 5 (admin-only, low frequency, single user). Document the limitation. If a job is lost, the admin sees a 404 and can re-submit. Full persistence (Supabase table) is v2.
**Warning signs:** Admin reports download "disappeared" without completing.

### Pitfall 6: hf_hub_download Cache Directory Growth
**What goes wrong:** `hf_hub_download` caches downloads in `~/.cache/huggingface/hub/` by default. Running without `local_dir` fills the cache indefinitely.
**Why it happens:** Default HF caching is designed for repeated access — not appropriate for server-side one-time downloads.
**How to avoid:** Always pass `local_dir=str(tmp_dir)` so the file lands in /tmp. This skips the HF cache entirely and goes directly to the temp dir. Clean up /tmp after S3 upload completes.
**Warning signs:** Heroku disk usage grows over time; downloaded files appear in unexpected locations.

## Code Examples

### HF URL Validation (dry_run)
```python
# Source: huggingface_hub official docs - dry_run parameter
from huggingface_hub import hf_hub_download
from huggingface_hub.errors import RepositoryNotFoundError, GatedRepoError, EntryNotFoundError

def validate_hf_download(repo_id: str, filename: str, token: str | None) -> dict:
    """
    Returns {"valid": True, "size": N, "filename": filename}
    or raises ValueError with user-friendly message.
    """
    try:
        info = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            token=token,
            dry_run=True,
        )
        # DryRunFileInfo has .size attribute
        return {
            "valid": True,
            "size": info.size,       # bytes
            "filename": filename,
        }
    except GatedRepoError:
        raise ValueError(
            f"Model '{repo_id}' is gated. Provide a HuggingFace access token "
            f"with access to this model."
        )
    except RepositoryNotFoundError:
        raise ValueError(
            f"Repository '{repo_id}' not found or is private. "
            f"Check the URL and provide a token if the repo is private."
        )
    except EntryNotFoundError:
        raise ValueError(
            f"File '{filename}' not found in repository '{repo_id}'."
        )
```

### Complete Background Download Task
```python
# Source: asyncio.to_thread stdlib + hf_hub_download official docs + project S3 pattern
import asyncio
import shutil
import tempfile
import pathlib

async def run_hf_download_job(
    job_id: str, repo_id: str, filename: str,
    s3_key: str, hf_token: str | None
) -> None:
    """Async wrapper that runs blocking download in a thread."""
    await asyncio.to_thread(
        _blocking_hf_download_and_upload,
        job_id, repo_id, filename, s3_key, hf_token
    )

def _blocking_hf_download_and_upload(
    job_id: str, repo_id: str, filename: str,
    s3_key: str, hf_token: str | None
) -> None:
    """Runs in a thread. Downloads from HF, uploads to S3, cleans up /tmp."""
    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix=f"hf-{job_id[:8]}-"))
    try:
        # Phase 1: Download from HuggingFace
        _HF_JOBS[job_id]["status"] = "downloading"
        local_path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            token=hf_token,
            local_dir=str(tmp_dir),
            tqdm_class=make_tqdm_class(job_id),
        )

        # Phase 2: Upload to RunPod S3
        _HF_JOBS[job_id]["status"] = "uploading"
        _HF_JOBS[job_id]["progress_pct"] = 0
        upload_to_s3(local_path, s3_key, job_id)

        _HF_JOBS[job_id]["status"] = "done"
        _HF_JOBS[job_id]["progress_pct"] = 100
    except Exception as e:
        _HF_JOBS[job_id]["status"] = "error"
        _HF_JOBS[job_id]["error"] = str(e)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
```

### Frontend Polling Pattern
```typescript
// Source: Project-established polling pattern (see VirtualSet.tsx pollForWorld)
async function pollHFDownload(jobId: string, onProgress: (job: HFJob) => void): Promise<void> {
  const maxWait = 3600000; // 1 hour max
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const job = await apiClient.getHFDownloadStatus(jobId);
    onProgress(job);
    if (job.status === "done" || job.status === "error") break;
    await new Promise(r => setTimeout(r, 3000)); // poll every 3s
  }
}
```

### Settings Extension
```python
# Source: backend/config/settings.py established pattern
# Add to Settings class in backend/config/settings.py:
HF_TOKEN: str = ""  # Optional default HuggingFace token; per-request token overrides this
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `hf_transfer` (LFS backend) | `hf_xet` (chunk-based dedup) | huggingface_hub 0.32.0+ | Faster downloads automatically; no API change needed |
| Manual S3 multipart upload | multipart is still correct for RunPod S3 | N/A | delete_objects and copy_object not supported on RunPod S3 (established in Phase 4) |
| huggingface_hub 0.x (requests) | huggingface_hub 1.x (httpx) | 2024 | Breaking: `proxies` parameter removed; httpx-based internally |

**Deprecated/outdated:**
- `hf_transfer`: Deprecated; replaced by `hf_xet` in huggingface_hub 0.32.0. Installing latest `huggingface_hub` automatically includes `hf_xet`.
- `resume_download` parameter: Deprecated without replacement; library always resumes when possible.
- `local_dir_use_symlinks` parameter: Deprecated; symlinks no longer used.

## Open Questions

1. **Heroku disk space constraint**
   - What we know: Heroku dynos have limited ephemeral storage. Large models (>400MB) may fail mid-download if /tmp fills.
   - What's unclear: Exact /tmp limit on the current Heroku dyno tier.
   - Recommendation: Document the size limit in the UI. For Phase 5, accept the constraint. Add a "Recommended: files under 500MB" note. True streaming (HF response → S3 multipart without /tmp) is feasible but requires bypassing `hf_hub_download` and handling LFS manually — out of scope for Phase 5.

2. **Progress reporting across two phases (download + upload)**
   - What we know: Two distinct progress phases — HF download (0-100%) and S3 upload (0-100%). Showing combined 0-200% is confusing.
   - What's unclear: Best UX for two-phase progress.
   - Recommendation: Show phase label ("Downloading from HuggingFace... 45%" then "Uploading to volume... 23%"). Use a single 0-100% bar per phase, with a status label indicating which phase. Simpler than computing a weighted combined percentage.

3. **Concurrent download jobs**
   - What we know: In-memory dict supports multiple jobs. Each job uses its own /tmp dir.
   - What's unclear: Whether Heroku memory limits become a problem with 2+ concurrent large downloads.
   - Recommendation: No concurrency limit needed for Phase 5 — admin use case is inherently sequential. Add a note in UI: "One download at a time recommended."

## Sources

### Primary (HIGH confidence)
- huggingface_hub official docs (https://huggingface.co/docs/huggingface_hub/en/guides/download) — download functions, parameters, local_dir usage
- huggingface_hub file_download reference (https://huggingface.co/docs/huggingface_hub/en/package_reference/file_download) — hf_hub_download signature, token param, dry_run param, tqdm_class param, DryRunFileInfo
- PyPI huggingface-hub (https://pypi.org/project/huggingface-hub/) — version 1.5.0 confirmed current as of 2026-02-26
- Project codebase: `backend/services/infrastructure_service.py` — established boto3 multipart upload pattern (S3 does not support batch delete or copy_object on RunPod)
- Project codebase: `backend/config/settings.py` — settings pattern for new env vars
- Project codebase: `backend/api/infrastructure.py` — endpoint patterns (Depends(verify_admin), per-endpoint protection, error mapping)
- huggingface_hub utilities reference (https://huggingface.co/docs/huggingface_hub/en/package_reference/utilities) — GatedRepoError, RepositoryNotFoundError, EntryNotFoundError

### Secondary (MEDIUM confidence)
- FastAPI background tasks docs (https://fastapi.tiangolo.com/tutorial/background-tasks/) — BackgroundTasks with sync functions run in threadpool
- DEV.to article on HF to S3 pattern — confirms download-to-local-then-upload approach (no direct HF→S3 streaming natively)

### Tertiary (LOW confidence)
- GitHub issue #2407 (huggingface/huggingface_hub) — remote filesystem write support is an open feature request, not implemented as of research date

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — huggingface_hub is the official library, boto3 already in project, asyncio.to_thread is stdlib
- Architecture: HIGH — all patterns traced to official docs or established project patterns
- Pitfalls: HIGH for Heroku constraints (established in STATE.md), MEDIUM for disk space specifics (exact limit not verified)
- URL parsing: MEDIUM — regex covers known HF URL formats; edge cases acknowledged

**Research date:** 2026-03-04
**Valid until:** 2026-06-01 (huggingface_hub minor releases may add features; core API is stable)
