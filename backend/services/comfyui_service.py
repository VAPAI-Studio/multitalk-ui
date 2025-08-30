import os
import httpx
import asyncio
from typing import Tuple, Optional
from models.comfyui import ComfyUIStatus, QueueStatus, SystemStats, SystemInfo, SystemDevice

class ComfyUIService:
    def __init__(self):
        self.default_url = os.getenv("COMFYUI_SERVER_URL", "https://comfy.vapai.studio")
    
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