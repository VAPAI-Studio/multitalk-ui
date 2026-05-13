-- Migration 007: Snippet table for user-facing AI-curated passages
-- Distinct from book_chunks (internal RAG) — see Phase 2 CONTEXT.md

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS snippets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_title VARCHAR(500),
    page_number INTEGER,
    content TEXT NOT NULL,
    justification TEXT,
    concept_ids JSONB DEFAULT '[]',
    concept_names JSONB DEFAULT '[]',
    token_count INTEGER DEFAULT 0,
    embedding vector(1536),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_snippets_book ON snippets(book_id);
CREATE INDEX IF NOT EXISTS idx_snippets_not_deleted ON snippets(book_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_snippets_embedding ON snippets USING hnsw (embedding vector_cosine_ops);
