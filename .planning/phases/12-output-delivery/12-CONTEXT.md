# Phase 12: Output Delivery - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Completed upscaled videos are automatically delivered to Supabase Storage and optionally to Google Drive, and are downloadable by the user (individual + batch ZIP). This phase modifies the existing `_process_single_video` pipeline to add delivery after Freepik completion, adds a ZIP download endpoint, and wires up public URLs for individual downloads.

Requirements: DLVR-01, DLVR-02, DLVR-03, DLVR-04

</domain>

<decisions>
## Implementation Decisions

### Delivery Timing
- Upload to Supabase Storage happens **inline after each video completes** — right after Freepik returns COMPLETED, before moving to next video
- Google Drive upload also happens **inline per video** — right after Supabase upload for each video, files appear in Drive progressively
- No post-batch sweep needed; delivery is part of the per-video processing pipeline

### Upload Failure Handling
- If Supabase upload fails: video stays **completed** (upscaling succeeded), `supabase_upload_status='failed'`, Freepik temp URL preserved in `output_storage_url` temporarily
- If Google Drive upload fails: video stays **completed**, `drive_upload_status='failed'` — Drive is optional delivery, never fails the video (matches ROADMAP success criteria: "failure does not fail the video")
- No retry logic for upload failures in this phase

### ZIP Download
- ZIP is **generated on demand** when user clicks "Download All" — no pre-built ZIP in storage
- Filenames in ZIP use **original filenames with `_upscaled` suffix** (e.g., `my_video_upscaled.mp4`)
- Due to Heroku 30-second timeout: ZIP creation runs as a **background job with polling** — backend returns job ID, frontend polls until ready, then downloads
- ZIP endpoint requires **standard JWT authentication** (no temporary tokens)

### Download URLs
- Upscaled videos use **public URLs** (permanent, no expiration) — store once, always accessible
- Videos stored in **existing `multitalk-videos` bucket** (not a new bucket) with a subfolder prefix to distinguish from ComfyUI outputs
- Individual video download (DLVR-03): **direct Supabase URL** — frontend already has `output_storage_url` from batch detail response, no backend proxy needed

### Claude's Discretion
- Storage path structure within `multitalk-videos` bucket (user prefers Claude decides)
- Google Drive subfolder naming convention within the project folder
- Exact ZIP background job implementation (in-memory store like HF downloads, or DB-backed)
- Whether to use httpx streaming for Freepik download or full-buffer (based on file sizes)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User consistently chose recommended options aligned with simplicity and existing patterns.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StorageService.upload_video_from_url()`: Downloads video from URL and uploads to Supabase `multitalk-videos` bucket — can be adapted for Freepik output URLs (currently hardcoded to ComfyUI download)
- `StorageService._extract_public_url()` / `get_public_url()`: Already supports public URL generation from Supabase Storage
- `GoogleDriveService.upload_file()`: Accepts bytes + filename + folder_id, returns file_id — ready for Drive delivery
- `GoogleDriveService.get_or_create_folder()`: Can create batch subfolder in project folder
- `ProjectContext` (frontend): Already provides `selectedProject.id` — maps to `project_id` on `upscale_batches`

### Established Patterns
- Thread pool executor for Supabase sync operations (`_supabase_executor` in StorageService)
- Tuple returns `(success, data, error)` across all services
- `asyncio.create_task()` for background processing (used in batch start/resume)
- DB columns already exist: `output_storage_url`, `output_drive_file_id`, `supabase_upload_status`, `drive_upload_status`

### Integration Points
- `_process_single_video()` in `backend/api/upscale.py` — add delivery step after `status == "COMPLETED"` block
- `UpscaleJobService.update_video_status()` — already accepts `output_url` param, needs extension for upload status fields
- Existing `project_id` on `upscale_batches` — links to Google Drive folder for delivery
- New ZIP endpoint on the upscale router (`/upscale/batches/{batch_id}/download-zip`)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-output-delivery*
*Context gathered: 2026-03-11*
