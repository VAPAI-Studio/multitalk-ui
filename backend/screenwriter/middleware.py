# backend/app/middleware.py

import asyncio
import hashlib
import time
import logging
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Callable
import uuid

logger = logging.getLogger(__name__)

class LoggingMiddleware(BaseHTTPMiddleware):
    """Log all requests and responses"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate request ID for tracking
        request_id = str(uuid.uuid4())
        
        # Start time
        start_time = time.time()
        
        # Log request
        logger.info(
            f"Request [{request_id}]: {request.method} {request.url.path} "
            f"Client: {request.client.host if request.client else 'Unknown'}"
        )
        
        # Add request ID to request state
        request.state.request_id = request_id
        
        # Process request
        response = await call_next(request)
        
        # Calculate duration
        duration = time.time() - start_time
        
        # Log response
        logger.info(
            f"Response [{request_id}]: {response.status_code} "
            f"Duration: {duration:.3f}s"
        )
        
        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id
        
        return response

class SecurityMiddleware(BaseHTTPMiddleware):
    """Add security headers to responses"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        
        # Add security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        # More permissive CSP for development
        response.headers["Content-Security-Policy"] = (
            "default-src 'self' http://localhost:5173 http://localhost:5174 https://*.vapai.studio; "
            "connect-src 'self' http://localhost:5173 http://localhost:5174 http://localhost:8000 http://localhost:8080 https://*.vapai.studio; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline';"
        )
        
        return response

class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Limit request body size"""
    
    def __init__(self, app, max_size: int = 10 * 1024 * 1024):  # 10MB default
        super().__init__(app)
        self.max_size = max_size
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.headers.get("content-length"):
            content_length = int(request.headers["content-length"])
            if content_length > self.max_size:
                return Response(
                    content="Request body too large",
                    status_code=413
                )
        
        return await call_next(request)

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple rate limiting middleware"""
    
    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.requests = {}
        self.window_size = 60  # 1 minute
        self._lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        current_time = time.time()

        async with self._lock:
            # Clean old entries
            self.requests = {
                ip: timestamps
                for ip, timestamps in self.requests.items()
                if any(t > current_time - self.window_size for t in timestamps)
            }

            # Get client's request timestamps
            if client_ip not in self.requests:
                self.requests[client_ip] = []

            # Filter timestamps within window
            valid_timestamps = [
                t for t in self.requests[client_ip]
                if t > current_time - self.window_size
            ]

            if len(valid_timestamps) >= self.requests_per_minute:
                return Response(
                    content="Rate limit exceeded",
                    status_code=429,
                    headers={"Retry-After": str(self.window_size)}
                )

            # Add current request timestamp
            valid_timestamps.append(current_time)
            self.requests[client_ip] = valid_timestamps

        return await call_next(request)


class ApiKeyRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-API-key rate limiting (default 1000 req/hour).

    Only applies to requests with Bearer tokens starting with 'sa_'.
    JWT and unauthenticated requests pass through unaffected.
    """

    def __init__(self, app, default_rate_limit: int = 1000):
        super().__init__(app)
        self.default_rate_limit = default_rate_limit
        self.window_size = 3600  # 1 hour in seconds
        self.requests = {}  # key_hash -> [timestamps]
        self._lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip non-API-key requests and OPTIONS (CORS preflight)
        if request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        if not auth_header.lower().startswith("bearer sa_"):
            return await call_next(request)

        token = auth_header.split(" ", 1)[1]
        key_hash = hashlib.sha256(token.encode()).hexdigest()
        current_time = time.time()

        async with self._lock:
            # Clean up expired entries from all keys
            self.requests = {
                kh: timestamps
                for kh, timestamps in self.requests.items()
                if any(t > current_time - self.window_size for t in timestamps)
            }

            if key_hash not in self.requests:
                self.requests[key_hash] = []

            # Filter to current window
            valid = [t for t in self.requests[key_hash] if t > current_time - self.window_size]

            if len(valid) >= self.default_rate_limit:
                retry_after = int(self.window_size - (current_time - valid[0]))
                return Response(
                    content='{"detail": "API key rate limit exceeded"}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(max(1, retry_after))}
                )

            valid.append(current_time)
            self.requests[key_hash] = valid

        return await call_next(request)
