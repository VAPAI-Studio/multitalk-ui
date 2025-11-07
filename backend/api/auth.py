"""Authentication API endpoints."""
from fastapi import APIRouter, HTTPException, Depends, status
from core.supabase import get_supabase
from core.auth import get_current_user
from models.user import (
    UserRegister,
    UserLogin,
    TokenResponse,
    UserResponse,
    PasswordReset,
    PasswordUpdate
)
from supabase import Client
from typing import Dict

router = APIRouter(tags=["Authentication"])


@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserRegister,
    supabase: Client = Depends(get_supabase)
):
    """
    Register a new user.

    Args:
        user_data: User registration data (email, password, optional full_name)
        supabase: Supabase client instance

    Returns:
        TokenResponse with access token and user data

    Raises:
        HTTPException: If registration fails
    """
    try:
        # Register user with Supabase Auth
        auth_response = supabase.auth.sign_up({
            "email": user_data.email,
            "password": user_data.password,
            "options": {
                "data": {
                    "full_name": user_data.full_name
                }
            }
        })

        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User registration failed"
            )

        # Return token and user data
        return TokenResponse(
            access_token=auth_response.session.access_token,
            token_type="bearer",
            expires_in=auth_response.session.expires_in,
            refresh_token=auth_response.session.refresh_token,
            user=UserResponse(
                id=auth_response.user.id,
                email=auth_response.user.email,
                full_name=user_data.full_name,
                created_at=auth_response.user.created_at
            )
        )

    except Exception as e:
        error_message = str(e)

        # Handle specific Supabase errors
        if "already registered" in error_message.lower() or "already exists" in error_message.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User with this email already exists"
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Registration failed: {error_message}"
        )


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    credentials: UserLogin,
    supabase: Client = Depends(get_supabase)
):
    """
    Login with email and password.

    Args:
        credentials: User login credentials (email, password)
        supabase: Supabase client instance

    Returns:
        TokenResponse with access token and user data

    Raises:
        HTTPException: If login fails
    """
    try:
        # Authenticate with Supabase
        auth_response = supabase.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password
        })

        if not auth_response.user or not auth_response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

        # Get user metadata
        user_metadata = auth_response.user.user_metadata or {}

        return TokenResponse(
            access_token=auth_response.session.access_token,
            token_type="bearer",
            expires_in=auth_response.session.expires_in,
            refresh_token=auth_response.session.refresh_token,
            user=UserResponse(
                id=auth_response.user.id,
                email=auth_response.user.email,
                full_name=user_metadata.get("full_name"),
                created_at=auth_response.user.created_at
            )
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )


@router.post("/auth/logout")
async def logout(
    supabase: Client = Depends(get_supabase),
    current_user = Depends(get_current_user)
):
    """
    Logout the current user (invalidate token).

    Args:
        supabase: Supabase client instance
        current_user: Current authenticated user

    Returns:
        Success message
    """
    try:
        supabase.auth.sign_out()
        return {"message": "Successfully logged out"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Logout failed: {str(e)}"
        )


@router.get("/auth/me", response_model=UserResponse)
async def get_current_user_info(
    current_user = Depends(get_current_user)
):
    """
    Get current authenticated user information.

    Args:
        current_user: Current authenticated user from JWT token

    Returns:
        UserResponse with user data
    """
    user_metadata = current_user.user_metadata if hasattr(current_user, 'user_metadata') else {}

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=user_metadata.get("full_name"),
        created_at=current_user.created_at if hasattr(current_user, 'created_at') else None
    )


@router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_token: str,
    supabase: Client = Depends(get_supabase)
):
    """
    Refresh access token using refresh token.

    Args:
        refresh_token: Refresh token
        supabase: Supabase client instance

    Returns:
        TokenResponse with new access token

    Raises:
        HTTPException: If refresh fails
    """
    try:
        auth_response = supabase.auth.refresh_session(refresh_token)

        if not auth_response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )

        user_metadata = auth_response.user.user_metadata or {}

        return TokenResponse(
            access_token=auth_response.session.access_token,
            token_type="bearer",
            expires_in=auth_response.session.expires_in,
            refresh_token=auth_response.session.refresh_token,
            user=UserResponse(
                id=auth_response.user.id,
                email=auth_response.user.email,
                full_name=user_metadata.get("full_name"),
                created_at=auth_response.user.created_at
            )
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token refresh failed: {str(e)}"
        )


@router.post("/auth/password-reset")
async def request_password_reset(
    data: PasswordReset,
    supabase: Client = Depends(get_supabase)
):
    """
    Request password reset email.

    Args:
        data: Email for password reset
        supabase: Supabase client instance

    Returns:
        Success message
    """
    try:
        supabase.auth.reset_password_email(data.email)
        return {"message": "Password reset email sent"}
    except Exception as e:
        # Always return success to prevent email enumeration
        return {"message": "If the email exists, a password reset link has been sent"}


@router.post("/auth/verify-email")
async def verify_email(
    token: str,
    type: str,
    supabase: Client = Depends(get_supabase)
):
    """
    Verify email with token.

    Args:
        token: Verification token from email
        type: Type of verification (signup, recovery, etc.)
        supabase: Supabase client instance

    Returns:
        Success message
    """
    try:
        supabase.auth.verify_otp({
            "token": token,
            "type": type
        })
        return {"message": "Email verified successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Email verification failed: {str(e)}"
        )
