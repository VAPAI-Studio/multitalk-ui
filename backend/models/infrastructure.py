"""Pydantic models for infrastructure management."""
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime

class FileSystemItem(BaseModel):
    """A file or folder in the network volume."""
    type: Literal["file", "folder"]
    name: str
    path: str
    size: Optional[int] = None  # bytes, null for folders
    sizeHuman: Optional[str] = None  # "2.5 GB", null for folders
    lastModified: Optional[datetime] = None
    childCount: Optional[int] = None  # for folders only

class FileSystemResponse(BaseModel):
    """Paginated file system listing response."""
    items: List[FileSystemItem]
    totalItems: int
    hasMore: bool
    continuationToken: Optional[str] = None
