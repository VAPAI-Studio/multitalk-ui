# Phase 4: File Operations - Research

**Researched:** 2026-03-04
**Domain:** S3 object operations (boto3 delete/copy), FastAPI backend endpoints, React modal confirmation dialogs, FileTreeNode UI integration
**Confidence:** HIGH

## Summary

Phase 4 adds delete, move, and rename operations to the existing RunPod S3 file browser. The entire backend stack (boto3 S3 client, InfrastructureService, admin-protected router) is already in place from Phases 2-3, so this phase primarily extends what exists rather than building new infrastructure.

S3 has no native "move" or "rename" operation — both are implemented as copy-then-delete. For single files this is straightforward (copy_object + delete_object). For folders it requires listing all objects under the prefix and copying/deleting each one in a loop. There is no "delete folder" API — folder deletion is always recursive object enumeration followed by per-object deletion (or batch delete_objects for up to 1000 keys at once).

Critical path protection must happen in the backend service layer as a hardcoded blocklist, not in the UI only. The FileTreeNode component already has a clean pattern for per-row action buttons (established by the Download button in Phase 3), so adding Delete/Rename/Move buttons follows that exact pattern. Confirmation dialogs are implemented inline in React using state-controlled modal overlays — no external library needed given the project's existing Tailwind CSS setup.

**Primary recommendation:** Extend InfrastructureService with delete_object, delete_folder (recursive batch), copy_object (for rename/move), and move_object (copy + delete). Add 3-4 new endpoints to the existing `/api/infrastructure` router. Add per-row action buttons to FileTreeNode with inline confirmation modals.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILEOP-01 | Admin can delete individual files with confirmation dialog | `delete_object` S3 call + React modal pattern; FileTreeNode row action button |
| FILEOP-02 | Admin can delete folders with recursive deletion warning | List all keys under prefix + `delete_objects` batch (1000/call) + modal with folder warning text |
| FILEOP-03 | Critical system paths are protected from accidental deletion | Hardcoded `PROTECTED_PATHS` set in service layer; backend rejects before S3 call |
| FILEOP-04 | Admin can move files between directories on the volume | `copy_object` + `delete_object` in service; frontend path input in modal |
| FILEOP-05 | Admin can rename files and folders | Same as move (copy+delete for file; recursive copy+delete for folder) |
| FILEOP-06 | File operations show success/failure feedback to admin | Inline status in FileTreeNode (existing pattern); toast/banner after completion |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| boto3 | existing | S3 delete/copy/list operations | Already in use; all needed APIs are synchronous boto3 calls |
| FastAPI | existing | New admin-protected endpoints | Router already registered; just add methods |
| React + TypeScript | existing | Confirmation dialogs, action buttons | No new libraries needed; Tailwind handles styling |
| botocore.exceptions.ClientError | existing | S3 error handling | Same pattern used across all existing service methods |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | existing | Modal overlay styling | Inline modal; no external modal lib needed |
| React useState | existing | Modal open/close state, pending operation state | Local component state for confirmation flow |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline React modal | External dialog library (Radix, Headless UI) | External lib adds a dependency for a simple yes/no confirm; Tailwind overlay is sufficient |
| Per-object delete loop | Batch `delete_objects` | Batch is 5-10x faster for folders; always use batch for folders; single delete_object for files |
| Copy-then-delete for move | S3 "rename" API | No such API exists in S3; copy-then-delete is the only approach |

**Installation:**
```bash
# No new dependencies required — boto3 and React are already installed
```

## Architecture Patterns

### Recommended Project Structure
```
backend/
├── models/infrastructure.py     # Add: DeleteRequest, MoveRequest, RenameRequest
├── services/infrastructure_service.py  # Add: delete_object, delete_folder, copy_object, move_object
└── api/infrastructure.py        # Add: DELETE /files, POST /files/move, POST /files/rename

frontend/src/
├── components/
│   ├── FileTreeNode.tsx         # Add: Delete/Rename/Move buttons + inline modals
│   └── ConfirmDialog.tsx        # Optional extracted component (or inline)
└── lib/
    └── apiClient.ts             # Add: deleteFile, deleteFolder, moveFile, renameFile
```

### Pattern 1: S3 Delete Single File

**What:** Call `s3_client.delete_object(Bucket=bucket, Key=key)`. S3 returns 204 even if key does not exist (idempotent).
**When to use:** FILEOP-01 — deleting individual files.

```python
# Source: boto3 S3 docs — delete_object
async def delete_object(self, path: str) -> Tuple[bool, Optional[str]]:
    try:
        safe_path = self._validate_path(path)
        self._check_protected(safe_path)  # raises ValueError if protected
        s3_client.delete_object(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=safe_path
        )
        return True, None
    except ValueError as e:
        return False, str(e)
    except ClientError as e:
        return False, f"S3 error: {str(e)}"
```

### Pattern 2: S3 Delete Folder (Recursive Batch)

**What:** List all objects with the folder prefix, then call `delete_objects` in batches of 1000.
**When to use:** FILEOP-02 — deleting folders recursively.

```python
# Source: boto3 S3 docs — delete_objects + list_objects_v2 pagination
async def delete_folder(self, path: str) -> Tuple[bool, int, Optional[str]]:
    """Returns (success, deleted_count, error)."""
    try:
        safe_path = self._validate_path(path)
        self._check_protected(safe_path)
        prefix = safe_path.rstrip('/') + '/'

        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Prefix=prefix
        )

        deleted_count = 0
        for page in pages:
            objects = page.get('Contents', [])
            if not objects:
                continue
            # Batch delete up to 1000 per call
            delete_payload = {'Objects': [{'Key': obj['Key']} for obj in objects]}
            s3_client.delete_objects(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Delete=delete_payload
            )
            deleted_count += len(objects)

        return True, deleted_count, None
    except ValueError as e:
        return False, 0, str(e)
    except ClientError as e:
        return False, 0, f"S3 error: {str(e)}"
```

**Key detail:** `delete_objects` takes `Delete={'Objects': [{'Key': k}, ...]}` — each item is a dict with Key (and optionally VersionId). Maximum 1000 keys per call. The paginator handles listing beyond 1000 objects automatically.

### Pattern 3: S3 Move / Rename (Copy + Delete)

**What:** `copy_object` (server-side copy, no data transit through backend) then `delete_object`. For folders: iterate all objects under old prefix, copy each to new prefix key, delete originals.
**When to use:** FILEOP-04 (move), FILEOP-05 (rename).

```python
# Source: boto3 S3 docs — copy_object
async def move_object(self, source_path: str, dest_path: str) -> Tuple[bool, Optional[str]]:
    """Move (copy + delete) a single file."""
    try:
        safe_src = self._validate_path(source_path)
        safe_dst = self._validate_path(dest_path)
        self._check_protected(safe_src)

        # Server-side copy — no data through backend memory
        copy_source = {'Bucket': settings.RUNPOD_NETWORK_VOLUME_ID, 'Key': safe_src}
        s3_client.copy_object(
            CopySource=copy_source,
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=safe_dst
        )
        # Only delete after successful copy
        s3_client.delete_object(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=safe_src
        )
        return True, None
    except ClientError as e:
        return False, f"S3 error: {str(e)}"
```

**Folder move:** List all keys under `source_prefix/`, compute new key by replacing prefix, copy each, delete originals. Same paginator pattern as delete_folder.

### Pattern 4: Protected Paths Blocklist

**What:** A set of path prefixes that cannot be deleted or moved. Checked in the service layer before any S3 call.
**When to use:** FILEOP-03 — protecting critical system paths.

```python
# Source: project convention — define in service or settings
PROTECTED_PATHS = frozenset([
    "models",           # top-level models directory
    "ComfyUI",          # ComfyUI installation
    "venv",             # Python virtual environment
])

def _check_protected(self, path: str) -> None:
    """Raises ValueError if path starts with a protected prefix."""
    normalized = path.strip('/')
    for protected in PROTECTED_PATHS:
        if normalized == protected or normalized.startswith(protected + '/'):
            raise ValueError(
                f"Path '{normalized}' is protected and cannot be deleted or moved. "
                f"Protected paths: {sorted(PROTECTED_PATHS)}"
            )
```

**Note:** The specific protected paths must be confirmed with the product owner. The above are reasonable defaults for a RunPod ComfyUI volume. Research shows no official RunPod documentation on required paths — these should be customizable or at minimum well-documented in code comments.

### Pattern 5: React Inline Confirmation Modal

**What:** A local boolean state controls a modal overlay. The modal shows the operation details and requires explicit confirmation before calling the API.
**When to use:** All destructive operations (FILEOP-01, FILEOP-02, FILEOP-04, FILEOP-05).

```tsx
// Inline within FileTreeNode — follows existing download button pattern
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [isDeleting, setIsDeleting] = useState(false);
const [operationError, setOperationError] = useState("");

const handleDeleteConfirm = async () => {
  setIsDeleting(true);
  try {
    await apiClient.deleteFile(item.path);
    onOperationComplete?.(); // triggers FileTree refresh
  } catch (err: any) {
    setOperationError(err.message || "Delete failed");
  } finally {
    setIsDeleting(false);
    setShowDeleteConfirm(false);
  }
};

// Modal JSX (uses Tailwind — no external library)
{showDeleteConfirm && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-900 mb-2">
        Delete {item.type === 'folder' ? 'Folder' : 'File'}?
      </h3>
      <p className="text-gray-600 mb-1">
        <span className="font-mono text-sm bg-gray-100 px-1 rounded">{item.name}</span>
      </p>
      {item.type === 'folder' && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
          Warning: This will permanently delete all files inside this folder.
        </p>
      )}
      <div className="flex gap-3 mt-6">
        <button onClick={() => setShowDeleteConfirm(false)}
          className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={handleDeleteConfirm} disabled={isDeleting}
          className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50">
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
)}
```

### Pattern 6: FileTreeNode Callback for Post-Operation Refresh

**What:** FileTreeNode receives an `onOperationComplete` callback prop. After any successful file operation, it calls this callback, which triggers FileTree to reload its current directory (same mechanism as `onRefreshRequest` from Phase 3).
**When to use:** All file operations that mutate the tree (delete, move, rename).

```tsx
// FileTreeNode props extension
interface Props {
  item: FileSystemItem;
  depth: number;
  onOperationComplete?: () => void;  // NEW: called after delete/move/rename
}

// FileTree passes callback down
<FileTreeNode
  key={child.path}
  item={child}
  depth={depth + 1}
  onOperationComplete={onOperationComplete}  // thread through
/>
```

### Anti-Patterns to Avoid

- **Delete without confirmation:** Never call delete_object on click without a confirm modal. Folder deletes are irreversible.
- **Frontend-only path protection:** Protecting paths only in the UI can be bypassed by direct API calls. Protect in the service layer, not just the UI.
- **Buffering file content for copy:** `copy_object` is a server-side S3 operation — it does not transfer data through the backend. Never download-then-upload for copy/move.
- **Assuming delete_object fails on missing key:** S3 `delete_object` is idempotent and returns 204 for non-existent keys. Do not rely on ClientError to detect "file not found before delete."
- **Leaving FileTreeNode self-contained for operations:** Operations need to signal the parent FileTree to refresh. The `onOperationComplete` prop must be threaded from Infrastructure.tsx → FileTree → FileTreeNode (all levels).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive folder listing | Custom pagination loop | boto3 `get_paginator('list_objects_v2')` | Handles all truncation edge cases; built-in |
| Batch delete | Loop of single delete_object calls | `delete_objects` with up to 1000 keys | 1000x fewer API calls for large folders |
| Server-side copy | Download file → re-upload | `copy_object` | S3-native; no data through backend memory |
| Modal dialog | External dialog library | Tailwind inline modal | Project already uses Tailwind; trivial to implement |
| Path validation | Regex or custom parser | Existing `_validate_path()` in InfrastructureService | Already implemented and tested |

**Key insight:** S3 copy, delete, and list operations are all synchronous boto3 calls that complete in milliseconds to seconds (depending on object count). No async queue or background jobs needed for Phase 4 — all operations complete within HTTP request timeouts.

## Common Pitfalls

### Pitfall 1: delete_objects Returns Errors Inside Success Response
**What goes wrong:** `delete_objects` returns HTTP 200 even if some keys failed to delete. Errors are embedded in the response body under `response['Errors']`.
**Why it happens:** S3 batch delete is designed for eventual consistency; partial failure is a valid outcome.
**How to avoid:** Always check `response.get('Errors', [])` after each batch call. If any errors exist, log them and surface to the admin.
**Warning signs:** Silent data loss where some objects appear deleted from UI but are still on S3.

```python
response = s3_client.delete_objects(Bucket=bucket, Delete=delete_payload)
errors = response.get('Errors', [])
if errors:
    raise ValueError(f"Failed to delete {len(errors)} objects: {errors[0]['Message']}")
```

### Pitfall 2: Folder Move Leaves Partial State on Failure
**What goes wrong:** If folder move fails halfway (copy succeeded for 500 of 1000 files, then copy_object raises ClientError), both old and new locations have partial data.
**Why it happens:** S3 has no atomic multi-object transaction.
**How to avoid:** For Phase 4 v1, document this limitation clearly in the API response. Consider implementing as: copy-all-first, verify-count, then delete-all. This narrows the failure window.
**Warning signs:** Admin sees duplicate files in both locations after a failed move.

### Pitfall 3: Rename Folder Is Expensive
**What goes wrong:** Renaming a folder with 10,000 files takes O(N) copy + delete calls. The HTTP request may time out on Heroku (30s limit).
**Why it happens:** S3 has no atomic folder rename — it requires copying every object.
**How to avoid:** For folders, accept the current plan (synchronous, may be slow for very large folders). Document the limitation. Phase 5 will introduce background jobs — large folder operations could be deferred there if needed. For Phase 4, synchronous is fine for typical use cases (model directories with <100 files).
**Warning signs:** 504 Gateway Timeout on rename of large folders on Heroku.

### Pitfall 4: Protected Path Bypass via Path Normalization
**What goes wrong:** Admin sends path like `"models/../models"` or `" models"` (leading space) to bypass the blocklist check.
**Why it happens:** String comparison without normalization.
**How to avoid:** Always call `_validate_path()` (which already strips leading/trailing slashes and checks for `..`) before `_check_protected()`. The existing `_validate_path` already catches `..` traversal.
**Warning signs:** Successful delete of a path that starts with `models/` when `models` is protected.

### Pitfall 5: FileTreeNode Action Buttons Trigger Parent Click Handler
**What goes wrong:** Clicking Delete button expands/collapses the folder because the click bubbles to the parent `div onClick={handleToggle}`.
**Why it happens:** React event bubbling on nested click handlers.
**How to avoid:** Call `e.stopPropagation()` on all action button click handlers — exactly as the Download button already does in Phase 3.
**Warning signs:** Folder expands when admin clicks Delete/Rename.

### Pitfall 6: Rename Modal Needs Target Path Input
**What goes wrong:** For move operations, the admin needs to type the destination path. A simple `<input>` with the current parent path pre-filled is sufficient — but the input must be validated for path traversal before sending to backend.
**Why it happens:** Move is more complex than delete (requires user input of destination).
**How to avoid:** Pre-fill the input with the item's parent directory. Validate on the frontend that the entered path doesn't contain `..`. Backend validates again independently.

## Code Examples

Verified patterns from official sources:

### S3 Paginator for Recursive List
```python
# Source: boto3 docs — Paginators
# https://boto3.amazonaws.com/v1/documentation/api/latest/guide/paginators.html
paginator = s3_client.get_paginator('list_objects_v2')
pages = paginator.paginate(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Prefix=prefix  # e.g. "models/checkpoints/"
)
for page in pages:
    for obj in page.get('Contents', []):
        print(obj['Key'])
```

### S3 Batch Delete
```python
# Source: boto3 docs — delete_objects
# Max 1000 keys per call; check Errors in response
response = s3_client.delete_objects(
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Delete={
        'Objects': [{'Key': key} for key in keys_to_delete],
        'Quiet': True   # suppress per-key success entries in response (saves bandwidth)
    }
)
errors = response.get('Errors', [])
```

### S3 Server-Side Copy
```python
# Source: boto3 docs — copy_object
# CopySource is a dict with Bucket + Key; no data traverses the backend
s3_client.copy_object(
    CopySource={'Bucket': settings.RUNPOD_NETWORK_VOLUME_ID, 'Key': source_key},
    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
    Key=destination_key
)
```

### FastAPI DELETE Endpoint Pattern (extends existing router)
```python
# Pattern: DELETE /api/infrastructure/files?path=...
@router.delete("/files")
async def delete_file(
    path: str = Query(..., description="S3 key of file to delete"),
    admin_user: dict = Depends(verify_admin)
) -> dict:
    service = InfrastructureService()
    success, error = await service.delete_object(path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "path": path}
```

### apiClient Methods Pattern
```typescript
// Follows existing pattern in apiClient.ts
async deleteFile(path: string): Promise<{ success: boolean }> {
  return this.request(
    `/infrastructure/files?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' }
  );
}

async deleteFolder(path: string): Promise<{ success: boolean; deleted_count: number }> {
  return this.request(
    `/infrastructure/folders?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' }
  );
}

async moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean }> {
  return this.request('/infrastructure/files/move', {
    method: 'POST',
    body: JSON.stringify({ source_path: sourcePath, dest_path: destPath }),
  });
}

async renameFolder(sourcePath: string, destPath: string): Promise<{ success: boolean }> {
  return this.request('/infrastructure/folders/move', {
    method: 'POST',
    body: JSON.stringify({ source_path: sourcePath, dest_path: destPath }),
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `list_objects` (v1) | `list_objects_v2` | AWS deprecation | v2 uses ContinuationToken (not Marker), already used in Phase 2 |
| Individual delete loops | `delete_objects` batch (1000/call) | Long-established best practice | Use batch for all multi-object deletes |
| Presigned URLs for download | Backend streaming proxy | Phase 3 decision | RunPod S3 doesn't support presigned URLs; streaming is the only approach (same applies to all S3 operations — use the authenticated client) |

**Deprecated/outdated:**
- `list_objects` (v1): Do not use — use `list_objects_v2` (already consistent with existing code)
- `get_paginator` alternative: Manual loop with `ContinuationToken` — works but fragile; paginator is cleaner

## Open Questions

1. **What are the actual critical protected paths on the RunPod volume?**
   - What we know: A ComfyUI volume typically has `ComfyUI/`, `models/`, `venv/`, `custom_nodes/`, `outputs/` directories
   - What's unclear: Which of these should be un-deletable vs just cautioned against
   - Recommendation: Hard-protect `ComfyUI/` and `venv/` (system infrastructure). Let admin delete `models/` subfolders freely (that is the primary use case). Document the blocklist clearly.

2. **Should rename affect both files and folders, or only files in v1?**
   - What we know: FILEOP-05 says "files and folders"
   - What's unclear: Folder rename on large directories may time out on Heroku
   - Recommendation: Implement rename for both but document the performance limitation for large folders. If a folder rename triggers a 504, the admin can use delete-then-upload as a workaround for Phase 4.

3. **Should move allow cross-path moves (e.g., from `models/` into `outputs/`)?**
   - What we know: FILEOP-04 says "between directories" without restriction
   - What's unclear: Should any cross-directory moves be restricted?
   - Recommendation: Allow any move that doesn't target a protected path. No additional restrictions needed for Phase 4.

## Sources

### Primary (HIGH confidence)
- boto3 S3 documentation: `delete_object`, `delete_objects`, `copy_object`, `list_objects_v2`, `get_paginator` — verified against existing Phase 2-3 usage in `infrastructure_service.py`
- Existing project code: `backend/services/infrastructure_service.py`, `backend/api/infrastructure.py`, `frontend/src/components/FileTreeNode.tsx` — direct inspection of patterns in use

### Secondary (MEDIUM confidence)
- S3 `delete_objects` Errors-in-response behavior: documented in AWS SDK guides; consistent with known S3 eventual consistency model
- Heroku 30s timeout constraint: documented in STATE.md Blockers/Concerns; confirmed as existing architectural constraint

### Tertiary (LOW confidence)
- Specific protected paths for RunPod ComfyUI volumes: inferred from common RunPod ComfyUI Docker images; no official RunPod documentation found specifying which paths must be preserved

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies
- Architecture: HIGH — extends established patterns from Phases 2-3; S3 operations are well-documented
- Pitfalls: HIGH — delete_objects error-in-response and event bubbling are known, verified pitfalls
- Protected paths list: LOW — specific paths are project-context dependent; needs owner input

**Research date:** 2026-03-04
**Valid until:** 2026-09-04 (stable domain — boto3 S3 APIs are highly stable)
