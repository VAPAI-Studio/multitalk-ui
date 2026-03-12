# Phase 2 Research: Network Volume File Browser

**Research Date:** 2026-03-04
**Phase:** 2 of 7 (Network Volume File Browser)
**Depends on:** Phase 1 (Admin Access Control) - COMPLETE

## Executive Summary

Phase 2 requires building a file browser UI that navigates the RunPod network volume using RunPod's S3-compatible API. The research confirms this is technically feasible and identifies key architectural decisions needed for planning.

**Critical Finding:** RunPod's S3-compatible API is available and well-documented. Direct S3 access eliminates the pod-based fallback concern noted in STATE.md, but requires careful handling of pagination, lazy loading, and Heroku constraints.

## Research Questions & Answers

### Q1: Can we access RunPod network volumes via S3 API?

**Answer:** YES - Confirmed working solution.

RunPod provides an [S3-protocol compatible API](https://docs.runpod.io/storage/s3-api) for direct access to network volumes without launching a Pod. This API:
- Uses standard S3 syntax (compatible with boto3 and AWS CLI)
- Available in specific datacenters: EUR-IS-1, EU-RO-1, EU-CZ-1, US-KS-2
- Requires separate "S3 API key" (distinct from RunPod API key)
- No additional cost for API access
- Supports: list, upload, download, delete, sync operations

**Source:** [RunPod S3 API Documentation](https://docs.runpod.io/storage/s3-api), [RunPod Blog: S3 API Launch](https://www.runpod.io/blog/streamline-ai-workflows-s3-api)

**Implications for Planning:**
- Backend can use boto3 (already familiar Python library)
- Need to add S3 credentials configuration to Settings
- Must handle datacenter-specific endpoint URLs
- Eliminates pod-based fallback (S3 API is the solution)

### Q2: How do we handle 10,000+ files without crashing?

**Answer:** Use S3 pagination with boto3 paginators + lazy-loaded frontend tree.

**Backend Pagination:**
- boto3 provides [built-in paginators](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/paginators.html) for `list_objects_v2`
- [Pagination example](https://alexwlchan.net/2019/listing-s3-keys/): `paginator = s3.get_paginator('list_objects_v2')`
- Can limit results per page using `PaginationConfig` with `MaxItems`
- S3 API handles continuation tokens automatically

**Frontend Lazy Loading:**
- Only load/expand folders on user interaction
- Tree nodes fetch children on-demand
- Virtualization for long lists (1000+ items in a single folder)

**Sources:** [Boto3 Paginators](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/paginators.html), [AWS S3 ListObjectsV2 Paginator](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/paginator/ListObjectsV2.html), [Listing S3 Keys Article](https://alexwlchan.net/2019/listing-s3-keys/)

**Implications for Planning:**
- Backend API returns paginated results (e.g., 100-500 items per request)
- Frontend tracks expanded nodes and fetches children lazily
- Need loading indicators for folder expansion
- Cache folder contents briefly to avoid redundant requests

### Q3: What frontend tree component should we use?

**Answer:** Build custom tree component using existing project patterns OR consider MUI X Tree View.

**Custom Component (Recommended - Matches Project Patterns):**
- Project uses React 19.1.1 with TypeScript, TailwindCSS, no UI libraries
- Existing GenerationFeed component shows virtualization patterns (progressive loading, batch fetching)
- Build hierarchical tree with lazy-loaded folders using project's styling patterns
- Pros: Full control, matches existing UI, no new dependencies
- Cons: More implementation work, need to handle virtualization manually

**MUI X Tree View (Alternative - If Performance Critical):**
- [MUI X offers](https://mui.com/x/react-tree-view/) lazy loading, virtualization, drag-drop
- Pros: Battle-tested, handles thousands of nodes efficiently
- Cons: Adds Material UI dependency (project currently has NO UI framework)
- Project philosophy: Minimal dependencies (only 3 prod dependencies: @sparkjsdev/spark, jszip, three.js)

**Sources:** [MUI X Tree View](https://mui.com/x/react-tree-view/), [ReactScript Tree View Comparison](https://reactscript.com/best-tree-view/)

**Implications for Planning:**
- **Decision needed:** Custom vs. library (recommend custom to match project patterns)
- If custom: Plan 2-3 components (TreeView, TreeNode, TreeFolder)
- Must support: expand/collapse, lazy loading, breadcrumb navigation, human-readable sizes

### Q4: What data structure should the backend return?

**Answer:** Hierarchical JSON with folder metadata, lazy-loaded children.

**Proposed Structure:**
```json
{
  "type": "folder",
  "name": "models",
  "path": "/models",
  "children": [
    {
      "type": "folder",
      "name": "checkpoints",
      "path": "/models/checkpoints",
      "childCount": 150,
      "hasMore": true
    },
    {
      "type": "file",
      "name": "config.json",
      "path": "/models/config.json",
      "size": 2048,
      "sizeHuman": "2.0 KB",
      "lastModified": "2026-03-01T12:00:00Z"
    }
  ],
  "totalItems": 2,
  "hasMore": false,
  "continuationToken": null
}
```

**Key Fields:**
- `type`: "file" or "folder"
- `path`: Full S3 key (slash-separated)
- `size` + `sizeHuman`: Bytes + formatted string (e.g., "2.5 GB")
- `childCount`: Number of items in folder (for pagination UX)
- `hasMore`: Whether folder has additional items (pagination)
- `continuationToken`: S3 pagination token for loading more

**Implications for Planning:**
- Backend service: `InfrastructureService` with S3 client wrapper
- API endpoint: `GET /api/infrastructure/files?path=/models&limit=100`
- Need utility function for human-readable sizes (KB, MB, GB)
- Frontend tracks expanded folders and loaded children

### Q5: How do we handle Heroku's 30-second timeout?

**Answer:** Use streaming responses or immediate-return + polling for large directories.

**The Problem:**
- [Heroku enforces 30-second HTTP timeout](https://devcenter.heroku.com/articles/request-timeout)
- Large directory listings (10,000+ files) may exceed this
- Backend 512MB memory limit (noted in STATE.md) affects buffering

**Solutions:**
1. **Pagination (Primary):**
   - Limit results to 100-500 items per request
   - Frontend loads additional pages on-demand
   - Each request completes well under 30 seconds

2. **Streaming (If Needed):**
   - [Heroku supports streaming](https://www.heroku.com/blog/timeout-quickly/) with rolling 55-second window
   - First byte within 30 seconds, then keep-alive with data chunks
   - FastAPI supports StreamingResponse

3. **Background Jobs (Large Operations):**
   - For operations like "list all files recursively" (Phase 4+)
   - Return job ID immediately, poll for completion
   - Store results in Supabase or S3

**Sources:** [Heroku Request Timeout](https://devcenter.heroku.com/articles/request-timeout), [Preventing H12 Errors](https://devcenter.heroku.com/articles/preventing-h12-errors-request-timeouts), [Timeout Quickly Article](https://www.heroku.com/blog/timeout-quickly/)

**Implications for Planning:**
- Default pagination limit: 100-200 items
- Backend timeout: 10-15 seconds (well under 30)
- Frontend shows "Load More" button if `hasMore: true`
- No background jobs needed for Phase 2 (just browsing)

### Q6: What are the security considerations?

**Answer:** Admin-only access enforced at multiple layers.

**Access Control Layers:**
1. **Frontend:** AuthContext `isAdmin` check (Phase 1 complete)
2. **Backend:** `verify_admin` dependency on all endpoints (Phase 1 complete)
3. **S3 Credentials:** Server-side only (never exposed to frontend)
4. **Path Validation:** Prevent directory traversal attacks (e.g., `../../etc/passwd`)

**New Security Needs for Phase 2:**
- Validate S3 paths: no `..`, must start with `/` or be relative
- Sanitize file/folder names in responses
- Rate limiting on list endpoints (prevent abuse)
- Log all file access for audit trail (v2 feature)

**Implications for Planning:**
- Backend validator: `validate_s3_path(path: str) -> str`
- Use existing `verify_admin` dependency on all infrastructure routes
- Add S3 error handling (access denied, bucket not found)

### Q7: What S3 operations are needed for Phase 2?

**Answer:** List objects with prefix filtering (folder navigation).

**Required Operations:**
- `list_objects_v2(Bucket, Prefix, Delimiter='/', MaxKeys=100)` - List folder contents
- Delimiter `/` ensures hierarchical navigation (folders vs. files)
- Prefix filters to subfolder (e.g., `Prefix='/models/checkpoints/'`)

**NOT Needed for Phase 2:**
- Upload (`put_object`) - Phase 3
- Download (`get_object` or presigned URL) - Phase 3
- Delete (`delete_object`) - Phase 4
- Move/rename (copy + delete) - Phase 4

**boto3 Setup:**
```python
import boto3

s3_client = boto3.client(
    's3',
    endpoint_url='https://s3.runpod.io',  # Datacenter-specific
    aws_access_key_id=settings.RUNPOD_S3_ACCESS_KEY,
    aws_secret_access_key=settings.RUNPOD_S3_SECRET_KEY,
    region_name='eu-ro-1'  # Datacenter ID
)

# List folder contents
response = s3_client.list_objects_v2(
    Bucket='network-volume-id',
    Prefix='models/',
    Delimiter='/',
    MaxKeys=100
)
```

**Implications for Planning:**
- Add boto3 to requirements.txt (check if already present)
- Settings: `RUNPOD_S3_ACCESS_KEY`, `RUNPOD_S3_SECRET_KEY`, `RUNPOD_NETWORK_VOLUME_ID`, `RUNPOD_S3_ENDPOINT_URL`, `RUNPOD_S3_REGION`
- Create S3 client singleton (similar to `core/supabase.py`)

## Technical Findings Summary

### Existing Patterns to Follow

**From Phase 1:**
- Admin-only API routes with `Depends(verify_admin)`
- `infrastructure.py` router under `/api/infrastructure`
- Frontend: `Infrastructure.tsx` page with admin guard
- Settings: `config/settings.py` with environment variables

**From Frontend Components:**
- GenerationFeed: Progressive loading, pagination, virtualization patterns
- TailwindCSS styling: rounded-3xl, gradient backgrounds, shadow-lg
- No UI libraries (pure React + TailwindCSS)
- apiClient: Centralized API calls with token refresh

**Backend Architecture:**
- Service layer: `services/infrastructure_service.py` (to be created)
- API layer: `api/infrastructure.py` (exists, needs file browser endpoints)
- Models: `models/infrastructure.py` (to be created)
- Core utilities: `core/s3_client.py` (to be created)

### Dependencies to Add

**Python (backend/requirements.txt):**
- `boto3>=1.34.0` - AWS SDK for S3 operations (check if already present)

**TypeScript (frontend - none needed):**
- Use existing React, TailwindCSS for tree component

### Configuration Requirements

**Backend .env Variables:**
```bash
# RunPod S3 API (new in Phase 2)
RUNPOD_S3_ACCESS_KEY=your-s3-access-key
RUNPOD_S3_SECRET_KEY=your-s3-secret-key
RUNPOD_NETWORK_VOLUME_ID=your-volume-id
RUNPOD_S3_ENDPOINT_URL=https://eu-ro-1.s3.runpod.io
RUNPOD_S3_REGION=eu-ro-1
```

**Settings.py Additions:**
```python
# RunPod S3 Configuration
RUNPOD_S3_ACCESS_KEY: str = ""
RUNPOD_S3_SECRET_KEY: str = ""
RUNPOD_NETWORK_VOLUME_ID: str = ""
RUNPOD_S3_ENDPOINT_URL: str = "https://eu-ro-1.s3.runpod.io"
RUNPOD_S3_REGION: str = "eu-ro-1"
```

### Performance Considerations

**Backend:**
- S3 list operations typically < 1 second for 100-500 items
- Pagination prevents memory issues on backend
- boto3 handles connection pooling automatically

**Frontend:**
- Lazy loading prevents rendering 10,000+ nodes at once
- Cache expanded folders for 30 seconds (like GenerationFeed polling)
- Virtual scrolling IF single folder has 1000+ items (rare, but possible)

**Heroku Constraints:**
- 30-second timeout: Mitigated by pagination (each request < 5 seconds)
- 512MB memory: No issue (JSON response ~10KB per 100 items)

## Architecture Decisions Needed

### Decision 1: Tree Component Approach
**Options:**
- A) Custom tree component (matches project patterns, no new deps)
- B) MUI X Tree View (performance-optimized, adds dependency)

**Recommendation:** Option A (Custom)
- Project has zero UI framework dependencies
- GenerationFeed shows team can build complex UI with React + TailwindCSS
- Phase 2 requirements are straightforward (lazy loading, breadcrumbs)
- MUI X adds Material UI, increases bundle size

**Trade-offs:**
- Custom: More implementation work, full control, consistent styling
- MUI X: Faster implementation, battle-tested, but UI inconsistency

### Decision 2: Pagination Strategy
**Options:**
- A) Load all items in folder, paginate on frontend (simpler)
- B) Backend pagination with "Load More" button (scalable)

**Recommendation:** Option B (Backend Pagination)
- VOL-04 requires handling 10,000+ files without crashing
- Heroku timeout risk with large folders
- Better UX for slow networks (initial load fast)

**Implementation:**
- Backend: Return 100-200 items per request with `hasMore` flag
- Frontend: Show "Load More" button if `hasMore: true`
- Cache loaded items to avoid refetch on collapse/expand

### Decision 3: S3 Client Initialization
**Options:**
- A) Global S3 client singleton (like Supabase client)
- B) Create client per request (more resource-intensive)

**Recommendation:** Option A (Singleton)
- Matches existing `core/supabase.py` pattern
- boto3 handles connection pooling internally
- Credentials loaded once from settings

**Implementation:**
```python
# core/s3_client.py
from boto3 import client
from config.settings import settings

def get_s3_client():
    return client(
        's3',
        endpoint_url=settings.RUNPOD_S3_ENDPOINT_URL,
        aws_access_key_id=settings.RUNPOD_S3_ACCESS_KEY,
        aws_secret_access_key=settings.RUNPOD_S3_SECRET_KEY,
        region_name=settings.RUNPOD_S3_REGION
    )

s3_client = get_s3_client()
```

### Decision 4: Breadcrumb Navigation
**Options:**
- A) Frontend-only (parse path string)
- B) Backend returns breadcrumb array

**Recommendation:** Option A (Frontend-Only)
- Simple path parsing: `"/models/checkpoints/flux".split("/")`
- No backend logic needed
- Frontend controls navigation state

**Implementation:**
```tsx
// Frontend breadcrumb component
const parts = path.split('/').filter(Boolean)
const breadcrumbs = parts.map((part, i) => ({
  name: part,
  path: '/' + parts.slice(0, i + 1).join('/')
}))
```

### Decision 5: Folder vs. File Detection
**Options:**
- A) Use S3 `CommonPrefixes` (folders) and `Contents` (files)
- B) Treat everything as file, infer folders from trailing `/`

**Recommendation:** Option A (S3 CommonPrefixes)
- S3 API distinguishes folders and files when using `Delimiter='/'`
- `CommonPrefixes`: Array of folder prefixes (e.g., `['models/checkpoints/']`)
- `Contents`: Array of file objects (keys, sizes, modified dates)

**Implementation:**
```python
response = s3.list_objects_v2(Bucket=volume_id, Prefix=path, Delimiter='/')

folders = [
    {
        'type': 'folder',
        'name': prefix['Prefix'].rstrip('/').split('/')[-1],
        'path': prefix['Prefix'].rstrip('/')
    }
    for prefix in response.get('CommonPrefixes', [])
]

files = [
    {
        'type': 'file',
        'name': obj['Key'].split('/')[-1],
        'path': obj['Key'],
        'size': obj['Size'],
        'lastModified': obj['LastModified']
    }
    for obj in response.get('Contents', [])
    if not obj['Key'].endswith('/')  # Exclude folder markers
]
```

## Risk Assessment

### Critical Risks

1. **RunPod S3 API Availability**
   - **Risk:** API not available in user's datacenter
   - **Likelihood:** Low (4 datacenters supported, expanding)
   - **Impact:** HIGH - Phase 2 blocked
   - **Mitigation:** Validate datacenter support early in planning
   - **Fallback:** Document supported datacenters in setup guide

2. **S3 Credentials Configuration**
   - **Risk:** User doesn't have S3 API key (separate from RunPod API key)
   - **Likelihood:** Medium (easy to miss)
   - **Impact:** HIGH - Feature unusable
   - **Mitigation:** Clear setup documentation, health check endpoint
   - **Detection:** Backend `/api/infrastructure/health` checks S3 credentials

3. **Pagination Edge Cases**
   - **Risk:** Folder with 50,000+ files exceeds S3 API limits
   - **Likelihood:** Low (most folders < 1,000 files)
   - **Impact:** Medium - Folder not browsable
   - **Mitigation:** Backend pagination with 100-200 item limit
   - **UX:** Show "Load More" button, warn if folder > 10,000 items

### Medium Risks

4. **Heroku Timeout on Large Folders**
   - **Risk:** List operation takes > 30 seconds
   - **Likelihood:** Very Low (with pagination)
   - **Impact:** Medium - Request fails with H12 error
   - **Mitigation:** Pagination (100-200 items per request)
   - **Monitoring:** Log request duration, alert if > 15 seconds

5. **Tree Component Performance**
   - **Risk:** Custom tree component lags with 1,000+ nodes
   - **Likelihood:** Low (lazy loading prevents rendering all nodes)
   - **Impact:** Low - Poor UX, but functional
   - **Mitigation:** Virtual scrolling if folder has 1,000+ items
   - **Fallback:** Add loading spinners, debounce expand/collapse

6. **S3 API Rate Limiting**
   - **Risk:** RunPod throttles excessive API calls
   - **Likelihood:** Low (browsing is low-frequency)
   - **Impact:** Low - Temporary errors
   - **Mitigation:** Cache folder contents for 30 seconds
   - **Retry:** Exponential backoff on 429 errors

### Low Risks

7. **Path Traversal Attacks**
   - **Risk:** Malicious paths (e.g., `../../sensitive-data`)
   - **Likelihood:** Very Low (admin-only, single user)
   - **Impact:** Low - No sensitive data outside volume
   - **Mitigation:** Path validation in backend

8. **Date Formatting Issues**
   - **Risk:** S3 `LastModified` in incorrect timezone
   - **Likelihood:** Low (boto3 handles this)
   - **Impact:** Very Low - Cosmetic only
   - **Mitigation:** Use ISO 8601 format, frontend displays in user's timezone

## Success Criteria Validation

**VOL-01: Admin can view hierarchical tree of files and folders**
- ✅ Confirmed: S3 API with `Delimiter='/'` provides hierarchical structure
- Implementation: TreeView component with folders and files

**VOL-02: File browser displays name, size (human-readable), and last modified date**
- ✅ Confirmed: S3 API returns `Key` (name), `Size` (bytes), `LastModified` (ISO timestamp)
- Implementation: Format bytes to KB/MB/GB, display date in readable format

**VOL-03: Admin can expand and collapse folders without page reload**
- ✅ Confirmed: React state management with lazy-loaded children
- Implementation: TreeFolder component fetches children on expand

**VOL-04: File browser handles directories with 10,000+ files without crashing**
- ✅ Confirmed: Backend pagination + lazy loading prevents rendering all items
- Implementation: Paginated API responses, "Load More" button

**VOL-05: Admin can navigate to any path level via breadcrumb or tree clicks**
- ✅ Confirmed: Frontend breadcrumb from path string, tree click updates selected path
- Implementation: Breadcrumb component, tree node onClick handler

**All success criteria are achievable with identified architecture.**

## Next Steps for Planning

### Information Gathered for 03-PLAN.md

1. **Component Structure:**
   - Backend: S3 client singleton, InfrastructureService, API endpoints
   - Frontend: TreeView, TreeNode, TreeFolder, Breadcrumb components

2. **API Endpoints Needed:**
   - `GET /api/infrastructure/files?path=/models&limit=100&offset=0`
   - `GET /api/infrastructure/health` (extended with S3 check)

3. **Data Models:**
   - `FileSystemItem` (type, name, path, size, lastModified)
   - `FileSystemResponse` (items, totalItems, hasMore, continuationToken)

4. **Configuration:**
   - 5 new environment variables for S3 access
   - Settings.py updates
   - .env.example documentation

5. **Implementation Waves:**
   - Wave 1: Backend S3 client, list endpoint, pagination
   - Wave 2: Frontend tree component, lazy loading
   - Wave 3: Breadcrumb navigation, polish

### Questions for Planner

- **Pagination limit:** 100, 200, or 500 items per request? (Recommend 200)
- **Cache duration:** 30 seconds (matches GenerationFeed) or longer?
- **Virtual scrolling:** Include in Phase 2 or defer to Phase 3? (Recommend defer)
- **Testing strategy:** Manual testing or add S3 mock in tests?

### Blocked Items (None)

All research questions answered. No technical blockers identified.

## References

### Documentation Sources
- [RunPod S3 API Documentation](https://docs.runpod.io/storage/s3-api)
- [RunPod Blog: Streamline AI Workflows with S3 API](https://www.runpod.io/blog/streamline-ai-workflows-s3-api)
- [Boto3 Paginators Guide](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/paginators.html)
- [AWS S3 ListObjectsV2 Paginator](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/paginator/ListObjectsV2.html)
- [Listing S3 Keys in Python](https://alexwlchan.net/2019/listing-s3-keys/)
- [MUI X Tree View](https://mui.com/x/react-tree-view/)
- [Heroku Request Timeout](https://devcenter.heroku.com/articles/request-timeout)
- [Heroku: Preventing H12 Errors](https://devcenter.heroku.com/articles/preventing-h12-errors-request-timeouts)
- [Heroku Blog: Timeout Quickly](https://www.heroku.com/blog/timeout-quickly/)

### Internal Project References
- `CLAUDE.md` - Project architecture and patterns
- `STATE.md` - Project decisions and blockers
- `REQUIREMENTS.md` - VOL-01 through VOL-05
- `ROADMAP.md` - Phase dependencies and success criteria
- `backend/config/settings.py` - Existing configuration patterns
- `backend/api/infrastructure.py` - Existing admin-only router
- `backend/services/runpod_service.py` - RunPod API integration patterns
- `frontend/src/components/GenerationFeed.tsx` - Pagination and lazy loading patterns
- `frontend/src/pages/Infrastructure.tsx` - Current placeholder page

---

**Research Complete:** 2026-03-04
**Status:** Ready for planning (03-PLAN.md)
**Blockers Resolved:** RunPod S3 API access confirmed (STATE.md blocker removed)
