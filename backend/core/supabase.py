from supabase import create_client, Client
import os
from typing import Optional

class SupabaseClient:
    _instance: Optional[Client] = None
    
    @classmethod
    def get_client(cls) -> Client:
        if cls._instance is None:
            supabase_url = os.getenv("SUPABASE_URL")
            # Prefer SERVICE_ROLE_KEY to bypass RLS, fallback to ANON_KEY
            supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

            if not supabase_url or not supabase_key:
                raise ValueError("SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY) must be set in environment variables")

            cls._instance = create_client(supabase_url, supabase_key)

        return cls._instance

# Convenience function to get the client
def get_supabase() -> Client:
    return SupabaseClient.get_client()