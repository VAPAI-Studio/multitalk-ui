import logging
import os
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from screenwriter.config import settings
from screenwriter.models import database, schemas
from screenwriter.services.media_service import generate_thumbnail
from screenwriter.api.dependencies import get_current_user, get_db

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ALLOWED_AUDIO_EXTENSIONS = {"mp3", "wav", "m4a"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


def _verify_project_ownership(db: Session, project_id: UUID, user_id: UUID) -> database.Project:
    """Verify user owns the project. Returns project or raises 404."""
    project = db.query(database.Project).filter(
        database.Project.id == str(project_id),
        database.Project.owner_id == str(user_id),
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("/{project_id}", response_model=schemas.AssetMediaResponse, status_code=status.HTTP_201_CREATED)
async def upload_media(
    project_id: UUID,
    file: UploadFile = File(...),
    element_id: Optional[UUID] = Form(None),
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload an image or audio file linked to a project (and optionally a breakdown element)."""
    _verify_project_ownership(db, project_id, current_user.id)

    # Validate element belongs to project if provided
    if element_id is not None:
        element = db.query(database.BreakdownElement).filter(
            database.BreakdownElement.id == str(element_id),
            database.BreakdownElement.project_id == str(project_id),
            database.BreakdownElement.is_deleted == False,
        ).first()
        if not element:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Element not found in this project")

    # Validate extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
    if ext in ALLOWED_IMAGE_EXTENSIONS:
        file_type = "image"
    elif ext in ALLOWED_AUDIO_EXTENSIONS:
        file_type = "audio"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type. Allowed: jpg, jpeg, png, webp, mp3, wav, m4a")

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large. Max 20MB.")

    # Generate safe filename and save
    safe_name = f"{uuid4()}.{ext}"
    media_dir = os.path.join(settings.MEDIA_DIR, str(project_id))
    os.makedirs(media_dir, exist_ok=True)
    file_path = os.path.join(media_dir, safe_name)

    with open(file_path, "wb") as f:
        f.write(content)

    # Generate thumbnail for images
    thumbnail_url = None
    if file_type == "image":
        try:
            thumb_abs = generate_thumbnail(file_path, media_dir)
            thumb_filename = os.path.basename(thumb_abs)
            thumbnail_url = f"/media/{project_id}/thumbs/{thumb_filename}"
        except ValueError:
            # Clean up the invalid image file
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file")

    file_url = f"/media/{project_id}/{safe_name}"

    # Create DB record
    media = database.AssetMedia(
        project_id=str(project_id),
        element_id=str(element_id) if element_id else None,
        file_type=file_type,
        file_path=file_url,
        thumbnail_path=thumbnail_url,
        original_filename=file.filename or safe_name,
        file_size_bytes=len(content),
    )

    try:
        db.add(media)
        db.commit()
        db.refresh(media)
    except Exception:
        # Clean up files on DB failure
        if os.path.exists(file_path):
            os.remove(file_path)
        if thumbnail_url:
            thumb_abs_path = os.path.join(media_dir, "thumbs", os.path.basename(thumbnail_url))
            if os.path.exists(thumb_abs_path):
                os.remove(thumb_abs_path)
        db.rollback()
        raise

    return media


@router.get("/{project_id}", response_model=List[schemas.AssetMediaResponse])
async def list_media(
    project_id: UUID,
    element_id: Optional[UUID] = None,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all media for a project, optionally filtered by element."""
    _verify_project_ownership(db, project_id, current_user.id)

    query = db.query(database.AssetMedia).filter(
        database.AssetMedia.project_id == str(project_id),
    )

    if element_id is not None:
        query = query.filter(database.AssetMedia.element_id == str(element_id))

    query = query.order_by(database.AssetMedia.created_at.desc())
    return query.all()


@router.delete("/{project_id}/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    project_id: UUID,
    media_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a media record and its associated files from disk."""
    _verify_project_ownership(db, project_id, current_user.id)

    media = db.query(database.AssetMedia).filter(
        database.AssetMedia.id == str(media_id),
        database.AssetMedia.project_id == str(project_id),
    ).first()
    if not media:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    # Delete files from disk (best effort)
    for url_path in [media.file_path, media.thumbnail_path]:
        if url_path and url_path.startswith("/media/"):
            # url_path is like "/media/{project_id}/filename" -- strip "/media/" prefix
            relative = url_path[len("/media/"):]
            abs_path = os.path.join(settings.MEDIA_DIR, relative)
            if os.path.exists(abs_path):
                os.remove(abs_path)

    db.delete(media)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
