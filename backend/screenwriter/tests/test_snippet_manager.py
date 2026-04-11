"""
Snippet Manager API tests — Phase 2 (BROW-02, BROW-03, EDIT-03, EXTR-03)
Tests the /api/snippets router which operates on the Snippet table (NOT BookChunks).
Run: pytest app/tests/test_snippet_manager.py -v
"""
import uuid
import pytest
from unittest.mock import AsyncMock, patch

from screenwriter.models.database import Book, BookStatus, Snippet

# The mock auth user ID — matches MockAuthService.get_current_user()
MOCK_USER_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")


class TestSnippetAPI:
    """Tests for /api/snippets router (Snippet entity, Phase 2)."""

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

    def _make_snippet(self, db_session, book, **kwargs):
        """Helper: create a Snippet record for a given book."""
        defaults = dict(
            id=uuid.uuid4(),
            book_id=str(book.id),
            content="test content",
            token_count=42,
            chapter_title="Chapter 1",
            page_number=5,
            concept_ids=["abc123"],
            concept_names=["Test Concept"],
            is_deleted=False,
        )
        defaults.update(kwargs)
        snippet = Snippet(**defaults)
        db_session.add(snippet)
        db_session.commit()
        return snippet

    def test_list_snippets_includes_metadata(self, client, db_session, mock_auth_headers):
        """BROW-02: GET /api/snippets?book_id={id} returns items with chapter_title, page_number, token_count"""
        book = self._make_book(db_session)
        snippet = self._make_snippet(
            db_session,
            book,
            chapter_title="Chapter 1",
            page_number=5,
            token_count=42,
            content="test content",
            concept_names=["Test Concept"],
            concept_ids=["abc123"],
        )

        response = client.get(
            f"/api/snippets/?book_id={book.id}",
            headers=mock_auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        item = data["items"][0]
        assert item["chapter_title"] == "Chapter 1"
        assert item["page_number"] == 5
        assert item["token_count"] == 42

    def test_list_snippets_includes_concept_names(self, client, db_session, mock_auth_headers):
        """BROW-03: GET /api/snippets?book_id={id} returns items with concept_names list"""
        book = self._make_book(db_session)
        snippet = self._make_snippet(
            db_session,
            book,
            content="concept test content",
            concept_names=["Save the Cat", "Beat Sheet"],
            concept_ids=["id1", "id2"],
        )

        response = client.get(
            f"/api/snippets/?book_id={book.id}",
            headers=mock_auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        item = data["items"][0]
        assert item["concept_names"] == ["Save the Cat", "Beat Sheet"]

    def test_edit_snippet_atomic_rollback(self, client, db_session, mock_auth_headers, mock_embed):
        """EDIT-03: PATCH /api/snippets/{id} with failing embed returns 5xx and does not mutate DB"""
        from fastapi.testclient import TestClient
        from screenwriter.main import app
        from screenwriter.db import get_db

        book = self._make_book(db_session)
        snippet = self._make_snippet(
            db_session,
            book,
            content="original content",
        )

        def override_get_db():
            try:
                yield db_session
            finally:
                pass

        with patch(
            "app.services.embedding_service.embedding_service.embed_text",
            new_callable=AsyncMock,
            side_effect=RuntimeError("embed failed"),
        ):
            app.dependency_overrides[get_db] = override_get_db
            atomic_client = TestClient(app, raise_server_exceptions=False)
            response = atomic_client.patch(
                f"/api/snippets/{snippet.id}",
                json={"content": "new content"},
                headers=mock_auth_headers,
            )
            app.dependency_overrides.clear()

        assert response.status_code >= 500

        db_session.refresh(snippet)
        assert snippet.content == "original content"

    def test_no_create_endpoint(self, client, db_session, mock_auth_headers):
        """EXTR-03: POST /api/snippets returns 404 or 405 — no user-facing creation allowed"""
        response = client.post(
            "/api/snippets/",
            json={"content": "test", "book_id": "00000000-0000-0000-0000-000000000001"},
            headers=mock_auth_headers,
        )
        assert response.status_code in (404, 405)
