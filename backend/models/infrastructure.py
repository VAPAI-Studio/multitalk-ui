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


# --- Upload models ---

class UploadInitRequest(BaseModel):
    """Request to start a multipart upload."""
    filename: str           # original filename (not a path)
    target_path: str        # directory on S3 to upload into (e.g. "models/checkpoints")
    file_size: int          # total bytes — used to compute total_parts for frontend

class UploadInitResponse(BaseModel):
    """Returned after creating a multipart upload on S3."""
    upload_id: str          # S3 UploadId — must be passed back for each part
    key: str                # full S3 key: target_path/filename
    total_parts: int        # ceil(file_size / CHUNK_SIZE) — tells frontend how many parts to send

class UploadPartResponse(BaseModel):
    """Returned after each part is successfully uploaded."""
    part_number: int
    etag: str               # MD5 of part content; pass verbatim to complete step

class CompletePartInfo(BaseModel):
    """A single part descriptor for the complete-upload request."""
    part_number: int
    etag: str               # exactly as returned by UploadPartResponse

class CompleteUploadRequest(BaseModel):
    """Request to finalize a multipart upload."""
    upload_id: str
    key: str                # same key returned by init
    parts: List[CompletePartInfo]  # sorted by part_number ascending

class AbortUploadRequest(BaseModel):
    """Request to abort and clean up a failed multipart upload."""
    upload_id: str
    key: str                # same key returned by init


# --- File operation models ---

class DeleteRequest(BaseModel):
    """Request to delete a single file or folder on the network volume."""
    path: str               # S3 key (file) or prefix without trailing slash (folder)
    is_folder: bool = False # True triggers recursive deletion

class MoveFileRequest(BaseModel):
    """Request to move or rename a single file."""
    source_path: str        # Current S3 key
    dest_path: str          # New S3 key (may be in a different directory)

class MoveFolderRequest(BaseModel):
    """Request to move or rename a folder (recursive copy + delete)."""
    source_path: str        # Current folder prefix (no trailing slash)
    dest_path: str          # New folder prefix (no trailing slash)
