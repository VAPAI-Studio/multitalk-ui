# Phase 3: File Transfer - Research

**Researched:** 2026-03-04
**Domain:** S3-compatible multipart upload, streaming download, FastAPI, React/TypeScript progress UI
**Confidence:** HIGH (core architecture) / MEDIUM (RunPod-specific behavior)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPLOAD-01 | Admin can upload files from local machine to RunPod network volume | S3 multipart upload via backend-orchestrated presigned parts OR direct multipart via backend endpoint |
| UPLOAD-02 | File upload supports files up to 10GB using chunked/multipart upload | RunPod S3 supports CreateMultipartUpload + UploadPart + CompleteMultipartUpload; min chunk 5MB, max 10,000 parts |
| UPLOAD-03 | Upload progress indicator shows percentage and estimated time remaining | XMLHttpRequest onprogress or fetch + ReadableStream tracking per-chunk; aggregate across parts |
| UPLOAD-04 | Admin can select target directory before uploading | Path selector reuses existing FileTree `currentPath` state; passed as S3 key prefix |
| UPLOAD-05 | Upload handles network interruptions gracefully (retry or resume) | Per-part retry on failure; UploadId preserved so only failed part re-sends, not whole file |
| DWNLD-01 | Admin can download files from RunPod network volume to local machine | FastAPI StreamingResponse proxying S3 GetObject body to browser |
| DWNLD-02 | Download uses presigned S3 URLs with streaming (no backend buffering) | CRITICAL: RunPod S3 does NOT support presigned URLs — must use backend StreamingResponse proxy with chunk streaming |
| DWNLD-03 | Admin receives download initiation confirmation | UI toast/status message when download endpoint responds with first byte; no need to wait for completion |
| DWNLD-04 | Download works for files of any size without timeout | Heroku 55-second rolling window reset per chunk sent; streaming approach keeps connection alive |
</phase_requirements>

---

## Summary

Phase 3 implements bidirectional file transfer between the admin's browser and the RunPod network volume. The architecture is heavily constrained by two critical facts: **Heroku's 30-second initial response timeout** and **RunPod S3's lack of presigned URL support**.

For uploads, the correct approach is a **backend-coordinated multipart upload**: the backend generates each per-part upload URL via `boto3` (which works because the upload parts go directly from the frontend to RunPod S3 — this avoids the Heroku timeout entirely). Wait — RunPod does NOT support presigned URLs at all. This means **all uploads must be proxied through the FastAPI backend** using multipart S3 operations. This is viable only because: (a) Heroku's rolling 55-second window resets with each chunk received, so chunked streaming upload survives the timeout as long as chunks arrive every <55s, and (b) the 512MB Heroku memory limit forces small chunk sizes (5-50MB recommended) so the backend never buffers the whole file.

For downloads, since presigned URLs are not supported, the backend must stream S3 object bytes to the browser using FastAPI's `StreamingResponse` with a `boto3` `get_object` body iterator. Each chunk yielded resets Heroku's rolling 55-second window, so arbitrarily large files download successfully without timeout.

**Primary recommendation:** Use backend-proxied chunked multipart upload (5MB chunks, per-chunk retry, frontend XHR progress tracking) for uploads; use FastAPI `StreamingResponse` with S3 `get_object` body streaming for downloads. Do not use presigned URLs — RunPod S3 does not support them.

---

## CRITICAL ARCHITECTURAL FINDING

**RunPod S3-compatible API does NOT support presigned URLs.**

Source: Official RunPod docs (`https://docs.runpod.io/storage/s3-api`) — compatibility reference states: "Pre-signed URLs are not supported."

This invalidates the requirement wording in DWNLD-02 which says "presigned S3 URL." The implementation must use backend streaming proxies instead. The planner should note this discrepancy and implement the functional goal (no backend buffering of entire file in memory) via streaming, not presigned URLs.

**What RunPod S3 DOES support:**
- `PutObject` (files under 500MB)
- `GetObject`
- `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`
- `ListObjects`, `ListObjectsV2`, `HeadObject`, `DeleteObject`, `CopyObject`
- Max file size: 4TB; Max part size: 500MB; Min part size: 5MB (standard S3 rule)

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| boto3 | 1.x (already installed) | S3 multipart operations (create_multipart_upload, upload_part, complete_multipart_upload, get_object) | Already used in Phase 2; battle-tested S3 client |
| fastapi | already installed | Backend streaming endpoint with StreamingResponse | Project standard; Starlette streaming built in |
| starlette StreamingResponse | (via fastapi) | Proxy S3 body to browser without buffering whole file | Yields chunks, keeps Heroku rolling window alive |
| anyio | (via fastapi) | async sleep(0) in generator to allow cancellation | FastAPI async streaming requires yield + await |

### Frontend
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| XMLHttpRequest | Browser native | Chunked upload with `onprogress` event for accurate per-chunk tracking | fetch() does not expose upload progress; XHR does via `upload.onprogress` |
| React state | (already installed) | Upload state management (progress %, bytes/sec, ETA) | Project standard; no external state library needed |
| TailwindCSS | (already installed) | Progress bar UI | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| python-multipart | already in FastAPI deps | Parse multipart form data in upload endpoint | For backend-proxied upload receiving file chunks |
| botocore.exceptions.ClientError | (via boto3) | Catch S3-specific errors with error codes | Always catch for informative error responses |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| XHR for upload progress | fetch() + ReadableStream | fetch has no standard upload progress API; XHR `upload.onprogress` is simpler and widely supported |
| Backend-proxied multipart | Presigned URLs | RunPod does NOT support presigned URLs — this is not viable |
| StreamingResponse download | Direct link / presigned URL | Presigned URLs not supported by RunPod S3 |

**Installation:** No new packages needed. boto3, FastAPI, python-multipart are already installed.

---

## Architecture Patterns

### Recommended Structure

Upload and download endpoints extend the existing `backend/api/infrastructure.py` and `backend/services/infrastructure_service.py`. Frontend upload UI is a new component added to `Infrastructure.tsx` alongside the existing `FileTree`.

```
backend/
├── api/infrastructure.py          # Add: POST /upload (stream chunks to S3), GET /download/{path}
├── services/infrastructure_service.py  # Add: upload_file_multipart(), download_file_stream()
├── models/infrastructure.py       # Add: UploadInitResponse, UploadChunkResponse

frontend/src/
├── components/
│   ├── FileTree.tsx               # Modify: pass currentPath, add download button per file
│   ├── FileUpload.tsx             # NEW: file picker, chunk splitter, XHR progress, retry
│   └── FileTreeNode.tsx           # Modify: add Download action button per file row
├── pages/Infrastructure.tsx       # Modify: integrate FileUpload component, target path selection
├── lib/apiClient.ts               # Add: uploadFileChunked(), downloadFile()
```

### Pattern 1: Backend-Proxied Chunked Upload (Multipart S3)

**What:** Frontend splits file into 5MB chunks and sends them one-by-one to the FastAPI backend via XHR. Backend receives each chunk and calls `s3_client.upload_part()`, returning the ETag. After all chunks, backend calls `complete_multipart_upload`.

**Why this avoids Heroku timeout:** Each HTTP request (one per chunk) is small and completes well within 30 seconds. The 30-second timer resets per-request, not per-file.

**When to use:** All uploads. Single-request uploads for >500MB are rejected by RunPod S3; multipart is required above that threshold. Using multipart for all uploads (even small files) simplifies the code.

**Flow:**
```
Browser → POST /infrastructure/upload/init  (filename, size, target_path)
Backend → s3_client.create_multipart_upload() → returns upload_id
Backend → 200 { upload_id, total_parts }

For each 5MB chunk (part_number 1..N):
  Browser → PUT /infrastructure/upload/part?upload_id=&part_number=&key=
           (body: raw chunk bytes)
  Backend → s3_client.upload_part(Body=chunk_bytes) → returns ETag
  Backend → 200 { part_number, etag }

Browser → POST /infrastructure/upload/complete
           (body: { upload_id, key, parts: [{part_number, etag}] })
Backend → s3_client.complete_multipart_upload() → 200 { success }
```

**Example (backend):**
```python
# Source: boto3 docs + RunPod S3 API compatibility reference
from fastapi import APIRouter, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse
from core.s3_client import s3_client
from config.settings import settings
from core.auth import verify_admin
from fastapi import Depends

@router.post("/upload/init")
async def init_upload(
    filename: str = Form(...),
    target_path: str = Form(...),
    admin_user: dict = Depends(verify_admin)
):
    s3_key = f"{target_path.strip('/')}/{filename}" if target_path else filename
    response = s3_client.create_multipart_upload(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=s3_key
    )
    return {"upload_id": response["UploadId"], "key": s3_key}

@router.put("/upload/part")
async def upload_part(
    upload_id: str = Query(...),
    part_number: int = Query(...),
    key: str = Query(...),
    chunk: UploadFile = File(...),
    admin_user: dict = Depends(verify_admin)
):
    chunk_bytes = await chunk.read()
    response = s3_client.upload_part(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=key,
        UploadId=upload_id,
        PartNumber=part_number,
        Body=chunk_bytes
    )
    return {"part_number": part_number, "etag": response["ETag"]}

@router.post("/upload/complete")
async def complete_upload(
    payload: CompleteUploadRequest,
    admin_user: dict = Depends(verify_admin)
):
    parts = [{"PartNumber": p.part_number, "ETag": p.etag} for p in payload.parts]
    s3_client.complete_multipart_upload(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=payload.key,
        UploadId=payload.upload_id,
        MultipartUpload={"Parts": parts}
    )
    return {"success": True}
```

**Example (frontend chunk upload with XHR progress):**
```typescript
// XHR gives upload.onprogress — fetch does NOT
async function uploadChunk(
  uploadId: string,
  key: string,
  partNumber: number,
  chunk: Blob,
  onProgress: (loaded: number, total: number) => void
): Promise<{ etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('chunk', chunk, `part-${partNumber}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Part ${partNumber} failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));

    const token = localStorage.getItem('vapai-auth-token');
    xhr.open('PUT', `${API_BASE}/infrastructure/upload/part?upload_id=${uploadId}&part_number=${partNumber}&key=${encodeURIComponent(key)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}
```

### Pattern 2: Backend Streaming Download (S3 GetObject Proxy)

**What:** Frontend triggers a download via an authenticated request to `/infrastructure/download?path=...`. Backend streams the S3 object body to the client in 64KB chunks without buffering the whole file in memory.

**Why this bypasses Heroku timeout:** Heroku's rolling 55-second window resets with each byte transmitted. As long as S3 keeps providing data (which it will for any reasonable network), the connection stays alive. Even a 10GB file at 10MB/s takes ~17 minutes but each chunk resets the timer.

**When to use:** All downloads from the RunPod volume.

**Example (backend):**
```python
from fastapi.responses import StreamingResponse
import anyio

@router.get("/download")
async def download_file(
    path: str = Query(..., description="S3 key of file to download"),
    admin_user: dict = Depends(verify_admin)
):
    """Stream file from RunPod S3 to browser without buffering."""
    safe_path = InfrastructureService._validate_path(path)
    filename = safe_path.split("/")[-1]

    async def s3_stream_generator():
        # s3_client.get_object returns a StreamingBody
        response = s3_client.get_object(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=safe_path
        )
        body = response["Body"]
        # iter_chunks is synchronous; wrap with anyio to allow cancellation
        for chunk in body.iter_chunks(chunk_size=65536):  # 64KB chunks
            yield chunk
            await anyio.sleep(0)  # yield control, allow connection cancellation

    return StreamingResponse(
        s3_stream_generator(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Include Content-Length if known so browser shows progress
            "Content-Length": str(response["ContentLength"])  # from get_object response
        }
    )
```

**Note on Content-Length:** The `get_object` response includes `ContentLength`. Pass it as a header so the browser can show download progress. This requires reading the `response` dict before starting the generator — structure accordingly.

**Example (frontend):**
```typescript
// Trigger authenticated download — cannot use <a href> directly because auth header needed
async function downloadFile(filePath: string, filename: string): Promise<void> {
  const token = localStorage.getItem('vapai-auth-token');
  const response = await fetch(
    `${API_BASE}/infrastructure/download?path=${encodeURIComponent(filePath)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  // Stream to blob and trigger browser download
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

**Note:** For very large files, `response.blob()` buffers in browser memory. Alternative: use a service worker or `<a>` link with a streaming approach. For the admin-only use case with 10GB files, the browser blob approach may hit memory limits. A simpler alternative is to open the download in a new tab using window.open() with an auth cookie — but the project uses Bearer tokens, not cookies, so the fetch+blob approach is the pragmatic choice for Phase 3.

### Pattern 3: Target Directory Selection

The upload UI reuses the `currentPath` state already tracked in `FileTree.tsx`. The `FileTree` component should expose `currentPath` via props or a shared state so the `FileUpload` component defaults to the current browsed directory. The admin can override via a text input or use the tree to navigate first.

```typescript
// In Infrastructure.tsx: shared path state
const [currentPath, setCurrentPath] = useState<string>("");

// FileTree and FileUpload both receive currentPath and setCurrentPath
<FileTree currentPath={currentPath} onNavigate={setCurrentPath} />
<FileUpload targetPath={currentPath} onUploadComplete={() => /* refresh tree */} />
```

### Anti-Patterns to Avoid

- **Sending the entire file to backend in one POST:** Heroku will time out for files >~20MB at typical upload speeds. Always chunk.
- **Using presigned URLs:** RunPod S3 explicitly does not support them. Will get 403 or 400 errors.
- **Buffering entire S3 response in backend memory:** `body.read()` on a 10GB file uses 10GB RAM on the Heroku dyno (512MB limit → crash). Always use `iter_chunks`.
- **Using `fetch()` for upload progress:** The Fetch API does not expose `upload.onprogress`. Use XMLHttpRequest for the upload part tracking.
- **Forgetting `AbortMultipartUpload` on failure:** Incomplete multipart uploads still incur storage charges. Always abort on error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File chunking math | Custom byte splitting logic | Simple `file.slice(start, end)` in browser (Blob API) | Native, correct, no deps |
| Per-part retry logic | Custom retry state machine | Simple try/catch with 3 attempts per chunk | Multipart is already resumable by design; keep retry simple |
| S3 multipart orchestration | Custom HTTP S3 calls | boto3 `create_multipart_upload`, `upload_part`, `complete_multipart_upload` | Already battle-tested, handles auth signing |
| Progress ETA calculation | Complex ETA algorithm | Simple bytes/elapsed * remaining | Good enough for UX; start simple |
| Download streaming | Custom TCP chunking | FastAPI `StreamingResponse` + boto3 `iter_chunks` | Starlette handles chunked encoding headers automatically |

**Key insight:** The complexity in this phase is architectural (Heroku timeout + no presigned URLs), not implementation. The individual operations (S3 multipart, XHR upload, StreamingResponse) are all well-understood patterns — just combine them correctly.

---

## Common Pitfalls

### Pitfall 1: Incomplete Multipart Uploads Accumulate Storage Costs
**What goes wrong:** If upload fails mid-way and `abort_multipart_upload` is not called, RunPod stores the parts indefinitely (counting toward storage).
**Why it happens:** Multipart uploads are stateful on the server side; parts persist until completed or aborted.
**How to avoid:** Frontend `try/catch` around the upload loop must call `POST /infrastructure/upload/abort` on any error. Backend must call `s3_client.abort_multipart_upload(Bucket=..., Key=..., UploadId=...)`.
**Warning signs:** Storage usage growing without corresponding file growth; orphaned UploadIds visible via `list_multipart_uploads`.

### Pitfall 2: RunPod S3 Presigned URL Requests Silently Fail
**What goes wrong:** If code attempts `s3_client.generate_presigned_url('get_object', ...)` and passes the URL to the client, the client gets an HTTP 403 or 400.
**Why it happens:** RunPod S3 explicitly does not support presigned URLs.
**How to avoid:** Never use `generate_presigned_url` with this S3 endpoint. Use direct `get_object` streaming.
**Warning signs:** Downloads return 403 despite valid credentials; `ClientError` with code `AccessDenied` on presigned URL calls.

### Pitfall 3: Heroku Timeout During Upload to Backend
**What goes wrong:** Admin uploads a 2GB file in a single POST; Heroku router terminates after 30 seconds.
**Why it happens:** Single-request uploads have a 30-second hard limit before first byte of response.
**How to avoid:** Use the 3-endpoint multipart pattern (init → parts → complete). Each part request is small and fast.
**Warning signs:** H12 errors in Heroku logs; frontend sees connection reset mid-upload.

### Pitfall 4: Heroku Memory Limit During Download
**What goes wrong:** Backend reads entire S3 object into memory with `body.read()` for large files → MemoryError.
**Why it happens:** Heroku dynos have 512MB RAM. A 1GB file exhausts it.
**How to avoid:** Always use `body.iter_chunks(chunk_size=65536)` and yield chunks in the generator.
**Warning signs:** R14 (memory exceeded) errors in Heroku logs; dyno restarts.

### Pitfall 5: Minimum Part Size Violation
**What goes wrong:** Sending parts smaller than 5MB to S3 (except the last part) causes `EntityTooSmall` error on `complete_multipart_upload`.
**Why it happens:** S3 protocol enforces minimum 5MB per part except the last.
**How to avoid:** Use `CHUNK_SIZE = 5 * 1024 * 1024` (5MB). Last part can be smaller.
**Warning signs:** `ClientError` with code `EntityTooSmall` during complete step.

### Pitfall 6: Part ETag Mismatch in Complete
**What goes wrong:** `complete_multipart_upload` rejects the part list if ETags don't match what was returned during `upload_part`.
**Why it happens:** ETag is the MD5 of the part content; must be passed back exactly as returned (including quotes).
**How to avoid:** Store ETags exactly as returned by `upload_part` response and pass them verbatim.
**Warning signs:** `InvalidPart` error on complete; check that ETags include surrounding quote characters.

### Pitfall 7: CORS for XHR Upload to Backend
**What goes wrong:** Browser XHR to FastAPI backend is blocked by CORS.
**Why it happens:** XHR with custom headers (Authorization) triggers preflight.
**How to avoid:** FastAPI CORS middleware already configured (Phase 1 setup). Verify `Authorization` header is in `allow_headers`. This should already work since the project has CORS configured.
**Warning signs:** Browser console shows CORS preflight 403; OPTIONS request rejected.

---

## Code Examples

### Init Multipart Upload (Backend)
```python
# Source: boto3 S3 docs + RunPod S3 API compatibility reference
response = s3_client.create_multipart_upload(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Key="models/checkpoints/my-model.safetensors"
)
upload_id = response["UploadId"]
```

### Upload a Part (Backend)
```python
# Source: boto3 upload_part docs
response = s3_client.upload_part(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Key=key,
    UploadId=upload_id,
    PartNumber=part_number,   # 1-based, 1..10000
    Body=chunk_bytes           # bytes; 5MB minimum except last part
)
etag = response["ETag"]  # Store this — needed for complete step
```

### Complete Multipart Upload (Backend)
```python
# Source: boto3 complete_multipart_upload docs
s3_client.complete_multipart_upload(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Key=key,
    UploadId=upload_id,
    MultipartUpload={
        "Parts": [
            {"PartNumber": 1, "ETag": '"abc123"'},
            {"PartNumber": 2, "ETag": '"def456"'},
            # ... sorted by PartNumber
        ]
    }
)
```

### Abort Multipart Upload (Backend)
```python
# Source: boto3 abort_multipart_upload docs
s3_client.abort_multipart_upload(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Key=key,
    UploadId=upload_id
)
```

### S3 Streaming Download (Backend)
```python
# Source: FastAPI custom response docs + boto3 get_object
from fastapi.responses import StreamingResponse
import anyio

async def s3_stream_generator(key: str):
    response = s3_client.get_object(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=key
    )
    body = response["Body"]
    content_length = response["ContentLength"]
    for chunk in body.iter_chunks(chunk_size=65536):
        yield chunk
        await anyio.sleep(0)

# Return from endpoint:
return StreamingResponse(
    s3_stream_generator(key),
    media_type="application/octet-stream",
    headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Length": str(content_length),
    }
)
```

### Frontend: File Chunking
```typescript
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB — S3 minimum part size

function splitFileIntoChunks(file: File): Blob[] {
  const chunks: Blob[] = [];
  let offset = 0;
  while (offset < file.size) {
    chunks.push(file.slice(offset, offset + CHUNK_SIZE));
    offset += CHUNK_SIZE;
  }
  return chunks;
}
```

### Frontend: Progress Tracking State
```typescript
interface UploadState {
  status: 'idle' | 'uploading' | 'completing' | 'done' | 'error' | 'aborting';
  totalParts: number;
  completedParts: number;
  currentPartProgress: number; // 0-100 for current part
  bytesUploaded: number;
  totalBytes: number;
  uploadSpeed: number;  // bytes/sec
  etaSeconds: number;
  errorMessage?: string;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct POST upload through backend | Presigned URL multipart (browser→S3 direct) | 2019-2021 | Eliminates server timeout; but RunPod doesn't support this |
| Custom multipart retry logic | Per-part retry with stored ETags | 2020+ | Resume on failure without re-uploading completed parts |
| Full file buffer on server for download | Streaming generator with iter_chunks | 2018+ | Sub-linear memory usage regardless of file size |
| `fetch()` for upload progress | XMLHttpRequest with `upload.onprogress` | Still current (2025) | XHR remains the only reliable upload progress API |

**Deprecated/outdated:**
- `response.Body.read()` for large files: Loads entire file into memory — use `iter_chunks` instead
- S3 PUT in single request for >500MB: RunPod rejects files >500MB in single PutObject — use multipart

---

## Open Questions

1. **Browser memory for large downloads**
   - What we know: fetch+blob downloads buffer the file in browser memory before saving
   - What's unclear: At what file size does this become a practical problem for admins (depends on browser/OS)
   - Recommendation: For Phase 3, use fetch+blob (simple, no deps). If 10GB files are common, investigate `showSaveFilePicker()` (File System Access API) in Phase 4 enhancement. Flag as known limitation in UI.

2. **RunPod S3 endpoint variation per datacenter**
   - What we know: The settings already hardcode `eu-ro-1.s3.runpod.io` which appears correct for this deployment
   - What's unclear: Whether the network volume ID serves as the bucket name or if there's a separate bucket naming scheme
   - Recommendation: Verify that existing Phase 2 S3 calls (which use `RUNPOD_NETWORK_VOLUME_ID` as bucket name) work — if Phase 2 works in production, uploads will too

3. **Concurrent upload parts**
   - What we know: S3 multipart supports parallel part uploads; RunPod docs don't document concurrency limits
   - What's unclear: Whether RunPod enforces rate limits on concurrent UploadPart calls
   - Recommendation: Upload parts sequentially in Phase 3 (simpler state management, avoids hitting unknown limits). Sequential is sufficient for the admin use case.

4. **Content-Length header for streaming download**
   - What we know: `get_object` response includes `ContentLength`; FastAPI StreamingResponse supports the header
   - What's unclear: Whether RunPod S3 always returns accurate ContentLength for all file types
   - Recommendation: Set Content-Length if available from get_object metadata; browser uses it for download progress bar. Fall back gracefully if missing.

---

## Validation Architecture

> Skipped: `workflow.nyquist_validation` is not set in `.planning/config.json` (defaults to skip).

---

## Sources

### Primary (HIGH confidence)
- https://docs.runpod.io/storage/s3-api — Confirmed: presigned URLs NOT supported; multipart operations supported; max single PutObject is 500MB
- https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/client/create_multipart_upload.html — create_multipart_upload API
- https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/client/upload_part.html — upload_part API
- https://fastapi.tiangolo.com/advanced/custom-response/ — StreamingResponse pattern with async generator
- https://devcenter.heroku.com/articles/request-timeout — 30s initial + 55s rolling window for streaming

### Secondary (MEDIUM confidence)
- https://dev.to/traindex/multipart-upload-for-large-files-using-pre-signed-urls-aws-4hg4 — Multipart patterns (adapted for backend-proxied, not presigned)
- https://blog.logrocket.com/multipart-uploads-s3-node-js-react/ — Frontend multipart orchestration patterns (TypeScript/React)
- https://repost.aws/questions/QUDRddZZUARtC1TTvyD_mYbw/s3-multipart-upload-using-boto3 — Per-part ETag handling

### Tertiary (LOW confidence)
- Multiple WebSearch results about XHR upload.onprogress patterns — well-established browser API but not directly sourced from spec

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — boto3 and FastAPI are already in use; StreamingResponse is FastAPI built-in
- Architecture: HIGH for backend patterns; MEDIUM for frontend XHR details (standard APIs but not verified via Context7)
- RunPod S3 constraints: HIGH — directly verified from official RunPod docs
- Pitfalls: HIGH — derived from official docs (Heroku timeout, S3 minimum part size, multipart protocol)

**Research date:** 2026-03-04
**Valid until:** 2026-06-04 (90 days — RunPod S3 API docs unlikely to change rapidly; boto3/FastAPI APIs are stable)
