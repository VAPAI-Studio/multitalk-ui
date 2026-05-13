# backend/app/exceptions.py

from fastapi import HTTPException, status
from typing import Any, Dict, Optional, List

class AppException(HTTPException):
    """Base application exception"""
    def __init__(
        self,
        status_code: int,
        detail: str,
        headers: Optional[Dict[str, Any]] = None
    ):
        super().__init__(status_code=status_code, detail=detail, headers=headers)

class ValidationException(AppException):
    """Validation error exception"""
    def __init__(self, detail: str, field: Optional[str] = None):
        message = f"{field}: {detail}" if field else detail
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

class AuthenticationException(AppException):
    """Authentication error exception"""
    def __init__(self, detail: str = "Authentication required"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"}
        )

class AuthorizationException(AppException):
    """Authorization error exception"""
    def __init__(self, detail: str = "Not authorized to access this resource"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail
        )

class NotFoundException(AppException):
    """Resource not found exception"""
    def __init__(self, resource: str, identifier: Optional[str] = None):
        detail = f"{resource} not found"
        if identifier:
            detail += f": {identifier}"
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail
        )

class ConflictException(AppException):
    """Resource conflict exception"""
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail
        )

class RateLimitException(AppException):
    """Rate limit exceeded exception"""
    def __init__(self, retry_after: Optional[int] = None):
        headers = {"Retry-After": str(retry_after)} if retry_after else None
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers=headers
        )

class ExternalServiceException(AppException):
    """External service error exception"""
    def __init__(self, service: str, detail: str):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{service} error: {detail}"
        )

class OpenAIException(ExternalServiceException):
    """OpenAI service error exception"""
    def __init__(self, detail: str):
        super().__init__(service="OpenAI", detail=detail)

class DatabaseException(AppException):
    """Database error exception"""
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {detail}"
        )

class ConfigurationException(AppException):
    """Configuration error exception"""
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Configuration error: {detail}"
        )

# Error response models
class ErrorDetail:
    """Error detail model"""
    def __init__(self, field: Optional[str], message: str):
        self.field = field
        self.message = message

class ErrorResponse:
    """Standard error response"""
    def __init__(
        self,
        detail: str,
        errors: Optional[List[ErrorDetail]] = None,
        code: Optional[str] = None
    ):
        self.detail = detail
        self.errors = errors or []
        self.code = code
    
    def to_dict(self) -> Dict[str, Any]:
        response = {"detail": self.detail}
        if self.errors:
            response["errors"] = [
                {"field": e.field, "message": e.message} for e in self.errors
            ]
        if self.code:
            response["code"] = self.code
        return response
