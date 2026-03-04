"""Business logic for infrastructure management."""
from typing import Tuple, Optional
from core.s3_client import s3_client
from config.settings import settings
from models.infrastructure import FileSystemItem, FileSystemResponse
from botocore.exceptions import ClientError


class InfrastructureService:
    """Service for managing RunPod infrastructure."""

    @staticmethod
    def _format_size(bytes_size: int) -> str:
        """Convert bytes to human-readable size."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if bytes_size < 1024.0:
                return f"{bytes_size:.1f} {unit}"
            bytes_size /= 1024.0
        return f"{bytes_size:.1f} PB"

    @staticmethod
    def _validate_path(path: str) -> str:
        """Validate and sanitize S3 path."""
        if '..' in path:
            raise ValueError("Path traversal detected")
        # Remove leading/trailing slashes, ensure safe
        path = path.strip('/')
        return path

    async def list_files(
        self,
        path: str = "",
        limit: int = 200,
        continuation_token: Optional[str] = None
    ) -> Tuple[bool, Optional[FileSystemResponse], Optional[str]]:
        """
        List files and folders at given path.

        Returns: (success, response, error_message)
        """
        try:
            # Validate path
            safe_path = self._validate_path(path)
            prefix = f"{safe_path}/" if safe_path else ""

            # Build S3 list request
            params = {
                'Bucket': settings.RUNPOD_NETWORK_VOLUME_ID,
                'Prefix': prefix,
                'Delimiter': '/',
                'MaxKeys': limit
            }
            if continuation_token:
                params['ContinuationToken'] = continuation_token

            # Call S3 API
            response = s3_client.list_objects_v2(**params)

            items = []

            # Add folders (CommonPrefixes)
            for prefix_obj in response.get('CommonPrefixes', []):
                folder_path = prefix_obj['Prefix'].rstrip('/')
                folder_name = folder_path.split('/')[-1]
                items.append(FileSystemItem(
                    type='folder',
                    name=folder_name,
                    path=folder_path,
                    size=None,
                    sizeHuman=None,
                    lastModified=None,
                    childCount=None  # Could be fetched separately
                ))

            # Add files (Contents)
            for obj in response.get('Contents', []):
                # Skip folder markers
                if obj['Key'].endswith('/'):
                    continue
                file_name = obj['Key'].split('/')[-1]
                items.append(FileSystemItem(
                    type='file',
                    name=file_name,
                    path=obj['Key'],
                    size=obj['Size'],
                    sizeHuman=self._format_size(obj['Size']),
                    lastModified=obj['LastModified'],
                    childCount=None
                ))

            # Build response
            result = FileSystemResponse(
                items=items,
                totalItems=len(items),
                hasMore=response.get('IsTruncated', False),
                continuationToken=response.get('NextContinuationToken')
            )

            return True, result, None

        except ClientError as e:
            return False, None, f"S3 error: {str(e)}"
        except ValueError as e:
            return False, None, str(e)
        except Exception as e:
            return False, None, f"Unexpected error: {str(e)}"
