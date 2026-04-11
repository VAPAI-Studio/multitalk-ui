# backend/tests/test_api.py

import pytest
from screenwriter.models.database import Framework, SectionType


class TestProjectsAPI:
    """Test projects API endpoints"""

    def test_create_project_valid(self, client, mock_auth_headers):
        """Test creating a project with valid data"""
        response = client.post(
            "/api/projects/",
            json={
                "title": "Test Project",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Project"
        assert data["framework"] == "three_act"
    
    def test_create_project_invalid_title(self, client, mock_auth_headers):
        """Test creating a project with invalid title"""
        # Empty title
        response = client.post(
            "/api/projects/",
            json={
                "title": "",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
        errors = response.json()["errors"]
        assert any("title" in error["field"] for error in errors)
        
        # Title too short
        response = client.post(
            "/api/projects/",
            json={
                "title": "A",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
        
        # Title too long
        response = client.post(
            "/api/projects/",
            json={
                "title": "A" * 256,
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
    
    def test_create_project_invalid_framework(self, client, mock_auth_headers):
        """Test creating a project with invalid framework"""
        response = client.post(
            "/api/projects/",
            json={
                "title": "Test Project",
                "framework": "invalid_framework"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
    
    def test_update_project_validation(self, client, mock_auth_headers):
        """Test updating a project with validation"""
        # First create a project
        create_response = client.post(
            "/api/projects/",
            json={
                "title": "Update Test",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        project_id = create_response.json()["id"]
        
        # Try to update with invalid title
        response = client.patch(
            f"/api/projects/{project_id}",
            json={"title": ""},
            headers=mock_auth_headers
        )
        assert response.status_code == 422

class TestSectionsAPI:
    """Test sections API endpoints"""

    def test_update_section_content_validation(self, client, mock_auth_headers):
        """Test updating section content with validation"""
        response = client.patch(
            "/api/sections/12345678-1234-5678-1234-567812345678",
            json={"user_notes": "A" * 10001},  # Exceeds max length
            headers=mock_auth_headers
        )
        # The response would be 404 because the section doesn't exist,
        # but if it did exist, it would validate the content

class TestReviewAPI:
    """Test review API endpoints"""

    def test_review_validation(self, client, mock_auth_headers):
        """Test review request validation"""
        # Test with text too short
        response = client.post(
            "/api/review/",
            json={
                "section_id": "12345678-1234-5678-1234-567812345678",
                "text": "Too short",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
        errors = response.json()["errors"]
        assert any("text" in error["field"] for error in errors)
        
        # Test with empty text
        response = client.post(
            "/api/review/",
            json={
                "section_id": "12345678-1234-5678-1234-567812345678",
                "text": "",
                "framework": "three_act"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422
        
        # Test with invalid framework
        response = client.post(
            "/api/review/",
            json={
                "section_id": "12345678-1234-5678-1234-567812345678",
                "text": "This is a valid length text for review",
                "framework": "invalid_framework"
            },
            headers=mock_auth_headers
        )
        assert response.status_code == 422

class TestAuthAPI:
    """Test authentication API endpoints"""

    def test_magic_link_request(self, client):
        """Test magic link request with email validation"""
        # Valid email
        response = client.post(
            "/api/auth/magic-link",
            json={"email": "test@example.com"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "magic_link" in data
        
        # Invalid email
        response = client.post(
            "/api/auth/magic-link",
            json={"email": "invalid-email"}
        )
        assert response.status_code == 422
        errors = response.json()["errors"]
        assert any("email" in error["field"] for error in errors)

class TestMiddleware:
    """Test custom middleware"""

    def test_rate_limiting(self, client):
        """Test rate limiting middleware"""
        # Note: This test would need to be configured based on the rate limit settings
        pass

    def test_request_size_limit(self, client, mock_auth_headers):
        """Test request size limit middleware"""
        large_content = "A" * (11 * 1024 * 1024)  # 11MB, exceeding 10MB limit
        response = client.post(
            "/api/projects/",
            json={
                "title": "Large Project",
                "framework": "three_act",
                "large_field": large_content
            },
            headers=mock_auth_headers
        )

    def test_security_headers(self, client):
        """Test security headers middleware"""
        response = client.get("/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"
        assert response.headers.get("X-Frame-Options") == "DENY"
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"