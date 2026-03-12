# Requirements: sideOUTsticks v1.1 Batch Video Upscale

**Defined:** 2026-03-11
**Core Value:** Enable batch video upscaling with smart credit management and organized output delivery

## v1.1 Requirements

Requirements for Batch Video Upscale milestone. Each maps to roadmap phases.

### Upload & Validation

- [ ] **UPLD-01**: User can upload multiple video files via file picker or drag-and-drop
- [ ] **UPLD-02**: System validates video format (MP4, MOV, AVI, WebM) and shows clear error for invalid files
- [ ] **UPLD-03**: System shows preview thumbnail, filename, duration, resolution, and file size for each queued video
- [ ] **UPLD-04**: System warns user if video exceeds Freepik duration/size limits before submission

### Settings

- [x] **SETT-01**: User can configure global upscale settings: resolution (1k/2k/4k), creativity (0-100), sharpen (0-100), smart grain (0-100), FPS boost (on/off), flavor (vivid/natural)
- [x] **SETT-02**: Settings default to sensible values (2k, creativity=0, sharpen=0, grain=0, FPS boost=off, vivid)

### Queue Processing

- [x] **QUEU-01**: Videos process sequentially one at a time through the Freepik API
- [x] **QUEU-02**: Queue is database-backed and processing continues when user navigates away or closes browser
- [x] **QUEU-03**: User can reorder pending videos in the queue via drag-and-drop

### Status & Progress

- [ ] **STAT-01**: Each video displays its current status with visual indicator (pending/processing/completed/failed/paused)
- [ ] **STAT-02**: Batch summary shows total, completed, processing, pending, and failed counts with progress bar
- [ ] **STAT-03**: Estimated time remaining displayed after at least one video completes
- [ ] **STAT-04**: User can view past batches grouped in a feed/history view
- [ ] **STAT-05**: User can re-run a past batch with the same settings

### Output Delivery

- [x] **DLVR-01**: Completed upscaled videos automatically saved to Supabase Storage
- [x] **DLVR-02**: If a Google Drive project is selected, completed videos also uploaded to the project folder
- [x] **DLVR-03**: User can download individual completed videos from the UI
- [x] **DLVR-04**: User can download all completed videos from a batch as a ZIP file

### Error Handling & Credits

- [x] **ERRR-01**: Failed videos show error message and a retry button
- [x] **ERRR-02**: Transient errors (network, 5xx) auto-retry up to 2 times with backoff
- [x] **ERRR-03**: Credit exhaustion is detected and batch pauses automatically (all remaining videos set to paused, not failed)
- [x] **ERRR-04**: User sees a clear notification explaining the pause with guidance to add Freepik credits
- [x] **ERRR-05**: User can resume a paused batch and processing continues from where it left off

### Infrastructure

- [x] **INFR-01**: Database schema supports batch and per-video tracking (new tables/migration)
- [x] **INFR-02**: Freepik API key stored as backend environment variable (FREEPIK_API_KEY)
- [ ] **INFR-03**: New feature page linked from homepage, accessible to all authenticated users
- [x] **INFR-04**: Backend batch processor survives server restarts (resumes interrupted batches on startup)

## Future Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Upload Enhancements

- **UPLD-05**: User can upload videos directly from Google Drive (browse and select)
- **UPLD-06**: Per-video settings override (expand panel on each queue item to customize individual settings)

### UX Enhancements

- **UX-01**: Preset buttons for common configurations ("Standard", "Cinematic", "Animation")
- **UX-02**: Before/after video comparison viewer (side-by-side or slider)
- **UX-03**: Video trimming to work around duration limits

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Parallel API submissions | Sequential required per PROJECT.md; rate limits make parallelism counterproductive |
| Real-time credit balance display | Freepik API does not expose a balance endpoint |
| Multi-API backend support | This milestone is specifically Freepik; ComfyUI upscale already exists separately |
| Freepik account management UI | API key is a backend env var; credit management done on Freepik's site |
| Upload from Google Drive | Planned for future milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UPLD-01 | Phase 13 | Pending |
| UPLD-02 | Phase 13 | Pending |
| UPLD-03 | Phase 13 | Pending |
| UPLD-04 | Phase 13 | Pending |
| SETT-01 | Phase 10 | Complete |
| SETT-02 | Phase 10 | Complete |
| QUEU-01 | Phase 10 | Complete |
| QUEU-02 | Phase 10 | Complete |
| QUEU-03 | Phase 11 | Complete |
| STAT-01 | Phase 13 | Pending |
| STAT-02 | Phase 13 | Pending |
| STAT-03 | Phase 13 | Pending |
| STAT-04 | Phase 13 | Pending |
| STAT-05 | Phase 13 | Pending |
| DLVR-01 | Phase 12 | Complete |
| DLVR-02 | Phase 12 | Complete |
| DLVR-03 | Phase 12 | Complete |
| DLVR-04 | Phase 12 | Complete |
| ERRR-01 | Phase 11 | Complete |
| ERRR-02 | Phase 11 | Complete |
| ERRR-03 | Phase 11 | Complete |
| ERRR-04 | Phase 11 | Complete |
| ERRR-05 | Phase 11 | Complete |
| INFR-01 | Phase 10 | Complete |
| INFR-02 | Phase 10 | Complete |
| INFR-03 | Phase 13 | Pending |
| INFR-04 | Phase 10 | Complete |

**Coverage:**
- v1.1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after roadmap creation*
