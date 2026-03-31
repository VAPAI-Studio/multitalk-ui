from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # API Settings
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "MultiTalk UI"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Server Settings
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    
    # Database - Supabase
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""  # Legacy fallback
    SUPABASE_SERVICE_ROLE_KEY: str = ""  # For server operations (bypasses RLS)
    SUPABASE_ANON_KEY: str = ""  # For client operations
    SUPABASE_PUBLIC_URL: str = ""  # Public URL for external APIs (ngrok URL)

    # External APIs
    OPENROUTER_API_KEY: str = ""
    WORLDLABS_API_KEY: str = ""

    # ComfyUI Configuration
    COMFYUI_SERVER_URL: str = "https://comfy.vapai.studio"
    COMFY_API_KEY: str = ""

    # RunPod Configuration
    ENABLE_RUNPOD: bool = False  # Feature flag - set to True to enable RunPod integration
    RUNPOD_API_KEY: str = ""  # RunPod API key for serverless execution
    RUNPOD_ENDPOINT_ID: str = ""  # RunPod endpoint ID (ComfyUI serverless deployment)
    RUNPOD_TIMEOUT: int = 600  # Timeout in seconds for RunPod requests (default: 10 minutes)

    # RunPod S3 API Configuration (for Network Volume access)
    RUNPOD_S3_ACCESS_KEY: str = ""
    RUNPOD_S3_SECRET_KEY: str = ""
    RUNPOD_NETWORK_VOLUME_ID: str = ""
    RUNPOD_S3_ENDPOINT_URL: str = "https://eu-ro-1.s3.runpod.io"
    RUNPOD_S3_REGION: str = "eu-ro-1"
    # HuggingFace access token (optional default; per-request token overrides)
    HF_TOKEN: str = ""

    # Freepik Video Upscaler Configuration
    FREEPIK_API_KEY: str = ""
    FREEPIK_API_BASE_URL: str = "https://api.freepik.com/v1/ai"
    FREEPIK_POLL_INTERVAL: int = 10      # seconds between status checks
    FREEPIK_TASK_TIMEOUT: int = 3600     # max seconds per video (1 hour)

    # GitHub Integration (Dockerfile editor — Phase 6)
    # Fine-grained PAT: Contents: read+write on the repo below (single repo only)
    GITHUB_TOKEN: str = ""
    # "owner/repo" — the repository containing the Dockerfile
    GITHUB_REPO: str = ""
    # Branch to read from and commit to (must exist)
    GITHUB_BRANCH: str = "main"
    # Exact path to the Dockerfile within the repo
    GITHUB_DOCKERFILE_PATH: str = ""

    # Training Configuration (Flux/LoRA)
    TRAINING_WORKSPACE_DIR: str = "./training_workspace"
    KOHYA_SS_PATH: str = "/opt/kohya_ss"

    # Google Drive Configuration
    GOOGLE_DRIVE_CREDENTIALS_FILE: str = ""  # Path to JSON file (dev)
    GOOGLE_DRIVE_CREDENTIALS_JSON: str = ""  # JSON string (Heroku)
    GOOGLE_DRIVE_SHARED_DRIVE_ID: str = ""
    
    # Storage Configuration
    STORAGE_BUCKET_VIDEOS: str = "multitalk-videos"
    STORAGE_BUCKET_IMAGES: str = "edited-images"
    
    # Upload Limits
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    ALLOWED_IMAGE_TYPES: List[str] = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/gif"]
    
    # API Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_BURST: int = 10
    
    # Processing Configuration
    IMAGE_PROCESSING_TIMEOUT: int = 300  # 5 minutes
    MAX_CONCURRENT_JOBS: int = 5
    
    # CORS Settings
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173"
    ]

    # Authentication Settings
    ALLOWED_EMAIL_DOMAINS: List[str] = ["vapai.studio", "sideoutsticks.com"]

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100
    
    @field_validator('ALLOWED_ORIGINS', 'ALLOWED_EMAIL_DOMAINS', 'ALLOWED_IMAGE_TYPES', mode='before')
    @classmethod
    def parse_list_fields(cls, v):
        if isinstance(v, str):
            return [item.strip() for item in v.split(',') if item.strip()]
        return v

    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore"
    }

    @property
    def supabase_key_resolved(self) -> str:
        """Get Supabase key with fallback priority: SERVICE_ROLE_KEY > ANON_KEY > KEY"""
        return self.SUPABASE_SERVICE_ROLE_KEY or self.SUPABASE_ANON_KEY or self.SUPABASE_KEY

    @property
    def supabase_anon_key_resolved(self) -> str:
        """Get Supabase anon key with fallback: ANON_KEY > SERVICE_ROLE_KEY > KEY"""
        return self.SUPABASE_ANON_KEY or self.SUPABASE_SERVICE_ROLE_KEY or self.SUPABASE_KEY

# Global settings instance
settings = Settings()