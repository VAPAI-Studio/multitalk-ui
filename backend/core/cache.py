"""
Server-side caching module for feed queries.

Provides a thread-safe TTL cache for frequently accessed feed data.
Cache is automatically invalidated after TTL expires.
"""

from cachetools import TTLCache
from threading import Lock
from typing import Optional, Any, Tuple, List, Dict

# Feed cache configuration
CACHE_TTL_SECONDS = 10  # 10-second TTL
CACHE_MAX_SIZE = 100    # Maximum number of cached entries

# Thread-safe cache instance
_feed_cache: TTLCache = TTLCache(maxsize=CACHE_MAX_SIZE, ttl=CACHE_TTL_SECONDS)
_cache_lock = Lock()


def get_cached(key: str) -> Optional[Any]:
    """
    Retrieve a cached value by key.

    Args:
        key: The cache key

    Returns:
        The cached value if present and not expired, None otherwise
    """
    with _cache_lock:
        return _feed_cache.get(key)


def set_cached(key: str, data: Any) -> None:
    """
    Store a value in the cache.

    Args:
        key: The cache key
        data: The value to cache
    """
    with _cache_lock:
        _feed_cache[key] = data


def invalidate(key: str) -> bool:
    """
    Remove a specific key from the cache.

    Args:
        key: The cache key to invalidate

    Returns:
        True if the key was found and removed, False otherwise
    """
    with _cache_lock:
        if key in _feed_cache:
            del _feed_cache[key]
            return True
        return False


def invalidate_pattern(prefix: str) -> int:
    """
    Remove all cache entries with keys starting with the given prefix.

    Args:
        prefix: The key prefix to match

    Returns:
        Number of entries invalidated
    """
    with _cache_lock:
        keys_to_remove = [k for k in _feed_cache.keys() if k.startswith(prefix)]
        for key in keys_to_remove:
            del _feed_cache[key]
        return len(keys_to_remove)


def clear_all() -> int:
    """
    Clear the entire cache.

    Returns:
        Number of entries cleared
    """
    with _cache_lock:
        count = len(_feed_cache)
        _feed_cache.clear()
        return count


def make_feed_cache_key(
    table: str,
    user_id: Optional[str] = None,
    workflow: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> str:
    """
    Generate a cache key for feed queries.

    Args:
        table: Table name (e.g., 'video_jobs', 'image_jobs')
        user_id: Optional user ID filter
        workflow: Optional workflow name filter
        status: Optional status filter
        limit: Number of items requested
        offset: Pagination offset

    Returns:
        A unique cache key string
    """
    parts = [
        f"feed:{table}",
        f"u:{user_id or 'all'}",
        f"w:{workflow or 'all'}",
        f"s:{status or 'all'}",
        f"l:{limit}",
        f"o:{offset}"
    ]
    return ":".join(parts)


def get_cache_stats() -> Dict[str, Any]:
    """
    Get cache statistics for monitoring.

    Returns:
        Dictionary with cache stats (size, max_size, ttl)
    """
    with _cache_lock:
        return {
            "current_size": len(_feed_cache),
            "max_size": CACHE_MAX_SIZE,
            "ttl_seconds": CACHE_TTL_SECONDS
        }
