# backend/app/services/auth_service.py

from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from uuid import UUID
import secrets

from screenwriter.config import settings
from screenwriter.models.schemas import User


class AuthService:
    def __init__(self):
        self.secret_key = settings.SECRET_KEY
        self.algorithm = "HS256"
        self.access_token_expire_minutes = 60 * 24 * 7  # 7 days

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

    def get_password_hash(self, password: str) -> str:
        """Generate password hash"""
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def create_access_token(self, data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create JWT access token"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)
        
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
        return encoded_jwt

    def verify_token(self, token: str) -> Optional[str]:
        """Verify JWT token and return user_id"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            user_id: str = payload.get("sub")
            if user_id is None:
                return None
            return user_id
        except JWTError:
            return None

    def create_magic_link_token(self, email: str) -> str:
        """Create a magic link token for email authentication"""
        token_data = {
            "sub": email,
            "type": "magic_link",
            "exp": datetime.utcnow() + timedelta(minutes=15)
        }
        return jwt.encode(token_data, self.secret_key, algorithm=self.algorithm)

    def verify_magic_link_token(self, token: str) -> Optional[str]:
        """Verify magic link token and return email"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            if payload.get("type") != "magic_link":
                return None
            email: str = payload.get("sub")
            return email
        except JWTError:
            return None

    def generate_mock_token(self, user_id: str = "12345678-1234-5678-1234-567812345678") -> str:
        """Generate a mock token for development"""
        token_data = {
            "sub": user_id,
            "email": "user@example.com",
            "exp": datetime.utcnow() + timedelta(days=7)
        }
        return self.create_access_token(token_data)

# Singleton instance
auth_service = AuthService()

# Mock authentication for MVP
class MockAuthService:
    """Mock auth service for MVP - replace with real auth in production"""
    
    def get_current_user(self) -> User:
        """Return mock user for development"""
        return User(
            id=UUID("12345678-1234-5678-1234-567812345678"),
            email="user@example.com",
            display_name="Dev User",
            created_at=datetime.utcnow()
        )
    
    def create_mock_token(self) -> str:
        """Create a mock JWT token"""
        return auth_service.generate_mock_token()

# Export mock service for MVP
mock_auth_service = MockAuthService()
