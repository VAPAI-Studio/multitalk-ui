"""Thin HTTP client wrapping the sideOUTsticks REST API for the MCP server.

Uses the platform's existing X-API-Key auth (see core/auth.py). No new auth
code is needed on the backend — every endpoint already accepts API keys
issued by /api/api-keys/generate.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx


DEFAULT_BASE_URL = "https://api.vapai.studio"  # override via SOUTSTICKS_BASE_URL
DEFAULT_TIMEOUT = 60.0


class ApiError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"[{status}] {detail}")
        self.status = status
        self.detail = detail


class SideoutClient:
    """Async HTTP client that forwards the user's API key on every request."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        comfy_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key or os.environ.get("SOUTSTICKS_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "SOUTSTICKS_API_KEY is not set. Generate one in the app "
                "(Settings → API Keys) and export it before running the MCP server."
            )

        self.base_url = (base_url or os.environ.get("SOUTSTICKS_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        # The ComfyUI endpoint the user's jobs should run against. Agents can
        # override per-call, but most users have a single preferred one.
        self.comfy_url = comfy_url or os.environ.get("SOUTSTICKS_COMFY_URL") or ""
        self._http = httpx.AsyncClient(
            timeout=timeout,
            headers={"X-API-Key": self.api_key},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # --- low-level -------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self.base_url}/api{path}"
        resp = await self._http.request(method, url, **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise ApiError(resp.status_code, str(detail))
        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return resp.content

    # --- workflows -------------------------------------------------------

    async def list_workflows(self) -> dict:
        return await self._request("GET", "/comfyui/workflows")

    async def get_workflow_parameters(self, workflow_name: str) -> dict:
        return await self._request(
            "GET", f"/comfyui/workflows/{workflow_name}/parameters"
        )

    async def submit_workflow(
        self,
        workflow_name: str,
        parameters: dict,
        client_id: str,
        base_url: Optional[str] = None,
    ) -> dict:
        return await self._request(
            "POST",
            "/comfyui/submit-workflow",
            json={
                "workflow_name": workflow_name,
                "parameters": parameters,
                "client_id": client_id,
                "base_url": base_url or self.comfy_url,
            },
        )

    async def get_history(self, prompt_id: str, base_url: Optional[str] = None) -> dict:
        return await self._request(
            "GET",
            f"/comfyui/history/{prompt_id}",
            params={"base_url": base_url or self.comfy_url},
        )

    # --- uploads ---------------------------------------------------------

    async def upload_image(
        self,
        filename: str,
        data: bytes,
        base_url: Optional[str] = None,
    ) -> dict:
        files = {"image": (filename, data)}
        return await self._request(
            "POST",
            "/comfyui/upload-image",
            params={"base_url": base_url or self.comfy_url},
            files=files,
        )

    async def upload_audio(
        self,
        filename: str,
        data: bytes,
        base_url: Optional[str] = None,
    ) -> dict:
        files = {"audio": (filename, data)}
        return await self._request(
            "POST",
            "/comfyui/upload-audio",
            params={"base_url": base_url or self.comfy_url},
            files=files,
        )

    # --- feed ------------------------------------------------------------

    async def list_my_generations(self, limit: int = 20, offset: int = 0) -> dict:
        return await self._request(
            "GET",
            "/feed/unified",
            params={"limit": limit, "offset": offset},
        )
