"""Integration tests for infrastructure API endpoints."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import datetime

from core.auth import verify_admin


@pytest.fixture(autouse=True)
def mock_supabase():
    """Mock Supabase client so tests don't need real credentials."""
    with patch('core.supabase.get_supabase', return_value=MagicMock()):
        yield


@pytest.fixture
def app():
    """Provide the FastAPI app."""
    from main import app
    return app


@pytest.fixture
def client(app):
    """Provide a test client."""
    return TestClient(app)


# Mock admin token for testing
MOCK_ADMIN_TOKEN = "mock-admin-token"


def _mock_admin():
    return {"id": "admin-user-id", "email": "admin@example.com"}


@pytest.fixture
def mock_admin_auth(app):
    """Override verify_admin dependency."""
    app.dependency_overrides[verify_admin] = _mock_admin
    yield
    app.dependency_overrides.pop(verify_admin, None)


@pytest.fixture
def mock_s3_client():
    """Mock S3 client responses."""
    with patch('services.infrastructure_service.s3_client') as mock:
        yield mock


def test_list_files_endpoint_success(client, mock_admin_auth, mock_s3_client):
    """Test successful file listing."""
    # Mock S3 response
    mock_s3_client.list_objects_v2.return_value = {
        'CommonPrefixes': [
            {'Prefix': 'models/'}
        ],
        'Contents': [
            {
                'Key': 'config.json',
                'Size': 2048,
                'LastModified': datetime(2026, 3, 1, 12, 0, 0)
            }
        ],
        'IsTruncated': False
    }

    # Call endpoint
    response = client.get(
        "/api/infrastructure/files?path=&limit=10",
        headers={"Authorization": f"Bearer {MOCK_ADMIN_TOKEN}"}
    )

    # Verify response
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) == 2  # 1 folder + 1 file
    assert data["totalItems"] == 2
    assert data["hasMore"] is False
    assert data["continuationToken"] is None

    # Verify folder item
    folder = next(item for item in data["items"] if item["type"] == "folder")
    assert folder["name"] == "models"
    assert folder["path"] == "models"

    # Verify file item
    file = next(item for item in data["items"] if item["type"] == "file")
    assert file["name"] == "config.json"
    assert file["size"] == 2048
    assert file["sizeHuman"] == "2.0 KB"


def test_list_files_endpoint_requires_admin(client, mock_s3_client):
    """Test endpoint rejects non-admin users."""
    # Don't mock admin auth - should fail
    response = client.get("/api/infrastructure/files")
    assert response.status_code in [401, 403]  # Unauthorized or Forbidden


def test_list_files_endpoint_pagination(client, mock_admin_auth, mock_s3_client):
    """Test pagination support."""
    # Mock S3 response with pagination
    mock_s3_client.list_objects_v2.return_value = {
        'CommonPrefixes': [],
        'Contents': [],
        'IsTruncated': True,
        'NextContinuationToken': 'next-token-abc'
    }

    response = client.get(
        "/api/infrastructure/files?path=models&limit=200",
        headers={"Authorization": f"Bearer {MOCK_ADMIN_TOKEN}"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["hasMore"] is True
    assert data["continuationToken"] == "next-token-abc"

    # Verify S3 called with correct parameters
    mock_s3_client.list_objects_v2.assert_called_once()
    call_args = mock_s3_client.list_objects_v2.call_args[1]
    assert call_args['Prefix'] == 'models/'
    assert call_args['MaxKeys'] == 200


def test_list_files_endpoint_path_validation(client, mock_admin_auth, mock_s3_client):
    """Test path traversal protection."""
    response = client.get(
        "/api/infrastructure/files?path=../etc/passwd",
        headers={"Authorization": f"Bearer {MOCK_ADMIN_TOKEN}"}
    )

    assert response.status_code == 400
    assert "Path traversal detected" in response.json()["detail"]


def test_list_files_endpoint_s3_error(client, mock_admin_auth, mock_s3_client):
    """Test S3 error handling."""
    from botocore.exceptions import ClientError

    # Mock S3 error
    mock_s3_client.list_objects_v2.side_effect = ClientError(
        {'Error': {'Code': 'NoSuchBucket', 'Message': 'Bucket not found'}},
        'ListObjectsV2'
    )

    response = client.get(
        "/api/infrastructure/files",
        headers={"Authorization": f"Bearer {MOCK_ADMIN_TOKEN}"}
    )

    assert response.status_code == 404
    assert "Network volume not found" in response.json()["detail"]
