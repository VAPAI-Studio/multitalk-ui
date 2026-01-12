"""
Thumbnail Service for generating video thumbnails.
Extracts the first frame of a video and uploads it to Supabase Storage.
"""
import os
import asyncio
import subprocess
import tempfile
import uuid
import time
from typing import Tuple, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

import httpx

from core.supabase import get_supabase

# Reusable thread pool for Supabase operations
_thumbnail_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="thumbnail")


class ThumbnailService:
    """Service for generating and storing video thumbnails."""

    def __init__(self):
        self.supabase = get_supabase()
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create a reusable HTTP client with connection pooling"""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
                follow_redirects=True
            )
        return self._http_client

    def _extract_public_url(self, url_response) -> Optional[str]:
        """Extract public URL from various response formats"""
        if hasattr(url_response, 'data') and url_response.data:
            return url_response.data.get('publicUrl') if isinstance(url_response.data, dict) else str(url_response.data)
        elif isinstance(url_response, dict) and 'publicUrl' in url_response:
            return url_response['publicUrl']
        elif isinstance(url_response, str):
            return url_response
        return None

    async def generate_thumbnail_from_url(
        self,
        video_url: str,
        job_id: str,
        width: int = 400,
        height: int = 400
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Generate a thumbnail from a video URL by extracting the first frame.

        Args:
            video_url: URL of the video (Supabase or ComfyUI)
            job_id: Job ID for naming the thumbnail
            width: Target thumbnail width
            height: Target thumbnail height

        Returns:
            (success, thumbnail_url, error_message)
        """
        start_time = time.time()
        temp_video_path = None
        temp_thumbnail_path = None

        try:
            print(f"🎬 Generating thumbnail for job {job_id}")

            # Create temporary files
            temp_dir = tempfile.gettempdir()
            temp_video_path = os.path.join(temp_dir, f"video_{job_id}_{uuid.uuid4().hex[:8]}.mp4")
            temp_thumbnail_path = os.path.join(temp_dir, f"thumb_{job_id}_{uuid.uuid4().hex[:8]}.jpg")

            # Download video
            print(f"📥 Downloading video from: {video_url[:80]}...")
            download_start = time.time()
            client = await self._get_http_client()
            response = await client.get(video_url)

            if response.status_code != 200:
                raise Exception(f"Failed to download video: HTTP {response.status_code}")

            video_content = response.content
            download_time = time.time() - download_start
            print(f"✅ Downloaded {len(video_content) / 1024 / 1024:.2f}MB in {download_time:.2f}s")

            # Write video to temp file
            with open(temp_video_path, 'wb') as f:
                f.write(video_content)

            # Extract first frame using ffmpeg
            print(f"🖼️ Extracting first frame with ffmpeg...")
            ffmpeg_start = time.time()

            # Run ffmpeg in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            ffmpeg_result = await loop.run_in_executor(
                _thumbnail_executor,
                lambda: self._run_ffmpeg(temp_video_path, temp_thumbnail_path, width, height)
            )

            if not ffmpeg_result[0]:
                raise Exception(ffmpeg_result[1])

            ffmpeg_time = time.time() - ffmpeg_start
            print(f"✅ Frame extracted in {ffmpeg_time:.2f}s")

            # Read thumbnail file
            with open(temp_thumbnail_path, 'rb') as f:
                thumbnail_content = f.read()

            if len(thumbnail_content) == 0:
                raise Exception("Generated thumbnail is empty")

            print(f"📤 Uploading thumbnail ({len(thumbnail_content) / 1024:.1f}KB)...")

            # Generate storage path
            timestamp = datetime.now().strftime('%Y-%m-%d')
            storage_path = f"thumbnails/{timestamp}/{job_id}.jpg"

            # Upload to Supabase Storage
            upload_start = time.time()
            upload_response = await loop.run_in_executor(
                _thumbnail_executor,
                lambda: self.supabase.storage
                .from_('multitalk-videos')
                .upload(
                    storage_path,
                    thumbnail_content,
                    file_options={
                        'content-type': 'image/jpeg',
                        'cache-control': '31536000',  # 1 year cache
                        'upsert': 'true'
                    }
                )
            )

            upload_time = time.time() - upload_start
            print(f"✅ Uploaded in {upload_time:.2f}s")

            # Check for upload errors
            if hasattr(upload_response, 'error') and upload_response.error:
                raise Exception(f"Upload failed: {upload_response.error}")
            elif isinstance(upload_response, dict) and upload_response.get('error'):
                raise Exception(f"Upload failed: {upload_response['error']}")

            # Get public URL
            url_response = self.supabase.storage.from_('multitalk-videos').get_public_url(storage_path)
            public_url = self._extract_public_url(url_response)

            if not public_url:
                raise Exception("Failed to get public URL for thumbnail")

            total_time = time.time() - start_time
            print(f"✅ Thumbnail generated in {total_time:.2f}s (download: {download_time:.2f}s, ffmpeg: {ffmpeg_time:.2f}s, upload: {upload_time:.2f}s)")

            return True, public_url, None

        except Exception as e:
            error_msg = str(e)
            print(f"❌ Thumbnail generation failed: {error_msg}")
            return False, None, error_msg

        finally:
            # Cleanup temp files
            for path in [temp_video_path, temp_thumbnail_path]:
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass

    def _run_ffmpeg(
        self,
        video_path: str,
        output_path: str,
        width: int,
        height: int
    ) -> Tuple[bool, Optional[str]]:
        """
        Run ffmpeg to extract first frame from video.
        This runs in a thread pool to avoid blocking.

        Returns:
            (success, error_message)
        """
        try:
            # Build ffmpeg command
            # -ss 0 : seek to start
            # -i : input file
            # -frames:v 1 : extract only 1 frame
            # -vf scale : scale to target size, maintaining aspect ratio
            # -y : overwrite output
            cmd = [
                'ffmpeg',
                '-ss', '0',
                '-i', video_path,
                '-frames:v', '1',
                '-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '2',  # High quality JPEG
                '-y',
                output_path
            ]

            # Run ffmpeg
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30  # 30 second timeout
            )

            if result.returncode != 0:
                # Check if ffmpeg is not installed
                if 'not found' in result.stderr.lower() or 'not recognized' in result.stderr.lower():
                    return False, "ffmpeg is not installed or not in PATH"
                return False, f"ffmpeg error: {result.stderr[:200]}"

            if not os.path.exists(output_path):
                return False, "ffmpeg did not create output file"

            return True, None

        except subprocess.TimeoutExpired:
            return False, "ffmpeg timed out after 30 seconds"
        except FileNotFoundError:
            return False, "ffmpeg is not installed or not in PATH"
        except Exception as e:
            return False, str(e)

    async def generate_thumbnail_from_comfyui(
        self,
        comfy_url: str,
        filename: str,
        subfolder: str,
        job_id: str,
        video_type: str = 'output',
        width: int = 400,
        height: int = 400
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Generate a thumbnail from a video in ComfyUI.

        Args:
            comfy_url: ComfyUI server URL
            filename: Video filename in ComfyUI
            subfolder: Video subfolder in ComfyUI
            job_id: Job ID for naming the thumbnail
            video_type: ComfyUI video type (usually 'output')
            width: Target thumbnail width
            height: Target thumbnail height

        Returns:
            (success, thumbnail_url, error_message)
        """
        from urllib.parse import urlencode

        # Build ComfyUI video URL
        clean_url = comfy_url.rstrip('/')
        params = {
            'filename': filename,
            'subfolder': subfolder or '',
            'type': video_type
        }
        video_url = f"{clean_url}/api/view?{urlencode(params)}"

        return await self.generate_thumbnail_from_url(video_url, job_id, width, height)
