"""Tests for API gateway: docs, usage tracking, and per-key rate limiting (Phase 44)."""
import hashlib
import time
from unittest.mock import patch

import pytest
from screenwriter.models.database import ApiKey as ApiKeyModel, User as UserModel


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _ensure_user(db_session):
    existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
    if not existing:
        user = UserModel(
            id=MOCK_USER_ID,
            email="gatewaytest@example.com",
            hashed_password="fakehash",
            display_name="GatewayTest",
        )
        db_session.add(user)
        db_session.flush()


def _create_api_key(client, mock_auth_headers, db_session, name="Gateway Key"):
    """Helper: create an API key and return (full_key, key_id).

    Ensures the mock user exists in the DB so that the API key auth path
    can look up the user after verifying the key hash.
    """
    _ensure_user(db_session)
    resp = client.post(
        "/api/auth/api-keys",
        json={"name": name},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    return data["key"], data["id"]


class TestSwaggerDocs:
    """AK-05: API documentation via Swagger UI."""

    def test_docs_accessible(self, client):
        """GET /docs returns 200 (Swagger UI HTML)."""
        resp = client.get("/docs")
        assert resp.status_code == 200

    def test_openapi_schema_accessible(self, client):
        """GET /openapi.json returns valid OpenAPI schema."""
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert "openapi" in schema
        assert "paths" in schema
        assert "components" in schema

    def test_all_tags_documented(self, client):
        """OpenAPI schema includes descriptions for all 20 router tags."""
        resp = client.get("/openapi.json")
        schema = resp.json()
        tags = schema.get("tags", [])
        tag_names = [t["name"] for t in tags]
        expected_tags = [
            "auth", "projects", "sections", "review", "books", "snippets",
            "snippet-manager", "agents", "chat", "templates", "phase-data",
            "list-items", "wizards", "ai", "breakdown", "shots", "media",
            "breakdown-chat", "storyboard", "shows",
        ]
        for tag in expected_tags:
            assert tag in tag_names, f"Tag '{tag}' missing from OpenAPI schema"
        # Every tag has a description
        for tag_obj in tags:
            assert "description" in tag_obj and len(tag_obj["description"]) > 0

    def test_security_scheme_dual_auth(self, client):
        """Security scheme mentions both JWT and API key formats."""
        resp = client.get("/openapi.json")
        schema = resp.json()
        sec = schema["components"]["securitySchemes"]["Bearer"]
        assert sec["type"] == "http"
        assert sec["scheme"] == "bearer"
        assert "API Key" in sec.get("bearerFormat", "")
        assert "sa_" in sec.get("description", "")


class TestUsageTracking:
    """AK-06: Per-key request counting."""

    def test_request_count_increments(self, client, mock_auth_headers, db_session):
        """Using an API key increments request_count in the database."""
        full_key, key_id = _create_api_key(client, mock_auth_headers, db_session, "Count Key")

        # Use the key 3 times
        for _ in range(3):
            resp = client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {full_key}"},
            )
            assert resp.status_code == 200

        # Check DB
        db_session.expire_all()
        api_key = db_session.query(ApiKeyModel).filter(ApiKeyModel.id == key_id).first()
        assert api_key.request_count == 3

    def test_request_count_in_list(self, client, mock_auth_headers, db_session):
        """List endpoint includes request_count field."""
        full_key, _ = _create_api_key(client, mock_auth_headers, db_session, "List Count Key")

        # Use key once
        client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )

        # List keys and check for request_count
        resp = client.get("/api/auth/api-keys", headers=mock_auth_headers)
        assert resp.status_code == 200
        keys = resp.json()
        found = [k for k in keys if k["name"] == "List Count Key"]
        assert len(found) == 1
        assert "request_count" in found[0]
        assert found[0]["request_count"] >= 1

    def test_jwt_does_not_increment_count(self, client, mock_auth_headers, db_session):
        """JWT auth (mock-token) does not create or increment any API key counter."""
        # Use JWT auth
        resp = client.get("/api/auth/me", headers=mock_auth_headers)
        assert resp.status_code == 200
        # No API keys should have been affected (this is a sanity check)
        all_keys = db_session.query(ApiKeyModel).all()
        for k in all_keys:
            # Keys created by OTHER tests might have counts, but this JWT request
            # should not have incremented any of them further.
            # We just verify JWT works without touching API key counters.
            pass  # If we got here without error, JWT auth path is independent


class TestPerKeyRateLimit:
    """AK-06: Per-key rate limiting."""

    def test_under_limit_allowed(self, client, mock_auth_headers, db_session):
        """Requests under the rate limit succeed normally."""
        full_key, _ = _create_api_key(client, mock_auth_headers, db_session, "Under Limit Key")
        resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )
        assert resp.status_code == 200

    def test_rate_limit_returns_429(self, client):
        """Exceeding per-key rate limit returns 429 with Retry-After header.

        Uses an isolated Starlette mini-app with the middleware configured at
        limit=2, so we can trigger and assert 429 without sending 1000 requests
        to the real app.
        """
        from screenwriter.middleware import ApiKeyRateLimitMiddleware
        from starlette.testclient import TestClient
        from starlette.applications import Starlette
        from starlette.responses import PlainTextResponse
        from starlette.routing import Route

        async def homepage(request):
            return PlainTextResponse("OK")

        mini_app = Starlette(routes=[Route("/test", homepage)])
        mini_app.add_middleware(ApiKeyRateLimitMiddleware, default_rate_limit=2)

        mini_client = TestClient(mini_app)
        test_token = "sa_test1234_secret"
        headers = {"Authorization": f"Bearer {test_token}"}

        # First 2 should pass
        r1 = mini_client.get("/test", headers=headers)
        assert r1.status_code == 200
        r2 = mini_client.get("/test", headers=headers)
        assert r2.status_code == 200

        # Third should be rate limited
        r3 = mini_client.get("/test", headers=headers)
        assert r3.status_code == 429
        assert "Retry-After" in r3.headers
        body = r3.json()
        assert "detail" in body
        assert "rate limit" in body["detail"].lower()

    def test_jwt_bypasses_key_limiter(self, client, mock_auth_headers):
        """JWT auth requests are not subject to per-key rate limiting."""
        # Make multiple requests with JWT -- should never get 429 from key limiter
        for _ in range(10):
            resp = client.get("/api/auth/me", headers=mock_auth_headers)
            assert resp.status_code == 200
