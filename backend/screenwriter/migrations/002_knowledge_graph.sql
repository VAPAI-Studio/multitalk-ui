-- backend/migrations/002_knowledge_graph.sql
-- Knowledge Graph + RAG infrastructure for multi-agent book-based review system

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS "vector";

-- Book processing status enum
CREATE TYPE book_status AS ENUM ('pending', 'extracting', 'analyzing', 'embedding', 'completed', 'failed');

-- Concept relationship types
CREATE TYPE relationship_type AS ENUM ('depends_on', 'related_to', 'part_of', 'example_of', 'contradicts', 'extends');

-- ============================================================
-- Books table
-- ============================================================
CREATE TABLE books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    title VARCHAR(500) NOT NULL,
    author VARCHAR(500),
    filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,
    status book_status DEFAULT 'pending',
    processing_step VARCHAR(100),
    total_chunks INTEGER DEFAULT 0,
    total_concepts INTEGER DEFAULT 0,
    processing_error TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- ============================================================
-- Raw text chunks with vector embeddings (for citation/RAG)
-- ============================================================
CREATE TABLE book_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    embedding vector(1536),
    chapter_title VARCHAR(500),
    page_number INTEGER,
    concept_ids JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Knowledge Graph: Concepts extracted from books
-- ============================================================
CREATE TABLE concepts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    definition TEXT NOT NULL,
    chapter_source VARCHAR(500),
    page_range VARCHAR(50),
    examples JSONB DEFAULT '[]',
    actionable_questions JSONB DEFAULT '[]',
    section_relevance JSONB DEFAULT '{}',
    tags JSONB DEFAULT '[]',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Knowledge Graph: Relationships between concepts
-- ============================================================
CREATE TABLE concept_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    target_concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    relationship relationship_type NOT NULL,
    description TEXT,
    UNIQUE(source_concept_id, target_concept_id, relationship)
);

-- ============================================================
-- Agents
-- ============================================================
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    system_prompt_template TEXT NOT NULL,
    personality TEXT,
    color VARCHAR(7) DEFAULT '#6366f1',
    icon VARCHAR(50) DEFAULT 'book',
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Many-to-many: agents <-> books
-- ============================================================
CREATE TABLE agent_books (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, book_id)
);

-- ============================================================
-- Chat sessions
-- ============================================================
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Chat messages
-- ============================================================
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'chat',
    book_references JSONB DEFAULT '[]',
    concepts_used JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_books_owner ON books(owner_id);
CREATE INDEX idx_books_status ON books(status);
CREATE INDEX idx_book_chunks_book ON book_chunks(book_id);
CREATE INDEX idx_book_chunks_embedding ON book_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_concepts_book ON concepts(book_id);
CREATE INDEX idx_concepts_embedding ON concepts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_concept_rels_source ON concept_relationships(source_concept_id);
CREATE INDEX idx_concept_rels_target ON concept_relationships(target_concept_id);
CREATE INDEX idx_agents_owner ON agents(owner_id);
CREATE INDEX idx_agents_active ON agents(is_active);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id, agent_id, project_id);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);

-- ============================================================
-- Triggers
-- ============================================================
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
