"""API key management endpoints."""
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from services.api_key_service import ApiKeyService
from models.api_key import ApiKeyGenerateResponse, ApiKeyStatusResponse, ApiKeyRevokeResponse

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def get_api_key_service():
    return ApiKeyService()


@router.post("/generate", response_model=ApiKeyGenerateResponse)
async def generate_api_key(
    current_user=Depends(get_current_user),
):
    """Generate a new API key. Revokes any existing active key.
    Returns the plaintext key ONCE — it cannot be retrieved again.
    """
    service = get_api_key_service()
    success, plaintext_key, error = service.create_key(
        user_id=current_user.id,
        name="Default"
    )

    if not success:
        raise HTTPException(status_code=500, detail=error)

    return ApiKeyGenerateResponse(
        success=True,
        api_key=plaintext_key,
        message="Save this key now. It will not be shown again."
    )


@router.get("/current", response_model=ApiKeyStatusResponse)
async def get_current_api_key(
    current_user=Depends(get_current_user),
):
    """Get info about the user's active API key (prefix, dates). Does not reveal the full key."""
    service = get_api_key_service()
    key_info = service.get_active_key_info(current_user.id)

    return ApiKeyStatusResponse(
        success=True,
        has_key=key_info is not None,
        key_info=key_info
    )


@router.delete("/revoke", response_model=ApiKeyRevokeResponse)
async def revoke_api_key(
    current_user=Depends(get_current_user),
):
    """Revoke the user's active API key."""
    service = get_api_key_service()
    success, error = service.revoke_active_key(current_user.id)

    if not success:
        raise HTTPException(status_code=400, detail=error)

    return ApiKeyRevokeResponse(
        success=True,
        message="API key revoked successfully"
    )
