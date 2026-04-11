import os
from PIL import Image

THUMBNAIL_SIZE = (300, 300)


def generate_thumbnail(original_path: str, media_dir: str) -> str:
    """Generate a WebP thumbnail from an image file.
    Returns the absolute path to the generated thumbnail.
    Raises ValueError if the file is not a valid image.
    """
    try:
        with Image.open(original_path) as img:
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            thumbs_dir = os.path.join(media_dir, "thumbs")
            os.makedirs(thumbs_dir, exist_ok=True)
            basename = os.path.splitext(os.path.basename(original_path))[0]
            thumb_path = os.path.join(thumbs_dir, f"{basename}_thumb.webp")
            img.save(thumb_path, "WEBP", quality=80)
            return thumb_path
    except Exception as e:
        raise ValueError(f"Invalid image file: {e}")
