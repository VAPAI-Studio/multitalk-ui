"""
Snippet CRUD endpoints.
Mounted at /api/books prefix in main.py — handles /{book_id}/snippets paths.
"""
import uuid
from uuid import UUID

import tiktoken
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from screenwriter.models import schemas
from screenwriter.models.database import Book, BookChunk
from screenwriter.services.embedding_service import embedding_service
from screenwriter.api.dependencies import get_db, get_current_user

router = APIRouter()

_ENC = tiktoken.encoding_for_model("gpt-4")


def _count_tokens(text: str) -> int:
    return len(_ENC.encode(text))


def _chunk_to_dict(chunk: BookChunk) -> dict:
    return {
        "id": str(chunk.id),
        "book_id": str(chunk.book_id),
        "chunk_index": chunk.chunk_index,
        "content": chunk.content,
        "token_count": chunk.token_count,
        "chapter_title": chunk.chapter_title,
        "page_number": chunk.page_number,
        "is_deleted": chunk.is_deleted,
        "is_user_created": chunk.is_user_created,
        "created_at": chunk.created_at.isoformat() if chunk.created_at else None,
        "updated_at": chunk.updated_at.isoformat() if chunk.updated_at else None,
    }


def _get_book_or_404(book_id: UUID, current_user: schemas.User, db: Session) -> Book:
    # Use str() for owner_id comparison: SQLite stores UUIDs as strings (String(36)),
    # and PostgreSQL also accepts string literals for uuid columns via implicit cast.
    book = (
        db.query(Book)
        .filter(Book.id == str(book_id), Book.owner_id == str(current_user.id))
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.get("/{book_id}/snippets")
async def list_snippets(
    book_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """BROW-01: Paginated list of non-deleted chunks for a book."""
    _get_book_or_404(book_id, current_user, db)

    base_query = (
        db.query(BookChunk)
        .filter(BookChunk.book_id == str(book_id), BookChunk.is_deleted.isnot(True))
        .order_by(BookChunk.chunk_index)
    )
    total = base_query.count()
    chunks = base_query.offset((page - 1) * per_page).limit(per_page).all()
    pages = (total + per_page - 1) // per_page if total > 0 else 1

    return {
        "items": [_chunk_to_dict(c) for c in chunks],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    }


@router.patch("/{book_id}/snippets/{chunk_id}")
async def edit_snippet(
    book_id: UUID,
    chunk_id: UUID,
    body: schemas.SnippetEdit,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """EDIT-01 + EDIT-02: Update content with atomic re-embedding."""
    _get_book_or_404(book_id, current_user, db)

    chunk = (
        db.query(BookChunk)
        .filter(
            BookChunk.id == str(chunk_id),
            BookChunk.book_id == str(book_id),
            BookChunk.is_deleted.isnot(True),
        )
        .first()
    )
    if not chunk:
        raise HTTPException(status_code=404, detail="Snippet not found")

    # Embed BEFORE any DB mutation — if this raises, nothing is committed
    new_embedding = await embedding_service.embed_text(body.content)
    new_token_count = _count_tokens(body.content)

    chunk.content = body.content
    chunk.embedding = new_embedding
    chunk.token_count = new_token_count
    db.commit()
    db.refresh(chunk)
    return _chunk_to_dict(chunk)


@router.delete("/{book_id}/snippets/{chunk_id}")
async def delete_snippet(
    book_id: UUID,
    chunk_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """EDIT-04: Soft-delete a chunk."""
    _get_book_or_404(book_id, current_user, db)

    chunk = (
        db.query(BookChunk)
        .filter(
            BookChunk.id == str(chunk_id),
            BookChunk.book_id == str(book_id),
            BookChunk.is_deleted.isnot(True),
        )
        .first()
    )
    if not chunk:
        raise HTTPException(status_code=404, detail="Snippet not found")

    chunk.is_deleted = True
    db.commit()
    return {"message": "Snippet deleted"}


@router.post("/{book_id}/snippets", status_code=201)
async def create_snippet(
    book_id: UUID,
    body: schemas.SnippetCreate,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """CUST-01 + CUST-03: Create a user-owned snippet with automatic embedding."""
    _get_book_or_404(book_id, current_user, db)

    # Embed BEFORE any DB write — if this raises, nothing is committed
    new_embedding = await embedding_service.embed_text(body.content)
    token_count = _count_tokens(body.content)

    max_index = (
        db.query(func.max(BookChunk.chunk_index))
        .filter(BookChunk.book_id == str(book_id))
        .scalar()
    ) or 0

    chunk = BookChunk(
        id=uuid.uuid4(),
        book_id=book_id,
        chunk_index=max_index + 1,
        content=body.content,
        embedding=new_embedding,
        token_count=token_count,
        chapter_title=body.chapter_title,
        page_number=body.page_number,
        is_user_created=True,
        is_deleted=False,
    )
    db.add(chunk)
    db.commit()
    db.refresh(chunk)
    return _chunk_to_dict(chunk)
