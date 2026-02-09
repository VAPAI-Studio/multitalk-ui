"""Service for Google Drive operations."""

from typing import Tuple, Optional, List

from core.google_drive import get_drive_client, get_shared_drive_id, is_drive_configured
from models.google_drive import DriveFile


class GoogleDriveService:
    """Service for interacting with Google Drive Shared Drives."""

    def __init__(self):
        if is_drive_configured():
            self.drive = get_drive_client()
            self.shared_drive_id = get_shared_drive_id()
        else:
            self.drive = None
            self.shared_drive_id = None

    async def check_connection(self) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
        """
        Check if we can connect to the shared drive.

        Returns: (success, drive_name, drive_id, error)
        """
        if not self.drive or not self.shared_drive_id:
            return False, None, None, "Google Drive not configured"

        try:
            # Get shared drive info
            drive_info = self.drive.drives().get(
                driveId=self.shared_drive_id
            ).execute()

            return True, drive_info.get('name'), drive_info.get('id'), None

        except Exception as e:
            return False, None, None, str(e)

    async def list_files(
        self,
        folder_id: Optional[str] = None,
        page_size: int = 50,
        page_token: Optional[str] = None,
        order_by: str = "folder,name"
    ) -> Tuple[bool, List[DriveFile], Optional[str], Optional[str]]:
        """
        List files in the shared drive or a specific folder.

        Args:
            folder_id: Optional folder ID to list contents of (defaults to drive root)
            page_size: Number of results per page
            page_token: Token for pagination

        Returns: (success, files, next_page_token, error)
        """
        if not self.drive or not self.shared_drive_id:
            return False, [], None, "Google Drive not configured"

        try:
            # Build query - if folder_id is provided, list that folder's contents
            # Otherwise list the root of the shared drive
            parent_id = folder_id or self.shared_drive_id
            query = f"'{parent_id}' in parents and trashed = false"

            # Execute request with shared drive support
            response = self.drive.files().list(
                q=query,
                driveId=self.shared_drive_id,
                corpora='drive',
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
                pageSize=page_size,
                pageToken=page_token,
                fields="nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink)",
                orderBy=order_by
            ).execute()

            files = []
            for item in response.get('files', []):
                files.append(DriveFile(
                    id=item['id'],
                    name=item['name'],
                    mime_type=item['mimeType'],
                    is_folder=item['mimeType'] == 'application/vnd.google-apps.folder',
                    size=int(item['size']) if item.get('size') else None,
                    created_time=item.get('createdTime'),
                    modified_time=item.get('modifiedTime'),
                    parent_id=item.get('parents', [None])[0] if item.get('parents') else None,
                    web_view_link=item.get('webViewLink')
                ))

            return True, files, response.get('nextPageToken'), None

        except Exception as e:
            return False, [], None, str(e)

    async def get_folder(self, folder_id: str) -> Tuple[bool, Optional[DriveFile], Optional[str]]:
        """
        Get folder metadata.

        Args:
            folder_id: ID of the folder to get

        Returns: (success, folder, error)
        """
        if not self.drive:
            return False, None, "Google Drive not configured"

        try:
            item = self.drive.files().get(
                fileId=folder_id,
                supportsAllDrives=True,
                fields="id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink"
            ).execute()

            folder = DriveFile(
                id=item['id'],
                name=item['name'],
                mime_type=item['mimeType'],
                is_folder=item['mimeType'] == 'application/vnd.google-apps.folder',
                size=int(item['size']) if item.get('size') else None,
                created_time=item.get('createdTime'),
                modified_time=item.get('modifiedTime'),
                parent_id=item.get('parents', [None])[0] if item.get('parents') else None,
                web_view_link=item.get('webViewLink')
            )

            return True, folder, None

        except Exception as e:
            return False, None, str(e)

    async def get_file(self, file_id: str) -> Tuple[bool, Optional[DriveFile], Optional[str]]:
        """
        Get file metadata.

        Args:
            file_id: ID of the file to get

        Returns: (success, file, error)
        """
        # Same implementation as get_folder - works for both
        return await self.get_folder(file_id)

    async def get_or_create_folder(
        self,
        parent_id: str,
        folder_name: str
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Get an existing folder or create it if it doesn't exist.

        Args:
            parent_id: ID of the parent folder
            folder_name: Name of the folder to get or create

        Returns: (success, folder_id, error)
        """
        if not self.drive or not self.shared_drive_id:
            return False, None, "Google Drive not configured"

        try:
            # Search for existing folder
            query = (
                f"name = '{folder_name}' and "
                f"'{parent_id}' in parents and "
                f"mimeType = 'application/vnd.google-apps.folder' and "
                f"trashed = false"
            )

            response = self.drive.files().list(
                q=query,
                driveId=self.shared_drive_id,
                corpora='drive',
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
                pageSize=1,
                fields="files(id, name)"
            ).execute()

            files = response.get('files', [])

            if files:
                # Folder exists, return its ID
                return True, files[0]['id'], None

            # Folder doesn't exist, create it
            file_metadata = {
                'name': folder_name,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [parent_id]
            }

            folder = self.drive.files().create(
                body=file_metadata,
                supportsAllDrives=True,
                fields='id'
            ).execute()

            return True, folder.get('id'), None

        except Exception as e:
            return False, None, str(e)

    async def upload_file(
        self,
        file_content: bytes,
        filename: str,
        folder_id: str,
        mime_type: str = 'video/mp4'
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Upload a file to Google Drive.

        Args:
            file_content: The file content as bytes
            filename: Name for the file in Drive
            folder_id: ID of the folder to upload to
            mime_type: MIME type of the file

        Returns: (success, file_id, error)
        """
        if not self.drive or not self.shared_drive_id:
            return False, None, "Google Drive not configured"

        try:
            from googleapiclient.http import MediaInMemoryUpload

            file_metadata = {
                'name': filename,
                'parents': [folder_id]
            }

            media = MediaInMemoryUpload(
                file_content,
                mimetype=mime_type,
                resumable=True
            )

            file = self.drive.files().create(
                body=file_metadata,
                media_body=media,
                supportsAllDrives=True,
                fields='id, webViewLink'
            ).execute()

            return True, file.get('id'), None

        except Exception as e:
            return False, None, str(e)
