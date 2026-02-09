"""Pydantic models for Google Drive API responses."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class DriveFile(BaseModel):
    """Represents a file or folder in Google Drive."""

    id: str
    name: str
    mime_type: str
    is_folder: bool
    size: Optional[int] = None
    created_time: Optional[datetime] = None
    modified_time: Optional[datetime] = None
    parent_id: Optional[str] = None
    web_view_link: Optional[str] = None


class DriveConnectionStatus(BaseModel):
    """Response for drive connection status check."""

    success: bool
    connected: bool
    drive_name: Optional[str] = None
    drive_id: Optional[str] = None
    error: Optional[str] = None


class DriveListResponse(BaseModel):
    """Response for listing files in a folder."""

    success: bool
    files: List[DriveFile] = []
    next_page_token: Optional[str] = None
    error: Optional[str] = None


class DriveFolderResponse(BaseModel):
    """Response for getting a folder with its contents."""

    success: bool
    folder: Optional[DriveFile] = None
    children: List[DriveFile] = []
    error: Optional[str] = None
