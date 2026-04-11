# backend/app/tests/test_breakdown_api.py

import uuid

import pytest
from unittest.mock import patch, AsyncMock
from screenwriter.models.database import (
    BreakdownElement,
    BreakdownRun,
    ElementSceneLink,
    ListItem,
    PhaseData,
    Project,
    ScreenplayContent,
)
from screenwriter.services.breakdown_service import (
    ExtractionResponse,
    ExtractedElement,
    ExtractedSceneAppearance,
)

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


def _make_element(db_session, project_id, category="prop", name="Test Item", is_deleted=False):
    elem = BreakdownElement(
        id=str(uuid.uuid4()),
        project_id=project_id,
        category=category,
        name=name,
        source="ai",
        is_deleted=is_deleted,
    )
    db_session.add(elem)
    db_session.flush()
    return elem


def _make_phase_data(db_session, project_id, phase="write", subsection_key="scenes"):
    """Create a PhaseData record to parent ListItems."""
    pd = PhaseData(
        id=str(uuid.uuid4()),
        project_id=project_id,
        phase=phase,
        subsection_key=subsection_key,
        content={},
    )
    db_session.add(pd)
    db_session.flush()
    return pd


def _make_list_item(db_session, phase_data_id):
    """Create a ListItem to use as a scene for linking."""
    item = ListItem(
        id=str(uuid.uuid4()),
        phase_data_id=phase_data_id,
        item_type="scene",
        content={"title": "Scene 1"},
    )
    db_session.add(item)
    db_session.flush()
    return item


# ============================================================
# API-02: List elements
# ============================================================

class TestListElements:
    def test_list_elements(self, client, db_session, mock_auth_headers):
        """GET /elements/{project_id} returns created elements (200)."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, name="Chair")
        _make_element(db_session, project_id, name="Table")
        db_session.commit()

        resp = client.get(f"/api/breakdown/elements/{project_id}", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {e["name"] for e in data}
        assert names == {"Chair", "Table"}

    def test_list_elements_excludes_deleted(self, client, db_session, mock_auth_headers):
        """Soft-deleted elements excluded by default."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, name="Active")
        _make_element(db_session, project_id, name="Deleted", is_deleted=True)
        db_session.commit()

        resp = client.get(f"/api/breakdown/elements/{project_id}", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Active"

    def test_list_elements_include_deleted(self, client, db_session, mock_auth_headers):
        """include_deleted=true returns all elements."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, name="Active")
        _make_element(db_session, project_id, name="Deleted", is_deleted=True)
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"include_deleted": "true"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_list_elements_filter_by_category(self, client, db_session, mock_auth_headers):
        """?category=prop returns only props."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="prop", name="Sword")
        _make_element(db_session, project_id, category="character", name="Hero")
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "prop"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Sword"


# ============================================================
# API-04: Create element
# ============================================================

class TestCreateElement:
    def test_create_element_source_user(self, client, db_session, mock_auth_headers):
        """POST creates with source='user' (201)."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        resp = client.post(
            f"/api/breakdown/elements/{project_id}",
            json={"category": "prop", "name": "Magic Wand", "description": "A wand"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Magic Wand"
        assert data["source"] == "user"

    def test_create_element_duplicate_conflict(self, client, db_session, mock_auth_headers):
        """Duplicate active name returns 409."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="prop", name="Duplicate")
        db_session.commit()

        resp = client.post(
            f"/api/breakdown/elements/{project_id}",
            json={"category": "prop", "name": "Duplicate"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 409

    def test_create_element_restores_soft_deleted(self, client, db_session, mock_auth_headers):
        """Duplicate of soft-deleted name restores it."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="prop", name="Restored", is_deleted=True)
        db_session.commit()

        resp = client.post(
            f"/api/breakdown/elements/{project_id}",
            json={"category": "prop", "name": "Restored", "description": "Back from the dead"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_deleted"] is False
        assert data["description"] == "Back from the dead"
        assert data["source"] == "user"


# ============================================================
# API-03: Update element
# ============================================================

class TestUpdateElement:
    def test_update_element_sets_user_modified(self, client, db_session, mock_auth_headers):
        """PUT updates fields and sets user_modified=true."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="Original")
        db_session.commit()

        resp = client.put(
            f"/api/breakdown/element/{elem.id}",
            json={"name": "Updated", "description": "new desc"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated"
        assert data["description"] == "new desc"
        assert data["user_modified"] is True

    def test_update_element_partial(self, client, db_session, mock_auth_headers):
        """PUT with only name updates name, leaves others."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="Partial")
        elem.description = "keep me"
        db_session.commit()

        resp = client.put(
            f"/api/breakdown/element/{elem.id}",
            json={"name": "Renamed"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed"
        assert data["description"] == "keep me"


# ============================================================
# API-05: Delete element (soft-delete)
# ============================================================

class TestDeleteElement:
    def test_delete_element_soft_deletes(self, client, db_session, mock_auth_headers):
        """DELETE sets is_deleted=true (200)."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="ToDelete")
        db_session.commit()

        resp = client.delete(
            f"/api/breakdown/element/{elem.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"

        # Verify soft-deleted in DB
        db_session.refresh(elem)
        assert elem.is_deleted is True


# ============================================================
# API-01: Extraction trigger (stub)
# ============================================================

class TestExtraction:
    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    def test_extract_creates_completed_run(self, mock_ai, client, db_session, mock_auth_headers):
        """POST /extract creates BreakdownRun with status='completed' (mocked AI)."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        # Create screenplay content so extraction doesn't fail early
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. ROOM - DAY\nA bare room.",
        )
        db_session.add(sc)
        db_session.commit()

        # Mock AI returns empty elements
        mock_ai.return_value = ExtractionResponse(elements=[])

        resp = client.post(
            f"/api/breakdown/extract/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert data["project_id"] == str(project_id)

    @patch("app.services.breakdown_service.chat_completion_structured", new_callable=AsyncMock)
    def test_extract_response_shape(self, mock_ai, client, db_session, mock_auth_headers):
        """Response has all BreakdownRunResponse fields and reflects extracted elements."""
        project_id = _create_project_via_api(client, mock_auth_headers)

        # Create screenplay content
        sc = ScreenplayContent(
            id=str(uuid.uuid4()),
            project_id=project_id,
            content="INT. OFFICE - DAY\nJOHN enters carrying a briefcase.",
        )
        db_session.add(sc)
        db_session.commit()

        # Mock AI returns sample elements
        mock_ai.return_value = ExtractionResponse(elements=[
            ExtractedElement(
                category="character",
                canonical_name="John",
                description="A man with a briefcase",
                scene_appearances=[],
            ),
            ExtractedElement(
                category="prop",
                canonical_name="Briefcase",
                description="A leather briefcase",
                scene_appearances=[],
            ),
        ])

        resp = client.post(
            f"/api/breakdown/extract/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        expected_keys = {
            "id", "project_id", "status", "config", "result_summary",
            "elements_created", "elements_updated", "error_message",
            "created_at", "completed_at",
        }
        assert expected_keys.issubset(set(data.keys()))
        assert data["elements_created"] == 2
        assert data["elements_updated"] == 0


# ============================================================
# API-06: Scene links
# ============================================================

class TestSceneLinks:
    def test_add_scene_link(self, client, db_session, mock_auth_headers):
        """POST /element/{id}/scenes creates link (201)."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="LinkMe")
        pd = _make_phase_data(db_session, project_id)
        item = _make_list_item(db_session, pd.id)
        db_session.commit()

        resp = client.post(
            f"/api/breakdown/element/{elem.id}/scenes",
            json={"scene_item_id": str(item.id), "context": "Used in scene 1"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["message"] == "Scene linked"
        assert "id" in data

    def test_add_scene_link_idempotent(self, client, db_session, mock_auth_headers):
        """Duplicate link returns 200, not error."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="IdempotentLink")
        pd = _make_phase_data(db_session, project_id)
        item = _make_list_item(db_session, pd.id)
        db_session.commit()

        # First link
        resp1 = client.post(
            f"/api/breakdown/element/{elem.id}/scenes",
            json={"scene_item_id": str(item.id)},
            headers=mock_auth_headers,
        )
        assert resp1.status_code == 201

        # Duplicate link (idempotent)
        resp2 = client.post(
            f"/api/breakdown/element/{elem.id}/scenes",
            json={"scene_item_id": str(item.id)},
            headers=mock_auth_headers,
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["message"] == "Scene link already exists"

    def test_add_scene_link_invalid_scene(self, client, db_session, mock_auth_headers):
        """Nonexistent scene_item_id returns 404."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="BadLink")
        db_session.commit()

        fake_scene_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/breakdown/element/{elem.id}/scenes",
            json={"scene_item_id": fake_scene_id},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_remove_scene_link(self, client, db_session, mock_auth_headers):
        """DELETE /element/{id}/scenes/{scene_id} removes link."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="Removable")
        pd = _make_phase_data(db_session, project_id)
        item = _make_list_item(db_session, pd.id)
        # Create link directly in DB
        link = ElementSceneLink(
            id=str(uuid.uuid4()),
            element_id=elem.id,
            scene_item_id=item.id,
            context="test",
            source="user",
        )
        db_session.add(link)
        db_session.commit()

        resp = client.delete(
            f"/api/breakdown/element/{elem.id}/scenes/{item.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"

    def test_remove_scene_link_nonexistent(self, client, db_session, mock_auth_headers):
        """Removing nonexistent link returns 404."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="NoLink")
        db_session.commit()

        fake_scene_id = str(uuid.uuid4())
        resp = client.delete(
            f"/api/breakdown/element/{elem.id}/scenes/{fake_scene_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# API-07: Summary
# ============================================================

class TestSummary:
    def test_summary_returns_counts(self, client, db_session, mock_auth_headers):
        """GET /summary returns category counts and total."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="prop", name="Prop1")
        _make_element(db_session, project_id, category="prop", name="Prop2")
        _make_element(db_session, project_id, category="character", name="Char1")
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/summary/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_elements"] == 3
        assert data["counts_by_category"]["prop"] == 2
        assert data["counts_by_category"]["character"] == 1

    def test_summary_staleness(self, client, db_session, mock_auth_headers):
        """Summary reflects project.breakdown_stale value."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        # Set breakdown_stale directly on the DB object
        project = db_session.query(Project).filter(Project.id == project_id).first()
        project.breakdown_stale = True
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/summary/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_stale"] is True

    def test_summary_with_last_run(self, client, db_session, mock_auth_headers):
        """Summary includes last run info after extraction."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        run = BreakdownRun(
            id=str(uuid.uuid4()),
            project_id=project_id,
            status="completed",
            config={},
            result_summary={"total": 5},
        )
        db_session.add(run)
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/summary/{project_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_run"] is not None
        assert data["last_run"]["status"] == "completed"


# ============================================================
# Cross-cutting tests
# ============================================================

class TestCrossCutting:
    def test_nonexistent_project_404(self, client, mock_auth_headers):
        """Operations on nonexistent project return 404."""
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/breakdown/elements/{fake_id}", headers=mock_auth_headers)
        assert resp.status_code == 404

    def test_no_auth_returns_error(self, client):
        """Requests without auth header return 401/403."""
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/breakdown/elements/{fake_id}")
        assert resp.status_code in (401, 403)


# ============================================================
# synced_to_characters field on list_elements (Plan 14-01 Task 1)
# ============================================================

class TestSyncedToCharacters:
    def test_synced_to_characters_false_when_no_phase_data(self, client, db_session, mock_auth_headers):
        """GET elements returns synced_to_characters=false when story.characters PhaseData does not exist."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="character", name="Hero")
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "character"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["synced_to_characters"] is False

    def test_synced_to_characters_true_when_name_matches(self, client, db_session, mock_auth_headers):
        """GET elements returns synced_to_characters=true for element whose name matches a ListItem in story.characters."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="Hero")
        # Create story.characters PhaseData and a ListItem with matching name
        chars_pd = _make_phase_data(db_session, project_id, phase="story", subsection_key="characters")
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=chars_pd.id,
            item_type="supporting",
            content={"name": "Hero"},
        )
        db_session.add(item)
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "character"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["synced_to_characters"] is True

    def test_synced_to_characters_case_insensitive(self, client, db_session, mock_auth_headers):
        """synced_to_characters match is case-insensitive."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        _make_element(db_session, project_id, category="character", name="HERO")
        chars_pd = _make_phase_data(db_session, project_id, phase="story", subsection_key="characters")
        item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=chars_pd.id,
            item_type="supporting",
            content={"name": "hero"},
        )
        db_session.add(item)
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "character"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["synced_to_characters"] is True


# ============================================================
# sync-to-project endpoint (Plan 14-01 Task 2)
# ============================================================

class TestSyncToProject:
    def test_sync_creates_list_item(self, client, db_session, mock_auth_headers):
        """POST sync-to-project creates a ListItem in story.characters with correct fields (200, status=created)."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="John")
        elem.description = "A seasoned detective"
        db_session.commit()

        resp = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert "list_item_id" in data

        # Verify item was created in DB
        list_item_id = data["list_item_id"]
        item = db_session.query(ListItem).filter(ListItem.id == list_item_id).first()
        assert item is not None
        assert item.item_type == "supporting"
        assert item.status == "draft"
        assert item.content["name"] == "John"
        assert item.content["role"] == "A seasoned detective"
        assert item.content["dialogue_style"] == ""

    def test_sync_idempotent_returns_already_exists(self, client, db_session, mock_auth_headers):
        """Calling sync-to-project twice returns already_exists with same list_item_id (200)."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="Alice")
        db_session.commit()

        resp1 = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert resp1.status_code == 200
        assert resp1.json()["status"] == "created"
        first_id = resp1.json()["list_item_id"]

        resp2 = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert data2["status"] == "already_exists"
        assert data2["list_item_id"] == first_id

        # Only one ListItem in DB
        chars_pd = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "story",
            PhaseData.subsection_key == "characters",
        ).first()
        items = db_session.query(ListItem).filter(ListItem.phase_data_id == chars_pd.id).all()
        assert len(items) == 1

    def test_sync_case_insensitive_duplicate(self, client, db_session, mock_auth_headers):
        """Case-insensitive duplicate: element name=JOHN with existing ListItem name=john returns already_exists."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="JOHN")
        # Pre-create story.characters PhaseData and ListItem with lowercase name
        chars_pd = _make_phase_data(db_session, project_id, phase="story", subsection_key="characters")
        existing_item = ListItem(
            id=str(uuid.uuid4()),
            phase_data_id=chars_pd.id,
            item_type="supporting",
            content={"name": "john"},
            status="draft",
        )
        db_session.add(existing_item)
        db_session.commit()

        resp = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "already_exists"
        assert data["list_item_id"] == str(existing_item.id)

    def test_sync_creates_phase_data_on_demand(self, client, db_session, mock_auth_headers):
        """When story.characters PhaseData does not exist, endpoint creates it and the ListItem."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="Bob")
        db_session.commit()

        # Verify no story.characters PhaseData exists yet
        pd_before = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "story",
            PhaseData.subsection_key == "characters",
        ).first()
        assert pd_before is None

        resp = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "created"

        # PhaseData was created
        pd_after = db_session.query(PhaseData).filter(
            PhaseData.project_id == project_id,
            PhaseData.phase == "story",
            PhaseData.subsection_key == "characters",
        ).first()
        assert pd_after is not None

    def test_sync_then_list_shows_synced_true(self, client, db_session, mock_auth_headers):
        """After sync, GET elements returns synced_to_characters=true for that element."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="Carol")
        db_session.commit()

        # Before sync
        list_before = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "character"},
            headers=mock_auth_headers,
        )
        assert list_before.json()[0]["synced_to_characters"] is False

        # Sync
        sync_resp = client.post(
            f"/api/breakdown/element/{elem.id}/sync-to-project",
            headers=mock_auth_headers,
        )
        assert sync_resp.json()["status"] == "created"

        # After sync
        list_after = client.get(
            f"/api/breakdown/elements/{project_id}",
            params={"category": "character"},
            headers=mock_auth_headers,
        )
        assert list_after.json()[0]["synced_to_characters"] is True


# ============================================================
# scene_links field on BreakdownElementResponse (Plan 13-01)
# ============================================================

def test_element_response_includes_scene_links(client, mock_auth_headers, db_session):
    """BreakdownElementResponse must include scene_links field (list, possibly empty)."""
    project_id = _create_project_via_api(client, mock_auth_headers)
    # create one element via API so owner relationship is correct
    resp = client.post(
        f"/api/breakdown/elements/{project_id}",
        json={"category": "prop", "name": "TestProp", "description": ""},
        headers=mock_auth_headers,
    )
    assert resp.status_code == 201
    element_id = resp.json()["id"]

    list_resp = client.get(f"/api/breakdown/elements/{project_id}", headers=mock_auth_headers)
    assert list_resp.status_code == 200
    elements = list_resp.json()
    assert len(elements) >= 1
    for elem in elements:
        assert "scene_links" in elem, f"scene_links missing from element {elem.get('id')}"
        assert isinstance(elem["scene_links"], list)

    # Verify the specific element also has scene_links (empty for manually created)
    target = next(e for e in elements if e["id"] == element_id)
    assert target["scene_links"] == []


# ============================================================
# GET single element (Phase 32 - EDP-01)
# ============================================================

class TestGetElement:
    def test_get_element_returns_single(self, client, db_session, mock_auth_headers):
        """GET /element/{id} returns single element with all fields."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="Jane")
        elem.description = "A pilot"
        elem.metadata_ = {"bio": "Former Navy pilot", "age": "32", "role": "Lead"}
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/element/{elem.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(elem.id)
        assert data["name"] == "Jane"
        assert data["category"] == "character"
        assert data["description"] == "A pilot"
        assert data["metadata"]["bio"] == "Former Navy pilot"
        assert data["metadata"]["age"] == "32"
        assert data["metadata"]["role"] == "Lead"
        assert "scene_links" in data

    def test_get_element_includes_scene_title(self, client, db_session, mock_auth_headers):
        """GET /element/{id} returns scene_links with scene_title from ListItem content."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, name="WithScenes")
        pd = _make_phase_data(db_session, project_id)
        item = _make_list_item(db_session, pd.id)
        # _make_list_item creates with content={"title": "Scene 1"}
        link = ElementSceneLink(
            id=str(uuid.uuid4()),
            element_id=elem.id,
            scene_item_id=item.id,
            context="test",
            source="ai",
        )
        db_session.add(link)
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/element/{elem.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["scene_links"]) == 1
        assert data["scene_links"][0]["scene_title"] == "Scene 1"

    def test_get_element_nonexistent_404(self, client, mock_auth_headers):
        """GET with nonexistent element_id returns 404."""
        fake_id = str(uuid.uuid4())
        resp = client.get(
            f"/api/breakdown/element/{fake_id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_get_element_wrong_owner_404(self, client, db_session, mock_auth_headers):
        """GET element owned by a different user returns 404 (ownership check)."""
        # Create element with a different owner via direct DB insert
        from screenwriter.models.database import Project as ProjectModel
        other_project = ProjectModel(
            id=str(uuid.uuid4()),
            owner_id=str(uuid.uuid4()),  # different owner
            title="Other Project",
            framework="three_act",
        )
        db_session.add(other_project)
        db_session.flush()
        elem = _make_element(db_session, other_project.id, name="Forbidden")
        db_session.commit()

        resp = client.get(
            f"/api/breakdown/element/{elem.id}",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404


# ============================================================
# Update element metadata persistence (Phase 32 - EDP-01)
# ============================================================

class TestUpdateElementMetadata:
    def test_update_metadata_persists(self, client, db_session, mock_auth_headers):
        """PUT with metadata dict saves and GET returns same metadata."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="character", name="MetaChar")
        db_session.commit()

        metadata = {"bio": "A mysterious figure", "age": "45", "role": "Antagonist"}
        put_resp = client.put(
            f"/api/breakdown/element/{elem.id}",
            json={"metadata": metadata},
            headers=mock_auth_headers,
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["metadata"] == metadata

        # Verify via GET
        get_resp = client.get(
            f"/api/breakdown/element/{elem.id}",
            headers=mock_auth_headers,
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["metadata"] == metadata

    def test_update_metadata_full_replace(self, client, db_session, mock_auth_headers):
        """PUT with new metadata replaces entire metadata object."""
        project_id = _create_project_via_api(client, mock_auth_headers)
        elem = _make_element(db_session, project_id, category="location", name="MetaLoc")
        elem.metadata_ = {"address": "123 Oak St", "type": "Interior", "notes": "Old house"}
        db_session.commit()

        # Replace with partial metadata (only address and type)
        new_metadata = {"address": "456 Elm St", "type": "Exterior"}
        put_resp = client.put(
            f"/api/breakdown/element/{elem.id}",
            json={"metadata": new_metadata},
            headers=mock_auth_headers,
        )
        assert put_resp.status_code == 200
        result_meta = put_resp.json()["metadata"]
        assert result_meta == new_metadata
        # "notes" key should NOT be present (full replace, not merge)
        assert "notes" not in result_meta
