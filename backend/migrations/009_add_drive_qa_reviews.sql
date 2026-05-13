-- Migration: Add Drive QA Reviews
-- Date: 2026-05-12
-- Description: Create drive_qa_reviews table for QA tracking of Drive scenes.
--              Stores per-user OK/NOK status and notes for each scene in the
--              Drive QA viewer.

-- ============================================================================
-- STEP 1: Create drive_qa_reviews table
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'drive_qa_reviews'
    ) THEN
        CREATE TABLE drive_qa_reviews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Drive identifiers
            episode_id TEXT NOT NULL,
            scene_id TEXT NOT NULL,
            scene_name TEXT NOT NULL,

            -- QA state
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ok', 'nok')),
            notes TEXT,

            -- Ownership
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

            -- Timestamps
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- One review per user per scene
            UNIQUE (user_id, scene_id)
        );
        RAISE NOTICE 'Created drive_qa_reviews table';
    ELSE
        RAISE NOTICE 'drive_qa_reviews table already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_drive_qa_reviews_episode
    ON drive_qa_reviews(episode_id);

CREATE INDEX IF NOT EXISTS idx_drive_qa_reviews_user
    ON drive_qa_reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_drive_qa_reviews_scene
    ON drive_qa_reviews(scene_id);

-- ============================================================================
-- STEP 3: updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_drive_qa_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_drive_qa_reviews_updated_at ON drive_qa_reviews;
CREATE TRIGGER trg_drive_qa_reviews_updated_at
    BEFORE UPDATE ON drive_qa_reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_drive_qa_reviews_updated_at();

-- ============================================================================
-- STEP 4: Row-Level Security
-- ============================================================================

ALTER TABLE drive_qa_reviews ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read all reviews (team-wide visibility)
DROP POLICY IF EXISTS "Authenticated can read all reviews" ON drive_qa_reviews;
CREATE POLICY "Authenticated can read all reviews"
    ON drive_qa_reviews FOR SELECT
    TO authenticated
    USING (true);

-- Users can only insert/update/delete their own reviews
DROP POLICY IF EXISTS "Users can insert own reviews" ON drive_qa_reviews;
CREATE POLICY "Users can insert own reviews"
    ON drive_qa_reviews FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reviews" ON drive_qa_reviews;
CREATE POLICY "Users can update own reviews"
    ON drive_qa_reviews FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reviews" ON drive_qa_reviews;
CREATE POLICY "Users can delete own reviews"
    ON drive_qa_reviews FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================================
-- STEP 5: Comments
-- ============================================================================

COMMENT ON TABLE drive_qa_reviews IS 'Per-user QA review status for Drive scenes in the QA viewer';
COMMENT ON COLUMN drive_qa_reviews.episode_id IS 'Google Drive folder ID of the episode (e.g., Max Wild 1x03)';
COMMENT ON COLUMN drive_qa_reviews.scene_id IS 'Google Drive folder ID of the scene';
COMMENT ON COLUMN drive_qa_reviews.scene_name IS 'Human-readable scene name (e.g., "Scene 07") for display';
COMMENT ON COLUMN drive_qa_reviews.status IS 'QA verdict: pending (not reviewed), ok (approved), nok (needs rework)';

-- ============================================================================
-- STEP 6: Verify
-- ============================================================================

DO $$
DECLARE
    table_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'drive_qa_reviews'
    ) INTO table_exists;

    IF table_exists THEN
        RAISE NOTICE 'Migration 009_add_drive_qa_reviews completed successfully!';
    ELSE
        RAISE WARNING 'Migration may have failed - please check table creation';
    END IF;
END $$;
