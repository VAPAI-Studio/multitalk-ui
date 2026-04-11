# backend/app/tests/test_breakdown_chat_api.py

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest


MOCK_USER_ID = "12345678-1234-5678-1234-567812345678"


class TestBreakdownChatAPI:
    """Tests for the breakdown chat streaming endpoint."""

    def _create_test_project(self, client, mock_auth_headers):
        """Create a project via API and return the project dict."""
        resp = client.post(
            "/api/projects/",
            json={"title": "Test Project", "framework": "three_act"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 200, f"Project creation failed: {resp.json()}"
        return resp.json()

    def test_stream_requires_auth(self, client):
        """POST without auth returns 401 or 403."""
        fake_uuid = str(uuid.uuid4())
        resp = client.post(
            f"/api/breakdown-chat/{fake_uuid}/stream",
            json={"content": "Hello"},
        )
        assert resp.status_code in (401, 403)

    def test_stream_requires_valid_project(self, client, mock_auth_headers):
        """POST to nonexistent project returns 404."""
        fake_uuid = str(uuid.uuid4())
        resp = client.post(
            f"/api/breakdown-chat/{fake_uuid}/stream",
            json={"content": "Hello"},
            headers=mock_auth_headers,
        )
        assert resp.status_code == 404

    def test_stream_includes_shots_context(self, client, mock_auth_headers, db_session):
        """Verify shots context is injected into the AI system prompt."""
        project = self._create_test_project(client, mock_auth_headers)
        project_id = project["id"]

        captured_messages = []

        async def mock_stream(*args, **kwargs):
            captured_messages.append(kwargs.get("messages") or (args[0] if args else []))
            for chunk in ["Test response about shots"]:
                yield chunk

        with patch(
            "app.api.endpoints.breakdown_chat.chat_completion_stream",
            side_effect=mock_stream,
        ):
            resp = client.post(
                f"/api/breakdown-chat/{project_id}/stream",
                json={
                    "content": "Tell me about my shots",
                    "message_history": [],
                    "shots_context": [
                        {
                            "id": "shot-1",
                            "shot_number": 1,
                            "scene_item_id": None,
                            "fields": {"shot_size": "CU"},
                            "source": "user",
                        }
                    ],
                    "elements_context": [],
                },
                headers=mock_auth_headers,
            )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")

        # Verify the system prompt contains the shot field value
        assert len(captured_messages) == 1
        messages = captured_messages[0]
        system_prompt = messages[0]["content"]
        assert "CU" in system_prompt
        assert "Shot #1" in system_prompt

    def test_stream_includes_elements_context(self, client, mock_auth_headers, db_session):
        """Verify breakdown elements context is injected into the AI system prompt."""
        project = self._create_test_project(client, mock_auth_headers)
        project_id = project["id"]

        captured_messages = []

        async def mock_stream(*args, **kwargs):
            captured_messages.append(kwargs.get("messages") or (args[0] if args else []))
            for chunk in ["Test response about elements"]:
                yield chunk

        with patch(
            "app.api.endpoints.breakdown_chat.chat_completion_stream",
            side_effect=mock_stream,
        ):
            resp = client.post(
                f"/api/breakdown-chat/{project_id}/stream",
                json={
                    "content": "Tell me about my characters",
                    "message_history": [],
                    "shots_context": [],
                    "elements_context": [
                        {
                            "id": "elem-1",
                            "category": "character",
                            "name": "John",
                            "description": "Protagonist",
                        }
                    ],
                },
                headers=mock_auth_headers,
            )

        assert resp.status_code == 200

        # Verify the system prompt contains the element data
        assert len(captured_messages) == 1
        messages = captured_messages[0]
        system_prompt = messages[0]["content"]
        assert "John" in system_prompt
        assert "character" in system_prompt.lower()

    def test_stream_returns_sse_chunks(self, client, mock_auth_headers, db_session):
        """Verify the SSE response contains proper chunk and done events."""
        project = self._create_test_project(client, mock_auth_headers)
        project_id = project["id"]

        async def mock_stream(*args, **kwargs):
            for chunk in ["Hello ", "World"]:
                yield chunk

        with patch(
            "app.api.endpoints.breakdown_chat.chat_completion_stream",
            side_effect=mock_stream,
        ):
            resp = client.post(
                f"/api/breakdown-chat/{project_id}/stream",
                json={
                    "content": "Hello",
                    "message_history": [],
                    "shots_context": [],
                    "elements_context": [],
                },
                headers=mock_auth_headers,
            )

        assert resp.status_code == 200
        raw_text = resp.text

        # Verify SSE chunks
        assert 'data: {"chunk": "Hello "}' in raw_text
        assert 'data: {"chunk": "World"}' in raw_text
        assert '"done": true' in raw_text
        assert "[DONE]" in raw_text

    def test_shot_create_action(self, client, mock_auth_headers, db_session):
        """CHAT-04: AI can create shots. Verify shot_action in done event."""
        project = self._create_test_project(client, mock_auth_headers)
        project_id = project["id"]

        async def mock_stream(*args, **kwargs):
            yield "I'll create a close-up shot for you."

        # Mock extraction to return a create action
        mock_action = {
            "type": "create",
            "data": {
                "scene_item_id": None,
                "shot_number": 1,
                "fields": {"shot_size": "CU", "description": "Close-up of protagonist"},
            },
        }

        with patch(
            "app.api.endpoints.breakdown_chat.chat_completion_stream",
            side_effect=mock_stream,
        ):
            with patch(
                "app.api.endpoints.breakdown_chat.chat_completion",
                new_callable=AsyncMock,
                return_value=json.dumps({"action": mock_action}),
            ):
                resp = client.post(
                    f"/api/breakdown-chat/{project_id}/stream",
                    json={
                        "content": "Create a close-up shot",
                        "message_history": [],
                        "shots_context": [],
                        "elements_context": [],
                    },
                    headers=mock_auth_headers,
                )

        assert resp.status_code == 200
        text = resp.text
        # Parse the done event to verify shot_action
        for line in text.split("\n"):
            if line.startswith("data: ") and "done" in line:
                try:
                    payload = json.loads(line[6:])
                    if payload.get("done"):
                        assert payload["shot_action"] is not None
                        assert payload["shot_action"]["type"] == "create"
                        assert payload["shot_action"]["data"]["fields"]["shot_size"] == "CU"
                        break
                except json.JSONDecodeError:
                    continue
        else:
            pytest.fail("No done event with shot_action found in SSE stream")

    def test_shot_modify_action(self, client, mock_auth_headers, db_session):
        """CHAT-05: AI can modify shots. Verify shot_action in done event."""
        project = self._create_test_project(client, mock_auth_headers)
        project_id = project["id"]

        async def mock_stream(*args, **kwargs):
            yield "I'll change the camera angle to low angle."

        mock_action = {
            "type": "modify",
            "shot_id": "existing-shot-id",
            "data": {"fields": {"camera_angle": "Low Angle"}},
        }

        with patch(
            "app.api.endpoints.breakdown_chat.chat_completion_stream",
            side_effect=mock_stream,
        ):
            with patch(
                "app.api.endpoints.breakdown_chat.chat_completion",
                new_callable=AsyncMock,
                return_value=json.dumps({"action": mock_action}),
            ):
                resp = client.post(
                    f"/api/breakdown-chat/{project_id}/stream",
                    json={
                        "content": "Change shot 1 to low angle",
                        "message_history": [],
                        "shots_context": [
                            {
                                "id": "existing-shot-id",
                                "shot_number": 1,
                                "scene_item_id": None,
                                "fields": {"camera_angle": "Eye Level"},
                                "source": "user",
                            }
                        ],
                        "elements_context": [],
                    },
                    headers=mock_auth_headers,
                )

        assert resp.status_code == 200
        text = resp.text
        for line in text.split("\n"):
            if line.startswith("data: ") and "done" in line:
                try:
                    payload = json.loads(line[6:])
                    if payload.get("done"):
                        assert payload["shot_action"] is not None
                        assert payload["shot_action"]["type"] == "modify"
                        assert payload["shot_action"]["shot_id"] == "existing-shot-id"
                        assert payload["shot_action"]["data"]["fields"]["camera_angle"] == "Low Angle"
                        break
                except json.JSONDecodeError:
                    continue
        else:
            pytest.fail("No done event with shot_action found in SSE stream")
