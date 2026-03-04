"""Infrastructure management API endpoints (admin-only)."""
from fastapi import APIRouter, Depends
from typing import Dict, Any
from core.auth import verify_admin

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
