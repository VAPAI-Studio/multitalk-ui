# backend/app/tests/test_media_api.py

import io
import os
import uuid

import pytest
from PIL import Image

from screenwriter.models.database import BreakdownElement

MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


def _create_project_via_api(client, mock_auth_headers, title="Test Project"):
    """Create a project through the API so owner_id is stored correctly for SQLite."""
    resp = client.post(
        "/api/projects/",
        json={"title": title, "framework": "three_act"},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
    return resp.json()["id"]


def _create_test_image(fmt="JPEG", size=(100, 100)):
    """Create a test image in memory. Returns BytesIO ready for upload."""
    buf = io.BytesIO()
    img = Image.new("RGB", size, "red")
    img.save(buf, fmt)
    buf.seek(0)
    return buf


def _create_breakdown_element(db_session, project_id, name="Test Element"):
    """Insert a BreakdownElement row for element_id tests."""
    elem = BreakdownElement(
        id=str(uuid.uuid4()),
        project_id=project_id,
        category="character",
        name=name,
        is_deleted=False,
    )
    db_session.add(elem)
    db_session.flush()
    return elem


@pytest.fixture(autouse=True)
def _patch_media_dir(monkeypatch, tmp_path):
    """Patch MEDIA_DIR to use a temp directory so tests don't write to real media folder."""
    monkeypatch.setattr("app.config.settings.MEDIA_DIR", str(tmp_path))
    return tmp_path


# ============================================================
# TestUploadMedia
# ============================================================


class TestUploadMedia:
    def test_upload_image(self, client, mock_auth_headers, _patch_media_dir):
        """POST with JPEG file returns 201, file_type='image', thumbnail_path is not None."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        img_data = _create_test_image("JPEG")

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["file_type"] == "image"
        assert data["thumbnail_path"] is not None
        assert data["original_filename"] == "test.jpg"
        assert data["project_id"] == project_id

    def test_upload_png(self, client, mock_auth_headers, _patch_media_dir):
        """POST with PNG file returns 201, file_type='image'."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        img_data = _create_test_image("PNG")

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.png", img_data, "image/png")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["file_type"] == "image"

    def test_upload_audio(self, client, mock_auth_headers, _patch_media_dir):
        """POST with MP3 file returns 201, file_type='audio', thumbnail_path is None."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        audio_data = io.BytesIO(b"\x00" * 1024)

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.mp3", audio_data, "audio/mpeg")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["file_type"] == "audio"
        assert data["thumbnail_path"] is None

    def test_upload_with_element_id(self, client, db_session, mock_auth_headers, _patch_media_dir):
        """POST with valid element_id links media to element."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _create_breakdown_element(db_session, project_id)
        db_session.commit()

        img_data = _create_test_image("JPEG")
        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            data={"element_id": str(elem.id)},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["element_id"] == str(elem.id)

    def test_thumbnail_generated(self, client, mock_auth_headers, _patch_media_dir):
        """POST with image creates a thumbnail file on disk ending in _thumb.webp."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        img_data = _create_test_image("JPEG")

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()

        # Verify thumbnail exists on disk
        thumb_path = data["thumbnail_path"]
        assert thumb_path is not None
        assert thumb_path.endswith("_thumb.webp")

        # Verify the actual file exists
        relative = thumb_path[len("/media/"):]
        abs_thumb = os.path.join(str(_patch_media_dir), relative)
        assert os.path.exists(abs_thumb), f"Thumbnail file not found at {abs_thumb}"


# ============================================================
# TestUploadValidation
# ============================================================


class TestUploadValidation:
    def test_reject_unsupported_type(self, client, mock_auth_headers, _patch_media_dir):
        """POST with .txt file returns 400."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        txt_data = io.BytesIO(b"Hello world")

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.txt", txt_data, "text/plain")},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 400
        assert "Unsupported file type" in resp.json()["detail"]

    def test_reject_oversize(self, client, mock_auth_headers, _patch_media_dir):
        """POST with >20MB content returns 400."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        # 20MB + 1 byte
        oversize_data = io.BytesIO(b"\x00" * (20 * 1024 * 1024 + 1))

        resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("big.jpg", oversize_data, "image/jpeg")},
            headers=mock_auth_headers,
        )
        # Should be 400 from endpoint's own size check (middleware limit is 25MB)
        assert resp.status_code == 400
        assert "too large" in resp.json()["detail"].lower()

    def test_reject_invalid_element(self, client, db_session, mock_auth_headers, _patch_media_dir):
        """POST with element_id from different project returns 400."""
        project1_id = _create_project_via_api(client, mock_auth_headers, title="Project 1")
        project2_id = _create_project_via_api(client, mock_auth_headers, title="Project 2")
        elem = _create_breakdown_element(db_session, project2_id)
        db_session.commit()

        img_data = _create_test_image("JPEG")
        resp = client.post(
            f"/api/media/{project1_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            data={"element_id": str(elem.id)},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 400
        assert "Element not found" in resp.json()["detail"]


# ============================================================
# TestListMedia
# ============================================================


class TestListMedia:
    def test_list_empty(self, client, mock_auth_headers, _patch_media_dir):
        """GET returns empty list for project with no media."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.get(
            f"/api/media/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_returns_all(self, client, mock_auth_headers, _patch_media_dir):
        """GET returns all media for project."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        # Upload two files
        img_data1 = _create_test_image("JPEG")
        client.post(
            f"/api/media/{project_id}",
            files={"file": ("img1.jpg", img_data1, "image/jpeg")},
            headers=mock_auth_headers,
        )
        audio_data = io.BytesIO(b"\x00" * 1024)
        client.post(
            f"/api/media/{project_id}",
            files={"file": ("audio1.mp3", audio_data, "audio/mpeg")},
            headers=mock_auth_headers,
        )

        resp = client.get(
            f"/api/media/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_list_filter_by_element(self, client, db_session, mock_auth_headers, _patch_media_dir):
        """GET ?element_id=UUID filters correctly."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem1 = _create_breakdown_element(db_session, project_id, name="Elem 1")
        elem2 = _create_breakdown_element(db_session, project_id, name="Elem 2")
        db_session.commit()

        # Upload one image linked to elem1, one to elem2
        img1 = _create_test_image("JPEG")
        client.post(
            f"/api/media/{project_id}",
            files={"file": ("img1.jpg", img1, "image/jpeg")},
            data={"element_id": str(elem1.id)},
            headers=mock_auth_headers,
        )
        img2 = _create_test_image("PNG")
        client.post(
            f"/api/media/{project_id}",
            files={"file": ("img2.png", img2, "image/png")},
            data={"element_id": str(elem2.id)},
            headers=mock_auth_headers,
        )

        resp = client.get(
            f"/api/media/{project_id}",
            params={"element_id": str(elem1.id)},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["element_id"] == str(elem1.id)


# ============================================================
# TestDeleteMedia
# ============================================================


class TestDeleteMedia:
    def test_delete_removes_record(self, client, mock_auth_headers, _patch_media_dir):
        """DELETE returns 204, media gone from list."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        img_data = _create_test_image("JPEG")
        upload_resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            headers=mock_auth_headers,
        )
        media_id = upload_resp.json()["id"]

        resp = client.delete(
            f"/api/media/{project_id}/{media_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 204

        # Verify media is gone
        list_resp = client.get(
            f"/api/media/{project_id}",
            headers=mock_auth_headers,
        )
        assert len(list_resp.json()) == 0

    def test_delete_removes_file(self, client, mock_auth_headers, _patch_media_dir):
        """DELETE also removes the file from disk."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        img_data = _create_test_image("JPEG")
        upload_resp = client.post(
            f"/api/media/{project_id}",
            files={"file": ("test.jpg", img_data, "image/jpeg")},
            headers=mock_auth_headers,
        )
        data = upload_resp.json()
        file_path = data["file_path"]
        thumb_path = data["thumbnail_path"]

        # Verify files exist before delete
        relative = file_path[len("/media/"):]
        abs_file = os.path.join(str(_patch_media_dir), relative)
        assert os.path.exists(abs_file), f"File should exist before delete: {abs_file}"

        if thumb_path:
            thumb_relative = thumb_path[len("/media/"):]
            abs_thumb = os.path.join(str(_patch_media_dir), thumb_relative)
            assert os.path.exists(abs_thumb), f"Thumbnail should exist before delete: {abs_thumb}"

        # Delete
        media_id = data["id"]
        resp = client.delete(
            f"/api/media/{project_id}/{media_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 204

        # Verify files are gone
        assert not os.path.exists(abs_file), f"File should be removed after delete: {abs_file}"
        if thumb_path:
            assert not os.path.exists(abs_thumb), f"Thumbnail should be removed after delete: {abs_thumb}"

    def test_delete_not_found(self, client, mock_auth_headers, _patch_media_dir):
        """DELETE fake media_id returns 404."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        fake_id = str(uuid.uuid4())

        resp = client.delete(
            f"/api/media/{project_id}/{fake_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# TestCrossCutting
# ============================================================


class TestCrossCutting:
    def test_no_auth(self, client, _patch_media_dir):
        """Request without auth returns 401/403."""
        fake_uuid = str(uuid.uuid4())

        resp = client.get(f"/api/media/{fake_uuid}")
        assert resp.status_code in (401, 403)

    def test_wrong_project_404(self, client, mock_auth_headers, _patch_media_dir):
        """Request to nonexistent project returns 404."""
        fake_uuid = str(uuid.uuid4())

        resp = client.get(
            f"/api/media/{fake_uuid}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404
