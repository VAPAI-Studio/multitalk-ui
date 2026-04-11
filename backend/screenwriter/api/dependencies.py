# backend/app/api/dependencies.py

import hashlib
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import datetime
from uuid import UUID

from screenwriter.config import settings
from screenwriter.models import schemas, database
from screenwriter.services.auth_service import auth_service, mock_auth_service
from screenwriter.db import get_db

# Auth dependency
security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> schemas.User:
    """Get current authenticated user (JWT or API key)."""
    try:
        # Mock authentication - only available in development
        if settings.ENVIRONMENT == "development" and credentials.credentials == "mock-token":
            return mock_auth_service.get_current_user()

        # API key authentication (sa_<prefix>_<secret> format)
        if credentials.credentials.startswith("sa_"):
            token = credentials.credentials
            key_hash = hashlib.sha256(token.encode()).hexdigest()
            api_key = db.query(database.ApiKey).filter(
                database.ApiKey.key_hash == key_hash,
                database.ApiKey.is_active == True,
            ).first()
            if not api_key:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid API key",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            if api_key.expires_at and api_key.expires_at.replace(tzinfo=None) < datetime.utcnow():
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="API key expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            # Atomic increment request_count + update last_used_at
            db.execute(
                text(
                    "UPDATE sw_api_keys SET request_count = request_count + 1, "
                    "last_used_at = :now WHERE id = :id"
                ),
                {"now": datetime.utcnow(), "id": str(api_key.id)}
            )
            db.commit()
            # Return user associated with this key
            user = db.query(database.User).filter(database.User.id == api_key.user_id).first()
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return schemas.User(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                created_at=user.created_at,
            )

        # Production JWT authentication flow
        # SECRET_KEY must equal the Supabase JWT secret so Supabase-issued
        # tokens are accepted directly (both use HS256).
        token_str = credentials.credentials
        user_id = auth_service.verify_token(token_str)
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Extract email from the JWT payload for auto-provisioning
        try:
            from jose import jwt as jose_jwt
            payload = jose_jwt.decode(token_str, settings.SECRET_KEY, algorithms=["HS256"])
            email = payload.get("email", "")
        except Exception:
            email = ""

        # Auto-provision: create sw_users row on first login
        user = db.query(database.User).filter(database.User.id == user_id).first()
        if user is None:
            from uuid import UUID
            user = database.User(
                id=UUID(user_id),
                email=email,
                display_name=email.split("@")[0] if email else "User",
                hashed_password="",
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        return schemas.User(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            created_at=user.created_at,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
