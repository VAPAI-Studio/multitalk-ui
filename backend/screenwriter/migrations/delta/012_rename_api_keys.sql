-- Migration 012: Rename api_keys -> sw_api_keys to avoid collision with multitalk-ui
-- The guard checks that api_keys exists AND lacks the revoked_at column (which multitalk's version has).
-- This ensures we only rename the screenwriting assistant's api_keys, not multitalk's.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'revoked_at'
    ) THEN
        ALTER TABLE api_keys RENAME TO sw_api_keys;
        ALTER INDEX IF EXISTS ix_api_keys_user_id RENAME TO ix_sw_api_keys_user_id;
        ALTER INDEX IF EXISTS ix_api_keys_key_hash RENAME TO ix_sw_api_keys_key_hash;
    END IF;
END $$;
