"""
Snippet Manager API — /api/snippets
Operates on the Snippet table (NOT BookChunks).
GET    /api/snippets?book_id={uuid}&page=1&per_page=50
PATCH  /api/snippets/{snippet_id}    body: {"content": "..."}
DELETE /api/snippets/{snippet_id}
No POST — snippets are AI-created only (EXTR-03).
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID
import tiktoken
import logging

from screenwriter.api.dependencies import get_current_user, get_db
from screenwriter.models import schemas
from screenwriter.models.database import Book, Snippet
from screenwriter.services.embedding_service import embedding_service

router = APIRouter()
logger = logging.getLogger(__name__)


def _count_tokens(text: str) -> int:
    try:
        enc = tiktoken.encoding_for_model("gpt-4")
        return len(enc.encode(text))
    except Exception:
        return len(text.split())


def _snippet_to_dict(snippet: Snippet) -> dict:
    return {
        "id": str(snippet.id),
        "book_id": str(snippet.book_id),
        "chapter_title": snippet.chapter_title,
        "page_number": snippet.page_number,
        "content": snippet.content,
        "justification": snippet.justification,
        "concept_ids": snippet.concept_ids or [],
        "concept_names": snippet.concept_names or [],
        "token_count": snippet.token_count or 0,
        "is_deleted": snippet.is_deleted,
        "created_at": snippet.created_at.isoformat() if snippet.created_at else None,
        "updated_at": snippet.updated_at.isoformat() if snippet.updated_at else None,
    }


@router.get("/")
async def list_snippets(
    book_id: UUID = Query(...),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List snippets for a book. Includes concept_names for display (BROW-03).
    Returns book_status so frontend can show processing banner without extra API call (BROW-05).
    """
    book = db.query(Book).filter(
        Book.id == str(book_id),
        Book.owner_id == str(current_user.id),
    ).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    base_q = (
        db.query(Snippet)
        .filter(
            Snippet.book_id == str(book_id),
            Snippet.is_deleted.isnot(True),
        )
        .order_by(Snippet.created_at)
    )
    total = base_q.count()
    items = base_q.offset((page - 1) * per_page).limit(per_page).all()
    pages = (total + per_page - 1) // per_page if total > 0 else 1

    return {
        "items": [_snippet_to_dict(s) for s in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "book_status": book.status.value if hasattr(book.status, "value") else (book.status or "pending"),
    }


@router.patch("/{snippet_id}")
async def edit_snippet(
    snippet_id: UUID,
    body: schemas.SnippetEdit,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit snippet content. Embeds BEFORE DB mutation — embed failure rolls back atomically."""
    snippet = (
        db.query(Snippet)
        .join(Book, Book.id == Snippet.book_id)
        .filter(
            Snippet.id == str(snippet_id),
            Snippet.is_deleted.isnot(True),
            Book.owner_id == str(current_user.id),
        )
        .first()
    )
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found")

    # Embed BEFORE DB mutation — if embed raises, nothing is committed
    new_embedding = await embedding_service.embed_text(body.content)
    new_token_count = _count_tokens(body.content)

    snippet.content = body.content
    snippet.embedding = new_embedding
    snippet.token_count = new_token_count
    db.commit()
    db.refresh(snippet)
    return _snippet_to_dict(snippet)


@router.delete("/{snippet_id}", status_code=204)
async def delete_snippet(
    snippet_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-delete a snippet. Excluded from all future list results."""
    snippet = (
        db.query(Snippet)
        .join(Book, Book.id == Snippet.book_id)
        .filter(
            Snippet.id == str(snippet_id),
            Snippet.is_deleted.isnot(True),
            Book.owner_id == str(current_user.id),
        )
        .first()
    )
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found")

    snippet.is_deleted = True
    db.commit()
    return None
