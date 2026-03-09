"""
Universal RunPod ComfyUI Handler
---------------------------------
Deploy this alongside ComfyUI in a single RunPod serverless container.

Input format:
    {"input": {"workflow": { ...full ComfyUI workflow JSON... }}}

Output format:
    {"output": {"files": [{"filename": "...", "type": "image|video", "data": "<base64>", "mime_type": "..."}], "prompt_id": "..."}}

Architecture:
    - One RunPod endpoint handles ALL workflows (no per-workflow handlers needed)
    - Models live on the network volume (mounted via extra_model_paths.yaml)
    - Only custom node additions require a Dockerfile rebuild
    - ComfyUI runs on localhost:8188 inside the same container
"""

import runpod
import requests
import base64
import time
from typing import Dict, Any, List

COMFYUI_URL = "http://127.0.0.1:8188"
POLL_INTERVAL = 1.0           # seconds between history polls
COMFYUI_READY_TIMEOUT = 120   # seconds to wait for ComfyUI startup on cold starts
MAX_JOB_DURATION = 1800       # 30 minutes maximum per job


def wait_for_comfyui() -> None:
    """Poll /system_stats until ComfyUI is ready. Handles cold start race condition."""
    deadline = time.time() + COMFYUI_READY_TIMEOUT
    while time.time() < deadline:
        try:
            r = requests.get(f"{COMFYUI_URL}/system_stats", timeout=5)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"ComfyUI did not become ready within {COMFYUI_READY_TIMEOUT}s")


def submit_workflow(workflow: Dict[str, Any]) -> str:
    """POST workflow JSON to ComfyUI /prompt, return prompt_id."""
    r = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow},
        timeout=30
    )
    r.raise_for_status()
    data = r.json()
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {data}")
    return prompt_id


def poll_until_complete(prompt_id: str) -> Dict[str, Any]:
    """Poll /history/{prompt_id} until the job finishes. Returns outputs dict."""
    deadline = time.time() + MAX_JOB_DURATION
    while time.time() < deadline:
        r = requests.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=10)
        r.raise_for_status()
        history = r.json()
        if prompt_id in history:
            job = history[prompt_id]
            status = job.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                raise RuntimeError(f"ComfyUI execution error: {messages}")
            return job.get("outputs", {})
        time.sleep(POLL_INTERVAL)
    raise RuntimeError(f"Job {prompt_id} timed out after {MAX_JOB_DURATION}s")


def extract_outputs(outputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Walk all node outputs, download each file, return base64-encoded list.
    Handles 'images' (still frames) and 'gifs' (ComfyUI's key for video/MP4 outputs).
    """
    results = []
    for node_id, node_out in outputs.items():
        # Still images
        for img in node_out.get("images", []):
            params = {
                "filename": img["filename"],
                "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output"),
            }
            r = requests.get(f"{COMFYUI_URL}/view", params=params, timeout=60)
            r.raise_for_status()
            results.append({
                "node_id": node_id,
                "filename": img["filename"],
                "type": "image",
                "data": base64.b64encode(r.content).decode("utf-8"),
                "mime_type": "image/png",
            })

        # Videos and GIFs (ComfyUI uses the "gifs" key for all video outputs including MP4)
        for vid in node_out.get("gifs", []):
            params = {
                "filename": vid["filename"],
                "subfolder": vid.get("subfolder", ""),
                "type": vid.get("type", "output"),
            }
            r = requests.get(f"{COMFYUI_URL}/view", params=params, timeout=120)
            r.raise_for_status()
            ext = vid["filename"].rsplit(".", 1)[-1].lower()
            mime = "video/mp4" if ext == "mp4" else f"video/{ext}"
            results.append({
                "node_id": node_id,
                "filename": vid["filename"],
                "type": "video",
                "data": base64.b64encode(r.content).decode("utf-8"),
                "mime_type": mime,
            })

    return results


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    """RunPod serverless entry point."""
    try:
        input_data = event.get("input", {})
        workflow = input_data.get("workflow")
        if not workflow:
            return {"error": "Missing 'workflow' in input. Expected: {'input': {'workflow': {...}}}", "status": "FAILED"}

        wait_for_comfyui()
        prompt_id = submit_workflow(workflow)
        outputs = poll_until_complete(prompt_id)
        files = extract_outputs(outputs)

        return {
            "output": {
                "files": files,
                "prompt_id": prompt_id,
            },
            "status": "COMPLETED",
        }
    except Exception as e:
        return {"error": str(e), "status": "FAILED"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
