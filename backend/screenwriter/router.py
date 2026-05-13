# screenwriter/router.py
#
# Aggregates all screenwriter API routers into a single router
# that multitalk's main.py can mount with one include_router call.

from fastapi import APIRouter

from screenwriter.api.endpoints import (
    projects,
    sections,
    review,
    auth,
    books,
    agents,
    chat,
    snippets,
    snippet_manager,
    phase_data as phase_data_ep,
    list_items as list_items_ep,
    wizards as wizards_ep,
    ai_chat as ai_chat_ep,
    breakdown as breakdown_ep,
    shots as shots_ep,
    media as media_ep,
    breakdown_chat as breakdown_chat_ep,
    storyboard as storyboard_ep,
    shows as shows_ep,
    snapshots as snapshots_ep,
    templates as templates_ep,
)

router = APIRouter()

# Auth
router.include_router(auth.router, prefix="/auth", tags=["screenwriter-auth"])

# Projects & core
router.include_router(projects.router, prefix="/projects", tags=["screenwriter-projects"])
router.include_router(sections.router, prefix="/sections", tags=["screenwriter-sections"])
router.include_router(review.router, prefix="/review", tags=["screenwriter-review"])

# Template system
router.include_router(templates_ep.router, prefix="/templates", tags=["screenwriter-templates"])
router.include_router(phase_data_ep.router, prefix="/phase-data", tags=["screenwriter-phase-data"])
router.include_router(list_items_ep.router, prefix="/list-items", tags=["screenwriter-list-items"])
router.include_router(wizards_ep.router, prefix="/wizards", tags=["screenwriter-wizards"])
router.include_router(ai_chat_ep.router, prefix="/ai", tags=["screenwriter-ai"])

# Knowledge system
router.include_router(books.router, prefix="/books", tags=["screenwriter-books"])
router.include_router(agents.router, prefix="/agents", tags=["screenwriter-agents"])
router.include_router(chat.router, prefix="/chat", tags=["screenwriter-chat"])
router.include_router(snippets.router, prefix="/snippets", tags=["screenwriter-snippets"])
router.include_router(snippet_manager.router, prefix="/snippet-manager", tags=["screenwriter-snippets"])

# Production
router.include_router(breakdown_ep.router, prefix="/breakdown", tags=["screenwriter-breakdown"])
router.include_router(shots_ep.router, prefix="/shots", tags=["screenwriter-shots"])
router.include_router(media_ep.router, prefix="/media", tags=["screenwriter-media"])
router.include_router(breakdown_chat_ep.router, prefix="/breakdown-chat", tags=["screenwriter-breakdown-chat"])
router.include_router(storyboard_ep.router, prefix="/storyboard", tags=["screenwriter-storyboard"])

# Shows
router.include_router(shows_ep.router, prefix="/shows", tags=["screenwriter-shows"])

# Snapshots
router.include_router(snapshots_ep.router, prefix="/projects/{project_id}/snapshots", tags=["screenwriter-snapshots"])


def init_screenwriter():
    """Initialize screenwriter database (run migrations)."""
    from screenwriter.db import init_db
    init_db()
