import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Dict
from uuid import UUID

from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.db import SessionLocal
from screenwriter.models.database import Book, BookChunk, BookStatus, Concept, ConceptRelationship, RelationshipType, Snippet
from .document_service import document_service
from .embedding_service import embedding_service
from .knowledge_extraction_service import knowledge_extraction_service

logger = logging.getLogger(__name__)

# Registry of active processing tasks: book_id (str) → asyncio.Task
_active_tasks: Dict[str, asyncio.Task] = {}


class BookProcessingService:
    """Orchestrates the full book processing pipeline:
    1. Extract text from document
    2. Create raw chunks + embeddings (for RAG citations)
    3. Extract knowledge graph via GPT-4 (concepts + relationships)
    4. Generate concept embeddings
    5. Link chunks to concepts
    """

    async def process_book(
        self,
        book_id: UUID,
        file_path: str,
        db: Session,
        start_chapter: int = 0,
    ) -> None:
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            logger.error(f"Book {book_id} not found")
            return

        # Register this coroutine's task so it can be cancelled
        current_task = asyncio.current_task()
        if current_task:
            _active_tasks[str(book_id)] = current_task

        try:
            if start_chapter == 0:
                # ── Step 1: Extract text ──
                self._update_status(book, BookStatus.EXTRACTING, "Extracting text from document", db, progress=5)
                pages = document_service.extract_text(file_path, book.file_type)

                if not pages:
                    raise ValueError("No text could be extracted from the document")

                logger.info(f"Extracted {len(pages)} pages/sections from {book.filename}")

                # ── Step 2: Create raw chunks + embeddings ──
                self._update_status(book, BookStatus.EMBEDDING, "Creating text chunks and embeddings", db, progress=8)

                chunks = document_service.chunk_text(pages)
                logger.info(f"Created {len(chunks)} chunks")

                chunk_texts = [c.content for c in chunks]
                chunk_embeddings = await embedding_service.embed_batch(chunk_texts)

                db_chunks = []
                for chunk, emb in zip(chunks, chunk_embeddings):
                    db_chunk = BookChunk(
                        book_id=book_id,
                        chunk_index=chunk.chunk_index,
                        content=chunk.content,
                        token_count=chunk.token_count,
                        embedding=emb,
                        chapter_title=chunk.chapter_title,
                        page_number=chunk.page_number,
                    )
                    db.add(db_chunk)
                    db_chunks.append(db_chunk)

                book.total_chunks = len(chunks)
                book.progress = 10
                db.commit()
            else:
                # Resuming: fetch existing chunks for concept-linking later
                logger.info(f"Resuming book {book_id} from chapter {start_chapter}")
                pages = document_service.extract_text(file_path, book.file_type)
                db_chunks = db.query(BookChunk).filter(BookChunk.book_id == book_id).all()

            # ── Step 3: Extract knowledge graph ──
            self._update_status(book, BookStatus.ANALYZING, "Extracting knowledge graph", db, progress=book.progress)

            chapters = document_service.split_into_chapters(pages)
            chapters_total = len(chapters)

            # Set total on first pass; preserve on resume
            if start_chapter == 0:
                book.chapters_total = chapters_total
                db.commit()

            logger.info(f"Processing {chapters_total} chapters (starting at {start_chapter})")

            all_concepts = []
            all_relationships = []
            all_raw_snippets = []

            try:
                for idx, chapter in enumerate(chapters):
                    if idx < start_chapter:
                        continue  # Skip already-processed chapters

                    chapter_title = chapter.get("title", "Untitled")
                    chapter_result = await knowledge_extraction_service.process_chapter(
                        chapter_text=chapter["text"],
                        chapter_title=chapter_title,
                        book_title=book.title,
                    )
                    all_concepts.extend(chapter_result.get("concepts", []))
                    all_relationships.extend(chapter_result.get("relationships", []))

                    # Inject chapter_title into each snippet (AI doesn't know which chapter it's in)
                    for s in chapter_result.get("snippets", []):
                        s["chapter_title"] = chapter_title
                    all_raw_snippets.extend(chapter_result.get("snippets", []))

                    # Update per-chapter progress
                    book.chapters_processed = idx + 1
                    book.progress = 10 + int(75 * (book.chapters_processed / chapters_total))
                    book.processing_step = f"Analyzed chapter {idx + 1} of {chapters_total}"
                    db.commit()

            except asyncio.CancelledError:
                logger.info(f"Book {book_id} processing cancelled — saving PAUSED state")
                book.status = BookStatus.PAUSED
                book.processing_step = f"Paused at chapter {book.chapters_processed} of {book.chapters_total}"
                db.commit()
                _active_tasks.pop(str(book_id), None)
                return

            logger.info(f"Extracted {len(all_concepts)} concepts, {len(all_relationships)} relationships")

            # ── Quality filter ──
            QUALITY_THRESHOLD = 0.5
            filtered_concepts = [
                c for c in all_concepts
                if c.get("quality_score", QUALITY_THRESHOLD) >= QUALITY_THRESHOLD
            ]
            if len(filtered_concepts) < len(all_concepts):
                logger.info(
                    f"Quality filter: {len(all_concepts)} → {len(filtered_concepts)} concepts "
                    f"(dropped {len(all_concepts) - len(filtered_concepts)} low-quality)"
                )
            all_concepts = filtered_concepts

            # ── Step 4: Store concepts + generate concept embeddings ──
            self._update_status(book, BookStatus.EMBEDDING, "Generating concept embeddings", db, progress=90)

            concept_definitions = [c["definition"] for c in all_concepts]
            concept_embeddings = await embedding_service.embed_batch(concept_definitions) if concept_definitions else []

            concept_name_to_db = {}

            for concept_data, emb in zip(all_concepts, concept_embeddings):
                db_concept = Concept(
                    book_id=book_id,
                    name=concept_data["name"],
                    definition=concept_data["definition"],
                    chapter_source=concept_data.get("chapter_source"),
                    page_range=concept_data.get("page_range"),
                    examples=concept_data.get("examples", []),
                    actionable_questions=concept_data.get("actionable_questions", []),
                    section_relevance=concept_data.get("section_relevance", {}),
                    tags=concept_data.get("tags", []),
                    quality_score=concept_data.get("quality_score"),
                    embedding=emb,
                )
                db.add(db_concept)
                db.flush()
                concept_name_to_db[concept_data["name"]] = db_concept

            # ── Step 5: Store relationships ──
            book.progress = 97
            db.commit()

            for rel_data in all_relationships:
                source = concept_name_to_db.get(rel_data["source"])
                target = concept_name_to_db.get(rel_data["target"])
                if source and target:
                    rel_type_str = rel_data.get("type", "related_to")
                    try:
                        rel_type = RelationshipType(rel_type_str)
                    except ValueError:
                        rel_type = RelationshipType.RELATED_TO

                    db_rel = ConceptRelationship(
                        source_concept_id=source.id,
                        target_concept_id=target.id,
                        relationship=rel_type,
                        description=rel_data.get("description"),
                    )
                    db.add(db_rel)

            # ── Step 6: Persist AI-curated snippets with embeddings ──
            if all_raw_snippets:
                snippet_texts = [s["content"] for s in all_raw_snippets]
                snippet_embeddings = await embedding_service.embed_batch(snippet_texts)

                for raw_snippet, emb in zip(all_raw_snippets, snippet_embeddings):
                    concept_name = raw_snippet.get("concept_name")
                    concept_db = concept_name_to_db.get(concept_name) if concept_name else None
                    concept_ids = [str(concept_db.id)] if concept_db else []
                    concept_names = [concept_db.name] if concept_db else []

                    token_count = len(raw_snippet["content"].split())
                    db_snippet = Snippet(
                        book_id=book_id,
                        chapter_title=raw_snippet.get("chapter_title"),
                        content=raw_snippet["content"],
                        justification=raw_snippet.get("justification"),
                        concept_ids=concept_ids,
                        concept_names=concept_names,
                        token_count=token_count,
                        embedding=emb,
                    )
                    db.add(db_snippet)

                db.commit()
                logger.info(f"Persisted {len(all_raw_snippets)} snippets for book {book_id}")

            # ── Step 7: Link chunks to concepts ──
            for db_chunk in db_chunks:
                linked_ids = []
                chunk_lower = db_chunk.content.lower()
                for name, db_concept in concept_name_to_db.items():
                    if name.lower() in chunk_lower:
                        linked_ids.append(str(db_concept.id))
                if linked_ids:
                    db_chunk.concept_ids = linked_ids

            # ── Finalize ──
            book.status = BookStatus.COMPLETED
            book.total_concepts = len(all_concepts)
            book.processed_at = datetime.now(timezone.utc)
            book.processing_step = "Complete"
            book.progress = 100
            book.chapters_processed = chapters_total
            db.commit()

            logger.info(
                f"Book '{book.title}' processed: "
                f"{book.total_chunks} chunks, "
                f"{book.total_concepts} concepts, "
                f"{len(all_relationships)} relationships"
            )

        except asyncio.CancelledError:
            # Cancelled outside the chapter loop (e.g. during embedding)
            logger.info(f"Book {book_id} cancelled during embedding — saving PAUSED state")
            book = db.query(Book).filter(Book.id == book_id).first()
            if book:
                book.status = BookStatus.PAUSED
                book.processing_step = f"Paused at chapter {book.chapters_processed} of {book.chapters_total}"
                db.commit()
            _active_tasks.pop(str(book_id), None)
            return

        except Exception as e:
            logger.error(f"Error processing book {book_id}: {e}", exc_info=True)
            book = db.query(Book).filter(Book.id == book_id).first()
            if book:
                book.status = BookStatus.FAILED
                book.processing_error = str(e)
                book.processing_step = "Failed"
                db.commit()

        finally:
            _active_tasks.pop(str(book_id), None)

    def pause_book(self, book_id: str) -> bool:
        """Cancel the active processing task for a book. Returns True if cancelled."""
        task = _active_tasks.get(book_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    async def resume_book(self, book_id: str, owner_id: str) -> None:
        """Resume processing a paused book from its last checkpoint."""
        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.id == book_id).first()
            if not book:
                logger.error(f"resume_book: book {book_id} not found")
                return

            start_chapter = book.chapters_processed
            file_path = os.path.join(settings.UPLOAD_DIR, owner_id, book.filename)

            # Clean up any partially-written concepts from the interrupted chapter
            # (chapter_source matches the chapter index that was in progress)
            # Since we re-process from start_chapter, we delete concepts from that chapter onward
            # Actually, concepts are stored after the full loop - so partial chapters have no concepts.
            # Safe to just resume from chapters_processed.

            book.status = BookStatus.ANALYZING
            book.processing_error = None
            book.processing_step = f"Resuming from chapter {start_chapter}"
            db.commit()

            await self.process_book(book.id, file_path, db, start_chapter=start_chapter)
        finally:
            db.close()

    async def retry_book(self, book_id: str, owner_id: str) -> None:
        """Delete all extracted data and reprocess the book from scratch."""
        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.id == book_id).first()
            if not book:
                logger.error(f"retry_book: book {book_id} not found")
                return

            # Delete existing extracted data — preserve user-created snippets
            db.query(BookChunk).filter(
                BookChunk.book_id == book.id,
                BookChunk.is_user_created == False,
            ).delete(synchronize_session=False)
            db.query(Concept).filter(Concept.book_id == book.id).delete()
            # Delete all AI-generated snippets — they will be recreated by reprocessing
            db.query(Snippet).filter(
                Snippet.book_id == str(book.id)
            ).delete(synchronize_session=False)

            # Reset counters
            book.status = BookStatus.PENDING
            book.chapters_total = 0
            book.chapters_processed = 0
            book.progress = 0
            book.total_chunks = 0
            book.total_concepts = 0
            book.processing_error = None
            book.processing_step = None
            book.processed_at = None
            db.commit()

            file_path = os.path.join(settings.UPLOAD_DIR, owner_id, book.filename)
            await self.process_book(book.id, file_path, db)
        finally:
            db.close()

    def _update_status(self, book: Book, status: BookStatus, step: str, db: Session, progress: int = -1) -> None:
        book.status = status
        book.processing_step = step
        if progress >= 0:
            book.progress = progress
        db.commit()
        logger.info(f"Book '{book.title}': {step}")


book_processing_service = BookProcessingService()
