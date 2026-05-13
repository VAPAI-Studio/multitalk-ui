import pytest
from screenwriter.models.database import Show as ShowModel, User as UserModel, Project as ProjectModel


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


class TestShowModel:
    """Test the Show SQLAlchemy model directly."""

    def test_show_model_columns(self, db_session):
        # Ensure mock user exists (needed for FK constraint)
        existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
        if not existing:
            user = UserModel(
                id=MOCK_USER_ID,
                email="showtest@example.com",
                hashed_password="fakehash",
                display_name="ShowTest",
            )
            db_session.add(user)
            db_session.flush()

        show = ShowModel(
            owner_id=MOCK_USER_ID,
            title="Breaking Bad",
            description="A chemistry teacher turns to cooking meth.",
        )
        db_session.add(show)
        db_session.commit()
        db_session.refresh(show)

        assert show.id is not None
        assert show.owner_id == "12345678-1234-5678-1234-567812345678"
        assert show.title == "Breaking Bad"
        assert show.description == "A chemistry teacher turns to cooking meth."
        assert show.created_at is not None


class TestShowsAPI:
    """Test Show CRUD endpoints."""

    def test_create_show(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "Breaking Bad", "description": "A chemistry teacher..."},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Breaking Bad"
        assert data["description"] == "A chemistry teacher..."
        assert "id" in data
        assert "owner_id" in data
        assert "created_at" in data

    def test_create_show_default_description(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "The Wire"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["description"] == ""

    def test_create_show_empty_title(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "   "},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_create_show_short_title(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "X"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_list_shows(self, client, mock_auth_headers):
        client.post("/api/shows/", json={"title": "Show A"}, headers=mock_auth_headers)
        client.post("/api/shows/", json={"title": "Show B"}, headers=mock_auth_headers)
        resp = client.get("/api/shows/", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2
        titles = [s["title"] for s in data]
        assert "Show A" in titles
        assert "Show B" in titles

    def test_get_show(self, client, mock_auth_headers):
        create_resp = client.post(
            "/api/shows/",
            json={"title": "Get Me", "description": "Details here"},
            headers=mock_auth_headers,
        )
        show_id = create_resp.json()["id"]
        resp = client.get(f"/api/shows/{show_id}", headers=mock_auth_headers)
        assert resp.status_code == 200
        assert resp.json()["title"] == "Get Me"
        assert resp.json()["description"] == "Details here"

    def test_get_show_not_found(self, client, mock_auth_headers):
        resp = client.get(
            "/api/shows/00000000-0000-0000-0000-000000000000",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_update_show(self, client, mock_auth_headers):
        create_resp = client.post(
            "/api/shows/",
            json={"title": "Old Title", "description": "Old desc"},
            headers=mock_auth_headers,
        )
        show_id = create_resp.json()["id"]
        update_resp = client.put(
            f"/api/shows/{show_id}",
            json={"title": "New Title", "description": "New desc"},
            headers=mock_auth_headers,
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["title"] == "New Title"
        assert update_resp.json()["description"] == "New desc"

    def test_update_show_partial(self, client, mock_auth_headers):
        create_resp = client.post(
            "/api/shows/",
            json={"title": "Keep Title", "description": "Change me"},
            headers=mock_auth_headers,
        )
        show_id = create_resp.json()["id"]
        update_resp = client.put(
            f"/api/shows/{show_id}",
            json={"description": "Changed"},
            headers=mock_auth_headers,
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["title"] == "Keep Title"
        assert update_resp.json()["description"] == "Changed"

    def test_update_show_not_found(self, client, mock_auth_headers):
        resp = client.put(
            "/api/shows/00000000-0000-0000-0000-000000000000",
            json={"title": "No Such Show"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_delete_show(self, client, mock_auth_headers):
        create_resp = client.post(
            "/api/shows/",
            json={"title": "Doomed Show"},
            headers=mock_auth_headers,
        )
        show_id = create_resp.json()["id"]
        del_resp = client.delete(f"/api/shows/{show_id}", headers=mock_auth_headers)
        assert del_resp.status_code == 200
        # Verify it's gone
        get_resp = client.get(f"/api/shows/{show_id}", headers=mock_auth_headers)
        assert get_resp.status_code == 404

    def test_delete_show_not_found(self, client, mock_auth_headers):
        resp = client.delete(
            "/api/shows/00000000-0000-0000-0000-000000000000",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_create_show_fields_complete(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "Full Fields", "description": "Test desc"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert "owner_id" in data
        assert "title" in data
        assert "description" in data
        assert "created_at" in data
        # updated_at may be None on creation


class TestBibleModel:
    """Test the Show model's bible columns directly."""

    def test_show_bible_defaults(self, db_session):
        # Ensure mock user exists
        existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
        if not existing:
            user = UserModel(
                id=MOCK_USER_ID,
                email="bibletest@example.com",
                hashed_password="fakehash",
                display_name="BibleTest",
            )
            db_session.add(user)
            db_session.flush()

        show = ShowModel(
            owner_id=MOCK_USER_ID,
            title="Bible Default Test",
        )
        db_session.add(show)
        db_session.commit()
        db_session.refresh(show)

        assert show.bible_characters == ""
        assert show.bible_world_setting == ""
        assert show.bible_season_arc == ""
        assert show.bible_tone_style == ""
        assert show.episode_duration_minutes is None

    def test_show_bible_set_values(self, db_session):
        existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
        if not existing:
            user = UserModel(
                id=MOCK_USER_ID,
                email="bibletest2@example.com",
                hashed_password="fakehash",
                display_name="BibleTest2",
            )
            db_session.add(user)
            db_session.flush()

        show = ShowModel(
            owner_id=MOCK_USER_ID,
            title="Bible Values Test",
            bible_characters="Walter White - chemistry teacher",
            bible_world_setting="Albuquerque, New Mexico",
            bible_season_arc="Descent into criminality",
            bible_tone_style="Dark, tense, morally ambiguous",
            episode_duration_minutes=44,
        )
        db_session.add(show)
        db_session.commit()
        db_session.refresh(show)

        assert show.bible_characters == "Walter White - chemistry teacher"
        assert show.bible_world_setting == "Albuquerque, New Mexico"
        assert show.bible_season_arc == "Descent into criminality"
        assert show.bible_tone_style == "Dark, tense, morally ambiguous"
        assert show.episode_duration_minutes == 44


class TestBibleAPI:
    """Test Bible GET/PUT endpoints."""

    def _create_show(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "Bible Test Show"},
            headers=mock_auth_headers,
        )
        return resp.json()["id"]

    def test_get_bible_defaults(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.get(f"/api/shows/{show_id}/bible", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["show_id"] == show_id
        assert data["bible_characters"] == ""
        assert data["bible_world_setting"] == ""
        assert data["bible_season_arc"] == ""
        assert data["bible_tone_style"] == ""
        assert data["episode_duration_minutes"] is None

    def test_get_bible_not_found(self, client, mock_auth_headers):
        resp = client.get(
            "/api/shows/00000000-0000-0000-0000-000000000000/bible",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_update_bible_partial(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"bible_characters": "Walter White - chemistry teacher turned drug lord"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bible_characters"] == "Walter White - chemistry teacher turned drug lord"
        assert data["bible_world_setting"] == ""  # unchanged
        assert data["bible_season_arc"] == ""  # unchanged
        assert data["bible_tone_style"] == ""  # unchanged
        assert data["episode_duration_minutes"] is None  # unchanged

    def test_update_bible_full(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={
                "bible_characters": "Jesse Pinkman - partner",
                "bible_world_setting": "Southwest USA",
                "bible_season_arc": "Rise and fall",
                "bible_tone_style": "Gritty realism",
                "episode_duration_minutes": 60,
            },
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bible_characters"] == "Jesse Pinkman - partner"
        assert data["bible_world_setting"] == "Southwest USA"
        assert data["bible_season_arc"] == "Rise and fall"
        assert data["bible_tone_style"] == "Gritty realism"
        assert data["episode_duration_minutes"] == 60

    def test_update_bible_round_trip(self, client, mock_auth_headers):
        """PUT then GET to verify persistence."""
        show_id = self._create_show(client, mock_auth_headers)
        client.put(
            f"/api/shows/{show_id}/bible",
            json={"bible_characters": "Persisted character notes", "episode_duration_minutes": 22},
            headers=mock_auth_headers,
        )
        resp = client.get(f"/api/shows/{show_id}/bible", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["bible_characters"] == "Persisted character notes"
        assert data["episode_duration_minutes"] == 22

    def test_update_duration_preset(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        for preset in [10, 22, 44, 60]:
            resp = client.put(
                f"/api/shows/{show_id}/bible",
                json={"episode_duration_minutes": preset},
                headers=mock_auth_headers,
            )
            assert resp.status_code == 200
            assert resp.json()["episode_duration_minutes"] == preset

    def test_update_duration_custom(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": 35},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["episode_duration_minutes"] == 35

    def test_update_duration_invalid_zero(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": 0},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_update_duration_invalid_negative(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": -5},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_update_duration_invalid_too_high(self, client, mock_auth_headers):
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": 481},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 422

    def test_update_bible_not_found(self, client, mock_auth_headers):
        resp = client.put(
            "/api/shows/00000000-0000-0000-0000-000000000000/bible",
            json={"bible_characters": "Nobody"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_update_duration_clear_to_null(self, client, mock_auth_headers):
        """Setting duration to null clears it."""
        show_id = self._create_show(client, mock_auth_headers)
        # Set it first
        client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": 22},
            headers=mock_auth_headers,
        )
        # Clear it
        resp = client.put(
            f"/api/shows/{show_id}/bible",
            json={"episode_duration_minutes": None},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["episode_duration_minutes"] is None


class TestEpisodeModel:
    """Test Project model with episode columns (show_id, episode_number)."""

    def _ensure_user(self, db_session):
        existing = db_session.query(UserModel).filter(UserModel.id == MOCK_USER_ID).first()
        if not existing:
            user = UserModel(
                id=MOCK_USER_ID,
                email="episodetest@example.com",
                hashed_password="fakehash",
                display_name="EpisodeTest",
            )
            db_session.add(user)
            db_session.flush()

    def test_project_with_show_id_and_episode_number(self, db_session):
        """Test that a Project can be created with show_id and episode_number."""
        self._ensure_user(db_session)
        show = ShowModel(
            owner_id=MOCK_USER_ID,
            title="Episode Model Test Show",
        )
        db_session.add(show)
        db_session.flush()

        project = ProjectModel(
            owner_id=MOCK_USER_ID,
            title="Pilot Episode",
            show_id=str(show.id),
            episode_number=1,
        )
        db_session.add(project)
        db_session.commit()
        db_session.refresh(project)

        assert project.id is not None
        assert project.show_id == str(show.id)
        assert project.episode_number == 1
        assert project.title == "Pilot Episode"

    def test_project_standalone_no_show(self, db_session):
        """Test that a standalone Project works with show_id=None."""
        self._ensure_user(db_session)
        project = ProjectModel(
            owner_id=MOCK_USER_ID,
            title="Standalone Film",
        )
        db_session.add(project)
        db_session.commit()
        db_session.refresh(project)

        assert project.show_id is None
        assert project.episode_number is None

    def test_project_response_schema_includes_episode_fields(self):
        """Test that the Project response schema includes show_id and episode_number."""
        from screenwriter.models.schemas import Project as ProjectSchema
        fields = ProjectSchema.model_fields
        assert "show_id" in fields, "show_id missing from Project response schema"
        assert "episode_number" in fields, "episode_number missing from Project response schema"

    def test_episode_create_schema_validation(self):
        """Test EpisodeCreate schema validates correctly."""
        from screenwriter.models.schemas import EpisodeCreate
        # Valid input
        ep = EpisodeCreate(title="Pilot")
        assert ep.title == "Pilot"
        assert ep.episode_number is None
        assert ep.framework.value == "three_act"

        # With episode_number
        ep2 = EpisodeCreate(title="Episode Two", episode_number=2)
        assert ep2.episode_number == 2

        # Title too short
        with pytest.raises(Exception):
            EpisodeCreate(title="X")

        # Whitespace-only title
        with pytest.raises(Exception):
            EpisodeCreate(title="   ")

        # episode_number must be >= 1
        with pytest.raises(Exception):
            EpisodeCreate(title="Test", episode_number=0)


class TestEpisodesAPI:
    """Test POST /api/shows/{show_id}/episodes endpoint."""

    def _create_show(self, client, mock_auth_headers):
        resp = client.post(
            "/api/shows/",
            json={"title": "Episode Test Show"},
            headers=mock_auth_headers,
        )
        return resp.json()["id"]

    def test_create_episode(self, client, mock_auth_headers):
        """POST with title and episode_number returns 201 with show_id, episode_number, and 6 sections."""
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Pilot", "episode_number": 1},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Pilot"
        assert data["show_id"] == show_id
        assert data["episode_number"] == 1
        assert len(data["sections"]) == 6

    def test_create_episode_auto_number(self, client, mock_auth_headers):
        """POST without episode_number auto-assigns 1 for first, 2 for second."""
        show_id = self._create_show(client, mock_auth_headers)
        resp1 = client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Episode One"},
            headers=mock_auth_headers,
        )
        assert resp1.status_code == 201
        assert resp1.json()["episode_number"] == 1

        resp2 = client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Episode Two"},
            headers=mock_auth_headers,
        )
        assert resp2.status_code == 201
        assert resp2.json()["episode_number"] == 2

    def test_create_episode_custom_framework(self, client, mock_auth_headers):
        """POST with framework=hero_journey creates episode with that framework."""
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Hero Ep", "framework": "hero_journey"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["framework"] == "hero_journey"

    def test_create_episode_show_not_found(self, client, mock_auth_headers):
        """POST to non-existent show returns 404."""
        resp = client.post(
            "/api/shows/00000000-0000-0000-0000-000000000000/episodes",
            json={"title": "Orphan"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_create_episode_sections_count(self, client, mock_auth_headers):
        """Create episode and verify exactly 6 sections returned."""
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Section Count Ep"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 201
        sections = resp.json()["sections"]
        assert len(sections) == 6
        section_types = [s["type"] for s in sections]
        assert "inciting_incident" in section_types
        assert "climax" in section_types
        assert "resolution" in section_types

    def test_list_episodes(self, client, mock_auth_headers):
        """GET /api/shows/{show_id}/episodes returns episodes ordered by episode_number."""
        show_id = self._create_show(client, mock_auth_headers)
        # Create two episodes
        client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Ep 1"},
            headers=mock_auth_headers,
        )
        client.post(
            f"/api/shows/{show_id}/episodes",
            json={"title": "Ep 2"},
            headers=mock_auth_headers,
        )
        resp = client.get(f"/api/shows/{show_id}/episodes", headers=mock_auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["episode_number"] == 1
        assert data[1]["episode_number"] == 2

    def test_list_episodes_empty(self, client, mock_auth_headers):
        """GET for show with no episodes returns 200 with empty list."""
        show_id = self._create_show(client, mock_auth_headers)
        resp = client.get(f"/api/shows/{show_id}/episodes", headers=mock_auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_episodes_not_found(self, client, mock_auth_headers):
        """GET for non-existent show_id returns 404."""
        resp = client.get(
            "/api/shows/00000000-0000-0000-0000-000000000000/episodes",
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_standalone_projects_unaffected(self, client, mock_auth_headers):
        """POST /api/projects/ still works, returns show_id=null, episode_number=null."""
        resp = client.post(
            "/api/projects/",
            json={"title": "My Film", "framework": "three_act"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["show_id"] is None
        assert data["episode_number"] is None
