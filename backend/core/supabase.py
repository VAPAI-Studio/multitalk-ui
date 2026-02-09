from supabase import create_client, Client
from typing import Optional

from config.settings import settings

try:
    from supabase.client import ClientOptions
except Exception:
    ClientOptions = None

class SupabaseClient:
    _instance: Optional[Client] = None

    @classmethod
    def get_client(cls) -> Client:
        if cls._instance is None:
            supabase_url = settings.SUPABASE_URL
            # Use helper property for key resolution with fallback priority
            supabase_key = settings.supabase_key_resolved

            if not supabase_url or not supabase_key:
                raise ValueError("SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY) must be set in environment variables")

            cls._instance = create_client(supabase_url, supabase_key)

        return cls._instance

    @classmethod
    def create_authed_client(cls, access_token: str) -> Client:
        supabase_url = settings.SUPABASE_URL
        supabase_key = settings.supabase_anon_key_resolved

        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and (SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY) must be set in environment variables")

        headers = {
            "Authorization": f"Bearer {access_token}",
            "apikey": supabase_key,
        }

        if ClientOptions is not None:
            client = create_client(supabase_url, supabase_key, ClientOptions(headers=headers))
        else:
            client = create_client(supabase_url, supabase_key)

        try:
            if hasattr(client, "postgrest") and hasattr(client.postgrest, "auth"):
                client.postgrest.auth(access_token)
        except Exception:
            pass

        return client

# Convenience function to get the client
def get_supabase() -> Client:
    return SupabaseClient.get_client()


def get_supabase_for_token(access_token: Optional[str]) -> Client:
    # Always use the singleton client for now - authenticated clients have issues
    # with certain supabase-py versions. Since RLS is disabled, this works fine.
    return get_supabase()
