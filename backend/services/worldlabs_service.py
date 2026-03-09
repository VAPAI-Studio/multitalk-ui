import httpx
from typing import Tuple, Optional
from config.settings import settings


class WorldLabsService:
    def __init__(self):
        self.api_key = settings.WORLDLABS_API_KEY
        self.base_url = "https://api.worldlabs.ai"

    async def generate_world(
        self,
        image_url: str,
        display_name: str = "Virtual Set Scene",
        model: str = "Marble 0.1-plus",
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit an image to World Labs for 3D world generation.
        image_url must be a publicly accessible URL (not a data URL).
        Returns (success, operation_id, error).
        """
        try:
            if not self.api_key:
                return False, None, "World Labs API key not configured"

            payload = {
                "display_name": display_name,
                "world_prompt": {
                    "type": "image",
                    "image_prompt": {
                        "source": "uri",
                        "uri": image_url,
                    },
                },
                "model": model,
            }

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

                if response.status_code != 200:
                    error_data = response.json() if response.content else {}
                    error_msg = error_data.get("error", {}).get(
                        "message", f"API request failed: {response.status_code}"
                    )
                    return False, None, error_msg

                data = response.json()
                operation_id = data.get("operation_id")
                if not operation_id:
                    return False, None, "No operation_id returned from World Labs"

                return True, operation_id, None

        except httpx.TimeoutException:
            return False, None, "Request timeout - World Labs API may be slow"
        except Exception as e:
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
