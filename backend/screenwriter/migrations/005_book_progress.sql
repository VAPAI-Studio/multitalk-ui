-- backend/migrations/005_book_progress.sql
-- Adds progress tracking + pause capability to book processing

-- Add PAUSED status to book_status enum
ALTER TYPE book_status ADD VALUE IF NOT EXISTS 'paused';

-- Add progress tracking columns to books
ALTER TABLE books
    ADD COLUMN IF NOT EXISTS chapters_total INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS chapters_processed INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
