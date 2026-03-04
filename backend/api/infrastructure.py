"""Infrastructure management API endpoints (admin-only)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional
from core.auth import verify_admin
from models.infrastructure import FileSystemResponse
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
