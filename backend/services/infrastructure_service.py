"""Business logic for infrastructure management."""
import math
import anyio
from typing import Tuple, Optional
from core.s3_client import s3_client
from config.settings import settings
from models.infrastructure import FileSystemItem, FileSystemResponse, UploadInitResponse, UploadPartResponse
from botocore.exceptions import ClientError

CHUNK_SIZE = 5 * 1024 * 1024  # 5MB — S3 minimum part size

# Critical paths that cannot be deleted or moved.
# ComfyUI/ and venv/ are system infrastructure required for RunPod serverless execution.
# models/ subdirectories ARE deletable — that is the primary use case for this feature.
PROTECTED_PATHS = frozenset([
    "ComfyUI",
    "venv",
])


class InfrastructureService:
    """Service for managing RunPod infrastructure."""

    @staticmethod
    def _format_size(bytes_size: float) -> str:
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

    @staticmethod
    def _check_protected(path: str) -> None:
        """Raise ValueError if path is a protected system path."""
        normalized = path.strip('/')
        for protected in PROTECTED_PATHS:
            if normalized == protected or normalized.startswith(protected + '/'):
                raise ValueError(
                    f"Path '{normalized}' is protected and cannot be deleted or moved. "
                    f"Protected top-level directories: {sorted(PROTECTED_PATHS)}"
                )

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

    async def init_multipart_upload(
        self,
        filename: str,
        target_path: str,
        file_size: int
    ) -> Tuple[bool, Optional[UploadInitResponse], Optional[str]]:
        """Create a multipart upload on S3. Returns upload_id and key."""
        try:
            safe_path = self._validate_path(target_path)
            # Validate filename (no path traversal)
            if '/' in filename or '\\' in filename or '..' in filename:
                return False, None, "Invalid filename"
            key = f"{safe_path}/{filename}".lstrip('/')
            response = s3_client.create_multipart_upload(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=key
            )
            total_parts = max(1, math.ceil(file_size / CHUNK_SIZE))
            return True, UploadInitResponse(
                upload_id=response["UploadId"],
                key=key,
                total_parts=total_parts
            ), None
        except ClientError as e:
            return False, None, f"S3 error: {str(e)}"
        except ValueError as e:
            return False, None, str(e)
        except Exception as e:
            return False, None, f"Unexpected error: {str(e)}"

    async def upload_part(
        self,
        upload_id: str,
        key: str,
        part_number: int,
        chunk_bytes: bytes
    ) -> Tuple[bool, Optional[UploadPartResponse], Optional[str]]:
        """Upload a single part. part_number is 1-based."""
        try:
            response = s3_client.upload_part(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=chunk_bytes
            )
            return True, UploadPartResponse(
                part_number=part_number,
                etag=response["ETag"]
            ), None
        except ClientError as e:
            return False, None, f"S3 error: {str(e)}"
        except Exception as e:
            return False, None, f"Unexpected error: {str(e)}"

    async def complete_multipart_upload(
        self,
        upload_id: str,
        key: str,
        parts: list  # list of dicts with PartNumber and ETag
    ) -> Tuple[bool, Optional[str]]:
        """Finalize the multipart upload. Returns (success, error_message)."""
        try:
            s3_client.complete_multipart_upload(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])}
            )
            return True, None
        except ClientError as e:
            return False, f"S3 error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"

    async def abort_multipart_upload(
        self,
        upload_id: str,
        key: str
    ) -> Tuple[bool, Optional[str]]:
        """Abort and clean up an incomplete multipart upload."""
        try:
            s3_client.abort_multipart_upload(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=key,
                UploadId=upload_id
            )
            return True, None
        except ClientError as e:
            return False, f"S3 error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"

    async def download_file_stream(self, path: str):
        """
        Stream an S3 object to the caller as an async generator.
        Returns (generator, content_length, filename) or raises.
        Does NOT buffer the file in memory.
        """
        safe_path = self._validate_path(path)
        if not safe_path:
            raise ValueError("Invalid path")
        filename = safe_path.split("/")[-1] or "download"

        # Get object metadata + body (body is a StreamingBody, lazy)
        response = s3_client.get_object(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=safe_path
        )
        content_length = response.get("ContentLength", 0)
        body = response["Body"]

        async def chunk_generator():
            for chunk in body.iter_chunks(chunk_size=65536):  # 64KB chunks
                yield chunk
                await anyio.sleep(0)  # yield control; allows connection cancellation

        return chunk_generator(), content_length, filename

    async def delete_object(self, path: str) -> Tuple[bool, Optional[str]]:
        """Delete a single file. S3 delete_object is idempotent (204 even if key absent)."""
        try:
            safe_path = self._validate_path(path)
            self._check_protected(safe_path)
            s3_client.delete_object(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=safe_path
            )
            return True, None
        except ValueError as e:
            return False, str(e)
        except ClientError as e:
            return False, f"S3 error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"

    async def delete_folder(self, path: str) -> Tuple[bool, int, Optional[str]]:
        """
        Recursively delete all objects under a folder prefix.
        Returns (success, deleted_count, error).
        Uses individual delete_object calls (delete_objects batch not supported by RunPod S3).
        """
        try:
            safe_path = self._validate_path(path)
            self._check_protected(safe_path)
            prefix = safe_path.rstrip('/') + '/'

            paginator = s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Prefix=prefix
            )

            deleted_count = 0
            for page in pages:
                for obj in page.get('Contents', []):
                    s3_client.delete_object(
                        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                        Key=obj['Key']
                    )
                    deleted_count += 1

            return True, deleted_count, None
        except ValueError as e:
            return False, 0, str(e)
        except ClientError as e:
            return False, 0, f"S3 error: {str(e)}"
        except Exception as e:
            return False, 0, f"Unexpected error: {str(e)}"

    async def move_object(self, source_path: str, dest_path: str) -> Tuple[bool, Optional[str]]:
        """
        Move or rename a single file via download-stream then re-upload then delete.
        copy_object is not supported by RunPod S3, so we stream through the backend.
        Only deletes source AFTER successful upload.
        """
        try:
            safe_src = self._validate_path(source_path)
            safe_dst = self._validate_path(dest_path)
            self._check_protected(safe_src)
            if not safe_src:
                return False, "Source path is empty"
            if not safe_dst:
                return False, "Destination path is empty"
            if safe_src == safe_dst:
                return False, "Source and destination paths are identical"

            get_resp = s3_client.get_object(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=safe_src
            )
            body = get_resp['Body']
            content_length = get_resp.get('ContentLength', 0)
            content_type = get_resp.get('ContentType', 'application/octet-stream')

            s3_client.put_object(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=safe_dst,
                Body=body,
                ContentLength=content_length,
                ContentType=content_type,
            )
            # Only delete source after confirmed successful upload
            s3_client.delete_object(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=safe_src
            )
            return True, None
        except ValueError as e:
            return False, str(e)
        except ClientError as e:
            return False, f"S3 error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"

    async def move_folder(self, source_path: str, dest_path: str) -> Tuple[bool, int, Optional[str]]:
        """
        Move or rename a folder by streaming each object to the new prefix then deleting originals.
        copy_object and delete_objects batch are not supported by RunPod S3, so we stream each
        file through the backend individually. Only deletes source keys after all uploads succeed.
        Returns (success, moved_count, error).
        """
        try:
            safe_src = self._validate_path(source_path)
            safe_dst = self._validate_path(dest_path)
            self._check_protected(safe_src)
            if safe_src == safe_dst:
                return False, 0, "Source and destination paths are identical"

            src_prefix = safe_src.rstrip('/') + '/'
            dst_prefix = safe_dst.rstrip('/') + '/'

            paginator = s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Prefix=src_prefix
            )

            # Phase 1: stream-copy all objects to new prefix
            source_keys = []
            for page in pages:
                for obj in page.get('Contents', []):
                    old_key = obj['Key']
                    new_key = dst_prefix + old_key[len(src_prefix):]
                    get_resp = s3_client.get_object(
                        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                        Key=old_key
                    )
                    s3_client.put_object(
                        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                        Key=new_key,
                        Body=get_resp['Body'],
                        ContentLength=get_resp.get('ContentLength', 0),
                        ContentType=get_resp.get('ContentType', 'application/octet-stream'),
                    )
                    source_keys.append(old_key)

            if not source_keys:
                return True, 0, None  # empty folder — nothing to move

            # Phase 2: delete originals individually (only after all uploads succeeded)
            for old_key in source_keys:
                s3_client.delete_object(
                    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                    Key=old_key
                )

            return True, len(source_keys), None
        except ValueError as e:
            return False, 0, str(e)
        except ClientError as e:
            return False, 0, f"S3 error: {str(e)}"
        except Exception as e:
            return False, 0, f"Unexpected error: {str(e)}"

    async def create_folder(self, path: str) -> Tuple[bool, Optional[str]]:
        """
        Create a folder by writing a zero-byte object with a trailing slash.
        In S3 object storage, folders are virtual — this placeholder makes them visible.
        """
        try:
            safe_path = self._validate_path(path)
            self._check_protected(safe_path)
            if not safe_path:
                return False, "Folder path is empty"
            key = safe_path.rstrip('/') + '/'
            s3_client.put_object(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=key,
                Body=b''
            )
            return True, None
        except ValueError as e:
            return False, str(e)
        except ClientError as e:
            return False, f"S3 error: {str(e)}"
        except Exception as e:
            return False, f"Unexpected error: {str(e)}"
