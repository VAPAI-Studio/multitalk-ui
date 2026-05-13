-- Migration 013: Fix api_keys collision with multitalk-ui
-- When screenwriting migrations ran against a DB that already had multitalk's api_keys,
-- migrations 009/010 added columns to the wrong table and 012's rename was skipped.
-- This migration creates sw_api_keys if it doesn't exist and cleans up.

DO $$
BEGIN
    -- Create sw_api_keys if it doesn't exist yet
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sw_api_keys'
    ) THEN
        CREATE TABLE sw_api_keys (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            key_prefix VARCHAR(8) NOT NULL,
            key_hash VARCHAR(64) UNIQUE NOT NULL,
            scopes JSONB DEFAULT '[]'::jsonb,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_used_at TIMESTAMPTZ,
            is_active BOOLEAN DEFAULT TRUE,
            request_count INTEGER NOT NULL DEFAULT 0,
            rate_limit INTEGER DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_sw_api_keys_user_id ON sw_api_keys(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS ix_sw_api_keys_key_hash ON sw_api_keys(key_hash);
    END IF;

    -- Clean up columns accidentally added to multitalk's api_keys by migrations 009/010
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'revoked_at'
    ) THEN
        -- This is multitalk's api_keys — remove screenwriting columns if present
        ALTER TABLE api_keys DROP COLUMN IF EXISTS request_count;
        ALTER TABLE api_keys DROP COLUMN IF EXISTS rate_limit;
    END IF;
END $$;
