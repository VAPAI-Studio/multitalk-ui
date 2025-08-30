import os
import httpx
from typing import Tuple, Optional

class OpenRouterService:
    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        self.base_url = "https://openrouter.ai/api/v1"
        
    async def edit_image(self, image_data: str, prompt: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """Edit an image using OpenRouter's Gemini model"""
        try:
            if not self.api_key:
                return False, None, "OpenRouter API key not configured"
            
            # Prepare the request payload
            payload = {
                "model": "google/gemini-2.5-flash-image-preview:free",
                "modalities": ["image", "text"],
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"{prompt}. Output should be 16:9 widescreen composition."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": image_data
                            }
                        }
                    ]
                }]
            }
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "HTTP-Referer": "https://multitalk.app",  # Replace with your actual domain
                "X-Title": "MultiTalk API",
                "Content-Type": "application/json"
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers
                )
                
                if response.status_code != 200:
                    error_data = response.json() if response.content else {}
                    error_message = error_data.get('error', {}).get('message', f'API request failed: {response.status_code}')
                    return False, None, error_message
                
                data = response.json()
                image_url = data.get('choices', [{}])[0].get('message', {}).get('images', [{}])[0].get('image_url', {}).get('url')
                
                if image_url:
                    return True, image_url, None
                else:
                    return False, None, "No edited image received from API"
                    
        except httpx.TimeoutException:
            return False, None, "Request timeout - OpenRouter API may be slow"
        except Exception as error:
            return False, None, f"Error calling OpenRouter API: {str(error)}"