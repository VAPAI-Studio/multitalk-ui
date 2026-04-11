# backend/app/services/imagen_service.py

"""
Google Vertex AI Imagen integration for storyboard frame generation.

Requires google-cloud-aiplatform>=1.60.0 and Application Default Credentials
or a service account key. Set GOOGLE_CLOUD_PROJECT in .env.
"""

import logging

logger = logging.getLogger(__name__)

# Style prefix map
_STYLE_PREFIXES = {
    "photorealistic": "Photorealistic cinematic film still.",
    "cinematic": "Cinematic dramatic film still with high contrast lighting.",
    "animated": "Animation style frame, clean lines, vivid colors.",
}


class ImagenService:
    """Google Vertex AI Imagen integration for storyboard frame generation."""

    def __init__(self, project_id: str, region: str, model_name: str):
        self.project_id = project_id
        self.region = region
        self.model_name = model_name

    @staticmethod
    def build_prompt(
        shot_fields: dict,
        storyboard_style: str | None,
        scene_context: str = "",
    ) -> str:
        """
        Build an image generation prompt from shot fields, style, and scene context.

        Prompt structure:
        - Style prefix mapped from storyboard_style
        - Scene context (truncated to 200 chars) if non-empty
        - Camera composition (shot_size, camera_angle) if non-empty
        - Description from shot_fields
        - Action from shot_fields
        - Professional suffix
        """
        parts = []

        # Style prefix
        style_prefix = _STYLE_PREFIXES.get(storyboard_style or "", "Cinematic film still.")
        parts.append(style_prefix)

        # Scene context
        if scene_context:
            truncated = scene_context[:200]
            parts.append(f"Scene context: {truncated}")

        # Camera composition
        shot_size = (shot_fields.get("shot_size") or "").strip()
        camera_angle = (shot_fields.get("camera_angle") or "").strip()
        if shot_size and camera_angle:
            parts.append(f"Camera: {shot_size}, {camera_angle}.")
        elif shot_size:
            parts.append(f"Camera: {shot_size}.")
        elif camera_angle:
            parts.append(f"Camera: {camera_angle}.")

        # Description
        description = (shot_fields.get("description") or "").strip()
        if description:
            parts.append(description)

        # Action
        action = (shot_fields.get("action") or "").strip()
        if action:
            parts.append(f"Action: {action}")

        # If no meaningful content beyond style prefix, return minimal prompt
        if len(parts) <= 1:
            return f"{style_prefix} Professional storyboard frame."

        # Professional suffix
        parts.append("Professional production storyboard frame. No text overlays.")

        return " ".join(parts)

    def generate_image(self, prompt: str) -> bytes:
        """
        Call Vertex AI Imagen to generate a single image from the prompt.

        Returns PNG image bytes.
        Raises RuntimeError if the SDK is not installed or generation fails.
        """
        try:
            import vertexai
            from vertexai.preview.vision_models import ImageGenerationModel

            vertexai.init(project=self.project_id, location=self.region)
            model = ImageGenerationModel.from_pretrained(self.model_name)
            response = model.generate_images(prompt=prompt, number_of_images=1)
            return response.images[0]._image_bytes
        except ImportError as e:
            raise RuntimeError(
                "google-cloud-aiplatform is not installed. "
                "Run: pip install google-cloud-aiplatform>=1.60.0"
            ) from e
        except Exception as e:
            raise RuntimeError(f"Imagen generation failed: {e}") from e
