# backend/app/tests/test_auth.py

import pytest
from screenwriter.models.database import User as UserModel


class TestUserModel:
    """Test the User SQLAlchemy model directly."""

    def test_user_model_columns(self, db_session):
        """Create a User row via SQLAlchemy, verify all columns exist and are queryable."""
        user = UserModel(
            email="model@test.com",
            hashed_password="fakehash",
            display_name="ModelTest",
        )
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

        assert user.id is not None
        assert user.email == "model@test.com"
        assert user.hashed_password == "fakehash"
        assert user.display_name == "ModelTest"
        assert user.is_active is True
        assert user.created_at is not None

        # Verify queryable
        queried = db_session.query(UserModel).filter(UserModel.email == "model@test.com").first()
        assert queried is not None
        assert queried.id == user.id


class TestAuthAPI:
    """Test register, login, and JWT integration."""

    def test_register_success(self, client):
        """POST /api/auth/register with valid data returns 200 with access_token."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "test@example.com",
                "password": "securepass123",
                "display_name": "Test",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_register_duplicate_email(self, client):
        """Register same email twice -- second call returns 400."""
        payload = {
            "email": "dup@example.com",
            "password": "securepass123",
            "display_name": "Dup",
        }
        first = client.post("/api/auth/register", json=payload)
        assert first.status_code == 200

        second = client.post("/api/auth/register", json=payload)
        assert second.status_code == 400
        assert "Email already registered" in second.json()["detail"]

    def test_register_weak_password(self, client):
        """POST /api/auth/register with 3-char password returns 422."""
        response = client.post(
            "/api/auth/register",
            json={
                "email": "weak@example.com",
                "password": "abc",
                "display_name": "Weak",
            },
        )
        assert response.status_code == 422

    def test_login_success(self, client):
        """Register a user, then login with same creds returns 200 with access_token."""
        client.post(
            "/api/auth/register",
            json={
                "email": "login@example.com",
                "password": "securepass123",
                "display_name": "Login",
            },
        )

        response = client.post(
            "/api/auth/login",
            json={"email": "login@example.com", "password": "securepass123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client):
        """Register a user, login with wrong password returns 401."""
        client.post(
            "/api/auth/register",
            json={
                "email": "wrongpw@example.com",
                "password": "securepass123",
                "display_name": "WrongPw",
            },
        )

        response = client.post(
            "/api/auth/login",
            json={"email": "wrongpw@example.com", "password": "wrongpassword"},
        )
        assert response.status_code == 401
        assert "Invalid email or password" in response.json()["detail"]

    def test_login_nonexistent_user(self, client):
        """Login with email that was never registered returns 401."""
        response = client.post(
            "/api/auth/login",
            json={"email": "ghost@example.com", "password": "securepass123"},
        )
        assert response.status_code == 401

    def test_jwt_accepted_by_endpoints(self, client):
        """Register a user, use returned JWT to call GET /api/projects/, verify 200."""
        reg_resp = client.post(
            "/api/auth/register",
            json={
                "email": "jwt@example.com",
                "password": "securepass123",
                "display_name": "JWTUser",
            },
        )
        token = reg_resp.json()["access_token"]

        response = client.get(
            "/api/projects/",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200

    def test_mock_token_still_works(self, client):
        """GET /api/projects/ with 'Bearer mock-token' still returns 200."""
        response = client.get(
            "/api/projects/",
            headers={"Authorization": "Bearer mock-token"},
        )
        assert response.status_code == 200
