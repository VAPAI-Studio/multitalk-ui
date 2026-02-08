"""API endpoints for Google Drive integration."""

from fastapi import APIRouter, Query
from typing import Optional

from models.google_drive import (
    DriveConnectionStatus,
    DriveListResponse,
    DriveFolderResponse
)
from services.google_drive_service import GoogleDriveService

router = APIRouter(prefix="/google-drive", tags=["google-drive"])


def get_service() -> GoogleDriveService:
    """Get a GoogleDriveService instance."""
    return GoogleDriveService()


@router.get("/status", response_model=DriveConnectionStatus)
async def check_drive_connection():
    """
    Check connection to the configured shared drive.

    Returns drive name and ID if connected successfully.
    """
    service = get_service()
    success, drive_name, drive_id, error = await service.check_connection()

    return DriveConnectionStatus(
        success=success,
        connected=success,
        drive_name=drive_name,
        drive_id=drive_id,
        error=error
    )


@router.get("/files", response_model=DriveListResponse)
async def list_files(
    folder_id: Optional[str] = Query(None, description="Folder ID to list contents of (defaults to drive root)"),
    page_size: int = Query(50, ge=1, le=100, description="Number of results per page"),
    page_token: Optional[str] = Query(None, description="Token for pagination"),
    order_by: str = Query("folder,name", description="Sort order: 'folder,name' or 'folder,modifiedTime desc'")
):
    """
    List files and folders in the shared drive or a specific folder.

    Files are ordered by: folders first, then by name.
    """
    service = get_service()
    success, files, next_page_token, error = await service.list_files(
        folder_id=folder_id,
        page_size=page_size,
        page_token=page_token,
        order_by=order_by
    )

    return DriveListResponse(
        success=success,
        files=files,
        next_page_token=next_page_token,
        error=error
    )


@router.get("/folders/{folder_id}", response_model=DriveFolderResponse)
async def get_folder_with_contents(folder_id: str):
    """
    Get folder metadata and its contents.

    Returns both the folder information and a list of its children.
    """
    service = get_service()

    # Get folder info
    success, folder, error = await service.get_folder(folder_id)
    if not success:
        return DriveFolderResponse(success=False, error=error)

    # Get folder contents
    success, children, _, error = await service.list_files(folder_id=folder_id)

    return DriveFolderResponse(
        success=success,
        folder=folder,
        children=children,
        error=error
    )
