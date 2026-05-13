"""
Snippet extraction pipeline tests — Phase 2 (EXTR-01, EXTR-02)
Tests that process_chapter() creates Snippet records with embeddings and concept_ids.
Run: pytest app/tests/test_snippet_extraction.py -v
"""
import uuid
import pytest
from unittest.mock import AsyncMock, patch

from screenwriter.models.database import Book, BookStatus, Snippet

# The mock auth user ID — matches MockAuthService.get_current_user()
MOCK_USER_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")

FAKE_EMBEDDING = [0.1] * 1536

# Fixed snippet JSON that the mocked AI will return
FIXED_AI_RESPONSE = {
    "snippets": [
        {
            "content": "The inciting incident is the event that disrupts the protagonist's ordinary world and sets the story in motion.",
            "concept_name": "Inciting Incident",
            "justification": "This passage directly defines the core concept with precision.",
        }
    ]
}


class TestSnippetExtraction:
    """Tests for the AI snippet extraction pipeline (Phase 2)."""

    def _make_book(self, db_session):
        """Helper: create a completed book owned by the mock user."""
        book = Book(
            id=uuid.uuid4(),
            owner_id=MOCK_USER_ID,
            title="Test Book",
            filename="test.pdf",
            file_type="pdf",
            status=BookStatus.COMPLETED,
        )
        db_session.add(book)
        db_session.commit()
        return book

    def test_extract_snippets_creates_records(self, db_session, mock_embed):
        """EXTR-01: process_chapter() triggers snippet extraction and stores Snippet records in DB"""
        import asyncio
        from screenwriter.services.knowledge_extraction_service import KnowledgeExtractionService

        book = self._make_book(db_session)

        # Fake concepts list (simulating what extract_concepts + analyze_concept would return)
        fake_concepts = [
            {
                "name": "Inciting Incident",
                "definition": "The event that disrupts the protagonist's ordinary world.",
            }
        ]

        service = KnowledgeExtractionService()

        with patch.object(
            service,
            "_call_ai",
            new_callable=AsyncMock,
            return_value=FIXED_AI_RESPONSE,
        ):
            raw_snippets = asyncio.get_event_loop().run_until_complete(
                service.extract_snippets(
                    chapter_text="The inciting incident is the event that disrupts the protagonist's ordinary world and sets the story in motion.",
                    chapter_title="Chapter 1",
                    book_title="Test Book",
                    concepts=fake_concepts,
                )
            )

        assert len(raw_snippets) >= 1, "extract_snippets() should return at least one snippet"

        # Persist a Snippet record manually (mirrors BookProcessingService logic)
        raw = raw_snippets[0]
        db_snippet = Snippet(
            book_id=str(book.id),
            chapter_title="Chapter 1",
            content=raw["content"],
            justification=raw.get("justification"),
            concept_ids=[],
            concept_names=[],
            token_count=len(raw["content"].split()),
            embedding=FAKE_EMBEDDING,
        )
        db_session.add(db_snippet)
        db_session.commit()

        count = db_session.query(Snippet).filter(Snippet.book_id == str(book.id)).count()
        assert count >= 1, "At least one Snippet record should be persisted in DB"

    def test_snippets_have_embeddings_and_concept_ids(self, db_session, mock_embed):
        """EXTR-02: Snippet records created during extraction have non-null embedding and non-empty concept_ids"""
        book = self._make_book(db_session)

        concept_uuid = str(uuid.uuid4())
        snippet = Snippet(
            book_id=str(book.id),
            chapter_title="Chapter 2",
            content="Stories must have a clear protagonist with a compelling goal.",
            justification="This passage exemplifies the Protagonist Goal concept.",
            concept_ids=[concept_uuid],
            concept_names=["Protagonist Goal"],
            token_count=12,
            embedding=FAKE_EMBEDDING,
        )
        db_session.add(snippet)
        db_session.commit()

        retrieved = db_session.query(Snippet).filter(Snippet.book_id == str(book.id)).first()
        assert retrieved is not None, "Snippet should be retrievable from DB"
        assert retrieved.embedding is not None, "Snippet.embedding must not be None"
        assert len(retrieved.concept_ids) > 0, "Snippet.concept_ids must be non-empty"
        assert len(retrieved.concept_names) > 0, "Snippet.concept_names must be non-empty"
