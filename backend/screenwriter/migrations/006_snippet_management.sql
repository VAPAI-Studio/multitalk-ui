-- backend/migrations/006_snippet_management.sql
-- Adds snippet management columns to book_chunks for Phase 1 (Snippet Manager)
-- Safe to run multiple times (IF NOT EXISTS guards).

ALTER TABLE book_chunks
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_user_created BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Partial index: fast lookup of non-deleted chunks per book (list endpoint)
CREATE INDEX IF NOT EXISTS idx_book_chunks_not_deleted
    ON book_chunks(book_id, chunk_index)
    WHERE is_deleted = FALSE;

-- Partial index: fast lookup of user-created chunks per book (retry_book exclusion)
CREATE INDEX IF NOT EXISTS idx_book_chunks_user_created
    ON book_chunks(book_id)
    WHERE is_user_created = TRUE;
