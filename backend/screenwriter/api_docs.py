# backend/app/api_docs.py

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi


def custom_openapi(app: FastAPI):
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="Screenwriter Assistant API",
        version="2.0.0",
        description="""
## Screenwriter Assistant API

A full-stack API for creating and managing screenplay projects with AI-powered review.

### Features

* **Project Management**: Create and manage screenplay projects with multiple story frameworks
* **Script Breakdown**: AI-powered extraction of characters, locations, props, and wardrobe
* **Shotlist & Storyboard**: Shot management with AI generation and storyboard frames
* **TV Show Mode**: Series bible, episodes, and cross-episode AI context injection
* **AI Review**: GPT-4 powered feedback on your writing
* **API Key Access**: Programmatic access via API keys for CI/CD and integrations

### Authentication

All protected endpoints accept two authentication methods:

**JWT Token** (for browser sessions):
```
Authorization: Bearer <jwt_token>
```

**API Key** (for programmatic access):
```
Authorization: Bearer sa_<prefix>_<secret>
```

API keys can be created at `/settings/api-keys` or via `POST /api/auth/api-keys`.

### Rate Limiting

- **IP-based**: 600 requests/minute (all requests)
- **Per API key**: 1000 requests/hour (API key requests only)

Rate-limited responses return `429` with a `Retry-After` header.
        """,
        routes=app.routes,
    )

    # Security scheme supporting both JWT and API key
    openapi_schema["components"]["securitySchemes"] = {
        "Bearer": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT or API Key",
            "description": (
                "Use a JWT token (from /api/auth/login) or an API key "
                "(format: sa_<prefix>_<secret>, from /api/auth/api-keys)"
            ),
        }
    }

    # Add security to all endpoints except public auth routes (register, login, mock-token)
    for path in openapi_schema["paths"]:
        for method in openapi_schema["paths"][path]:
            if method == "options":
                continue
            # All API endpoints require auth
            if path.startswith("/api/"):
                openapi_schema["paths"][path][method]["security"] = [{"Bearer": []}]

    # Complete tag descriptions for all 20 registered routers
    openapi_schema["tags"] = [
        {"name": "auth", "description": "Authentication: register, login, JWT tokens, and API key management"},
        {"name": "projects", "description": "Project CRUD operations for screenplays and episodes"},
        {"name": "sections", "description": "Section and checklist operations within projects"},
        {"name": "review", "description": "AI-powered review and feedback on screenplay sections"},
        {"name": "books", "description": "Book upload and processing for knowledge graph"},
        {"name": "snippets", "description": "Book snippet extraction and management"},
        {"name": "snippet-manager", "description": "User-created snippet CRUD operations"},
        {"name": "agents", "description": "Agent management, pipeline mapping, and configuration"},
        {"name": "chat", "description": "Agent chat sessions and message history"},
        {"name": "templates", "description": "Project template listing and configuration"},
        {"name": "phase-data", "description": "Template phase data CRUD (idea, story, scenes, write)"},
        {"name": "list-items", "description": "Phase list items CRUD and reordering"},
        {"name": "wizards", "description": "AI wizard operations for guided content generation"},
        {"name": "ai", "description": "AI generation actions (section content, screenplay text)"},
        {"name": "breakdown", "description": "Script breakdown extraction: characters, locations, props, wardrobe"},
        {"name": "shots", "description": "Shotlist CRUD, reordering, and AI shot generation"},
        {"name": "media", "description": "Media file upload and management for assets and storyboards"},
        {"name": "breakdown-chat", "description": "AI chat for breakdown mode analysis"},
        {"name": "storyboard", "description": "Storyboard frame management and selection"},
        {"name": "shows", "description": "TV show management with series bible and episodes"},
    ]

    # Add response examples
    add_response_examples(openapi_schema)

    app.openapi_schema = openapi_schema
    return app.openapi_schema


def add_response_examples(schema):
    """Add response examples to the OpenAPI schema."""

    project_example = {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "owner_id": "123e4567-e89b-12d3-a456-426614174001",
        "title": "The Last Journey",
        "framework": "three_act",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-02T00:00:00Z",
        "sections": [],
    }

    api_key_example = {
        "id": "123e4567-e89b-12d3-a456-426614174002",
        "name": "CI/CD Pipeline",
        "key_prefix": "abc12345",
        "scopes": [],
        "expires_at": None,
        "created_at": "2024-06-01T00:00:00Z",
        "last_used_at": "2024-06-15T12:30:00Z",
        "request_count": 1542,
        "is_active": True,
    }

    validation_error_example = {
        "detail": "Validation error",
        "errors": [
            {"field": "title", "message": "Title must be at least 2 characters long"}
        ],
    }

    if "components" not in schema:
        schema["components"] = {}

    if "examples" not in schema["components"]:
        schema["components"]["examples"] = {}

    schema["components"]["examples"]["project"] = {"value": project_example}
    schema["components"]["examples"]["api_key"] = {"value": api_key_example}
    schema["components"]["examples"]["validation_error"] = {"value": validation_error_example}

    return schema
