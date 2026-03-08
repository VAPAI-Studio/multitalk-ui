"""
Tests for GitHubService and related infrastructure models/settings.
TDD RED phase — tests written before implementation.
"""
import sys
from pathlib import Path
import pytest
import base64
from unittest.mock import AsyncMock, MagicMock, patch

# Add backend to Python path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


class TestGitHubServiceImport:
    """Ensure GitHubService is importable from the expected module."""

    def test_github_service_importable(self):
        from services.github_service import GitHubService
        assert GitHubService is not None

    def test_github_service_is_class(self):
        from services.github_service import GitHubService
        assert isinstance(GitHubService, type)


class TestGitHubServiceInit:
    """Test __init__ sets correct headers and attributes."""

    def test_init_sets_repo(self):
        from services.github_service import GitHubService
        svc = GitHubService("token123", "owner/repo", "main")
        assert svc.repo == "owner/repo"

    def test_init_sets_branch(self):
        from services.github_service import GitHubService
        svc = GitHubService("token123", "owner/repo", "main")
        assert svc.branch == "main"

    def test_init_default_branch_is_main(self):
        from services.github_service import GitHubService
        svc = GitHubService("token123", "owner/repo")
        assert svc.branch == "main"

    def test_init_sets_authorization_header(self):
        from services.github_service import GitHubService
        svc = GitHubService("token123", "owner/repo")
        assert svc.headers.get("Authorization") == "Bearer token123"

    def test_init_sets_accept_header(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo")
        assert "application/vnd.github" in svc.headers.get("Accept", "")

    def test_init_sets_api_version_header(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo")
        assert svc.headers.get("X-GitHub-Api-Version") == "2022-11-28"


class TestGitHubServiceGetFile:
    """Test get_file async method."""

    @pytest.mark.asyncio
    async def test_get_file_returns_dict_with_content_sha_path(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo", "main")

        encoded = base64.b64encode(b"FROM python:3.11\n").decode()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "content": encoded + "\n",
            "sha": "abc123sha",
            "path": "backend/Dockerfile",
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.get_file("backend/Dockerfile")

        assert result["content"] == "FROM python:3.11\n"
        assert result["sha"] == "abc123sha"
        assert result["path"] == "backend/Dockerfile"

    @pytest.mark.asyncio
    async def test_get_file_calls_raise_for_status(self):
        from services.github_service import GitHubService
        import httpx

        svc = GitHubService("tok", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Not Found", request=MagicMock(), response=MagicMock(status_code=404)
        )

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await svc.get_file("missing/file")

    @pytest.mark.asyncio
    async def test_get_file_uses_correct_url(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "myorg/myrepo", "dev")

        encoded = base64.b64encode(b"content").decode()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "content": encoded,
            "sha": "sha1",
            "path": "path/to/file",
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await svc.get_file("path/to/file")

        call_args = mock_client.get.call_args
        called_url = call_args[0][0] if call_args[0] else call_args[1].get("url", "")
        assert "myorg/myrepo" in called_url
        assert "path/to/file" in called_url


class TestGitHubServiceUpdateFile:
    """Test update_file async method."""

    @pytest.mark.asyncio
    async def test_update_file_returns_response_json(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo", "main")

        expected_response = {
            "commit": {"sha": "newcommitsha123"},
            "content": {"path": "backend/Dockerfile"},
        }
        mock_response = MagicMock()
        mock_response.json.return_value = expected_response
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.put = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.update_file(
                "backend/Dockerfile",
                "FROM python:3.11\n",
                "abc123sha",
                "chore: update Dockerfile",
            )

        assert result == expected_response

    @pytest.mark.asyncio
    async def test_update_file_base64_encodes_content(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.json.return_value = {"commit": {"sha": "sha"}}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.put = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await svc.update_file(
                "Dockerfile", "FROM ubuntu:22.04\n", "sha123", "test commit"
            )

        call_json = mock_client.put.call_args[1].get("json", {})
        if not call_json:
            # positional or keyword
            call_json = mock_client.put.call_args[0][1] if len(mock_client.put.call_args[0]) > 1 else {}
        # The content in the PUT body should be base64-encoded
        expected_b64 = base64.b64encode(b"FROM ubuntu:22.04\n").decode()
        assert call_json.get("content") == expected_b64

    @pytest.mark.asyncio
    async def test_update_file_calls_raise_for_status(self):
        from services.github_service import GitHubService
        import httpx

        svc = GitHubService("tok", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Conflict",
            request=MagicMock(),
            response=MagicMock(status_code=409),
        )

        mock_client = AsyncMock()
        mock_client.put = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await svc.update_file(
                    "Dockerfile", "content", "stale_sha", "commit msg"
                )


class TestSettingsGitHubFields:
    """Test Settings class has the required GitHub fields."""

    def test_settings_has_github_token(self):
        from config.settings import settings
        assert hasattr(settings, "GITHUB_TOKEN")

    def test_settings_github_token_default_empty(self):
        from config.settings import settings
        assert settings.GITHUB_TOKEN == ""

    def test_settings_has_github_repo(self):
        from config.settings import settings
        assert hasattr(settings, "GITHUB_REPO")

    def test_settings_github_repo_default_empty(self):
        from config.settings import settings
        assert settings.GITHUB_REPO == ""

    def test_settings_has_github_branch(self):
        from config.settings import settings
        assert hasattr(settings, "GITHUB_BRANCH")

    def test_settings_github_branch_default_main(self):
        from config.settings import settings
        assert settings.GITHUB_BRANCH == "main"

    def test_settings_has_github_dockerfile_path(self):
        from config.settings import settings
        assert hasattr(settings, "GITHUB_DOCKERFILE_PATH")

    def test_settings_github_dockerfile_path_default_empty(self):
        from config.settings import settings
        assert settings.GITHUB_DOCKERFILE_PATH == ""


class TestInfrastructureModels:
    """Test DockerfileContent and DockerfileSaveRequest Pydantic models."""

    def test_dockerfile_content_importable(self):
        from models.infrastructure import DockerfileContent
        assert DockerfileContent is not None

    def test_dockerfile_save_request_importable(self):
        from models.infrastructure import DockerfileSaveRequest
        assert DockerfileSaveRequest is not None

    def test_dockerfile_content_fields(self):
        from models.infrastructure import DockerfileContent
        obj = DockerfileContent(
            path="backend/Dockerfile",
            content="FROM python:3.11\n",
            sha="abc123",
        )
        assert obj.path == "backend/Dockerfile"
        assert obj.content == "FROM python:3.11\n"
        assert obj.sha == "abc123"

    def test_dockerfile_save_request_fields(self):
        from models.infrastructure import DockerfileSaveRequest
        obj = DockerfileSaveRequest(
            content="FROM python:3.11\n",
            sha="abc123",
            commit_message="chore: update Dockerfile",
        )
        assert obj.content == "FROM python:3.11\n"
        assert obj.sha == "abc123"
        assert obj.commit_message == "chore: update Dockerfile"

    def test_dockerfile_save_request_requires_commit_message(self):
        from models.infrastructure import DockerfileSaveRequest
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            DockerfileSaveRequest(content="x", sha="y")

    def test_dockerfile_save_request_trigger_deploy_defaults_false(self):
        from models.infrastructure import DockerfileSaveRequest
        obj = DockerfileSaveRequest(
            content="FROM python:3.11\n",
            sha="abc123",
            commit_message="chore: update Dockerfile",
        )
        assert obj.trigger_deploy is False

    def test_dockerfile_save_request_trigger_deploy_accepts_true(self):
        from models.infrastructure import DockerfileSaveRequest
        obj = DockerfileSaveRequest(
            content="FROM python:3.11\n",
            sha="abc123",
            commit_message="chore: update Dockerfile",
            trigger_deploy=True,
        )
        assert obj.trigger_deploy is True


class TestGitHubServiceCreateRelease:
    """Test create_release async method."""

    @pytest.mark.asyncio
    async def test_create_release_sends_post_with_correct_payload(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo", "main")

        expected_response = {
            "id": 1,
            "tag_name": "deploy-20260308-143022",
            "html_url": "https://github.com/owner/repo/releases/tag/deploy-20260308-143022",
            "name": "Deploy 20260308-143022",
            "body": "chore: update Dockerfile",
        }
        mock_response = MagicMock()
        mock_response.json.return_value = expected_response
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.create_release(
                tag_name="deploy-20260308-143022",
                target_commitish="abc123sha",
                name="Deploy 20260308-143022",
                body="chore: update Dockerfile",
            )

        # Verify the POST payload
        call_kwargs = mock_client.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert payload["tag_name"] == "deploy-20260308-143022"
        assert payload["target_commitish"] == "abc123sha"
        assert payload["name"] == "Deploy 20260308-143022"
        assert payload["body"] == "chore: update Dockerfile"
        assert payload["draft"] is False
        assert payload["prerelease"] is False

    @pytest.mark.asyncio
    async def test_create_release_returns_full_json_response(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "owner/repo", "main")

        expected_response = {
            "id": 42,
            "tag_name": "deploy-20260308-150000",
            "html_url": "https://github.com/owner/repo/releases/tag/deploy-20260308-150000",
        }
        mock_response = MagicMock()
        mock_response.json.return_value = expected_response
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await svc.create_release(
                tag_name="deploy-20260308-150000",
                target_commitish="def456",
                name="Deploy 20260308-150000",
            )

        assert result == expected_response

    @pytest.mark.asyncio
    async def test_create_release_calls_raise_for_status(self):
        from services.github_service import GitHubService
        import httpx

        svc = GitHubService("tok", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500),
        )

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await svc.create_release(
                    tag_name="deploy-test",
                    target_commitish="sha123",
                    name="Deploy test",
                )

    @pytest.mark.asyncio
    async def test_create_release_uses_auth_headers(self):
        from services.github_service import GitHubService
        svc = GitHubService("my-secret-token", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.json.return_value = {"id": 1, "tag_name": "v1"}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await svc.create_release(
                tag_name="v1",
                target_commitish="sha",
                name="Release v1",
            )

        call_kwargs = mock_client.post.call_args[1]
        headers = call_kwargs.get("headers", {})
        assert headers.get("Authorization") == "Bearer my-secret-token"

    @pytest.mark.asyncio
    async def test_create_release_422_duplicate_tag_raises(self):
        from services.github_service import GitHubService
        import httpx

        svc = GitHubService("tok", "owner/repo", "main")

        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.text = "Validation Failed"
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Validation Failed",
            request=MagicMock(),
            response=MagicMock(status_code=422, text="Validation Failed"),
        )

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await svc.create_release(
                    tag_name="existing-tag",
                    target_commitish="sha",
                    name="Duplicate",
                )

    @pytest.mark.asyncio
    async def test_create_release_posts_to_correct_url(self):
        from services.github_service import GitHubService
        svc = GitHubService("tok", "myorg/myrepo", "dev")

        mock_response = MagicMock()
        mock_response.json.return_value = {"id": 1, "tag_name": "v1"}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=mock_client):
            await svc.create_release(
                tag_name="v1",
                target_commitish="sha",
                name="Release",
            )

        call_args = mock_client.post.call_args
        called_url = call_args[0][0] if call_args[0] else call_args[1].get("url", "")
        assert "https://api.github.com/repos/myorg/myrepo/releases" == called_url
