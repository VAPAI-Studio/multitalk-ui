"""Infrastructure management API endpoints (admin-only)."""
from fastapi import APIRouter, Depends, HTTPException, Query, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from typing import Dict, Any, Optional
from core.auth import verify_admin
from models.infrastructure import (
    FileSystemResponse,
    UploadInitRequest,
    UploadInitResponse,
    UploadPartResponse,
    CompleteUploadRequest,
    AbortUploadRequest,
)
from services.infrastructure_service import InfrastructureService
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
        "admin_user_id": admin_user.id,
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
