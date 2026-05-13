-- Migration 005: Users table for real authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email);

-- Seed the mock development user so existing data (owner_id references) stays valid
INSERT INTO users (id, email, hashed_password, display_name, is_active)
VALUES (
    '12345678-1234-5678-1234-567812345678',
    'user@example.com',
    '$2b$12$LJ3m4ys3Lz0FqDMnOEBbge5OoHfBAjPMatPH.HFGFaSwEMcPd4pMi',
    'Dev User',
    TRUE
) ON CONFLICT (id) DO NOTHING;
