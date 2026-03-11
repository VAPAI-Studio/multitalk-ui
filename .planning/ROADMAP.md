# Roadmap: sideOUTsticks

## Milestones

- ✅ **v1.0 Infrastructure Management** — Phases 1-7 (shipped 2026-03-11)
- 🚧 **v1.1 Batch Video Upscale** — Phases 10-13 (in progress)

## Phases

<details>
<summary>v1.0 Infrastructure Management (Phases 1-7) -- SHIPPED 2026-03-11</summary>

- [x] Phase 1: Admin Access Control (4/4 plans) -- completed 2026-03-04
- [x] Phase 2: Network Volume File Browser (4/4 plans) -- completed 2026-03-04
- [x] Phase 3: File Transfer (3/3 plans) -- completed 2026-03-04
- [x] Phase 4: File Operations (3/3 plans) -- completed 2026-03-04
- [x] Phase 5: HuggingFace Integration (3/3 plans) -- completed 2026-03-05
- [x] Phase 6: Dockerfile Editor (2/2 plans) -- completed 2026-03-05
- [x] Phase 6.1: File Tree Pagination (1/1 plan) -- completed 2026-03-08
- [x] Phase 6.2: Verification Documentation (1/1 plan) -- completed 2026-03-08
- [x] Phase 7: GitHub Integration (2/2 plans) -- completed 2026-03-09

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### v1.1 Batch Video Upscale

**Milestone Goal:** Enable batch video upscaling via Freepik API with credit-aware queue management and dual output delivery (Supabase Storage + Google Drive).

- [x] **Phase 10: Foundation** - Database schema, Freepik service, API endpoints, settings model (completed 2026-03-11)
- [ ] **Phase 11: Batch Processing** - Sequential queue loop, credit exhaustion detection, pause/resume, error handling
- [ ] **Phase 12: Output Delivery** - Streaming download from Freepik, upload to Supabase Storage + Google Drive, download endpoints
- [ ] **Phase 13: Frontend** - Upload UI, progress display, batch history, homepage integration

## Phase Details

### Phase 10: Foundation
**Goal**: A single video can be submitted to the Freepik API, processed, and its status tracked in the database end-to-end
**Depends on**: Nothing (first phase of v1.1; existing codebase provides auth, storage, Google Drive infrastructure)
**Requirements**: INFR-01, INFR-02, INFR-04, SETT-01, SETT-02, QUEU-01, QUEU-02
**Success Criteria** (what must be TRUE):
  1. Database migration creates batch and video tables; a batch with one video can be created and queried via API
  2. A single video submitted through the API is sent to Freepik, polled to completion, and its final status (completed or failed) is persisted in the database
  3. Upscale settings (resolution, creativity, sharpen, grain, FPS boost, flavor) are accepted by the API with sensible defaults applied when omitted
  4. The batch submission endpoint returns immediately (under 1 second) and processing runs as a background task
  5. If the server restarts while a batch is processing, the interrupted batch resumes automatically on startup
**Plans**: 3 plans

Plans:
- [x] 10-01-PLAN.md -- Database schema, Pydantic models, and Freepik settings configuration
- [x] 10-02-PLAN.md -- FreepikUpscalerService and UpscaleJobService with tests
- [x] 10-03-PLAN.md -- API router, background processing, and startup recovery

### Phase 11: Batch Processing
**Goal**: Multiple videos process sequentially with intelligent error handling that distinguishes transient failures from credit exhaustion
**Depends on**: Phase 10
**Requirements**: QUEU-03, ERRR-01, ERRR-02, ERRR-03, ERRR-04, ERRR-05
**Success Criteria** (what must be TRUE):
  1. A batch of multiple videos processes them one at a time in order; completing one video starts the next automatically
  2. Transient errors (network timeouts, 5xx responses) trigger automatic retry with backoff (up to 2 retries) before marking a video as failed
  3. When Freepik credits are exhausted, all remaining pending videos are set to "paused" (not failed) and a pause reason is recorded in the database
  4. A paused batch can be resumed via API and processing continues from the next pending video without re-processing completed ones
  5. The queue order of pending videos can be changed via API before they are processed
**Plans**: TBD

Plans:
- [ ] 11-01: TBD
- [ ] 11-02: TBD

### Phase 12: Output Delivery
**Goal**: Completed upscaled videos are automatically delivered to Supabase Storage and optionally to Google Drive, and are downloadable by the user
**Depends on**: Phase 11
**Requirements**: DLVR-01, DLVR-02, DLVR-03, DLVR-04
**Success Criteria** (what must be TRUE):
  1. When a video completes upscaling, the result is automatically downloaded from Freepik and uploaded to Supabase Storage (streaming, not full-file-in-memory)
  2. If a Google Drive project folder is selected, the upscaled video is also uploaded to a subfolder in that project (failure does not fail the video)
  3. Individual completed videos can be downloaded from the UI via a direct URL
  4. All completed videos in a batch can be downloaded together as a single ZIP file
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD

### Phase 13: Frontend
**Goal**: Users can upload, configure, monitor, and retrieve batch video upscales through a complete feature page integrated into the app
**Depends on**: Phase 12
**Requirements**: UPLD-01, UPLD-02, UPLD-03, UPLD-04, STAT-01, STAT-02, STAT-03, STAT-04, STAT-05, INFR-03
**Success Criteria** (what must be TRUE):
  1. User can upload multiple video files via file picker or drag-and-drop, with format validation and clear error messages for invalid files
  2. Each queued video shows a preview thumbnail, filename, duration, resolution, and file size; videos exceeding Freepik limits show a warning before submission
  3. Each video displays a color-coded status badge (pending/processing/completed/failed/paused) and the batch shows an overall progress bar with counts and estimated time remaining
  4. User can view past batches in a history feed and re-run a previous batch with the same settings
  5. The Batch Video Upscale page is accessible from the homepage and sidebar navigation for all authenticated users
**Plans**: TBD

Plans:
- [ ] 13-01: TBD
- [ ] 13-02: TBD
- [ ] 13-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 10 -> 11 -> 12 -> 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Admin Access Control | v1.0 | 4/4 | Complete | 2026-03-04 |
| 2. Network Volume File Browser | v1.0 | 4/4 | Complete | 2026-03-04 |
| 3. File Transfer | v1.0 | 3/3 | Complete | 2026-03-04 |
| 4. File Operations | v1.0 | 3/3 | Complete | 2026-03-04 |
| 5. HuggingFace Integration | v1.0 | 3/3 | Complete | 2026-03-05 |
| 6. Dockerfile Editor | v1.0 | 2/2 | Complete | 2026-03-05 |
| 6.1. File Tree Pagination | v1.0 | 1/1 | Complete | 2026-03-08 |
| 6.2. Verification Documentation | v1.0 | 1/1 | Complete | 2026-03-08 |
| 7. GitHub Integration | v1.0 | 2/2 | Complete | 2026-03-09 |
| 10. Foundation | v1.1 | Complete    | 2026-03-11 | 2026-03-11 |
| 11. Batch Processing | v1.1 | 0/2 | Not started | - |
| 12. Output Delivery | v1.1 | 0/2 | Not started | - |
| 13. Frontend | v1.1 | 0/3 | Not started | - |
