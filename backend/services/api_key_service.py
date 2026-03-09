"""Service for managing per-user API keys."""
import hashlib
import secrets
from typing import Optional, Tuple
from datetime import datetime, timezone

from core.supabase import get_supabase

API_KEY_PREFIX = "sout_"
API_KEY_RANDOM_BYTES = 20  # 40 hex chars → total key length: 45 chars


class ApiKeyService:
    def __init__(self, supabase=None):
        self.supabase = supabase or get_supabase()

    @staticmethod
    def _generate_key() -> Tuple[str, str]:
        """Generate a new API key and its SHA-256 hash.
        Returns: (plaintext_key, hash_hex)
        """
        random_part = secrets.token_hex(API_KEY_RANDOM_BYTES)
        full_key = f"{API_KEY_PREFIX}{random_part}"
        key_hash = hashlib.sha256(full_key.encode()).hexdigest()
        return full_key, key_hash

    @staticmethod
    def _hash_key(key: str) -> str:
        return hashlib.sha256(key.encode()).hexdigest()

    def create_key(self, user_id: str, name: str = "Default") -> Tuple[bool, Optional[str], Optional[str]]:
        """Create a new API key for the user. Revokes any existing active key.
        Returns: (success, plaintext_key, error)
        """
        try:
            # Revoke any existing active key
            self.supabase.table("api_keys") \
                .update({"revoked_at": datetime.now(timezone.utc).isoformat()}) \
                .eq("user_id", user_id) \
                .is_("revoked_at", "null") \
                .execute()

            # Generate new key
            plaintext_key, key_hash = self._generate_key()
            key_prefix = plaintext_key[:9]  # "sout_" + first 4 hex chars

            # Insert new key
            self.supabase.table("api_keys").insert({
                "user_id": user_id,
                "key_hash": key_hash,
                "key_prefix": key_prefix,
                "name": name,
            }).execute()

            return True, plaintext_key, None

        except Exception as e:
            return False, None, str(e)

    def revoke_active_key(self, user_id: str) -> Tuple[bool, Optional[str]]:
        """Revoke the user's active API key.
        Returns: (success, error)
        """
        try:
            result = self.supabase.table("api_keys") \
                .update({"revoked_at": datetime.now(timezone.utc).isoformat()}) \
                .eq("user_id", user_id) \
                .is_("revoked_at", "null") \
                .execute()

            if not result.data:
                return False, "No active API key found"

            return True, None

        except Exception as e:
            return False, str(e)

    def get_active_key_info(self, user_id: str) -> Optional[dict]:
        """Get non-sensitive info about user's active key.
        Returns: dict with key_prefix, name, created_at, last_used_at or None
        """
        try:
            result = self.supabase.table("api_keys") \
                .select("key_prefix, name, created_at, last_used_at") \
                .eq("user_id", user_id) \
                .is_("revoked_at", "null") \
                .execute()

            if result.data and len(result.data) > 0:
                return result.data[0]
            return None

        except Exception:
            return None

    def lookup_user_by_key(self, api_key: str) -> Optional[object]:
        """Given a plaintext API key, validate it and return the Supabase user object.
        Returns: Supabase User object (same as get_current_user returns) or None
        """
        if not api_key.startswith(API_KEY_PREFIX):
            return None

        key_hash = self._hash_key(api_key)

        try:
            # Look up the key hash
            result = self.supabase.table("api_keys") \
                .select("user_id") \
                .eq("key_hash", key_hash) \
                .is_("revoked_at", "null") \
                .execute()

            if not result.data or len(result.data) == 0:
                return None

            user_id = result.data[0]["user_id"]

            # Update last_used_at (fire-and-forget style)
            try:
                self.supabase.table("api_keys") \
                    .update({"last_used_at": datetime.now(timezone.utc).isoformat()}) \
                    .eq("key_hash", key_hash) \
                    .execute()
            except Exception:
                pass  # Non-critical

            # Fetch the actual Supabase user object via admin API
            user_response = self.supabase.auth.admin.get_user_by_id(user_id)
            if user_response and user_response.user:
                return user_response.user

            return None

        except Exception:
            return None
