import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session

from screenwriter.models import schemas
from screenwriter.models.database import Book, BookStatus, Concept
from screenwriter.services.book_processing_service import book_processing_service
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.config import settings

router = APIRouter()

ACTIVE_PROCESSING_STATUSES = {
    BookStatus.PENDING,
    BookStatus.EXTRACTING,
    BookStatus.ANALYZING,
    BookStatus.EMBEDDING,
}


def _book_dict(b: Book) -> dict:
    return {
        "id": str(b.id),
        "title": b.title,
        "author": b.author,
        "filename": b.filename,
        "file_type": b.file_type,
        "file_size_bytes": b.file_size_bytes,
        "status": b.status.value if b.status else "pending",
        "processing_step": b.processing_step,
        "total_chunks": b.total_chunks,
        "total_concepts": b.total_concepts,
        "processing_error": b.processing_error,
        "chapters_total": b.chapters_total or 0,
        "chapters_processed": b.chapters_processed or 0,
        "progress": b.progress or 0,
        "uploaded_at": b.uploaded_at.isoformat() if b.uploaded_at else None,
        "processed_at": b.processed_at.isoformat() if b.processed_at else None,
    }


@router.post("/upload", response_model=schemas.BookUploadResponse)
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    author: str = Form(None),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a book for processing."""
    # Validate file type
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else ""
    if ext not in ("pdf", "epub", "txt"):
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, EPUB, or TXT.")

    # Validate file size
    file_content = await file.read()
    if len(file_content) > settings.MAX_BOOK_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max {settings.MAX_BOOK_SIZE_MB}MB.")

    # Save file to disk
    upload_dir = os.path.join(settings.UPLOAD_DIR, str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as f:
        f.write(file_content)

    # Create book record
    book = Book(
        owner_id=current_user.id,
        title=title,
        author=author,
        filename=file.filename,
        file_type=ext,
        file_size_bytes=len(file_content),
        status=BookStatus.PENDING,
    )
    db.add(book)
    db.commit()
    db.refresh(book)

    # Trigger background processing
    background_tasks.add_task(
        book_processing_service.process_book,
        book.id,
        file_path,
        db,
    )

    return {"id": str(book.id), "status": "pending", "message": "Book uploaded. Processing started."}


@router.get("/")
async def list_books(
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all books for the current user."""
    books = (
        db.query(Book)
        .filter(Book.owner_id == current_user.id)
        .order_by(Book.uploaded_at.desc())
        .all()
    )
    return [_book_dict(b) for b in books]


@router.post("/{book_id}/pause")
async def pause_book(
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop an actively processing book. It can be resumed later."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.status not in ACTIVE_PROCESSING_STATUSES:
        raise HTTPException(status_code=400, detail="Book is not currently being processed")

    cancelled = book_processing_service.pause_book(str(book_id))
    if not cancelled:
        # Task not found in registry (may have just finished) — set PAUSED directly
        book.status = BookStatus.PAUSED
        book.processing_step = f"Paused at chapter {book.chapters_processed} of {book.chapters_total}"
        db.commit()

    return {"message": "Stopping..."}


@router.post("/{book_id}/resume")
async def resume_book(
    book_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resume processing a paused book from its last checkpoint."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.status != BookStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Book is not paused")

    # Pass IDs only — the background task creates its own DB session
    background_tasks.add_task(
        book_processing_service.resume_book,
        str(book_id),
        str(current_user.id),
    )
    return {"message": "Resuming..."}


@router.post("/{book_id}/retry")
async def retry_book(
    book_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete all extracted data and reprocess the book from scratch."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.status not in {BookStatus.FAILED, BookStatus.PAUSED}:
        raise HTTPException(status_code=400, detail="Book must be failed or paused to retry")

    background_tasks.add_task(
        book_processing_service.retry_book,
        str(book_id),
        str(current_user.id),
    )
    return {"message": "Retrying from scratch..."}


@router.get("/{book_id}")
async def get_book(
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get book details including processing status."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return _book_dict(book)


@router.get("/{book_id}/concepts")
async def get_book_concepts(
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List extracted concepts for a book."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    concepts = (
        db.query(Concept)
        .filter(Concept.book_id == book_id)
        .order_by(Concept.name)
        .all()
    )
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "definition": c.definition,
            "chapter_source": c.chapter_source,
            "page_range": c.page_range,
            "examples": c.examples,
            "actionable_questions": c.actionable_questions,
            "section_relevance": c.section_relevance,
            "tags": c.tags,
        }
        for c in concepts
    ]


@router.delete("/{book_id}")
async def delete_book(
    book_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a book and all its chunks/concepts."""
    book = (
        db.query(Book)
        .filter(Book.id == book_id, Book.owner_id == current_user.id)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Delete file from disk
    file_path = os.path.join(settings.UPLOAD_DIR, str(current_user.id), book.filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    db.delete(book)
    db.commit()
    return {"message": "Book deleted"}
