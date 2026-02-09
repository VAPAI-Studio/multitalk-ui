import httpx
import asyncio
from typing import Tuple, Optional, Dict, Any
from models.comfyui import ComfyUIStatus, QueueStatus, SystemStats, SystemInfo, SystemDevice
from config.settings import settings

class ComfyUIService:
    def __init__(self):
        self.default_url = settings.COMFYUI_SERVER_URL
    
    async def get_status(self, base_url: Optional[str] = None) -> Tuple[bool, Optional[ComfyUIStatus], Optional[str]]:
        """Get ComfyUI status including queue and system stats"""
        try:
            url = base_url or self.default_url
            if not url:
                return False, None, "No ComfyUI URL provided"
            
            clean_url = url.rstrip('/')
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Fetch queue status
                try:
                    queue_response = await client.get(f"{clean_url}/queue")
                    if queue_response.status_code != 200:
                        raise Exception(f"Queue endpoint failed: {queue_response.status_code}")
                    
                    queue_data = queue_response.json()
                    queue_status = QueueStatus(
                        queue_running=queue_data.get('queue_running', []),
                        queue_pending=queue_data.get('queue_pending', [])
                    )
                except Exception as e:
                    return False, None, f"Queue fetch failed: {str(e)}"
                
                # Fetch system stats (optional)
                system_stats = None
                try:
                    stats_response = await client.get(f"{clean_url}/system_stats")
                    if stats_response.status_code == 200:
                        stats_data = stats_response.json()
                        
                        # Parse system info
                        system_info = None
                        if stats_data.get('system'):
                            system_info = SystemInfo(
                                python_version=stats_data['system'].get('python_version'),
                                torch_version=stats_data['system'].get('torch_version')
                            )
                        
                        # Parse devices
                        devices = []
                        if stats_data.get('devices'):
                            for device_data in stats_data['devices']:
                                devices.append(SystemDevice(
                                    name=device_data.get('name', ''),
                                    type=device_data.get('type', ''),
                                    vram_total=device_data.get('vram_total'),
                                    vram_free=device_data.get('vram_free')
                                ))
                        
                        system_stats = SystemStats(
                            system=system_info,
                            devices=devices if devices else None
                        )
                except Exception as e:
                    # System stats are optional, don't fail if they're not available
                    print(f"Warning: Could not fetch system stats: {e}")
                
                status = ComfyUIStatus(
                    connected=True,
                    queue=queue_status,
                    system_stats=system_stats,
                    error=None,
                    base_url=clean_url
                )
                
                return True, status, None
                
        except httpx.TimeoutException:
            return False, None, "Connection timeout"
        except Exception as error:
            error_message = str(error)
            if "connection" in error_message.lower():
                error_message = "Connection failed - check if ComfyUI server is running"
            return False, None, error_message

    async def upload_audio(self, base_url: str, audio_data: bytes, filename: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """Upload audio file to ComfyUI server using the /upload/image endpoint with 'image' key"""
        try:
            clean_url = base_url.rstrip('/')
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Use "image" key like the frontend does, even for audio files
                files = {"image": (filename, audio_data, "audio/wav")}
                
                # Use /upload/image endpoint (ComfyUI standard for all media)
                response = await client.post(f"{clean_url}/upload/image", files=files)
                
                if response.status_code != 200:
                    return False, None, f"Upload failed: {response.status_code}"
                
                # Try to parse as JSON first
                try:
                    result = response.json()
                    # ComfyUI usually returns the filename in different formats
                    if isinstance(result, dict):
                        audio_filename = result.get("name") or result.get("filename") or filename
                    elif isinstance(result, list) and len(result) > 0:
                        # Sometimes returns array of filenames
                        audio_filename = result[0]
                    else:
                        audio_filename = str(result) if result else filename
                except:
                    # If not JSON, try as text
                    text = response.text
                    audio_filename = text.strip() if text.strip() else filename
                
                return True, audio_filename, None
                
        except httpx.TimeoutException:
            return False, None, "Upload timeout"
        except Exception as error:
            return False, None, str(error)

    async def submit_prompt(self, base_url: str, prompt_data: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """Submit workflow prompt to ComfyUI"""
        try:
            clean_url = base_url.rstrip('/')
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{clean_url}/prompt",
                    json=prompt_data,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code != 200:
                    error_detail = ""
                    try:
                        error_data = response.json()
                        error_detail = error_data.get("error") or error_data.get("message") or ""
                    except:
                        error_detail = response.text or ""
                    
                    return False, None, f"ComfyUI rejected prompt ({response.status_code}): {error_detail}"
                
                result = response.json()
                prompt_id = result.get("prompt_id") or result.get("promptId") or result.get("node_id") or ""
                
                if not prompt_id:
                    return False, None, f"ComfyUI didn't return valid prompt ID. Response: {result}"
                
                return True, prompt_id, None
                
        except httpx.TimeoutException:
            return False, None, "Prompt submission timeout"
        except Exception as error:
            return False, None, str(error)

    async def get_history(self, base_url: str, job_id: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Get job history/status from ComfyUI"""
        try:
            clean_url = base_url.rstrip('/')
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{clean_url}/history/{job_id}")
                
                if response.status_code != 200:
                    return False, None, f"History fetch failed: {response.status_code}"
                
                history_data = response.json()
                return True, history_data, None
                
        except httpx.TimeoutException:
            return False, None, "History fetch timeout"
        except Exception as error:
            return False, None, str(error)