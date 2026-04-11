import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from screenwriter.models.database import ApiKey as ApiKeyModel, User as UserModel


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


class TestApiKeyModel:
    """Test the ApiKey SQLAlchemy model directly."""

    def _ensure_user(self, db_session):
        existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
        if not existing:
            user = UserModel(
                id=MOCK_USER_ID,
                email="apikeytest@example.com",
                hashed_password="fakehash",
                display_name="ApiKeyTest",
            )
            db_session.add(user)
            db_session.flush()

    def test_api_key_model_columns(self, db_session):
        """Create an ApiKey with all fields, assert they persist."""
        self._ensure_user(db_session)
        api_key = ApiKeyModel(
            user_id=MOCK_USER_ID,
            name="Test Key",
            key_prefix="abc12345",
            key_hash="a" * 64,
            scopes=["read", "write"],
            expires_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
        )
        db_session.add(api_key)
        db_session.commit()
        db_session.refresh(api_key)

        assert api_key.id is not None
        assert api_key.user_id == MOCK_USER_ID
        assert api_key.name == "Test Key"
        assert api_key.key_prefix == "abc12345"
        assert api_key.key_hash == "a" * 64
        assert api_key.scopes == ["read", "write"]
        assert api_key.expires_at is not None
        assert api_key.created_at is not None
        assert api_key.is_active is True

    def test_key_hash_matches_sha256(self, db_session):
        """Generate a key via hashlib.sha256, store it, assert match."""
        self._ensure_user(db_session)
        test_key = "test_key_for_hash_verification"
        expected_hash = hashlib.sha256(test_key.encode()).hexdigest()

        api_key = ApiKeyModel(
            user_id=MOCK_USER_ID,
            name="Hash Test Key",
            key_prefix="hash1234",
            key_hash=expected_hash,
        )
        db_session.add(api_key)
        db_session.commit()
        db_session.refresh(api_key)

        assert api_key.key_hash == expected_hash
        assert len(api_key.key_hash) == 64

    def test_api_key_cascade_delete(self, db_session):
        """Create user + api_key, delete user, assert api_key is gone.

        SQLite requires PRAGMA foreign_keys = ON to enforce CASCADE.
        We enable it temporarily and restore it after.
        """
        from sqlalchemy import text

        # Enable foreign keys for SQLite cascade support
        db_session.execute(text("PRAGMA foreign_keys = ON"))

        try:
            user = UserModel(
                id=str(uuid.uuid4()),
                email=f"cascade-{uuid.uuid4().hex[:8]}@example.com",
                hashed_password="fakehash",
                display_name="CascadeTest",
            )
            db_session.add(user)
            db_session.flush()

            api_key = ApiKeyModel(
                user_id=str(user.id),
                name="Cascade Key",
                key_prefix="casc1234",
                key_hash="b" * 64,
            )
            db_session.add(api_key)
            db_session.commit()

            key_id = api_key.id

            # Delete via raw SQL to trigger SQLite CASCADE
            db_session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": str(user.id)})
            db_session.commit()
            db_session.expire_all()

            # Assert api_key is gone
            found = db_session.query(ApiKeyModel).filter(ApiKeyModel.id == key_id).first()
            assert found is None
        finally:
            # Restore default (FK enforcement off) so other tests aren't affected
            db_session.execute(text("PRAGMA foreign_keys = OFF"))


class TestApiKeysAPI:
    """Test API key CRUD endpoints."""

    def test_create_api_key(self, client, mock_auth_headers):
        """POST to /api/auth/api-keys with name, assert 201 and correct fields."""
        resp = client.post(
            "/api/auth/api-keys",
            json={"name": "My Key"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert data["name"] == "My Key"
        assert "key" in data
        assert data["key"].startswith("sa_")
        assert "key_prefix" in data
        assert "created_at" in data

    def test_create_returns_full_key_once(self, client, mock_auth_headers):
        """Create a key, assert key field is in create response. Then GET list, assert NO key field."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "Once Key"},
            headers=mock_auth_headers,
        )
        assert create_resp.status_code == 201
        assert "key" in create_resp.json()

        list_resp = client.get("/api/auth/api-keys", headers=mock_auth_headers)
        assert list_resp.status_code == 200
        for item in list_resp.json():
            assert "key" not in item

    def test_list_does_not_expose_secret(self, client, mock_auth_headers):
        """Create a key, GET list, assert none have a key field (only key_prefix)."""
        client.post(
            "/api/auth/api-keys",
            json={"name": "Secret Test Key"},
            headers=mock_auth_headers,
        )
        resp = client.get("/api/auth/api-keys", headers=mock_auth_headers)
        assert resp.status_code == 200
        for item in resp.json():
            assert "key" not in item
            assert "key_prefix" in item

    def test_create_api_key_validation(self, client, mock_auth_headers):
        """POST with empty name, assert 422."""
        resp = client.post(
            "/api/auth/api-keys",
            json={"name": ""},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_list_api_keys(self, client, mock_auth_headers):
        """Create two keys, GET list, assert at least 2 items."""
        client.post(
            "/api/auth/api-keys",
            json={"name": "Key Alpha"},
            headers=mock_auth_headers,
        )
        client.post(
            "/api/auth/api-keys",
            json={"name": "Key Beta"},
            headers=mock_auth_headers,
        )
        resp = client.get("/api/auth/api-keys", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2
        names = [k["name"] for k in data]
        assert "Key Alpha" in names
        assert "Key Beta" in names

    def test_revoke_api_key(self, client, mock_auth_headers):
        """Create a key, DELETE it, verify it's gone from active list."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "Revoke Me"},
            headers=mock_auth_headers,
        )
        key_id = create_resp.json()["id"]

        del_resp = client.delete(f"/api/auth/api-keys/{key_id}", headers=mock_auth_headers)
        assert del_resp.status_code == 200

        # GET list should not contain this key (active-only filter)
        list_resp = client.get("/api/auth/api-keys", headers=mock_auth_headers)
        active_ids = [k["id"] for k in list_resp.json()]
        assert key_id not in active_ids


class TestApiKeyAuth:
    """Test API key authentication flow."""

    def test_api_key_authenticates_endpoint(self, client, mock_auth_headers):
        """Create a key via POST, use it to call GET /api/auth/me, assert 200."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "Auth Key"},
            headers=mock_auth_headers,
        )
        assert create_resp.status_code == 201
        full_key = create_resp.json()["key"]

        me_resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )
        assert me_resp.status_code == 200
        assert "email" in me_resp.json()

    def test_expired_key_rejected(self, client, mock_auth_headers, db_session):
        """Create a key, set expires_at to past, assert 401."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "Expired Key"},
            headers=mock_auth_headers,
        )
        assert create_resp.status_code == 201
        full_key = create_resp.json()["key"]
        key_id = create_resp.json()["id"]

        # Manually update expires_at to the past
        api_key = db_session.query(ApiKeyModel).filter(ApiKeyModel.id == key_id).first()
        api_key.expires_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        db_session.commit()

        me_resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )
        assert me_resp.status_code == 401

    def test_revoked_key_rejected(self, client, mock_auth_headers):
        """Create a key, revoke it, assert 401 when used."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "Revoked Key"},
            headers=mock_auth_headers,
        )
        full_key = create_resp.json()["key"]
        key_id = create_resp.json()["id"]

        # Revoke
        client.delete(f"/api/auth/api-keys/{key_id}", headers=mock_auth_headers)

        me_resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )
        assert me_resp.status_code == 401

    def test_invalid_key_rejected(self, client):
        """Call GET /api/auth/me with invalid sa_ key, assert 401."""
        me_resp = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer sa_invalid_garbage"},
        )
        assert me_resp.status_code == 401

    def test_jwt_still_works(self, client, mock_auth_headers):
        """Call GET /api/auth/me with mock-token, assert 200."""
        me_resp = client.get("/api/auth/me", headers=mock_auth_headers)
        assert me_resp.status_code == 200

    def test_last_used_at_updated(self, client, mock_auth_headers, db_session):
        """Create a key, use it, assert last_used_at is not None."""
        create_resp = client.post(
            "/api/auth/api-keys",
            json={"name": "LastUsed Key"},
            headers=mock_auth_headers,
        )
        assert create_resp.status_code == 201
        full_key = create_resp.json()["key"]
        key_id = create_resp.json()["id"]

        # Use the key
        client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {full_key}"},
        )

        # Check DB
        api_key = db_session.query(ApiKeyModel).filter(ApiKeyModel.id == key_id).first()
        assert api_key.last_used_at is not None
