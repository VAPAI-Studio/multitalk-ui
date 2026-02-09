"""Google Drive API client singleton for shared drive access."""

import json
import os
from typing import Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build, Resource

from config.settings import settings

# Full drive access for read and write operations
SCOPES = ['https://www.googleapis.com/auth/drive']


class GoogleDriveClient:
    """Singleton client for Google Drive API."""

    _instance: Optional[Resource] = None
    _credentials = None

    @classmethod
    def get_client(cls) -> Resource:
        """
        Get or create the Google Drive API client.

        Credentials are loaded with fallback:
        1. If GOOGLE_DRIVE_CREDENTIALS_FILE is set, load from file
        2. If GOOGLE_DRIVE_CREDENTIALS_JSON is set, parse from string
        """
        if cls._instance is None:
            credentials_file = settings.GOOGLE_DRIVE_CREDENTIALS_FILE
            credentials_json = settings.GOOGLE_DRIVE_CREDENTIALS_JSON

            if credentials_file and os.path.exists(credentials_file):
                # Load from file (development)
                cls._credentials = service_account.Credentials.from_service_account_file(
                    credentials_file,
                    scopes=SCOPES
                )
            elif credentials_json:
                # Parse from JSON string (Heroku/production)
                credentials_info = json.loads(credentials_json)
                cls._credentials = service_account.Credentials.from_service_account_info(
                    credentials_info,
                    scopes=SCOPES
                )
            else:
                raise ValueError(
                    "Google Drive credentials not configured. "
                    "Set GOOGLE_DRIVE_CREDENTIALS_FILE or GOOGLE_DRIVE_CREDENTIALS_JSON"
                )

            cls._instance = build('drive', 'v3', credentials=cls._credentials)

        return cls._instance

    @classmethod
    def get_shared_drive_id(cls) -> str:
        """Get the configured shared drive ID."""
        drive_id = settings.GOOGLE_DRIVE_SHARED_DRIVE_ID
        if not drive_id:
            raise ValueError("GOOGLE_DRIVE_SHARED_DRIVE_ID must be set")
        return drive_id

    @classmethod
    def is_configured(cls) -> bool:
        """Check if Google Drive is properly configured."""
        credentials_file = settings.GOOGLE_DRIVE_CREDENTIALS_FILE
        credentials_json = settings.GOOGLE_DRIVE_CREDENTIALS_JSON
        drive_id = settings.GOOGLE_DRIVE_SHARED_DRIVE_ID

        has_credentials = bool(
            (credentials_file and os.path.exists(credentials_file)) or
            credentials_json
        )
        has_drive_id = bool(drive_id)

        return has_credentials and has_drive_id

    @classmethod
    def reset(cls) -> None:
        """Reset the singleton instance (useful for testing)."""
        cls._instance = None
        cls._credentials = None


# Convenience functions
def get_drive_client() -> Resource:
    """Get the Google Drive API client."""
    return GoogleDriveClient.get_client()


def get_shared_drive_id() -> str:
    """Get the configured shared drive ID."""
    return GoogleDriveClient.get_shared_drive_id()


def is_drive_configured() -> bool:
    """Check if Google Drive is properly configured."""
    return GoogleDriveClient.is_configured()
