"""Infrastructure management API endpoints (admin-only)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from typing import Dict, Any, Optional
import httpx
from core.auth import verify_admin
from models.infrastructure import (
    FileSystemResponse,
    UploadInitRequest,
    UploadInitResponse,
    UploadPartResponse,
    CompleteUploadRequest,
    AbortUploadRequest,
    DeleteRequest,
    MoveFileRequest,
    MoveFolderRequest,
    CreateFolderRequest,
    HFDownloadRequest,
    HFDownloadJobStatus,
    DockerfileContent,
    DockerfileSaveRequest,
)
from services.infrastructure_service import InfrastructureService
from services.hf_download_service import (
    parse_hf_url,
    new_job,
    get_hf_job,
    start_hf_download_job,
)
from services.github_service import GitHubService
from core.s3_client import s3_client
from config.settings import settings
from botocore.exceptions import ClientError

router = APIRouter(prefix="/api/infrastructure", tags=["infrastructure"])


@router.get("/health")
async def infrastructure_health(
    admin_user: dict = Depends(verify_admin)
) -> Dict[str, Any]:
    """
    Infrastructure health check endpoint with S3 connectivity test.
    Admin-only: Returns API status and S3 connection status.

    NOTE: This project uses per-endpoint protection, not router-level dependencies.
    All future endpoints added to this router must explicitly include
    Depends(verify_admin) in their signature to ensure admin-only access.
    """
    # Basic API health
    result = {
        "success": True,
        "message": "Infrastructure API available",
        "admin_user_id": admin_user.get("id") if isinstance(admin_user, dict) else admin_user.id,
        "s3_connected": False,
        "s3_bucket": settings.RUNPOD_NETWORK_VOLUME_ID,
        "s3_error": None
    }

    # Test S3 connectivity
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        result["s3_error"] = "S3 credentials not configured. Set RUNPOD_S3_ACCESS_KEY, RUNPOD_S3_SECRET_KEY, and RUNPOD_NETWORK_VOLUME_ID in .env"
        return result

    try:
        # Try to list bucket (empty prefix, limit 1 to minimize overhead)
        response = s3_client.list_objects_v2(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Prefix="",
            MaxKeys=1
        )
        result["s3_connected"] = True
        result["message"] = "Infrastructure API and S3 connection healthy"

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        result["s3_error"] = f"S3 error ({error_code}): {error_message}"

    except Exception as e:
        result["s3_error"] = f"Unexpected S3 error: {str(e)}"

    return result


@router.get("/files", response_model=FileSystemResponse)
async def list_files(
    path: str = Query(default="", description="Directory path to list"),
    limit: int = Query(default=200, le=500, description="Max items per page"),
    continuation_token: Optional[str] = Query(default=None, description="Pagination token"),
    admin_user: dict = Depends(verify_admin)
) -> FileSystemResponse:
    """
    List files and folders on RunPod network volume.
    Admin-only endpoint with pagination support.
    """
    # Check if credentials are configured before attempting S3 call
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(
            status_code=400,
            detail="S3 credentials not configured. Set RUNPOD_S3_ACCESS_KEY, RUNPOD_S3_SECRET_KEY, RUNPOD_NETWORK_VOLUME_ID, RUNPOD_S3_ENDPOINT_URL, and RUNPOD_S3_REGION in backend/.env"
        )

    service = InfrastructureService()
    success, response, error = await service.list_files(path, limit, continuation_token)

    if not success:
        # Map S3 errors to appropriate HTTP status codes (avoids client-side retry loops)
        if error and "AccessDenied" in error:
            raise HTTPException(
                status_code=403,
                detail="S3 access denied. Verify your RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY have permission for this network volume."
            )
        elif error and "NoSuchBucket" in error:
            raise HTTPException(
                status_code=404,
                detail="Network volume not found. Check RUNPOD_NETWORK_VOLUME_ID in backend/.env"
            )
        elif error and "Path traversal detected" in error:
            raise HTTPException(status_code=400, detail=error)
        else:
            raise HTTPException(status_code=500, detail=error)

    return response


@router.post("/upload/init", response_model=UploadInitResponse)
async def init_upload(
    payload: UploadInitRequest,
    admin_user: dict = Depends(verify_admin)
) -> UploadInitResponse:
    """
    Step 1 of 3: Initialize a multipart upload.
    Returns upload_id and s3_key to use for subsequent part uploads.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, response, error = await service.init_multipart_upload(
        payload.filename, payload.target_path, payload.file_size
    )
    if not success:
        raise HTTPException(status_code=500, detail=error)
    return response


@router.put("/upload/part", response_model=UploadPartResponse)
async def upload_part(
    upload_id: str = Query(..., description="UploadId from init step"),
    part_number: int = Query(..., description="1-based part index"),
    key: str = Query(..., description="S3 key from init step"),
    chunk: UploadFile = File(..., description="Raw chunk bytes (5MB min, except last part)"),
    admin_user: dict = Depends(verify_admin)
) -> UploadPartResponse:
    """
    Step 2 of 3: Upload one part. Repeat for each 5MB chunk.
    Returns ETag — store it; required for the complete step.
    Admin-only.
    """
    if part_number < 1 or part_number > 10000:
        raise HTTPException(status_code=400, detail="part_number must be 1–10000")

    chunk_bytes = await chunk.read()

    service = InfrastructureService()
    success, response, error = await service.upload_part(
        upload_id, key, part_number, chunk_bytes
    )
    if not success:
        raise HTTPException(status_code=500, detail=error)
    return response


@router.post("/upload/complete")
async def complete_upload(
    payload: CompleteUploadRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Step 3 of 3: Finalize the multipart upload.
    Assembles all parts into a single S3 object.
    Admin-only.
    """
    parts = [{"PartNumber": p.part_number, "ETag": p.etag} for p in payload.parts]

    service = InfrastructureService()
    success, error = await service.complete_multipart_upload(
        payload.upload_id, payload.key, parts
    )
    if not success:
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "key": payload.key}


@router.post("/upload/abort")
async def abort_upload(
    payload: AbortUploadRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Abort a multipart upload on error.
    MUST be called on any upload failure to avoid orphaned parts and storage charges.
    Admin-only.
    """
    service = InfrastructureService()
    success, error = await service.abort_multipart_upload(
        payload.upload_id, payload.key
    )
    if not success:
        raise HTTPException(status_code=500, detail=error)
    return {"success": True}


@router.get("/download")
async def download_file(
    path: str = Query(..., description="Full S3 key of file to download"),
    admin_user: dict = Depends(verify_admin)
) -> StreamingResponse:
    """
    Stream a file from RunPod S3 to the browser without buffering entire file in memory.
    Uses 64KB chunk streaming — works for files of any size, keeps Heroku rolling timeout alive.
    NOTE: RunPod S3 does NOT support presigned URLs. Backend proxy is the only approach.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    try:
        service = InfrastructureService()
        chunk_generator, content_length, filename = await service.download_file_stream(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        if error_code == 'NoSuchKey':
            raise HTTPException(status_code=404, detail="File not found on volume")
        raise HTTPException(status_code=500, detail=f"S3 error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download error: {str(e)}")

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    if content_length:
        headers["Content-Length"] = str(content_length)

    return StreamingResponse(
        chunk_generator,
        media_type="application/octet-stream",
        headers=headers
    )


@router.delete("/files")
async def delete_file(
    path: str = Query(..., description="Full S3 key of the file to delete"),
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Delete a single file from the RunPod network volume.
    Returns 403 if the path is a protected system directory.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, error = await service.delete_object(path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "path": path}


@router.delete("/folders")
async def delete_folder(
    path: str = Query(..., description="Folder prefix to delete recursively (no trailing slash)"),
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Recursively delete all objects under a folder prefix.
    Returns 403 if the path is a protected system directory.
    WARNING: This permanently deletes all contents. No undo.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, deleted_count, error = await service.delete_folder(path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "path": path, "deleted_count": deleted_count}


@router.post("/files/move")
async def move_file(
    payload: MoveFileRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Move or rename a single file via server-side S3 copy + delete.
    No data flows through the backend — copy_object is an S3-native operation.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, error = await service.move_object(payload.source_path, payload.dest_path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "source_path": payload.source_path, "dest_path": payload.dest_path}


@router.post("/folders/move")
async def move_folder_endpoint(
    payload: MoveFolderRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Move or rename a folder by recursively copying all objects then batch-deleting originals.
    NOTE: S3 has no atomic multi-object transaction. Large folder operations may approach
    Heroku's 30-second timeout. For very large folders (>1000 files), consider smaller batches.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, moved_count, error = await service.move_folder(payload.source_path, payload.dest_path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {
        "success": True,
        "source_path": payload.source_path,
        "dest_path": payload.dest_path,
        "moved_count": moved_count
    }


@router.post("/folders")
async def create_folder(
    payload: CreateFolderRequest,
    admin_user: dict = Depends(verify_admin)
) -> dict:
    """
    Create a folder by writing a zero-byte S3 placeholder object.
    Admin-only.
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    service = InfrastructureService()
    success, error = await service.create_folder(payload.path)
    if not success:
        if error and "protected" in error.lower():
            raise HTTPException(status_code=403, detail=error)
        raise HTTPException(status_code=500, detail=error)
    return {"success": True, "path": payload.path.rstrip('/') + '/'}


@router.post("/hf-download")
async def start_hf_download(
    payload: HFDownloadRequest,
    background_tasks: BackgroundTasks,
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """
    Start a HuggingFace model download directly to the RunPod network volume.
    Returns job_id immediately — poll GET /hf-download/{job_id} for status.
    Admin-only.

    Flow: parse URL → create job → fire background task → return job_id.
    Background task: hf_hub_download to /tmp → S3 multipart upload → delete /tmp.
    Auth/not-found errors surface via polling (status === "error").
    """
    if not settings.RUNPOD_S3_ACCESS_KEY or not settings.RUNPOD_NETWORK_VOLUME_ID:
        raise HTTPException(status_code=400, detail="S3 credentials not configured")

    # Step 1: Parse URL to extract repo_id and filename (format validation only)
    try:
        repo_id, filename = parse_hf_url(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Step 2: Resolve HF token (per-request takes priority over settings default)
    hf_token = payload.hf_token or settings.HF_TOKEN or None

    # Step 3: Determine S3 key
    target = payload.target_path.rstrip("/")
    s3_key = f"{target}/{filename}" if target else filename

    # Step 4: Create in-memory job record
    job_id = new_job(filename, s3_key)

    # Step 5: Fire background task — runs in threadpool, response returned immediately
    # Auth/not-found/gated errors are caught inside _blocking_hf_download_and_upload
    background_tasks.add_task(
        start_hf_download_job, job_id, repo_id, filename, s3_key, hf_token
    )

    return {
        "success": True,
        "job_id": job_id,
        "filename": filename,
        "s3_key": s3_key,
    }


@router.get("/hf-download/{job_id}")
async def get_hf_download_status(
    job_id: str,
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """
    Poll the status of a HuggingFace download job.
    Returns immediately (dict lookup only — no blocking).
    Poll every 2-3 seconds from the frontend.
    Admin-only.
    """
    job = get_hf_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found. It may have expired (server restart clears in-memory jobs).")
    return {"job_id": job_id, **job}


# ---------------------------------------------------------------------------
# Dockerfile editor endpoints (Phase 6)
# ---------------------------------------------------------------------------

@router.get("/dockerfiles/content")
async def get_dockerfile(
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """
    Fetch the configured Dockerfile from GitHub.
    Returns content (decoded UTF-8), sha, and path.
    Path and repo are taken from settings — the frontend does not pass them.
    Admin-only.
    """
    if not settings.GITHUB_TOKEN or not settings.GITHUB_REPO or not settings.GITHUB_DOCKERFILE_PATH:
        raise HTTPException(
            status_code=400,
            detail="GitHub credentials not configured. Set GITHUB_TOKEN, GITHUB_REPO, and GITHUB_DOCKERFILE_PATH in .env",
        )
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        result = await service.get_file(settings.GITHUB_DOCKERFILE_PATH)
        return {"success": True, **result}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"GitHub API error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub error: {str(e)}")


@router.put("/dockerfiles/content")
async def save_dockerfile(
    payload: DockerfileSaveRequest,
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """
    Commit updated Dockerfile content to GitHub with a custom commit message.
    SHA must be the value returned by the most recent GET /dockerfiles/content call.
    Returns commit_sha of the new commit.
    Admin-only.
    """
    if not settings.GITHUB_TOKEN or not settings.GITHUB_REPO or not settings.GITHUB_DOCKERFILE_PATH:
        raise HTTPException(
            status_code=400,
            detail="GitHub credentials not configured. Set GITHUB_TOKEN, GITHUB_REPO, and GITHUB_DOCKERFILE_PATH in .env",
        )
    if not payload.commit_message.strip():
        raise HTTPException(status_code=422, detail="commit_message must not be empty")
    service = GitHubService(settings.GITHUB_TOKEN, settings.GITHUB_REPO, settings.GITHUB_BRANCH)
    try:
        result = await service.update_file(
            settings.GITHUB_DOCKERFILE_PATH,
            payload.content,
            payload.sha,
            payload.commit_message.strip(),
        )
        commit_sha = result["commit"]["sha"]

        # Optionally create GitHub release to trigger RunPod rebuild
        release_info = None
        deploy_error = None
        if payload.trigger_deploy:
            from datetime import datetime
            timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            tag_name = f"deploy-{timestamp}"
            try:
                release_result = await service.create_release(
                    tag_name=tag_name,
                    target_commitish=commit_sha,
                    name=f"Deploy {timestamp}",
                    body=payload.commit_message.strip(),
                )
                release_info = {
                    "tag_name": release_result["tag_name"],
                    "html_url": release_result.get("html_url", ""),
                }
            except httpx.HTTPStatusError as release_err:
                deploy_error = f"Commit succeeded but release creation failed: {release_err.response.text}"

        return {
            "success": True,
            "commit_sha": commit_sha,
            "deploy_triggered": bool(payload.trigger_deploy and release_info),
            "release": release_info,
            "deploy_error": deploy_error,
        }
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status == 409:
            raise HTTPException(
                status_code=409,
                detail="SHA conflict: the file was modified since you opened it. Reload and re-apply your changes.",
            )
        raise HTTPException(status_code=status, detail=f"GitHub API error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"GitHub error: {str(e)}")


# ---------------------------------------------------------------------------
# Static config file endpoints for WorkflowBuilder (Phase 15)
# ---------------------------------------------------------------------------

@router.get("/node-registry")
async def get_node_registry(
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """Return node_registry.json for dependency checking. Admin-only."""
    import json
    from pathlib import Path
    registry_path = Path(__file__).resolve().parent.parent / "runpod_config" / "node_registry.json"
    if not registry_path.exists():
        raise HTTPException(status_code=404, detail="node_registry.json not found")
    return json.loads(registry_path.read_text())


@router.get("/model-manifest")
async def get_model_manifest(
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """Return model_manifest.json for model presence checking. Admin-only."""
    import json
    from pathlib import Path
    manifest_path = Path(__file__).resolve().parent.parent / "runpod_config" / "model_manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="model_manifest.json not found")
    return json.loads(manifest_path.read_text())
