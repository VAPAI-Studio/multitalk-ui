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

class CreateFolderRequest(BaseModel):
    """Request to create a new folder (zero-byte S3 placeholder)."""
    path: str               # Desired folder path, e.g. "models/my-loras"


# --- HuggingFace Download models ---

class HFDownloadRequest(BaseModel):
    """Request to start a HuggingFace model download to the RunPod network volume."""
    url: str                          # Full HuggingFace URL (blob or resolve form)
    target_path: str                  # Target directory on volume (e.g. "models/checkpoints")
    hf_token: Optional[str] = None   # HF access token for gated/private repos

class HFDownloadJobStatus(BaseModel):
    """Current status of a background HF download job."""
    job_id: str
    status: Literal["pending", "downloading", "uploading", "done", "error"]
    progress_pct: float = 0.0         # 0-100 within current phase
    bytes_done: int = 0
    total_bytes: Optional[int] = None
    filename: str                     # Original filename being downloaded
    s3_key: str                       # Final S3 key on the volume
    error: Optional[str] = None       # Human-readable error message if status == "error"


# --- Dockerfile editor models (Phase 6) ---

class DockerfileContent(BaseModel):
    """Response model for GET /dockerfiles/content."""
    path: str
    content: str    # Decoded UTF-8 Dockerfile text
    sha: str        # Current blob SHA — must be passed back unmodified on save


class DockerfileSaveRequest(BaseModel):
    """Request body for PUT /dockerfiles/content."""
    content: str
    sha: str
    commit_message: str  # Non-empty required; validation happens in the API layer
