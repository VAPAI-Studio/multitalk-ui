from typing import List, Optional, Tuple
import asyncio
import httpx
import base64
import uuid
import time
from datetime import datetime
from urllib.parse import urlparse, urlencode
from concurrent.futures import ThreadPoolExecutor

from core.supabase import get_supabase
from models.storage import VideoFile

# Reusable thread pool for Supabase operations (avoids thread creation overhead)
_supabase_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="supabase")

class StorageService:
    def __init__(self):
        self.supabase = get_supabase()
        # Reuse httpx client for connection pooling
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create a reusable HTTP client with connection pooling"""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
            )
        return self._http_client

    async def _get_fresh_http_client(self, timeout: float = 120.0) -> httpx.AsyncClient:
        """Create a fresh HTTP client for large downloads (videos) - not pooled"""
        return httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=15.0),
            limits=httpx.Limits(max_keepalive_connections=1, max_connections=2),
            follow_redirects=True
        )

    def _extract_signed_url(self, url_response) -> Optional[str]:
        """Extract signed URL from various response formats"""
        if hasattr(url_response, 'error') and url_response.error:
            return None
        if isinstance(url_response, dict) and url_response.get('error'):
            return None

        if isinstance(url_response, dict):
            return (url_response.get('signedUrl') or
                    url_response.get('signed_url') or
                    url_response.get('url') or
                    url_response.get('publicUrl') or
                    url_response.get('public_url'))
        elif hasattr(url_response, 'signedUrl'):
            return url_response.signedUrl
        elif hasattr(url_response, 'signed_url'):
            return url_response.signed_url
        elif hasattr(url_response, 'url'):
            return url_response.url
        elif isinstance(url_response, str):
            return url_response
        return None

    async def upload_video_to_storage(
        self,
        comfy_url: str,
        filename: str,
        subfolder: str,
        job_id: str,
        video_type: str = 'output'
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Downloads a video from ComfyUI and uploads it to Supabase Storage"""
        start_time = time.time()
        print(f"🔍 Storage service called with: comfy_url={comfy_url}, filename={filename}, subfolder={subfolder}, job_id={job_id}")

        try:
            # Download video from ComfyUI using connection pooling
            clean_url = comfy_url.rstrip('/')
            params = {
                'filename': filename,
                'subfolder': subfolder or '',
                'type': video_type
            }

            video_url = f"{clean_url}/api/view?{urlencode(params)}"
            print(f"🔍 Downloading video from ComfyUI: {video_url}")

            download_start = time.time()
            client = await self._get_http_client()
            video_response = await client.get(
                video_url,
                headers={'Cache-Control': 'no-store'}
            )

            if video_response.status_code != 200:
                print(f"❌ ComfyUI download failed: {video_response.status_code}")
                raise Exception(f"Failed to download video from ComfyUI: {video_response.status_code}")

            video_content = video_response.content
            download_time = time.time() - download_start
            print(f"✅ Downloaded {len(video_content) / 1024 / 1024:.2f}MB in {download_time:.2f}s")

            if len(video_content) == 0:
                raise Exception("Downloaded video file is empty")

            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            storage_path = f"videos/{timestamp}/{job_id}_{filename}"

            # Upload to Supabase Storage using thread pool
            print(f"🔍 Uploading to Supabase Storage: {storage_path}")
            upload_start = time.time()

            loop = asyncio.get_event_loop()
            upload_response = await loop.run_in_executor(
                _supabase_executor,
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .upload(
                    storage_path,
                    video_content,
                    file_options={
                        'content-type': 'video/mp4',
                        'cache-control': '3600',
                        'upsert': 'true'
                    }
                )
            )

            upload_time = time.time() - upload_start
            print(f"✅ Upload completed in {upload_time:.2f}s")

            # Check if upload was successful
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif isinstance(upload_response, dict) and upload_response.get('error'):
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response['error']}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")

            # Get signed URL using thread pool
            url_response = await loop.run_in_executor(
                _supabase_executor,
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .create_signed_url(storage_path, 60 * 60 * 24 * 7)  # 7 days expiry
            )

            signed_url = self._extract_signed_url(url_response)
            if not signed_url:
                raise Exception(f"No signed URL found in response. Response content: {url_response}")

            total_time = time.time() - start_time
            print(f"✅ Total upload time: {total_time:.2f}s (download: {download_time:.2f}s, upload: {upload_time:.2f}s)")

            return True, signed_url, None

        except Exception as error:
            error_message = str(error)
            print(f"❌ Storage service error: {error_message}")

            # Provide more specific error messages
            if "timeout" in error_message.lower():
                error_message = "Timeout connecting to ComfyUI - server may be slow or unreachable"
            elif "connection" in error_message.lower():
                error_message = "Cannot connect to ComfyUI - check if server is running and URL is correct"
            elif "cors" in error_message.lower():
                error_message = "CORS error - ComfyUI may need --enable-cors-header flag"

            return False, None, error_message
    
    async def delete_video_from_storage(self, public_url: str) -> Tuple[bool, Optional[str]]:
        """Delete a video from Supabase Storage"""
        try:
            # Extract path from public URL
            parsed_url = urlparse(public_url)
            path_parts = parsed_url.path.split('/storage/v1/object/public/multitalk-videos/')
            if len(path_parts) < 2:
                raise Exception("Invalid public URL format")
            
            file_path = path_parts[1]
            
            response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .remove([file_path])
            )
            
            if response.error:
                raise Exception(f"Failed to delete from storage: {response.error}")
            
            return True, None
            
        except Exception as error:
            return False, str(error)
    
    async def list_storage_videos(self) -> Tuple[List[VideoFile], Optional[str]]:
        """List all videos in Supabase Storage"""
        try:
            response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .list('', {
                    'limit': 100,
                    'sortBy': {'column': 'created_at', 'order': 'desc'}
                })
            )
            
            if response.error:
                raise Exception(f"Failed to list videos: {response.error}")
            
            files = []
            if response.data:
                for file_info in response.data:
                    public_url_response = self.supabase.storage.from_('multitalk-videos').get_public_url(file_info['name'])
                    files.append(VideoFile(
                        name=file_info['name'],
                        public_url=public_url_response.data['publicUrl'] if public_url_response.data else ''
                    ))
            
            return files, None
            
        except Exception as error:
            return [], str(error)
    
    def _extract_public_url(self, url_response) -> Optional[str]:
        """Extract public URL from various response formats"""
        if hasattr(url_response, 'data') and url_response.data:
            return url_response.data.get('publicUrl') if isinstance(url_response.data, dict) else str(url_response.data)
        elif isinstance(url_response, dict) and 'publicUrl' in url_response:
            return url_response['publicUrl']
        elif isinstance(url_response, str):
            return url_response
        return None

    async def upload_image_from_data_url(self, data_url: str, folder: str = "images") -> Tuple[bool, Optional[str], Optional[str]]:
        """Upload an image from base64 data URL to Supabase Storage"""
        start_time = time.time()
        try:
            # Parse data URL (e.g., "data:image/png;base64,iVBORw0KGg...")
            if not data_url.startswith('data:image/'):
                raise Exception("Invalid data URL format - must be a data:image/ URL")

            # Extract mime type and base64 data
            header, base64_data = data_url.split(',', 1)
            mime_type = header.split(':')[1].split(';')[0]

            # Get file extension from mime type
            extension_map = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/gif': 'gif',
                'image/webp': 'webp'
            }

            extension = extension_map.get(mime_type, 'png')

            # Decode base64 data
            image_bytes = base64.b64decode(base64_data)
            print(f"🔍 Uploading image: {len(image_bytes) / 1024:.1f}KB")

            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            unique_id = str(uuid.uuid4())[:8]
            storage_path = f"{folder}/{timestamp}/{unique_id}.{extension}"

            # Upload to Supabase Storage using thread pool
            loop = asyncio.get_event_loop()
            upload_response = await loop.run_in_executor(
                _supabase_executor,
                lambda: self.supabase.storage
                .from_('edited-images')
                .upload(
                    storage_path,
                    image_bytes,
                    file_options={
                        'content-type': mime_type,
                        'upsert': 'true'
                    }
                )
            )

            # Check for upload errors
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")

            # Get public URL (this is fast, no need for thread pool)
            url_response = self.supabase.storage.from_('edited-images').get_public_url(storage_path)
            public_url = self._extract_public_url(url_response)

            if not public_url:
                raise Exception("Failed to get public URL from Supabase Storage")

            total_time = time.time() - start_time
            print(f"✅ Image uploaded in {total_time:.2f}s")

            return True, public_url, None

        except Exception as error:
            return False, None, str(error)
    
    async def upload_image_from_url(self, image_url: str, folder: str = "images") -> Tuple[bool, Optional[str], Optional[str]]:
        """Download an image from URL and upload to Supabase Storage"""
        start_time = time.time()
        try:
            print(f"🔍 Downloading image from: {image_url}")

            # Download image using connection pooling
            download_start = time.time()
            client = await self._get_http_client()
            image_response = await client.get(image_url)

            if image_response.status_code != 200:
                print(f"❌ Failed to download image: HTTP {image_response.status_code}")
                raise Exception(f"Failed to download image: {image_response.status_code}")

            image_content = image_response.content
            download_time = time.time() - download_start
            print(f"✅ Downloaded {len(image_content) / 1024:.1f}KB in {download_time:.2f}s")

            if len(image_content) == 0:
                raise Exception("Downloaded image file is empty")

            # Determine content type from response headers
            content_type = image_response.headers.get('content-type', 'image/png')

            # Get file extension
            extension_map = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/gif': 'gif',
                'image/webp': 'webp'
            }

            extension = extension_map.get(content_type, 'png')

            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            unique_id = str(uuid.uuid4())[:8]
            storage_path = f"{folder}/{timestamp}/{unique_id}.{extension}"

            # Upload to Supabase Storage using thread pool
            upload_start = time.time()
            loop = asyncio.get_event_loop()
            upload_response = await loop.run_in_executor(
                _supabase_executor,
                lambda: self.supabase.storage
                .from_('edited-images')
                .upload(
                    storage_path,
                    image_content,
                    file_options={
                        'content-type': content_type,
                        'upsert': 'true'
                    }
                )
            )

            upload_time = time.time() - upload_start
            print(f"✅ Uploaded in {upload_time:.2f}s")

            # Check for upload errors
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")

            # Get public URL
            url_response = self.supabase.storage.from_('edited-images').get_public_url(storage_path)
            public_url = self._extract_public_url(url_response)

            if not public_url:
                raise Exception("Failed to get public URL from Supabase Storage")

            total_time = time.time() - start_time
            print(f"✅ Total image upload time: {total_time:.2f}s")

            return True, public_url, None

        except Exception as error:
            return False, None, str(error)

    async def upload_video_from_url(self, video_url: str, folder: str = "videos") -> Tuple[bool, Optional[str], Optional[str]]:
        """Download a video from URL and upload to Supabase Storage"""
        start_time = time.time()
        try:
            print(f"🔍 Downloading video from: {video_url}")

            # Download video using connection pooling
            download_start = time.time()
            client = await self._get_http_client()
            video_response = await client.get(video_url)

            if video_response.status_code != 200:
                print(f"❌ Failed to download video: HTTP {video_response.status_code}")
                raise Exception(f"Failed to download video: {video_response.status_code}")

            video_content = video_response.content
            download_time = time.time() - download_start
            print(f"✅ Downloaded {len(video_content) / 1024 / 1024:.2f}MB in {download_time:.2f}s")

            if len(video_content) == 0:
                raise Exception("Downloaded video file is empty")

            # Determine content type from headers or default to mp4
            content_type = video_response.headers.get('content-type', 'video/mp4')

            # Get file extension based on content type
            extension = 'mp4'  # Default
            if 'webm' in content_type:
                extension = 'webm'
            elif 'mov' in content_type or 'quicktime' in content_type:
                extension = 'mov'

            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            unique_id = str(uuid.uuid4())[:8]
            storage_path = f"{folder}/{timestamp}/{unique_id}.{extension}"

            # Upload to Supabase Storage using thread pool
            print(f"🔍 Uploading to Supabase Storage: {storage_path}")
            upload_start = time.time()
            loop = asyncio.get_event_loop()
            upload_response = await loop.run_in_executor(
                _supabase_executor,
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .upload(
                    storage_path,
                    video_content,
                    file_options={
                        'content-type': content_type,
                        'cache-control': '3600',
                        'upsert': 'true'
                    }
                )
            )

            upload_time = time.time() - upload_start
            print(f"✅ Upload completed in {upload_time:.2f}s")

            # Check for upload errors
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif isinstance(upload_response, dict) and upload_response.get('error'):
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response['error']}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")

            # Get public URL
            url_response = self.supabase.storage.from_('multitalk-videos').get_public_url(storage_path)
            public_url = self._extract_public_url(url_response)

            if not public_url:
                raise Exception("Failed to get public URL from Supabase Storage")

            total_time = time.time() - start_time
            print(f"✅ Total video upload time: {total_time:.2f}s (download: {download_time:.2f}s, upload: {upload_time:.2f}s)")

            return True, public_url, None

        except Exception as error:
            print(f"❌ Video upload error: {str(error)}")
            return False, None, str(error)

    async def upload_user_avatar(self, user_id: str, image_bytes: bytes, content_type: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """Upload user profile picture to Supabase Storage"""
        try:
            # Get file extension from content type
            extension_map = {
                'image/png': 'png',
                'image/jpeg': 'jpg',
                'image/jpg': 'jpg',
                'image/webp': 'webp'
            }

            extension = extension_map.get(content_type, 'png')

            # Storage path: avatars/{user_id}/profile.{ext}
            storage_path = f"avatars/{user_id}/profile.{extension}"

            # Upload to Supabase Storage (user-avatars bucket)
            print(f"[STORAGE] Uploading avatar to: {storage_path}")
            upload_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('user-avatars')
                .upload(
                    storage_path,
                    image_bytes,
                    file_options={
                        'content-type': content_type,
                        'upsert': 'true'  # Replace existing file
                    }
                )
            )

            # Check for upload errors
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif hasattr(upload_response, 'status_code') and upload_response.status_code >= 400:
                raise Exception(f"Failed to upload to Supabase Storage: HTTP {upload_response.status_code}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")

            # Get signed URL (7 days expiry)
            url_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('user-avatars')
                .create_signed_url(storage_path, 60 * 60 * 24 * 7)
            )

            # Extract signed URL from response
            signed_url = None
            if isinstance(url_response, dict):
                signed_url = (url_response.get('signedUrl') or
                            url_response.get('signed_url') or
                            url_response.get('url'))
            elif hasattr(url_response, 'signedUrl'):
                signed_url = url_response.signedUrl
            elif hasattr(url_response, 'signed_url'):
                signed_url = url_response.signed_url
            elif isinstance(url_response, str):
                signed_url = url_response

            if not signed_url:
                raise Exception(f"No signed URL found in response")

            print(f"[STORAGE] Avatar uploaded successfully: {signed_url}")
            return True, signed_url, None

        except Exception as error:
            print(f"[STORAGE] Avatar upload error: {str(error)}")
            return False, None, str(error)

    async def delete_user_avatar(self, user_id: str) -> Tuple[bool, Optional[str]]:
        """Delete user profile picture from Supabase Storage"""
        try:
            # Try to delete all possible extensions
            extensions = ['png', 'jpg', 'jpeg', 'webp']
            deleted = False

            for ext in extensions:
                storage_path = f"avatars/{user_id}/profile.{ext}"
                try:
                    response = await asyncio.to_thread(
                        lambda: self.supabase.storage
                        .from_('user-avatars')
                        .remove([storage_path])
                    )
                    deleted = True
                    print(f"[STORAGE] Deleted avatar: {storage_path}")
                except:
                    # File might not exist with this extension, continue
                    pass

            if not deleted:
                print(f"[STORAGE] No avatar file found for user {user_id}")

            return True, None

        except Exception as error:
            print(f"[STORAGE] Avatar delete error: {str(error)}")
            return False, str(error)
