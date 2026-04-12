"""
ShotStream Service — thin HTTP client for the local ShotStream daemon.

DESIGN
======
ShotStream is not a ComfyUI node: it is a standalone PyTorch model from
KlingAIResearch (https://github.com/KlingAIResearch/ShotStream). We run it
as an independent FastAPI/Flask process on the same GPU host as ComfyUI
(different port, e.g. 9100). This service is a thin async proxy.

This is also the first non-ComfyUI feature in this backend and intentionally
does NOT depend on WorkflowService, ComfyUIService, or the `video_jobs` table.
Once the pattern settles, a generic ExecutionProvider abstraction will fold
ComfyUI, RunPod and ShotStream under the same interface (see TODO in CLAUDE.md).

EXPECTED CONTRACT OF THE LOCAL SHOTSTREAM SERVICE
-------------------------------------------------
POST   {SHOTSTREAM_SERVICE_URL}/generate
       body: ShotStreamSubmitRequest (as JSON)
       resp: {"job_id": "<uuid>"}

GET    {SHOTSTREAM_SERVICE_URL}/jobs/{job_id}
       resp: {
         "status": "queued"|"running"|"completed"|"failed"|"cancelled",
         "progress": 0.0..1.0,           # optional
         "output_url": "http://...",     # present when completed
         "error": "..."                  # present when failed
       }

POST   {SHOTSTREAM_SERVICE_URL}/jobs/{job_id}/cancel
       resp: {"cancelled": true}

GET    {SHOTSTREAM_SERVICE_URL}/health
       resp: {"status": "ok", "device": "cuda:0"}

The reference implementation of this daemon lives outside this repo (it
bundles the Wan2.1 + ShotStream weights). See the project docs for how to
run it locally alongside ComfyUI.
"""

from typing import Any, Dict, Optional, Tuple

import httpx

from config.settings import settings


class ShotStreamService:
    """Proxy to a locally-hosted ShotStream daemon."""

    def __init__(self, service_url: Optional[str] = None, timeout: Optional[int] = None):
        self.service_url = (service_url or settings.SHOTSTREAM_SERVICE_URL).rstrip("/")
        self.timeout = timeout or settings.SHOTSTREAM_TIMEOUT

    # -- internal helpers --------------------------------------------------

    def _ensure_configured(self) -> Optional[str]:
        """Return an error string if misconfigured, None otherwise."""
        if not settings.ENABLE_SHOTSTREAM:
            return "ShotStream is disabled. Set ENABLE_SHOTSTREAM=true."
        if not self.service_url:
            return (
                "ShotStream service URL not configured. "
                "Set SHOTSTREAM_SERVICE_URL to the local daemon (e.g. http://127.0.0.1:9100)."
            )
        return None

    # -- public API --------------------------------------------------------

    async def submit(self, payload: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """Submit a generation job. Returns (success, job_id, error)."""
        err = self._ensure_configured()
        if err:
            return False, None, err

        url = f"{self.service_url}/generate"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                job_id = data.get("job_id")
                if not job_id:
                    return False, None, "ShotStream did not return a job_id"
                return True, job_id, None
        except httpx.TimeoutException:
            return False, None, "ShotStream submit timed out"
        except httpx.HTTPStatusError as e:
            return False, None, _format_http_error(e)
        except httpx.RequestError as e:
            return False, None, f"ShotStream unreachable: {e}"
        except Exception as e:
            return False, None, f"Unexpected ShotStream error: {e}"

    async def status(self, job_id: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Get job status. Returns (success, data_dict, error)."""
        err = self._ensure_configured()
        if err:
            return False, None, err

        url = f"{self.service_url}/jobs/{job_id}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return True, resp.json(), None
        except httpx.TimeoutException:
            return False, None, "ShotStream status timed out"
        except httpx.HTTPStatusError as e:
            return False, None, _format_http_error(e)
        except httpx.RequestError as e:
            return False, None, f"ShotStream unreachable: {e}"
        except Exception as e:
            return False, None, f"Unexpected ShotStream error: {e}"

    async def cancel(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """Cancel a job. Returns (success, error)."""
        err = self._ensure_configured()
        if err:
            return False, err

        url = f"{self.service_url}/jobs/{job_id}/cancel"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url)
                resp.raise_for_status()
                return True, None
        except httpx.TimeoutException:
            return False, "ShotStream cancel timed out"
        except httpx.HTTPStatusError as e:
            return False, _format_http_error(e)
        except httpx.RequestError as e:
            return False, f"ShotStream unreachable: {e}"
        except Exception as e:
            return False, f"Unexpected ShotStream error: {e}"

    async def health(self) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """Check local service health. Returns (reachable, data_dict, error)."""
        if not self.service_url:
            return False, None, "SHOTSTREAM_SERVICE_URL not configured"

        url = f"{self.service_url}/health"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return True, resp.json(), None
        except httpx.TimeoutException:
            return False, None, "ShotStream health check timed out"
        except httpx.HTTPStatusError as e:
            return False, None, _format_http_error(e)
        except httpx.RequestError as e:
            return False, None, f"ShotStream unreachable: {e}"
        except Exception as e:
            return False, None, f"Unexpected ShotStream error: {e}"


def _format_http_error(e: httpx.HTTPStatusError) -> str:
    msg = f"ShotStream HTTP {e.response.status_code}"
    try:
        body = e.response.json()
        if isinstance(body, dict) and "error" in body:
            msg += f": {body['error']}"
    except Exception:
        pass
    return msg
