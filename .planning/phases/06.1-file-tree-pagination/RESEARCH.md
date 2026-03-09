# Phase 6.1: File Tree Pagination - Research

**Researched:** 2026-03-07
**Domain:** React state management, S3 cursor pagination, file-tree UI patterns
**Confidence:** HIGH — all findings are from direct codebase inspection, no external sources needed

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VOL-04 | File browser handles directories with 10,000+ files without crashing (pagination) | Backend already paginates (S3 MaxKeys + ContinuationToken); only the frontend UI control and state append logic need to be built |
</phase_requirements>

---

## Summary

The backend pagination infrastructure is **completely implemented and correct**. The S3 `list_objects_v2` call in `InfrastructureService.list_files` uses `MaxKeys` + `ContinuationToken`, and the response model includes `hasMore: bool` and `continuationToken: Optional[str]`. The `apiClient.listFiles()` method already accepts a `continuationToken` parameter and passes it to the API.

The gap is **entirely in the frontend**: `FileTree.tsx` calls `apiClient.listFiles(path, 200)` at line 46 but throws away `hasMore` and `continuationToken`. There is no "Load more" control. Directories with 201+ items silently truncate.

There is a second, independent bug: `FileTree.handleRefresh()` at lines 57-60 calls both `loadDirectory(currentPath)` (one GET /files) AND `onRefreshRequest?.()` (which increments `refreshTrigger` in Infrastructure.tsx, remounting FileTree via its `key` prop, which triggers another `loadDirectory` from the mount `useEffect`). Every file operation produces two identical GET /files calls.

**Primary recommendation:** Fix FileTree.tsx only (and its corresponding test). The backend needs no changes. Two small surgical edits — one for pagination state, one to break the double-call loop.

---

## Standard Stack

No new libraries needed. All changes use React hooks and existing `apiClient` methods.

### What Is Already Available

| Piece | Location | Notes |
|-------|----------|-------|
| `apiClient.listFiles(path, limit, continuationToken?)` | `frontend/src/lib/apiClient.ts:1198` | Third argument accepted, passed to backend |
| Backend `GET /api/infrastructure/files?continuation_token=...` | `backend/api/infrastructure.py:86` | Works today |
| `FileSystemResponse.hasMore` | `backend/models/infrastructure.py:20` | Always returned |
| `FileSystemResponse.continuationToken` | `backend/models/infrastructure.py:21` | Non-null when `hasMore: true` |
| Vitest + React Testing Library | `frontend/vitest.config.ts` | Vitest ^4.0.18, existing tests in `__tests__/` |
| Existing FileTree tests | `frontend/src/components/__tests__/FileTree.test.tsx` | 4 tests today |
| Existing FileTreeNode tests | `frontend/src/components/__tests__/FileTreeNode.test.tsx` | 5 tests today |

---

## Architecture Patterns

### Pattern 1: Append-on-Load-More (root FileTree)

`FileTree` manages `rootItems`, `hasMore`, `continuationToken`, and `isLoadingMore` state. The initial load replaces the list. "Load more" appends to it. Expanded folder state in each `FileTreeNode` is preserved because the existing `FileTreeNode` components are **not remounted** — only new nodes are appended below the existing list.

```typescript
// State additions to FileTree
const [hasMore, setHasMore] = useState(false);
const [continuationToken, setContinuationToken] = useState<string | null>(null);
const [isLoadingMore, setIsLoadingMore] = useState(false);

// Initial load — replaces list (existing behavior)
const loadDirectory = async (path: string = "") => {
  setIsLoading(true);
  setError("");
  try {
    const response = await apiClient.listFiles(path, 200);
    setRootItems(response.items);
    setHasMore(response.hasMore);
    setContinuationToken(response.continuationToken);
    setCurrentPath(path);
    onNavigate?.(path);
  } catch (err: any) {
    setError(err.message || "Failed to load directory contents");
  } finally {
    setIsLoading(false);
  }
};

// Load more — appends
const loadMore = async () => {
  if (!continuationToken || isLoadingMore) return;
  setIsLoadingMore(true);
  try {
    const response = await apiClient.listFiles(currentPath, 200, continuationToken);
    setRootItems(prev => [...prev, ...response.items]);
    setHasMore(response.hasMore);
    setContinuationToken(response.continuationToken);
  } catch (err: any) {
    setError(err.message || "Failed to load more items");
  } finally {
    setIsLoadingMore(false);
  }
};
```

The "Load more" button renders at the bottom of the item list when `hasMore` is true:

```tsx
{!isLoading && !error && hasMore && (
  <div className="px-6 py-3 border-t border-gray-100">
    <button
      onClick={loadMore}
      disabled={isLoadingMore}
      className="w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
    >
      {isLoadingMore ? (
        <>
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Loading more...
        </>
      ) : (
        <>
          Load more ({continuationToken ? "more items available" : ""})
        </>
      )}
    </button>
  </div>
)}
```

### Pattern 2: Same Append Pattern for FileTreeNode Children

`FileTreeNode` also calls `apiClient.listFiles(item.path, 200)` when expanding a folder. It too must store `hasMore` + `continuationToken` + `isLoadingMore` and append to `children`.

The `handleCreateFolder` path in `FileTreeNode` also re-fetches on line 146 — `apiClient.listFiles(item.path, 200)`. That call should also capture pagination state.

```typescript
// State additions to FileTreeNode
const [childrenHasMore, setChildrenHasMore] = useState(false);
const [childrenContinuationToken, setChildrenContinuationToken] = useState<string | null>(null);
const [isLoadingMoreChildren, setIsLoadingMoreChildren] = useState(false);

// Modify handleToggle to capture pagination state
const handleToggle = async () => {
  if (item.type === "file") return;
  if (isExpanded) { setIsExpanded(false); return; }
  if (children.length === 0) {
    setIsLoading(true);
    setError("");
    try {
      const response = await apiClient.listFiles(item.path, 200);
      setChildren(response.items);
      setChildrenHasMore(response.hasMore);
      setChildrenContinuationToken(response.continuationToken);
      setIsExpanded(true);
    } catch (err: any) {
      setError(err.message || "Failed to load folder contents");
    } finally {
      setIsLoading(false);
    }
  } else {
    setIsExpanded(true);
  }
};

// Add loadMoreChildren function
const loadMoreChildren = async () => {
  if (!childrenContinuationToken || isLoadingMoreChildren) return;
  setIsLoadingMoreChildren(true);
  try {
    const response = await apiClient.listFiles(item.path, 200, childrenContinuationToken);
    setChildren(prev => [...prev, ...response.items]);
    setChildrenHasMore(response.hasMore);
    setChildrenContinuationToken(response.continuationToken);
  } catch (err: any) {
    setError(err.message || "Failed to load more items");
  } finally {
    setIsLoadingMoreChildren(false);
  }
};
```

### Pattern 3: Fix the Double API Call

**Root cause (confirmed by audit):** `FileTree.handleRefresh()` does two things:

```typescript
// FileTree.tsx lines 57-60 — THE BUG
const handleRefresh = () => {
  loadDirectory(currentPath);      // call #1: direct load
  onRefreshRequest?.();             // call #2: increments refreshTrigger in Infrastructure.tsx
};                                  //          → key changes → FileTree remounts
                                    //          → useEffect fires → loadDirectory() again
```

`Infrastructure.tsx` passes `key={refreshTrigger}` to FileTree, so any change to `refreshTrigger` unmounts+remounts the whole FileTree, which fires the mount `useEffect`, which calls `loadDirectory("")`.

**Fix:** `handleRefresh` should call `onRefreshRequest?.()` only — the caller (Infrastructure.tsx) already wires `onRefreshRequest` to `handleTreeRefresh` which increments `refreshTrigger` and causes the remount, which calls `loadDirectory` once. The duplicate direct `loadDirectory` call in `handleRefresh` is the redundant call.

```typescript
// Fixed handleRefresh — one code path, one load
const handleRefresh = () => {
  onRefreshRequest?.();   // sole trigger — causes remount via key change in Infrastructure.tsx
};
```

Wait — but if `onRefreshRequest` is undefined (FileTree used standalone, without a parent), then refresh does nothing. The correct fix depends on whether `onRefreshRequest` is always provided. Looking at Infrastructure.tsx: it always provides `onRefreshRequest={handleTreeRefresh}`. But the standalone case (no parent) needs to work too.

**Correct fix:** Remove the `key={refreshTrigger}` remount mechanism from Infrastructure.tsx. Instead, expose a `refresh()` imperative handle via `useImperativeHandle`, OR simply make `handleRefresh` the sole reload path and stop using `key` for remounting.

**Simplest correct fix:**

1. In `FileTree.tsx`, `handleRefresh` calls `loadDirectory(currentPath)` only (remove `onRefreshRequest?.()` call or make `onRefreshRequest` a notification-only callback that does NOT cause remount).
2. In `Infrastructure.tsx`, remove `key={refreshTrigger}` and remove `refreshTrigger` state entirely. The `onRefreshRequest` callback on `FileTree` can remain as a side-channel notification to sibling components (FileUpload, HFDownload) that something changed, but it should NOT remount FileTree.

```typescript
// Infrastructure.tsx — REMOVE the key remount mechanism
// Before:
const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
const handleTreeRefresh = () => setRefreshTrigger(t => t + 1);
<FileTree key={refreshTrigger} ... onRefreshRequest={handleTreeRefresh} />

// After:
// No refreshTrigger state needed
<FileTree ... onRefreshRequest={() => {}} />
// FileTree handles its own refresh via handleRefresh → loadDirectory(currentPath)
```

But FileUpload and HFDownload also use `onUploadComplete={handleTreeRefresh}` and `onComplete={handleTreeRefresh}` to trigger refresh. Those callbacks must still cause FileTree to reload. With the remount pattern removed, those callbacks need to call into FileTree's `loadDirectory` differently.

**Best pattern for the project:** Keep `onRefreshRequest` as a prop but change what it does in Infrastructure.tsx. Make `handleTreeRefresh` call a method that triggers `loadDirectory` inside FileTree rather than changing the `key`. Use a `refreshCounter` state internal to FileTree (not the `key` prop):

```typescript
// Infrastructure.tsx (simplified)
const [fileTreeRefreshId, setFileTreeRefreshId] = useState(0);
const handleTreeRefresh = () => setFileTreeRefreshId(id => id + 1);

<FileTree
  // NO key= refresh trick
  refreshId={fileTreeRefreshId}       // new prop
  currentPath={currentPath}
  onNavigate={setCurrentPath}
/>
<FileUpload ... onUploadComplete={handleTreeRefresh} />
<HFDownload ... onComplete={handleTreeRefresh} />
```

```typescript
// FileTree.tsx — add refreshId prop, useEffect on it
interface FileTreeProps {
  refreshId?: number;        // new: incremented by parent to request reload
  currentPath?: string;
  onNavigate?: (path: string) => void;
}

// useEffect triggered by refreshId change
useEffect(() => {
  if (refreshId !== undefined) {
    loadDirectory(currentPath ?? "");
  }
}, [refreshId]);
```

This is one GET /files per file operation. The `onRefreshRequest` prop is no longer needed (or can remain for other purposes).

**Alternatively (minimum-diff fix):** Simply remove `loadDirectory(currentPath)` from `handleRefresh` and keep the rest:

```typescript
// Minimal fix — remove ONE line from handleRefresh
const handleRefresh = () => {
  // loadDirectory(currentPath);  ← REMOVE THIS LINE
  onRefreshRequest?.();            // this still causes remount → loadDirectory in useEffect
};
```

This leaves the remount mechanism in place (Infrastructure.tsx `key` pattern) but eliminates the duplicate direct call. Simpler but keeps a code smell. The planner should choose.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| S3 cursor pagination | Custom offset/page math | S3 `ContinuationToken` — already in backend |
| Infinite scroll | Intersection Observer setup | Simple "Load more" button — appropriate for admin tool, less complex |
| Full tree re-render on operation | Global refresh state | Append-only state update preserves expanded nodes |

---

## Files That Need to Change

### Frontend (required changes)

| File | Change | Why |
|------|--------|-----|
| `frontend/src/components/FileTree.tsx` | Add `hasMore`, `continuationToken`, `isLoadingMore` state; add `loadMore()` function; add "Load more" button in render; fix `handleRefresh` double-call bug; optionally accept `refreshId` prop | Primary work item |
| `frontend/src/components/FileTreeNode.tsx` | Add `childrenHasMore`, `childrenContinuationToken`, `isLoadingMoreChildren` state; update `handleToggle` to capture pagination; add `loadMoreChildren()`; add "Load more" button in children section; update `handleCreateFolder` to capture pagination | Required for VOL-04 in nested folders |
| `frontend/src/pages/Infrastructure.tsx` | Remove `key={refreshTrigger}` remount mechanism; pass `refreshId` prop instead (or use alternative fix) | Required to fix double API call |
| `frontend/src/components/__tests__/FileTree.test.tsx` | Add tests: `hasMore: true` shows "Load more" button; clicking appends items; `hasMore: false` hides button | Test coverage for new behavior |
| `frontend/src/components/__tests__/FileTreeNode.test.tsx` | Add tests: folder with `hasMore: true` shows "Load more" inside expanded children | Test coverage for nested pagination |

### Backend (no changes needed)

| File | Status |
|------|--------|
| `backend/api/infrastructure.py` | Already correct — `limit` and `continuation_token` query params exist |
| `backend/services/infrastructure_service.py` | Already correct — passes `ContinuationToken` to S3, returns `hasMore` and `continuationToken` |
| `backend/models/infrastructure.py` | Already correct — `FileSystemResponse` has `hasMore` and `continuationToken` |
| `frontend/src/lib/apiClient.ts` | Already correct — `listFiles()` accepts and passes `continuationToken` |

---

## Common Pitfalls

### Pitfall 1: Pagination Reset on Refresh
**What goes wrong:** When a file operation triggers a refresh, `loadDirectory` replaces the list. If the user had loaded 5 pages (1000 items), they lose that scroll position and see only 200 items again.
**Why it happens:** The refresh replaces `rootItems` with a fresh first page.
**How to avoid:** This is acceptable behavior. After a delete/rename, reset to page 1. Document it in the UI if needed.
**Warning signs:** User complains that tree "jumps back" after operations — expected behavior, not a bug.

### Pitfall 2: Duplicate Items on Load More
**What goes wrong:** If the user clicks "Load more" twice before the first completes, items can be duplicated.
**Why it happens:** Two concurrent requests with the same token both succeed and both append.
**How to avoid:** The `isLoadingMore` state guard (`if (!continuationToken || isLoadingMore) return;`) prevents this when properly checked before setting state.

### Pitfall 3: Stale Continuation Token After File Operation
**What goes wrong:** User loads page 1 (token A), then deletes a file, then clicks "Load more" with token A — the token points to a stale S3 list cursor.
**Why it happens:** S3 continuation tokens are stable cursor positions; they don't become invalid, but the list may shift.
**How to avoid:** On any refresh (`loadDirectory` call), reset `continuationToken` to null and `hasMore` to false. This is done naturally because `loadDirectory` replaces all pagination state.

### Pitfall 4: FileTreeNode Expanded State Survives Incorrectly
**What goes wrong:** After appending new root items via "Load more", the existing expanded `FileTreeNode` components stay expanded and show their cached children — this is the **desired behavior** because React keys remain stable (item.path is the key). No action needed.
**Why it works:** `rootItems.map((item) => <FileTreeNode key={item.path} ... />)` — React reconciles by key, existing nodes keep their state, new nodes are mounted fresh.

### Pitfall 5: Double API Call in handleRefresh (current bug)
**What goes wrong:** Currently every operation produces 2 GET /files calls.
**Root cause (confirmed):** `handleRefresh` calls `loadDirectory(currentPath)` directly AND `onRefreshRequest?.()` which triggers Infrastructure.tsx's `handleTreeRefresh` → increments `refreshTrigger` → `key` changes → FileTree unmounts+remounts → mount `useEffect` fires → `loadDirectory` again.
**Fix:** Remove either the direct `loadDirectory` call from `handleRefresh`, or remove the `key={refreshTrigger}` remount mechanism from Infrastructure.tsx.

---

## Code Examples

### Current FileTree.tsx — Lines to Change

```typescript
// CURRENT (line 46) — missing pagination state capture
const response = await apiClient.listFiles(path, 200);
setRootItems(response.items);
// hasMore and continuationToken are DISCARDED

// CURRENT handleRefresh (lines 57-60) — causes double call
const handleRefresh = () => {
  loadDirectory(currentPath);   // call #1
  onRefreshRequest?.();          // triggers key change → call #2
};
```

### Current FileTreeNode.tsx — Lines to Change

```typescript
// handleToggle (line 60) — missing pagination capture
const response = await apiClient.listFiles(item.path, 200);
setChildren(response.items);
// hasMore and continuationToken DISCARDED

// handleCreateFolder (line 146) — missing pagination capture
const response = await apiClient.listFiles(item.path, 200);
setChildren(response.items);
// hasMore and continuationToken DISCARDED
```

### Backend Already Works — No Changes

```python
# infrastructure_service.py — already correct
result = FileSystemResponse(
    items=items,
    totalItems=len(items),
    hasMore=response.get('IsTruncated', False),
    continuationToken=response.get('NextContinuationToken')
)
```

```typescript
// apiClient.ts — already accepts continuationToken
async listFiles(
  path: string = "",
  limit: number = 200,
  continuationToken?: string    // ← third arg already exists
): Promise<{ ...; hasMore: boolean; continuationToken: string | null }>
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 + React Testing Library |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd /Users/yvesfogel/Desktop/plataforma_b/multitalk-ui/frontend && npx vitest run src/components/__tests__/FileTree.test.tsx src/components/__tests__/FileTreeNode.test.tsx` |
| Full suite command | `cd /Users/yvesfogel/Desktop/plataforma_b/multitalk-ui/frontend && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOL-04 (pagination UI) | "Load more" button appears when `hasMore: true` | unit | `npx vitest run src/components/__tests__/FileTree.test.tsx` | ✅ (file exists, tests need to be added) |
| VOL-04 (pagination append) | Clicking "Load more" appends items, preserves existing | unit | `npx vitest run src/components/__tests__/FileTree.test.tsx` | ✅ (needs new test) |
| VOL-04 (no button when complete) | "Load more" absent when `hasMore: false` | unit | `npx vitest run src/components/__tests__/FileTree.test.tsx` | ✅ (implied by existing test; explicit assertion) |
| VOL-04 (node pagination) | FileTreeNode "Load more" works for expanded folders | unit | `npx vitest run src/components/__tests__/FileTreeNode.test.tsx` | ✅ (file exists, tests need to be added) |
| Double-call fix | Exactly 1 GET /files after file operation | unit | `npx vitest run src/components/__tests__/FileTree.test.tsx` | ✅ (needs new spy-count test) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/components/__tests__/FileTree.test.tsx src/components/__tests__/FileTreeNode.test.tsx`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. The test files already exist; new test cases need to be added within them.

---

## Open Questions

1. **Which double-call fix approach to use?**
   - What we know: Minimum-diff fix (remove one line from `handleRefresh`) keeps the remount mechanism but eliminates the extra call. Cleaner fix removes the `key` remount pattern entirely and uses a `refreshId` prop instead.
   - What's unclear: Whether any other consumers of `FileTree` rely on the remount behavior.
   - Recommendation: Use the cleaner `refreshId` prop approach — it's architecturally correct and there is only one place FileTree is used (`Infrastructure.tsx`).

2. **Should "Load more" in FileTreeNode also paginate `handleCreateFolder`'s re-fetch?**
   - What we know: `handleCreateFolder` (FileTreeNode.tsx line 146) re-fetches to show the new folder. This call also ignores pagination state.
   - What's unclear: Whether a folder with 201+ children where you create a new subfolder needs the full pagination state restored.
   - Recommendation: Yes, update it to capture pagination state. Small change, consistent behavior.

---

## Sources

### Primary (HIGH confidence)
- Direct source inspection: `frontend/src/components/FileTree.tsx` — confirmed `hasMore`/`continuationToken` are discarded
- Direct source inspection: `frontend/src/components/FileTreeNode.tsx` — confirmed same issue in node expand and createFolder
- Direct source inspection: `frontend/src/lib/apiClient.ts:1198-1225` — confirmed third arg accepted
- Direct source inspection: `backend/services/infrastructure_service.py:53-129` — confirmed S3 `IsTruncated` + `NextContinuationToken` wired correctly
- Direct source inspection: `backend/models/infrastructure.py:16-22` — confirmed `FileSystemResponse` model
- Direct source inspection: `.planning/v1.0-MILESTONE-AUDIT.md` — confirmed double-call root cause analysis
- Direct source inspection: `frontend/src/pages/Infrastructure.tsx` — confirmed `key={refreshTrigger}` remount pattern

### Secondary (MEDIUM confidence)
- S3 `IsTruncated` + `NextContinuationToken` behavior is standard AWS S3 API; RunPod S3 follows same interface (confirmed by existing working implementation)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, pure React state
- Architecture: HIGH — append-on-load-more is the standard pattern for this use case
- Pitfalls: HIGH — confirmed by direct code inspection and audit findings
- Double-call root cause: HIGH — confirmed by audit finding and code trace

**Research date:** 2026-03-07
**Valid until:** 90 days — this is internal codebase knowledge, not external API
