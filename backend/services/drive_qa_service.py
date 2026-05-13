"""Service for the Drive QA Viewer.

Reads Drive contents organized by episode/scene and exposes them in the
shape the QA viewer expects: each scene is split into "assets" (files inside
the scene's `Assets/` subfolder) and "results" (image files directly under
the scene folder).

Episode and the inner "3. Master Shot - Layout" folder IDs are hardcoded for
now (Max Wild 1x03). When we need to support more episodes, extract these
into a registry or DB table.
"""

from __future__ import annotations

import io
import re
from typing import List, Optional, Tuple

from googleapiclient.http import MediaIoBaseDownload

from core.google_drive import get_drive_client, is_drive_configured
from core.supabase import get_supabase
from models.drive_qa import QAImage, QAReview, QAScene, QASceneDetail, ReviewStatus


# ---------------------------------------------------------------------------
# Hardcoded Drive IDs for Max Wild 1x03
# ---------------------------------------------------------------------------

EPISODE_ID = "1_yPGxVUQ5C55jfvmbN93WH6uLfiKivUq"  # "Max Wild 1x03 (NUESTRA CARPETA)"
EPISODE_NAME = "Max Wild 1x03"
MASTER_SHOT_FOLDER_ID = "14wcpCuIoNw8EDf7agFdW6MXlzASWie-A"  # "3. Master Shot - Layout"

FOLDER_MIME = "application/vnd.google-apps.folder"
IMAGE_MIME_PREFIX = "image/"

# Matches "Scene 07", "scene 7", "Scene 7 - foo", etc. Used to sort and to
# filter out auxiliary folders like "TK01 - To Check".
_SCENE_RE = re.compile(r"^\s*scene\s*0*(\d+)", re.IGNORECASE)


def _scene_sort_key(name: str) -> Tuple[int, str]:
    """Sort scenes numerically by their scene number; non-matches go last."""
    m = _SCENE_RE.match(name)
    if m:
        return (int(m.group(1)), name)
    return (10_000, name)


class DriveQAService:
    """Read-only Drive accessor for the QA viewer."""

    def __init__(self) -> None:
        if is_drive_configured():
            self.drive = get_drive_client()
        else:
            self.drive = None

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_scenes(self) -> Tuple[bool, List[QAScene], Optional[str]]:
        """List all scene folders under '3. Master Shot - Layout', sorted."""
        if not self.drive:
            return False, [], "Google Drive not configured"

        try:
            scenes: List[QAScene] = []
            page_token: Optional[str] = None

            while True:
                resp = self.drive.files().list(
                    q=(
                        f"'{MASTER_SHOT_FOLDER_ID}' in parents "
                        f"and mimeType = '{FOLDER_MIME}' "
                        f"and trashed = false"
                    ),
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageSize=100,
                    pageToken=page_token,
                    fields="nextPageToken, files(id, name, modifiedTime)",
                ).execute()

                for item in resp.get("files", []):
                    name = item["name"]
                    # Keep only "Scene NN" folders, drop "TK01 - To Check" etc.
                    if not _SCENE_RE.match(name):
                        continue
                    scenes.append(
                        QAScene(
                            id=item["id"],
                            name=name,
                            modified_time=item.get("modifiedTime"),
                        )
                    )

                page_token = resp.get("nextPageToken")
                if not page_token:
                    break

            scenes.sort(key=lambda s: _scene_sort_key(s.name))
            return True, scenes, None

        except Exception as e:
            return False, [], str(e)

    async def get_scene_detail(
        self, scene_id: str
    ) -> Tuple[bool, Optional[QASceneDetail], Optional[str]]:
        """Return the scene split into assets (subfolder) and results (root images)."""
        if not self.drive:
            return False, None, "Google Drive not configured"

        try:
            # Verify the scene exists and grab its name.
            scene_meta = self.drive.files().get(
                fileId=scene_id,
                supportsAllDrives=True,
                fields="id, name, mimeType",
            ).execute()

            if scene_meta.get("mimeType") != FOLDER_MIME:
                return False, None, "Provided ID is not a folder"

            scene_name = scene_meta["name"]

            # List everything directly under the scene folder.
            children = await self._list_children(scene_id)

            # Results = image files directly in the scene folder.
            results: List[QAImage] = [
                _to_qa_image(c)
                for c in children
                if c["mimeType"].startswith(IMAGE_MIME_PREFIX)
            ]
            results.sort(key=lambda i: i.name.lower())

            # Assets = images inside the scene's `Assets/` subfolder (if any).
            assets_folder = next(
                (
                    c
                    for c in children
                    if c["mimeType"] == FOLDER_MIME
                    and c["name"].strip().lower() == "assets"
                ),
                None,
            )

            assets: List[QAImage] = []
            if assets_folder:
                asset_children = await self._list_children(assets_folder["id"])
                assets = [
                    _to_qa_image(c)
                    for c in asset_children
                    if c["mimeType"].startswith(IMAGE_MIME_PREFIX)
                ]
                assets.sort(key=lambda i: i.name.lower())

            return (
                True,
                QASceneDetail(
                    id=scene_id,
                    name=scene_name,
                    assets=assets,
                    results=results,
                ),
                None,
            )

        except Exception as e:
            return False, None, str(e)

    # ------------------------------------------------------------------
    # Binary download
    # ------------------------------------------------------------------

    async def download_file(
        self, file_id: str
    ) -> Tuple[bool, Optional[bytes], Optional[str], Optional[str]]:
        """Download the full bytes of a Drive file.

        Returns (success, content, mime_type, error).
        """
        if not self.drive:
            return False, None, None, "Google Drive not configured"

        try:
            meta = self.drive.files().get(
                fileId=file_id,
                supportsAllDrives=True,
                fields="id, name, mimeType",
            ).execute()
            mime_type = meta.get("mimeType", "application/octet-stream")

            request = self.drive.files().get_media(
                fileId=file_id,
                supportsAllDrives=True,
            )
            buf = io.BytesIO()
            downloader = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _status, done = downloader.next_chunk()

            return True, buf.getvalue(), mime_type, None

        except Exception as e:
            return False, None, None, str(e)

    async def get_thumbnail_url(
        self, file_id: str, size_px: int = 800
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Get a Drive-generated thumbnail link, resized to `size_px` on the long side.

        Drive's thumbnailLink looks like `...=s220`; we swap the size param.
        Returns (success, url, error).
        """
        if not self.drive:
            return False, None, "Google Drive not configured"

        try:
            meta = self.drive.files().get(
                fileId=file_id,
                supportsAllDrives=True,
                fields="id, thumbnailLink",
            ).execute()
            link = meta.get("thumbnailLink")
            if not link:
                return False, None, "No thumbnail available"

            # Drive returns links ending in `=sNNN`; resize by replacing it.
            resized = re.sub(r"=s\d+(-c)?$", f"=s{size_px}", link)
            return True, resized, None

        except Exception as e:
            return False, None, str(e)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _list_children(self, folder_id: str) -> list[dict]:
        """List every child of a folder, paginating through results."""
        if not self.drive:
            return []

        drive = self.drive
        all_items: list[dict] = []
        page_token: Optional[str] = None

        while True:
            resp = drive.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageSize=200,
                pageToken=page_token,
                fields=(
                    "nextPageToken, "
                    "files(id, name, mimeType, size, modifiedTime)"
                ),
            ).execute()
            all_items.extend(resp.get("files", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        return all_items


def _to_qa_image(item: dict) -> QAImage:
    return QAImage(
        id=item["id"],
        name=item["name"],
        mime_type=item["mimeType"],
        size=int(item["size"]) if item.get("size") else None,
        modified_time=item.get("modifiedTime"),
    )


# ---------------------------------------------------------------------------
# Reviews (Supabase)
# ---------------------------------------------------------------------------


class DriveQAReviewService:
    """CRUD for drive_qa_reviews on Supabase."""

    TABLE = "drive_qa_reviews"

    def __init__(self, supabase=None) -> None:
        self.supabase = supabase or get_supabase()

    async def list_for_episode(
        self, episode_id: str
    ) -> Tuple[bool, List[QAReview], Optional[str]]:
        try:
            resp = (
                self.supabase.table(self.TABLE)
                .select("*")
                .eq("episode_id", episode_id)
                .execute()
            )
            rows: list = resp.data or []
            reviews = [QAReview.model_validate(row) for row in rows]
            return True, reviews, None
        except Exception as e:
            return False, [], str(e)

    async def upsert(
        self,
        user_id: str,
        episode_id: str,
        scene_id: str,
        scene_name: str,
        status: ReviewStatus,
        notes: Optional[str],
    ) -> Tuple[bool, Optional[QAReview], Optional[str]]:
        try:
            payload = {
                "user_id": user_id,
                "episode_id": episode_id,
                "scene_id": scene_id,
                "scene_name": scene_name,
                "status": status,
                "notes": notes,
            }
            resp = (
                self.supabase.table(self.TABLE)
                .upsert(payload, on_conflict="user_id,scene_id")
                .execute()
            )
            rows: list = resp.data or []
            if not rows:
                return False, None, "Upsert returned no row"
            return True, QAReview.model_validate(rows[0]), None
        except Exception as e:
            return False, None, str(e)
