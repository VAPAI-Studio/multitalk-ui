from typing import List, Optional, Tuple
import asyncio
import httpx
import base64
import uuid
from datetime import datetime
from urllib.parse import urlparse, urlencode

from core.supabase import get_supabase
from models.storage import VideoFile

class StorageService:
    def __init__(self):
        self.supabase = get_supabase()
    
    async def upload_video_to_storage(
        self,
        comfy_url: str,
        filename: str,
        subfolder: str,
        job_id: str,
        video_type: str = 'output'
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Downloads a video from ComfyUI and uploads it to Supabase Storage"""
        print(f"🔍 Storage service called with: comfy_url={comfy_url}, filename={filename}, subfolder={subfolder}, job_id={job_id}")
        try:
            # Download video from ComfyUI
            clean_url = comfy_url.rstrip('/')
            params = {
                'filename': filename,
                'subfolder': subfolder or '',
                'type': video_type
            }
            
            video_url = f"{clean_url}/api/view?{urlencode(params)}"  # Added '/api' to path
            print(f"🔍 Attempting to download video from ComfyUI: {video_url}")
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                video_response = await client.get(
                    video_url,
                    headers={'Cache-Control': 'no-store'}
                )
                
                if video_response.status_code != 200:
                    print(f"❌ ComfyUI download failed: {video_response.status_code} - {video_response.text[:200]}")
                    raise Exception(f"Failed to download video from ComfyUI: {video_response.status_code}")
                
                video_content = video_response.content
                
                if len(video_content) == 0:
                    raise Exception("Downloaded video file is empty")
            
            # Generate storage path
            from datetime import datetime
            timestamp = datetime.now().strftime('%Y-%m-%d')
            storage_path = f"videos/{timestamp}/{job_id}_{filename}"
            
            # Upload to Supabase Storage
            print(f"🔍 Uploading to Supabase Storage: {storage_path}")
            upload_response = await asyncio.to_thread(
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
            print(f"🔍 Upload response type: {type(upload_response)}")
            
            # Check for upload errors with different response formats
            print(f"🔍 Upload response attributes: {dir(upload_response)}")
            
            # Check if upload was successful
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif isinstance(upload_response, dict) and upload_response.get('error'):
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response['error']}")
            elif hasattr(upload_response, 'status_code') and upload_response.status_code >= 400:
                raise Exception(f"Failed to upload to Supabase Storage: HTTP {upload_response.status_code}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")
            
            # For storage3.types.UploadResponse, check if the upload was successful
            # The response should have a 'path' attribute if successful
            if hasattr(upload_response, 'path') and not upload_response.path:
                raise Exception("Upload failed: No path returned from Supabase Storage")
            
            # Get signed URL (since bucket is private)
            url_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .create_signed_url(storage_path, 60 * 60 * 24 * 7)  # 7 days expiry
            )
            
            print(f"🔍 URL response type: {type(url_response)}")
            print(f"🔍 URL response content: {url_response}")
            
            # Handle different response formats for signed URL
            signed_url = None
            
            # Check if response has error
            if hasattr(url_response, 'error') and url_response.error:
                raise Exception(f"Failed to get signed URL from Supabase Storage: {url_response.error}")
            elif isinstance(url_response, dict) and url_response.get('error'):
                raise Exception(f"Failed to get signed URL from Supabase Storage: {url_response['error']}")
            
            # Try different ways to extract the signed URL
            if isinstance(url_response, dict):
                # Check common signed URL field names
                signed_url = (url_response.get('signedUrl') or 
                            url_response.get('signed_url') or 
                            url_response.get('url') or
                            url_response.get('publicUrl') or
                            url_response.get('public_url'))
            elif hasattr(url_response, 'signedUrl'):
                signed_url = url_response.signedUrl
            elif hasattr(url_response, 'signed_url'):
                signed_url = url_response.signed_url
            elif hasattr(url_response, 'url'):
                signed_url = url_response.url
            elif hasattr(url_response, 'publicUrl'):
                signed_url = url_response.publicUrl
            elif hasattr(url_response, 'public_url'):
                signed_url = url_response.public_url
            elif isinstance(url_response, str):
                # If the response is directly a string URL
                signed_url = url_response
            
            if not signed_url:
                raise Exception(f"No signed URL found in response. Response content: {url_response}")
            
            return True, signed_url, None
            
        except Exception as error:
            error_message = str(error)
            print(f"❌ Storage service error: {error_message}")
            print(f"❌ Error type: {type(error)}")
            
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
    
    async def upload_image_from_data_url(self, data_url: str, folder: str = "images") -> Tuple[bool, Optional[str], Optional[str]]:
        """Upload an image from base64 data URL to Supabase Storage"""
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
            
            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            unique_id = str(uuid.uuid4())[:8]
            storage_path = f"{folder}/{timestamp}/{unique_id}.{extension}"
            
            # Upload to Supabase Storage
            upload_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('edited-images')
                .upload(
                    storage_path,
                    image_bytes,
                    file_options={'upsert': 'true'}
                )
            )
            
            # Check for upload errors with different response formats
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif hasattr(upload_response, 'status_code') and upload_response.status_code >= 400:
                raise Exception(f"Failed to upload to Supabase Storage: HTTP {upload_response.status_code}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")
            
            # Get public URL
            url_response = self.supabase.storage.from_('edited-images').get_public_url(storage_path)
            
            # Handle different response formats
            if hasattr(url_response, 'data') and url_response.data:
                public_url = url_response.data.get('publicUrl') if isinstance(url_response.data, dict) else str(url_response.data)
            elif isinstance(url_response, dict) and 'publicUrl' in url_response:
                public_url = url_response['publicUrl']
            elif isinstance(url_response, str):
                public_url = url_response
            else:
                raise Exception("Failed to get public URL from Supabase Storage")
            
            return True, public_url, None
            
        except Exception as error:
            return False, None, str(error)
    
    async def upload_image_from_url(self, image_url: str, folder: str = "images") -> Tuple[bool, Optional[str], Optional[str]]:
        """Download an image from URL and upload to Supabase Storage"""
        try:
            print(f"[STORAGE] Attempting to download image from: {image_url}")
            # Download image from URL (increased timeout for large images)
            async with httpx.AsyncClient(timeout=60.0) as client:
                image_response = await client.get(image_url)
                
                if image_response.status_code != 200:
                    print(f"[STORAGE] Failed to download image: HTTP {image_response.status_code}")
                    raise Exception(f"Failed to download image: {image_response.status_code}")

                image_content = image_response.content
                print(f"[STORAGE] Downloaded {len(image_content)} bytes")

                if len(image_content) == 0:
                    raise Exception("Downloaded image file is empty")
            
            # Determine content type from response headers or URL
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

            print(f"[STORAGE] Uploading to Supabase Storage: {storage_path}")

            # Upload to Supabase Storage
            upload_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('edited-images')
                .upload(
                    storage_path,
                    image_content,
                    file_options={'upsert': 'true'}
                )
            )

            print(f"[STORAGE] Upload response: {upload_response}")
            
            # Check for upload errors with different response formats
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Failed to upload to Supabase Storage: {upload_response.error}")
            elif hasattr(upload_response, 'status_code') and upload_response.status_code >= 400:
                raise Exception(f"Failed to upload to Supabase Storage: HTTP {upload_response.status_code}")
            elif not upload_response:
                raise Exception("Upload failed: No response from Supabase Storage")
            
            # Get public URL
            url_response = self.supabase.storage.from_('edited-images').get_public_url(storage_path)
            
            # Handle different response formats
            if hasattr(url_response, 'data') and url_response.data:
                public_url = url_response.data.get('publicUrl') if isinstance(url_response.data, dict) else str(url_response.data)
            elif isinstance(url_response, dict) and 'publicUrl' in url_response:
                public_url = url_response['publicUrl']
            elif isinstance(url_response, str):
                public_url = url_response
            else:
                raise Exception("Failed to get public URL from Supabase Storage")
            
            return True, public_url, None
            
        except Exception as error:
            return False, None, str(error)