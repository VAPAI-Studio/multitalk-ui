"""S3 client singleton for RunPod network volume access."""
from boto3 import client
from config.settings import settings
from typing import Optional

_s3_client: Optional[any] = None

def get_s3_client():
    """Get or create S3 client singleton."""
    global _s3_client
    if _s3_client is None:
        _s3_client = client(
            's3',
            endpoint_url=settings.RUNPOD_S3_ENDPOINT_URL,
            aws_access_key_id=settings.RUNPOD_S3_ACCESS_KEY,
            aws_secret_access_key=settings.RUNPOD_S3_SECRET_KEY,
            region_name=settings.RUNPOD_S3_REGION
        )
    return _s3_client

# Module-level singleton instance
s3_client = get_s3_client()
