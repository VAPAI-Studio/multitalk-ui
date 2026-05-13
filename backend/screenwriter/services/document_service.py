import logging
from typing import List, Dict, Optional
import tiktoken

logger = logging.getLogger(__name__)


class DocumentChunk:
    """Represents a chunk of text from a document."""

    def __init__(
        self,
        content: str,
        token_count: int,
        chapter_title: Optional[str] = None,
        page_number: Optional[int] = None,
        chunk_index: int = 0,
    ):
        self.content = content
        self.token_count = token_count
        self.chapter_title = chapter_title
        self.page_number = page_number
        self.chunk_index = chunk_index


class DocumentService:
    def __init__(self, chunk_size: int = 750, chunk_overlap: int = 150):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.tokenizer = tiktoken.encoding_for_model("gpt-4")

    def extract_text_from_pdf(self, file_path: str) -> List[Dict]:
        """Extract text from PDF, return list of {text, page_number}."""
        from PyPDF2 import PdfReader

        reader = PdfReader(file_path)
        pages = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages.append({"text": text, "page_number": i + 1})
        return pages

    def extract_text_from_epub(self, file_path: str) -> List[Dict]:
        """Extract text from EPUB, return list of {text, chapter_title}."""
        import ebooklib
        from ebooklib import epub
        from bs4 import BeautifulSoup

        book = epub.read_epub(file_path)
        chapters = []
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            soup = BeautifulSoup(item.get_content(), "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            if text.strip():
                title = item.get_name() or ""
                heading = soup.find(["h1", "h2", "h3"])
                if heading:
                    title = heading.get_text(strip=True)
                chapters.append({"text": text, "chapter_title": title})
        return chapters

    def extract_text_from_txt(self, file_path: str) -> List[Dict]:
        """Extract text from plain text file."""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        return [{"text": text}]

    def extract_text(self, file_path: str, file_type: str) -> List[Dict]:
        """Route to appropriate extractor based on file type."""
        extractors = {
            "pdf": self.extract_text_from_pdf,
            "epub": self.extract_text_from_epub,
            "txt": self.extract_text_from_txt,
        }
        extractor = extractors.get(file_type)
        if not extractor:
            raise ValueError(f"Unsupported file type: {file_type}")
        return extractor(file_path)

    def count_tokens(self, text: str) -> int:
        """Count tokens using the GPT-4 tokenizer."""
        return len(self.tokenizer.encode(text))

    def chunk_text(self, pages: List[Dict]) -> List[DocumentChunk]:
        """Split extracted pages/chapters into overlapping chunks."""
        chunks = []
        chunk_index = 0

        # Concatenate all text with metadata tracking
        full_text = ""
        metadata_map = []  # (char_start, char_end, metadata)

        for page_data in pages:
            start = len(full_text)
            full_text += page_data["text"] + "\n\n"
            end = len(full_text)
            metadata_map.append((start, end, page_data))

        # Encode full text to tokens
        tokens = self.tokenizer.encode(full_text)

        # Create chunks with overlap
        i = 0
        while i < len(tokens):
            chunk_tokens = tokens[i : i + self.chunk_size]
            chunk_text = self.tokenizer.decode(chunk_tokens)

            # Find which page/chapter this chunk belongs to
            chunk_start_char = len(self.tokenizer.decode(tokens[:i]))
            mid_char = chunk_start_char + len(chunk_text) // 2

            chapter_title = None
            page_number = None
            for s, e, meta in metadata_map:
                if s <= mid_char < e:
                    chapter_title = meta.get("chapter_title")
                    page_number = meta.get("page_number")
                    break

            chunks.append(
                DocumentChunk(
                    content=chunk_text.strip(),
                    token_count=len(chunk_tokens),
                    chapter_title=chapter_title,
                    page_number=page_number,
                    chunk_index=chunk_index,
                )
            )

            chunk_index += 1
            i += self.chunk_size - self.chunk_overlap

        return chunks

    def split_into_chapters(self, pages: List[Dict]) -> List[Dict]:
        """Group pages into logical chapters for KG extraction.

        Returns list of {title, text, start_page, end_page}.
        """
        if not pages:
            return []

        # If pages have chapter_title, group by that
        if "chapter_title" in pages[0]:
            chapters = []
            current_chapter = None
            for page in pages:
                title = page.get("chapter_title", "Untitled")
                if current_chapter is None or current_chapter["title"] != title:
                    if current_chapter:
                        chapters.append(current_chapter)
                    current_chapter = {"title": title, "text": page["text"]}
                else:
                    current_chapter["text"] += "\n\n" + page["text"]
            if current_chapter:
                chapters.append(current_chapter)
            return chapters

        # If pages have page_number, create chapters of ~20 pages each
        chapter_size = 20
        chapters = []
        for i in range(0, len(pages), chapter_size):
            batch = pages[i : i + chapter_size]
            text = "\n\n".join(p["text"] for p in batch)
            start_page = batch[0].get("page_number", i + 1)
            end_page = batch[-1].get("page_number", i + len(batch))
            chapters.append(
                {
                    "title": f"Pages {start_page}-{end_page}",
                    "text": text,
                    "start_page": start_page,
                    "end_page": end_page,
                }
            )
        return chapters


document_service = DocumentService()
