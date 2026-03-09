"""Pydantic models for API key management."""
from pydantic import BaseModel
from typing import Optional


class ApiKeyInfo(BaseModel):
    key_prefix: str
    name: str
    created_at: str
    last_used_at: Optional[str] = None


class ApiKeyGenerateResponse(BaseModel):
    success: bool
    api_key: Optional[str] = None
    message: str


class ApiKeyStatusResponse(BaseModel):
    success: bool
    has_key: bool
    key_info: Optional[ApiKeyInfo] = None


class ApiKeyRevokeResponse(BaseModel):
    success: bool
    message: str
