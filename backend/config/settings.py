from pydantic import BaseSettings
from typing import Optional, List
import os

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
    SUPABASE_URL: str
    SUPABASE_KEY: str
    
    # External APIs
    OPENROUTER_API_KEY: str
    
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
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Validate required settings
        self._validate_required_settings()
    
    def _validate_required_settings(self):
        """Validate that all required settings are present."""
        required_fields = ["SUPABASE_URL", "SUPABASE_KEY", "OPENROUTER_API_KEY"]
        missing_fields = []
        
        for field in required_fields:
            if not getattr(self, field, None):
                missing_fields.append(field)
        
        if missing_fields:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing_fields)}\n"
                f"Please check your .env file or environment variables."
            )

# Global settings instance
settings = Settings()