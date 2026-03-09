-- Migration 006: Add per-user API keys table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- One active key per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_one_active_per_user
  ON public.api_keys(user_id) WHERE revoked_at IS NULL;

-- Fast hash lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON public.api_keys(key_hash) WHERE revoked_at IS NULL;

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Service role has full access (backend uses service role key)
CREATE POLICY api_keys_service_all ON public.api_keys
  FOR ALL USING (true) WITH CHECK (true);
