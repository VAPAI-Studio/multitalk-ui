"""Authentication utilities for JWT verification and user management."""
from typing import Optional
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.supabase import get_supabase
from supabase import Client
import jwt
import os

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
    supabase: Client = Depends(get_supabase)
):
    """
    Dependency to get the current authenticated user from JWT token.

    Args:
        credentials: Bearer token from request header
        supabase: Supabase client instance

    Returns:
        User object from Supabase auth

    Raises:
        HTTPException: If token is invalid or user not found
    """
    token = credentials.credentials

    try:
        # Verify the JWT token with Supabase
        user_response = supabase.auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials"
            )

        return user_response.user

    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Could not validate credentials: {str(e)}"
        )


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    supabase: Client = Depends(get_supabase)
) -> Optional[dict]:
    """
    Optional authentication - returns user if authenticated, None otherwise.
    Useful for endpoints that work both authenticated and unauthenticated.

    Args:
        credentials: Optional bearer token from request header
        supabase: Supabase client instance

    Returns:
        User object if authenticated, None otherwise
    """
    if not credentials:
        return None

    try:
        return get_current_user(credentials, supabase)
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
