# backend/app/main.py

import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from .api.endpoints import projects, sections, review, auth, books, agents, chat, snippets, snippet_manager
from .api.endpoints import templates as templates_ep, phase_data as phase_data_ep, list_items as list_items_ep
from .api.endpoints import wizards as wizards_ep, ai_chat as ai_chat_ep
from .api.endpoints import breakdown as breakdown_ep
from .api.endpoints import shots as shots_ep
from .api.endpoints import media as media_ep
from .api.endpoints import breakdown_chat as breakdown_chat_ep
from .api.endpoints import storyboard as storyboard_ep
from .api.endpoints import shows as shows_ep
from .api.endpoints import snapshots as snapshots_ep
from screenwriter.config import settings
from .middleware import (
    LoggingMiddleware,
    SecurityMiddleware,
    RequestSizeLimitMiddleware,
    RateLimitMiddleware,
    ApiKeyRateLimitMiddleware
)
from .api_docs import custom_openapi
from screenwriter.db import init_db
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = FastAPI(
    title="Screenwriter Assistant API",
    description="MVP API for screenwriting tool",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Custom OpenAPI schema
def custom_openapi_wrapper():
    return custom_openapi(app)

app.openapi = custom_openapi_wrapper

# Add middleware (order matters - executed from bottom to top)
# Rate limit generous for dev; tighten for production
app.add_middleware(ApiKeyRateLimitMiddleware, default_rate_limit=1000)
app.add_middleware(RateLimitMiddleware, requests_per_minute=600)
app.add_middleware(RequestSizeLimitMiddleware, max_size=25 * 1024 * 1024)  # 25MB (supports 20MB media uploads + multipart overhead)
app.add_middleware(SecurityMiddleware)
app.add_middleware(LoggingMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom exception handler for validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        field = " -> ".join(str(loc) for loc in error["loc"])
        message = error["msg"]
        errors.append({"field": field, "message": message})
    
    return JSONResponse(
        status_code=422,
        content={"detail": "Validation error", "errors": errors}
    )

@app.exception_handler(ValidationError)
async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Validation error", "errors": exc.errors()}
    )

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(sections.router, prefix="/api/sections", tags=["sections"])
app.include_router(review.router, prefix="/api/review", tags=["review"])
app.include_router(books.router, prefix="/api/books", tags=["books"])
app.include_router(snippets.router, prefix="/api/books", tags=["snippets"])
app.include_router(snippet_manager.router, prefix="/api/snippets", tags=["snippet-manager"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])

# Template system routers
app.include_router(templates_ep.router, prefix="/api/templates", tags=["templates"])
app.include_router(phase_data_ep.router, prefix="/api/phase-data", tags=["phase-data"])
app.include_router(list_items_ep.router, prefix="/api/list-items", tags=["list-items"])
app.include_router(wizards_ep.router, prefix="/api/wizards", tags=["wizards"])
app.include_router(ai_chat_ep.router, prefix="/api/ai", tags=["ai"])
app.include_router(breakdown_ep.router, prefix="/api/breakdown", tags=["breakdown"])
app.include_router(shots_ep.router, prefix="/api/shots", tags=["shots"])
app.include_router(media_ep.router, prefix="/api/media", tags=["media"])
app.include_router(breakdown_chat_ep.router, prefix="/api/breakdown-chat", tags=["breakdown-chat"])
app.include_router(storyboard_ep.router, prefix="/api/storyboard", tags=["storyboard"])
app.include_router(shows_ep.router, prefix="/api/shows", tags=["shows"])
app.include_router(snapshots_ep.router, prefix="/api/projects/{project_id}/snapshots", tags=["snapshots"])

# Serve uploaded media files
os.makedirs(settings.MEDIA_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.MEDIA_DIR), name="media")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.on_event("startup")
async def startup_event():
    """Run on application startup"""
    logging.info("Starting Screenwriter Assistant API...")
    # Initialize database
    init_db()
    logging.info("Database initialized successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Run on application shutdown"""
    logging.info("Shutting down Screenwriter Assistant API...")
    # Add any cleanup tasks here

