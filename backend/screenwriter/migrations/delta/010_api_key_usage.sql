-- Migration 010: Add request_count and rate_limit to api_keys (v5.0 -- Phase 44)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit INTEGER DEFAULT NULL;
-- rate_limit NULL means "use default" (1000 req/hour)
