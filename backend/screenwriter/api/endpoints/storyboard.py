# backend/app/api/endpoints/storyboard.py

import logging
import os
from typing import List
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models import database, schemas
from screenwriter.services.imagen_service import ImagenService
from screenwriter.api.dependencies import get_current_user, get_db

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


def _verify_project_ownership(
    db: Session, project_id: UUID, user_id: UUID
) -> database.Project:
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id),
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _verify_shot_in_project(
    db: Session, shot_id: UUID, project_id: UUID
) -> database.Shot:
    shot = db.query(database.Shot).filter(
        database.Shot.id == str(shot_id),
        database.Shot.project_id == str(project_id),
    ).first()
    if not shot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shot not found in project")
    return shot


@router.post(
    "/{project_id}/shots/{shot_id}/frames",
    response_model=schemas.StoryboardFrameResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_frame(
    project_id: UUID,
    shot_id: UUID,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a storyboard frame for a shot."""
    _verify_project_ownership(db, project_id, current_user.id)
    _verify_shot_in_project(db, shot_id, project_id)

    # Validate file extension
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}",
        )

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large (max 20MB)",
        )

    # Generate safe filename and save to disk
    safe_name = f"{uuid4()}.{ext}"
    storyboard_dir = os.path.join(settings.MEDIA_DIR, str(project_id), "storyboard")
    os.makedirs(storyboard_dir, exist_ok=True)
    file_abs_path = os.path.join(storyboard_dir, safe_name)

    with open(file_abs_path, "wb") as f:
        f.write(content)

    file_url = f"/media/{project_id}/storyboard/{safe_name}"

    try:
        frame = database.StoryboardFrame(
            shot_id=str(shot_id),
            file_path=file_url,
            thumbnail_path=file_url,  # No thumbnail generation — copy file_path per CONTEXT.md
            file_type="image",
            is_selected=False,
            generation_source="user",
        )
        db.add(frame)
        db.commit()
        db.refresh(frame)
        return frame
    except Exception:
        # Clean up file on DB error
        if os.path.exists(file_abs_path):
            os.remove(file_abs_path)
        db.rollback()
        raise


@router.get(
    "/{project_id}/shots/{shot_id}/frames",
    response_model=List[schemas.StoryboardFrameResponse],
)
def list_frames(
    project_id: UUID,
    shot_id: UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all storyboard frames for a shot."""
    _verify_project_ownership(db, project_id, current_user.id)
    _verify_shot_in_project(db, shot_id, project_id)

    frames = db.query(database.StoryboardFrame).filter(
        database.StoryboardFrame.shot_id == str(shot_id),
    ).order_by(database.StoryboardFrame.created_at).all()

    return frames


@router.patch(
    "/{project_id}/frames/{frame_id}",
    response_model=schemas.StoryboardFrameResponse,
)
def update_frame(
    project_id: UUID,
    frame_id: UUID,
    body: schemas.StoryboardFrameUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a storyboard frame (e.g., set is_selected)."""
    _verify_project_ownership(db, project_id, current_user.id)

    # Verify frame belongs to a shot in this project
    frame = (
        db.query(database.StoryboardFrame)
        .join(database.Shot, database.Shot.id == database.StoryboardFrame.shot_id)
        .filter(
            database.StoryboardFrame.id == str(frame_id),
            database.Shot.project_id == str(project_id),
        )
        .first()
    )
    if not frame:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frame not found")

    if body.is_selected is True:
        # Atomically deselect all frames for this shot, then select this one
        db.query(database.StoryboardFrame).filter(
            database.StoryboardFrame.shot_id == frame.shot_id
        ).update({"is_selected": False})
        frame.is_selected = True
    elif body.is_selected is False:
        frame.is_selected = False

    db.commit()
    db.refresh(frame)
    return frame


@router.delete(
    "/{project_id}/frames/{frame_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_frame(
    project_id: UUID,
    frame_id: UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a storyboard frame and remove its file from disk."""
    _verify_project_ownership(db, project_id, current_user.id)

    # Verify frame belongs to a shot in this project
    frame = (
        db.query(database.StoryboardFrame)
        .join(database.Shot, database.Shot.id == database.StoryboardFrame.shot_id)
        .filter(
            database.StoryboardFrame.id == str(frame_id),
            database.Shot.project_id == str(project_id),
        )
        .first()
    )
    if not frame:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frame not found")

    # Delete file from disk (best-effort)
    def _remove_file(path: str | None):
        if not path:
            return
        # Strip leading /media/ prefix and join with MEDIA_DIR
        stripped = path.lstrip("/")
        if stripped.startswith("media/"):
            stripped = stripped[len("media/"):]
        abs_path = os.path.join(settings.MEDIA_DIR, stripped)
        if os.path.exists(abs_path):
            try:
                os.remove(abs_path)
            except OSError:
                logger.warning("Could not delete file: %s", abs_path)

    _remove_file(frame.file_path)
    if frame.thumbnail_path and frame.thumbnail_path != frame.file_path:
        _remove_file(frame.thumbnail_path)

    db.delete(frame)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{project_id}/shots/{shot_id}/generate",
    response_model=schemas.StoryboardFrameResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_frame(
    project_id: UUID,
    shot_id: UUID,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a storyboard frame via Google Vertex AI Imagen."""
    project = _verify_project_ownership(db, project_id, current_user.id)
    shot = _verify_shot_in_project(db, shot_id, project_id)

    # Build the generation prompt from shot fields and scene context
    service = ImagenService(
        project_id=settings.GOOGLE_CLOUD_PROJECT,
        region=settings.IMAGEN_REGION,
        model_name=settings.IMAGEN_MODEL,
    )
    prompt = ImagenService.build_prompt(
        shot_fields=shot.fields or {},
        storyboard_style=project.storyboard_style,
        scene_context=shot.script_text or "",
    )

    # Generate image and save to disk
    storyboard_dir = os.path.join(settings.MEDIA_DIR, str(project_id), "storyboard")
    os.makedirs(storyboard_dir, exist_ok=True)
    safe_name = f"{uuid4()}.png"
    file_abs_path = os.path.join(storyboard_dir, safe_name)
    file_url = f"/media/{project_id}/storyboard/{safe_name}"

    try:
        image_bytes = service.generate_image(prompt)
        with open(file_abs_path, "wb") as f:
            f.write(image_bytes)

        # Auto-select if no existing selected frame for this shot
        has_selected = (
            db.query(database.StoryboardFrame)
            .filter(
                database.StoryboardFrame.shot_id == str(shot_id),
                database.StoryboardFrame.is_selected == True,  # noqa: E712
            )
            .count()
            > 0
        )

        frame = database.StoryboardFrame(
            shot_id=str(shot_id),
            file_path=file_url,
            thumbnail_path=file_url,
            file_type="image",
            is_selected=not has_selected,
            generation_source="ai",
            generation_style=project.storyboard_style,
        )
        db.add(frame)
        db.commit()
        db.refresh(frame)
        return frame
    except Exception as e:
        # Clean up partial file on any error
        if os.path.exists(file_abs_path):
            try:
                os.remove(file_abs_path)
            except OSError:
                pass
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Image generation failed: {str(e)}",
        )
