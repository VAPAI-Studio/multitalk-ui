import httpx
from typing import Tuple, Optional, List
from config.settings import settings


class WorldLabsService:
    def __init__(self):
        self.api_key = settings.WORLDLABS_API_KEY
        self.base_url = "https://api.worldlabs.ai"

    def _build_world_prompt(
        self,
        prompt_type: str,
        image_url: Optional[str] = None,
        images: Optional[List[dict]] = None,
        reconstruct_images: bool = False,
        video_url: Optional[str] = None,
        text_prompt: Optional[str] = None,
    ) -> dict:
        """Build the world_prompt payload based on prompt type."""
        if prompt_type == "image":
            prompt = {
                "type": "image",
                "image_prompt": {"source": "uri", "uri": image_url},
            }
            if text_prompt:
                prompt["text_prompt"] = text_prompt
            return prompt

        elif prompt_type == "multi-image":
            prompt = {
                "type": "multi-image",
                "multi_image_prompt": [
                    {
                        "azimuth": img["azimuth"],
                        "content": {"source": "uri", "uri": img["url"]},
                    }
                    for img in (images or [])
                ],
                "reconstruct_images": reconstruct_images,
            }
            if text_prompt:
                prompt["text_prompt"] = text_prompt
            return prompt

        elif prompt_type == "video":
            prompt = {
                "type": "video",
                "video_prompt": {"source": "uri", "uri": video_url},
            }
            if text_prompt:
                prompt["text_prompt"] = text_prompt
            return prompt

        raise ValueError(f"Unknown prompt_type: {prompt_type}")

    async def generate_world(
        self,
        prompt_type: str = "image",
        image_url: Optional[str] = None,
        images: Optional[List[dict]] = None,
        reconstruct_images: bool = False,
        video_url: Optional[str] = None,
        text_prompt: Optional[str] = None,
        display_name: str = "Virtual Set Scene",
        model: str = "Marble 0.1-plus",
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit media to World Labs for 3D world generation.
        Supports image, multi-image, and video prompt types.
        Returns (success, operation_id, error).
        """
        try:
            if not self.api_key:
                print("❌ World Labs API key not configured")
                return False, None, "World Labs API key not configured"

            world_prompt = self._build_world_prompt(
                prompt_type=prompt_type,
                image_url=image_url,
                images=images,
                reconstruct_images=reconstruct_images,
                video_url=video_url,
                text_prompt=text_prompt,
            )

            payload = {
                "display_name": display_name,
                "model": model,
                "world_prompt": world_prompt,
            }

            print(f"🌍 World Labs Request:")
            print(f"   Prompt Type: {prompt_type}")
            print(f"   Model: {model}")
            print(f"   Display Name: {display_name}")
            if image_url:
                print(f"   Image URL: {image_url[:100]}...")
            if text_prompt:
                print(f"   Text Prompt: {text_prompt}")
            print(f"   Full Payload: {payload}")

            headers = {
                "WLT-Api-Key": self.api_key,
                "Content-Type": "application/json",
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/marble/v1/worlds:generate",
                    json=payload,
                    headers=headers,
                )

                print(f"📡 World Labs Response: Status {response.status_code}")

                if response.status_code != 200:
                    error_data = response.json() if response.content else {}
                    print(f"❌ World Labs Error Response: {error_data}")
                    error_msg = error_data.get("error", {}).get(
                        "message", f"API request failed: {response.status_code}"
                    )
                    return False, None, error_msg

                data = response.json()
                print(f"✅ World Labs Success Response: {data}")
                operation_id = data.get("operation_id")
                if not operation_id:
                    print("❌ No operation_id in response")
                    return False, None, "No operation_id returned from World Labs"

                print(f"✅ Operation ID: {operation_id}")
                return True, operation_id, None

        except httpx.TimeoutException:
            print("⏱️ World Labs API timeout")
            return False, None, "Request timeout - World Labs API may be slow"
        except Exception as e:
            print(f"❌ Exception calling World Labs: {str(e)}")
            import traceback
            traceback.print_exc()
            return False, None, f"Error calling World Labs API: {str(e)}"

    async def poll_operation(
        self, operation_id: str
    ) -> Tuple[bool, bool, Optional[dict], Optional[str]]:
        """
        Poll the status of a world generation operation.
        Returns (success, done, world_data_or_None, error).
        """
        try:
            if not self.api_key:
                return False, False, None, "World Labs API key not configured"

            headers = {
                "WLT-Api-Key": self.api_key,
            }

            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{self.base_url}/marble/v1/operations/{operation_id}",
                    headers=headers,
                )

                if response.status_code != 200:
                    error_data = response.json() if response.content else {}
                    error_msg = error_data.get("error", {}).get(
                        "message", f"Poll failed: {response.status_code}"
                    )
                    return False, False, None, error_msg

                data = response.json()

                # Check for error
                if data.get("error"):
                    return False, True, None, str(data["error"])

                done = data.get("done", False)
                if not done:
                    return True, False, None, None

                # Extract world data from completed response
                world_response = data.get("response", {})
                return True, True, world_response, None

        except httpx.TimeoutException:
            return False, False, None, "Poll request timed out"
        except Exception as e:
            return False, False, None, f"Error polling World Labs: {str(e)}"

    @staticmethod
    def extract_splat_url(world_data: dict, resolution: str = "500k") -> Optional[str]:
        """
        Extract the SPZ splat URL from world response data.
        Prefers specified resolution, falls back to others.
        """
        try:
            assets = world_data.get("assets", {})
            splats = assets.get("splats", {})
            spz_urls = splats.get("spz_urls", {})

            # Try preferred resolution first, then fallbacks
            for res in [resolution, "500k", "100k", "full_res"]:
                url = spz_urls.get(res)
                if url:
                    return url

            return None
        except Exception:
            return None
