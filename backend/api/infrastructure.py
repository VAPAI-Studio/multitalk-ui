"""Infrastructure management API endpoints (admin-only)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, Optional
from core.auth import verify_admin
from models.infrastructure import FileSystemResponse
from services.infrastructure_service import InfrastructureService

router = APIRouter(prefix="/api/infrastructure", tags=["infrastructure"])


@router.get("/health")
async def infrastructure_health(
    admin_user: dict = Depends(verify_admin)  # Per-endpoint protection
) -> Dict[str, Any]:
    """
    Infrastructure health check endpoint.
    Admin-only: Returns basic status.

    NOTE: This project uses per-endpoint protection, not router-level dependencies.
    All future endpoints added to this router must explicitly include
    Depends(verify_admin) in their signature to ensure admin-only access.
    """
    return {
        "success": True,
        "message": "Infrastructure API available",
        "admin_user_id": admin_user.id
    }


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
    service = InfrastructureService()
    success, response, error = await service.list_files(path, limit, continuation_token)

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return response
