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
    SUPABASE_KEY: str = ""

    # External APIs
    OPENROUTER_API_KEY: str = ""
    
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
    
    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore"
    }

# Global settings instance
settings = Settings()