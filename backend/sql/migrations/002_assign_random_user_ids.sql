-- Migration: Assign random user_id to existing jobs with NULL user_id
-- Date: 2025-01-21
-- Description: Distributes legacy jobs (with NULL user_id) randomly among existing users

-- ============================================================================
-- Step 1: Create helper function to get random user_id from existing jobs
-- ============================================================================

CREATE OR REPLACE FUNCTION get_random_user_id()
RETURNS UUID AS $$
DECLARE
    random_user UUID;
BEGIN
    -- Get a random user_id from jobs that already have one
    SELECT user_id INTO random_user
    FROM (
        SELECT user_id FROM video_jobs WHERE user_id IS NOT NULL
        UNION
        SELECT user_id FROM image_jobs WHERE user_id IS NOT NULL
    ) AS users_with_jobs
    ORDER BY RANDOM()
    LIMIT 1;

    RETURN random_user;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Step 2: Update video_jobs with NULL user_id
-- ============================================================================

DO $$
DECLARE
    jobs_to_update CURSOR FOR
        SELECT id FROM video_jobs WHERE user_id IS NULL;
    job_record RECORD;
    updated_count INTEGER := 0;
BEGIN
    RAISE NOTICE 'Starting video_jobs migration...';

    FOR job_record IN jobs_to_update LOOP
        UPDATE video_jobs
        SET user_id = get_random_user_id()
        WHERE id = job_record.id;

        updated_count := updated_count + 1;

        -- Log progress every 10 jobs
        IF updated_count % 10 = 0 THEN
            RAISE NOTICE 'Updated % video jobs...', updated_count;
        END IF;
    END LOOP;

    RAISE NOTICE 'Completed video_jobs migration: % jobs updated', updated_count;
END $$;

-- ============================================================================
-- Step 3: Update image_jobs with NULL user_id
-- ============================================================================

DO $$
DECLARE
    jobs_to_update CURSOR FOR
        SELECT id FROM image_jobs WHERE user_id IS NULL;
    job_record RECORD;
    updated_count INTEGER := 0;
BEGIN
    RAISE NOTICE 'Starting image_jobs migration...';

    FOR job_record IN jobs_to_update LOOP
        UPDATE image_jobs
        SET user_id = get_random_user_id()
        WHERE id = job_record.id;

        updated_count := updated_count + 1;

        -- Log progress every 10 jobs
        IF updated_count % 10 = 0 THEN
            RAISE NOTICE 'Updated % image jobs...', updated_count;
        END IF;
    END LOOP;

    RAISE NOTICE 'Completed image_jobs migration: % jobs updated', updated_count;
END $$;

-- ============================================================================
-- Step 4: Update text_jobs with NULL user_id
-- ============================================================================

DO $$
DECLARE
    jobs_to_update CURSOR FOR
        SELECT id FROM text_jobs WHERE user_id IS NULL;
    job_record RECORD;
    updated_count INTEGER := 0;
BEGIN
    RAISE NOTICE 'Starting text_jobs migration...';

    FOR job_record IN jobs_to_update LOOP
        UPDATE text_jobs
        SET user_id = get_random_user_id()
        WHERE id = job_record.id;

        updated_count := updated_count + 1;

        -- Log progress every 10 jobs
        IF updated_count % 10 = 0 THEN
            RAISE NOTICE 'Updated % text jobs...', updated_count;
        END IF;
    END LOOP;

    RAISE NOTICE 'Completed text_jobs migration: % jobs updated', updated_count;
END $$;

-- ============================================================================
-- Step 5: Verification - Count remaining NULL user_ids
-- ============================================================================

DO $$
DECLARE
    video_null_count INTEGER;
    image_null_count INTEGER;
    text_null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO video_null_count FROM video_jobs WHERE user_id IS NULL;
    SELECT COUNT(*) INTO image_null_count FROM image_jobs WHERE user_id IS NULL;
    SELECT COUNT(*) INTO text_null_count FROM text_jobs WHERE user_id IS NULL;

    RAISE NOTICE '=== Migration Verification ===';
    RAISE NOTICE 'Remaining NULL user_ids:';
    RAISE NOTICE '  Video Jobs: %', video_null_count;
    RAISE NOTICE '  Image Jobs: %', image_null_count;
    RAISE NOTICE '  Text Jobs: %', text_null_count;

    IF video_null_count = 0 AND image_null_count = 0 AND text_null_count = 0 THEN
        RAISE NOTICE '✅ Migration completed successfully - no NULL user_ids remaining';
    ELSE
        RAISE WARNING '⚠️ Some jobs still have NULL user_ids';
    END IF;
END $$;

-- ============================================================================
-- Optional: Drop helper function after migration
-- ============================================================================

-- Uncomment the line below if you want to remove the helper function
-- DROP FUNCTION IF EXISTS get_random_user_id();

COMMENT ON FUNCTION get_random_user_id() IS 'Helper function to assign random user_id to legacy jobs during migration';
