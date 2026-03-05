"""GitHub API service for reading and writing files in a repository."""
import base64
import httpx


class GitHubService:
    """
    Async client for the GitHub Contents API.

    Supports reading and committing a single file via a fine-grained
    Personal Access Token (PAT) that has Contents: read+write on the
    configured repository.

    Per-call AsyncClient — no shared state between requests.
    """

    def __init__(self, token: str, repo: str, branch: str = "main") -> None:
        self.repo = repo
        self.branch = branch
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def get_file(self, path: str) -> dict:
        """
        Fetch a file from GitHub and return decoded content + metadata.

        Args:
            path: Exact file path within the repo (e.g. "backend/Dockerfile").

        Returns:
            {"content": str, "sha": str, "path": str}

        Raises:
            httpx.HTTPStatusError: If GitHub returns 4xx/5xx.
        """
        url = f"https://api.github.com/repos/{self.repo}/contents/{path}"
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                params={"ref": self.branch},
                headers=self.headers,
            )
            response.raise_for_status()
            data = response.json()

        # GitHub returns content as base64 with possible newlines
        raw_content = data["content"].replace("\n", "").replace(" ", "")
        decoded = base64.b64decode(raw_content).decode("utf-8")
        return {
            "content": decoded,
            "sha": data["sha"],
            "path": data["path"],
        }

    async def update_file(
        self,
        path: str,
        content: str,
        sha: str,
        message: str,
    ) -> dict:
        """
        Commit new content for a file via GitHub Contents API (PUT).

        Args:
            path:    Exact file path within the repo.
            content: New file content (plain UTF-8 text).
            sha:     Current blob SHA — must match HEAD or GitHub returns 409.
            message: Git commit message.

        Returns:
            Full GitHub API response JSON (contains commit.sha, content.path, …).

        Raises:
            httpx.HTTPStatusError: If GitHub returns 4xx/5xx (including 409 conflict).
        """
        url = f"https://api.github.com/repos/{self.repo}/contents/{path}"
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")
        payload = {
            "message": message,
            "content": encoded_content,
            "sha": sha,
            "branch": self.branch,
        }
        async with httpx.AsyncClient() as client:
            response = await client.put(
                url,
                json=payload,
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()
