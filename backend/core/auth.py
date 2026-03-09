"""Authentication utilities for JWT verification, API key auth, and user management."""
from typing import Optional
from fastapi import HTTPException, Security, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.supabase import get_supabase
from supabase import Client

security = HTTPBearer(auto_error=False)


def _lookup_api_key_user(api_key: str):
    """Look up a user by API key. Returns Supabase User object or None."""
    from services.api_key_service import ApiKeyService
    service = ApiKeyService()
    return service.lookup_user_by_key(api_key)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    supabase: Client = Depends(get_supabase)
):
    """
    Dependency to get the current authenticated user.
    Supports two auth methods:
      1. X-API-Key header (per-user API key)
      2. Authorization: Bearer <jwt> (Supabase JWT)

    Returns:
        User object from Supabase auth (same shape for both methods)

    Raises:
        HTTPException: If no valid auth is provided
    """
    # Path 1: API Key auth
    if x_api_key:
        user = _lookup_api_key_user(x_api_key)
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Invalid or revoked API key"
            )
        return user

    # Path 2: JWT Bearer auth (existing logic)
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Missing authentication. Provide Authorization: Bearer <token> or X-API-Key header."
        )

    token = credentials.credentials

    try:
        user_response = supabase.auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials"
            )

        return user_response.user

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Could not validate credentials: {str(e)}"
        )


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    supabase: Client = Depends(get_supabase)
) -> Optional[dict]:
    """
    Optional authentication - returns user if authenticated, None otherwise.
    Supports both JWT and API key auth.
    """
    if not credentials and not x_api_key:
        return None

    try:
        return get_current_user(credentials, x_api_key, supabase)
    except HTTPException:
        return None


def verify_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    Dependency to verify user has admin privileges.

    Args:
        user: Current authenticated user

    Returns:
        User object if admin

    Raises:
        HTTPException: If user is not an admin
    """
    # Check if user has admin role in metadata
    user_metadata = user.user_metadata if hasattr(user, 'user_metadata') else {}
    app_metadata = user.app_metadata if hasattr(user, 'app_metadata') else {}

    is_admin = (
        user_metadata.get('role') == 'admin' or
        app_metadata.get('role') == 'admin'
    )

    if not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Admin privileges required"
        )

    return user


def resolve_user_id(
    authorization: Optional[str] = None,
    x_api_key: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve a user_id from either a Bearer token or API key.
    Used by Pattern B endpoints that use Header(None) instead of Depends(get_current_user).

    Returns: user_id string or None
    """
    # Try API key first
    if x_api_key:
        user = _lookup_api_key_user(x_api_key)
        if user:
            return user.id
        return None

    # Try Bearer token
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            try:
                supabase = get_supabase()
                user_response = supabase.auth.get_user(token)
                if user_response and user_response.user:
                    return user_response.user.id
            except Exception:
                pass

    return None
