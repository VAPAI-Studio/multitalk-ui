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
        user_id = auth_service.verify_token(credentials.credentials)
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Query real user from database
        user = db.query(database.User).filter(database.User.id == user_id).first()
        if user is None:
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

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
