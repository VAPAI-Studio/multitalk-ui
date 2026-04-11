import asyncio
import hashlib
import logging
from collections import OrderedDict
from typing import List

from openai import AsyncOpenAI, RateLimitError

from screenwriter.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.model = settings.EMBEDDING_MODEL
        # In-memory LRU cache for query embeddings
        self._cache: OrderedDict = OrderedDict()
        self._max_cache_size = 500

    async def embed_text(self, text: str) -> List[float]:
        """Generate embedding for a single text, with caching."""
        cache_key = hashlib.md5(text.encode()).hexdigest()
        if cache_key in self._cache:
            self._cache.move_to_end(cache_key)
            return self._cache[cache_key]

        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        embedding = response.data[0].embedding

        self._cache[cache_key] = embedding
        if len(self._cache) > self._max_cache_size:
            self._cache.popitem(last=False)

        return embedding

    async def embed_batch(self, texts: List[str], batch_size: int = 50) -> List[List[float]]:
        """Generate embeddings for multiple texts in batches with rate limit handling."""
        all_embeddings = []
        total_batches = (len(texts) - 1) // batch_size + 1
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            batch_num = i // batch_size + 1
            logger.info(f"Embedding batch {batch_num}/{total_batches} ({len(batch)} texts)")

            for attempt in range(5):
                try:
                    response = await self.client.embeddings.create(
                        model=self.model,
                        input=batch,
                    )
                    batch_embeddings = [item.embedding for item in response.data]
                    all_embeddings.extend(batch_embeddings)
                    break
                except RateLimitError as e:
                    wait = 2 ** attempt * 2  # 2, 4, 8, 16, 32 seconds
                    logger.warning(f"Rate limited on batch {batch_num}, retrying in {wait}s (attempt {attempt + 1}/5): {e}")
                    await asyncio.sleep(wait)
            else:
                raise RateLimitError("Rate limit exceeded after 5 retries")

            # Small delay between batches to avoid rate limits
            if batch_num < total_batches:
                await asyncio.sleep(1)
        return all_embeddings


embedding_service = EmbeddingService()
