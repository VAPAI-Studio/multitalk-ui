import logging
from typing import List, Dict, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from .embedding_service import embedding_service
from screenwriter.models.database import Concept, ConceptRelationship, AgentBook
from screenwriter.config import settings

logger = logging.getLogger(__name__)


class RAGService:
    """Knowledge-aware retrieval service with two modes:

    Mode 1 — Concept-first (for structured reviews):
      Query concepts by section_relevance scores, traverse relationships,
      then retrieve supporting chunks.

    Mode 2 — Semantic (for chat follow-ups):
      Embed user message, search concept + chunk embeddings.
    """

    def get_relevant_concepts(
        self,
        section_type: str,
        agent_id: UUID,
        db: Session,
        top_k: int = None,
    ) -> List[Dict]:
        """Mode 1: Get concepts most relevant to a section type for an agent's books."""
        top_k = top_k or settings.MAX_CONCEPTS_PER_REVIEW

        # Get book IDs for this agent
        book_ids = [
            row[0]
            for row in db.query(AgentBook.book_id)
            .filter(AgentBook.agent_id == agent_id)
            .all()
        ]

        if not book_ids:
            return []

        # Query concepts ordered by section_relevance score
        concepts = (
            db.query(Concept)
            .filter(Concept.book_id.in_(book_ids))
            .all()
        )

        # Score and sort by relevance to the section type
        scored = []
        section_key = section_type.upper()
        for concept in concepts:
            relevance = (concept.section_relevance or {}).get(section_key, 0.0)
            if relevance > 0.2:  # Only include concepts with meaningful relevance
                scored.append((concept, relevance))

        scored.sort(key=lambda x: x[1], reverse=True)

        result = []
        for concept, relevance in scored[:top_k]:
            result.append({
                "id": str(concept.id),
                "name": concept.name,
                "definition": concept.definition,
                "chapter_source": concept.chapter_source,
                "page_range": concept.page_range,
                "examples": concept.examples or [],
                "actionable_questions": concept.actionable_questions or [],
                "section_relevance_score": relevance,
                "tags": concept.tags or [],
            })

        return result

    def get_concept_relationships(
        self,
        concept_ids: List[str],
        db: Session,
    ) -> List[Dict]:
        """Get relationships between a set of concepts."""
        if not concept_ids:
            return []

        relationships = (
            db.query(ConceptRelationship)
            .filter(
                (ConceptRelationship.source_concept_id.in_(concept_ids))
                | (ConceptRelationship.target_concept_id.in_(concept_ids))
            )
            .all()
        )

        result = []
        for rel in relationships:
            source = db.query(Concept).filter(Concept.id == rel.source_concept_id).first()
            target = db.query(Concept).filter(Concept.id == rel.target_concept_id).first()
            if source and target:
                result.append({
                    "source": source.name,
                    "target": target.name,
                    "relationship": rel.relationship.value if rel.relationship else "related_to",
                    "description": rel.description,
                })

        return result

    def get_supporting_chunks(
        self,
        concept_ids: List[str],
        agent_id: UUID,
        db: Session,
        top_k: int = 4,
    ) -> List[Dict]:
        """Get raw text chunks linked to specific concepts."""
        if not concept_ids:
            return []

        book_ids = [
            str(row[0])
            for row in db.query(AgentBook.book_id)
            .filter(AgentBook.agent_id == agent_id)
            .all()
        ]

        if not book_ids:
            return []

        # Use SQL to find chunks that reference these concepts
        result = db.execute(
            sql_text("""
                SELECT bc.content, bc.chapter_title, bc.page_number,
                       b.title as book_title, b.author as book_author
                FROM book_chunks bc
                JOIN books b ON bc.book_id = b.id
                WHERE bc.book_id = ANY(CAST(:book_ids AS uuid[]))
                  AND bc.concept_ids ?| :concept_ids
                  AND bc.is_deleted IS NOT TRUE
                LIMIT :top_k
            """),
            {
                "book_ids": book_ids,
                "concept_ids": concept_ids,
                "top_k": top_k,
            },
        )

        chunks = []
        for row in result:
            chunks.append({
                "content": row.content,
                "chapter_title": row.chapter_title,
                "page_number": row.page_number,
                "book_title": row.book_title,
                "book_author": row.book_author,
            })

        return chunks

    async def semantic_search(
        self,
        query_text: str,
        agent_id: Optional[UUID] = None,
        owner_id: Optional[UUID] = None,
        tags_filter: Optional[List[str]] = None,
        db: Session = None,
        top_k_concepts: int = 5,
        top_k_chunks: int = 4,
    ) -> Dict:
        """Mode 2: Semantic search across concepts and chunks for chat follow-ups.

        Routes to tag-based path when owner_id + tags_filter are provided,
        otherwise uses agent_id → AgentBook path (existing behavior).
        """
        query_embedding = await embedding_service.embed_text(query_text)

        if tags_filter is not None and owner_id is not None:
            # TAG_BASED path: search across all user's books filtered by tags
            concept_results = db.execute(
                sql_text("""
                    SELECT c.id, c.name, c.definition, c.chapter_source, c.page_range,
                           c.examples, c.actionable_questions, c.tags,
                           1 - (c.embedding <=> CAST(:embedding AS vector)) as similarity
                    FROM concepts c
                    JOIN books b ON c.book_id = b.id
                    WHERE b.owner_id = :owner_id
                      AND c.tags ?| :tags
                      AND c.embedding IS NOT NULL
                    ORDER BY c.embedding <=> CAST(:embedding AS vector)
                    LIMIT :top_k
                """),
                {
                    "embedding": str(query_embedding),
                    "owner_id": str(owner_id),
                    "tags": tags_filter,
                    "top_k": top_k_concepts,
                },
            )

            chunk_results = db.execute(
                sql_text("""
                    SELECT bc.content, bc.chapter_title, bc.page_number,
                           b.title as book_title, b.author as book_author,
                           1 - (bc.embedding <=> CAST(:embedding AS vector)) as similarity
                    FROM book_chunks bc
                    JOIN books b ON bc.book_id = b.id
                    WHERE b.owner_id = :owner_id
                      AND bc.embedding IS NOT NULL
                      AND bc.is_deleted IS NOT TRUE
                    ORDER BY bc.embedding <=> CAST(:embedding AS vector)
                    LIMIT :top_k
                """),
                {
                    "embedding": str(query_embedding),
                    "owner_id": str(owner_id),
                    "top_k": top_k_chunks,
                },
            )
        else:
            # BOOK_BASED path: existing behavior via AgentBook join
            book_ids = [
                str(row[0])
                for row in db.query(AgentBook.book_id)
                .filter(AgentBook.agent_id == agent_id)
                .all()
            ]

            if not book_ids:
                return {"concepts": [], "chunks": []}

            concept_results = db.execute(
                sql_text("""
                    SELECT c.id, c.name, c.definition, c.chapter_source, c.page_range,
                           c.examples, c.actionable_questions, c.tags,
                           1 - (c.embedding <=> CAST(:embedding AS vector)) as similarity
                    FROM concepts c
                    WHERE c.book_id = ANY(CAST(:book_ids AS uuid[]))
                      AND c.embedding IS NOT NULL
                    ORDER BY c.embedding <=> CAST(:embedding AS vector)
                    LIMIT :top_k
                """),
                {
                    "embedding": str(query_embedding),
                    "book_ids": book_ids,
                    "top_k": top_k_concepts,
                },
            )

            chunk_results = db.execute(
                sql_text("""
                    SELECT bc.content, bc.chapter_title, bc.page_number,
                           b.title as book_title, b.author as book_author,
                           1 - (bc.embedding <=> CAST(:embedding AS vector)) as similarity
                    FROM book_chunks bc
                    JOIN books b ON bc.book_id = b.id
                    WHERE bc.book_id = ANY(CAST(:book_ids AS uuid[]))
                      AND bc.embedding IS NOT NULL
                      AND bc.is_deleted IS NOT TRUE
                    ORDER BY bc.embedding <=> CAST(:embedding AS vector)
                    LIMIT :top_k
                """),
                {
                    "embedding": str(query_embedding),
                    "book_ids": book_ids,
                    "top_k": top_k_chunks,
                },
            )

        concepts = []
        for row in concept_results:
            concepts.append({
                "id": str(row.id),
                "name": row.name,
                "definition": row.definition,
                "chapter_source": row.chapter_source,
                "page_range": row.page_range,
                "examples": row.examples or [],
                "actionable_questions": row.actionable_questions or [],
                "tags": row.tags or [],
                "similarity": float(row.similarity),
            })

        chunks = []
        for row in chunk_results:
            chunks.append({
                "content": row.content,
                "chapter_title": row.chapter_title,
                "page_number": row.page_number,
                "book_title": row.book_title,
                "book_author": row.book_author,
                "similarity": float(row.similarity),
            })

        return {"concepts": concepts, "chunks": chunks}

    def get_concepts_by_tags(
        self,
        tags: List[str],
        owner_id: UUID,
        db: Session,
        top_k: int = None,
        quality_threshold: float = 0.5,
    ) -> List[Dict]:
        """Get concepts from all user's books that match any of the given tags."""
        top_k = top_k or settings.MAX_CONCEPTS_PER_REVIEW

        result = db.execute(
            sql_text("""
                SELECT c.id, c.name, c.definition, c.chapter_source, c.page_range,
                       c.examples, c.actionable_questions, c.section_relevance,
                       c.tags, c.quality_score
                FROM concepts c
                JOIN books b ON c.book_id = b.id
                WHERE b.owner_id = :owner_id
                  AND c.tags ?| :tags
                  AND (c.quality_score IS NULL OR c.quality_score >= :threshold)
                ORDER BY c.quality_score DESC NULLS LAST
                LIMIT :top_k
            """),
            {
                "owner_id": str(owner_id),
                "tags": tags,
                "threshold": quality_threshold,
                "top_k": top_k,
            },
        )

        concepts = []
        for row in result:
            concepts.append({
                "id": str(row.id),
                "name": row.name,
                "definition": row.definition,
                "chapter_source": row.chapter_source,
                "page_range": row.page_range,
                "examples": row.examples or [],
                "actionable_questions": row.actionable_questions or [],
                "section_relevance": row.section_relevance or {},
                "tags": row.tags or [],
                "quality_score": row.quality_score,
            })

        return concepts

    def get_all_tags(self, owner_id: UUID, db: Session) -> List[str]:
        """Return all unique concept tags from the user's processed books."""
        result = db.execute(
            sql_text("""
                SELECT DISTINCT jsonb_array_elements_text(c.tags) as tag
                FROM concepts c
                JOIN books b ON c.book_id = b.id
                WHERE b.owner_id = :owner_id
                  AND b.status = 'completed'
                ORDER BY tag
            """),
            {"owner_id": str(owner_id)},
        )
        return [row.tag for row in result]


rag_service = RAGService()
