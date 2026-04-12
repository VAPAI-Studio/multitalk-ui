"""sideOUTsticks MCP server (stdio transport).

Exposes a minimal v1 tool surface so agents can:
  1. Discover available workflows and their parameters
  2. Upload input media
  3. Submit a workflow and poll its status
  4. Browse the authenticated user's generation history

Run locally:
    export SOUTSTICKS_API_KEY=sout_...
    export SOUTSTICKS_COMFY_URL=https://comfy.vapai.studio
    python -m backend.mcp.server

Register with Claude Desktop / Cursor / etc. as a stdio MCP server.
"""
from __future__ import annotations

import asyncio
import base64
import random
import string
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .client import ApiError, SideoutClient


server: Server = Server("sideoutsticks")
_client: SideoutClient | None = None


def _get_client() -> SideoutClient:
    global _client
    if _client is None:
        _client = SideoutClient()
    return _client


def _client_id() -> str:
    return "mcp-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


# --- tool definitions --------------------------------------------------

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="list_workflows",
            description=(
                "List all available AI workflow templates on the sideOUTsticks "
                "platform (e.g. VideoLipsync, WANI2V, StyleTransfer)."
            ),
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="get_workflow_parameters",
            description=(
                "Return the required parameter names for a specific workflow. "
                "Call this before submit_workflow to know what to pass."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_name": {"type": "string"},
                },
                "required": ["workflow_name"],
            },
        ),
        Tool(
            name="upload_image",
            description=(
                "Upload an image to the user's ComfyUI server. Returns the "
                "filename to reference in workflow parameters."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "data_base64": {
                        "type": "string",
                        "description": "Base64-encoded image bytes.",
                    },
                },
                "required": ["filename", "data_base64"],
            },
        ),
        Tool(
            name="upload_audio",
            description=(
                "Upload an audio file to the user's ComfyUI server. Returns "
                "the filename to reference in workflow parameters."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "data_base64": {"type": "string"},
                },
                "required": ["filename", "data_base64"],
            },
        ),
        Tool(
            name="submit_workflow",
            description=(
                "Submit a workflow for execution. Returns a prompt_id. Use "
                "get_job_status to poll for completion."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "workflow_name": {"type": "string"},
                    "parameters": {
                        "type": "object",
                        "description": (
                            "Workflow-specific parameters. Shape depends on "
                            "the workflow — call get_workflow_parameters first."
                        ),
                    },
                },
                "required": ["workflow_name", "parameters"],
            },
        ),
        Tool(
            name="get_job_status",
            description=(
                "Check the status of a submitted job. Returns ComfyUI history "
                "which includes node outputs (images/videos) when complete."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt_id": {"type": "string"},
                },
                "required": ["prompt_id"],
            },
        ),
        Tool(
            name="wait_for_job",
            description=(
                "Poll a job until it completes or times out. Use for short "
                "jobs; for long ones, prefer get_job_status."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt_id": {"type": "string"},
                    "timeout_seconds": {"type": "integer", "default": 300},
                    "poll_interval_seconds": {"type": "integer", "default": 5},
                },
                "required": ["prompt_id"],
            },
        ),
        Tool(
            name="list_my_generations",
            description=(
                "List the authenticated user's recent generations across all "
                "features (videos, images, worlds)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 20},
                    "offset": {"type": "integer", "default": 0},
                },
            },
        ),
    ]


# --- tool dispatch -----------------------------------------------------

@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    client = _get_client()
    try:
        result = await _dispatch(client, name, arguments)
    except ApiError as e:
        return [TextContent(type="text", text=f"API error: {e}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Unexpected error: {e!r}")]
    return [TextContent(type="text", text=_format_json(result))]


async def _dispatch(client: SideoutClient, name: str, args: dict[str, Any]) -> Any:
    if name == "list_workflows":
        return await client.list_workflows()

    if name == "get_workflow_parameters":
        return await client.get_workflow_parameters(args["workflow_name"])

    if name == "upload_image":
        data = base64.b64decode(args["data_base64"])
        return await client.upload_image(args["filename"], data)

    if name == "upload_audio":
        data = base64.b64decode(args["data_base64"])
        return await client.upload_audio(args["filename"], data)

    if name == "submit_workflow":
        return await client.submit_workflow(
            workflow_name=args["workflow_name"],
            parameters=args["parameters"],
            client_id=_client_id(),
        )

    if name == "get_job_status":
        return await client.get_history(args["prompt_id"])

    if name == "wait_for_job":
        return await _wait_for_job(
            client,
            prompt_id=args["prompt_id"],
            timeout=args.get("timeout_seconds", 300),
            interval=args.get("poll_interval_seconds", 5),
        )

    if name == "list_my_generations":
        return await client.list_my_generations(
            limit=args.get("limit", 20),
            offset=args.get("offset", 0),
        )

    raise ValueError(f"Unknown tool: {name}")


async def _wait_for_job(
    client: SideoutClient, *, prompt_id: str, timeout: int, interval: int
) -> dict:
    elapsed = 0
    while elapsed < timeout:
        history = await client.get_history(prompt_id)
        entry = (history.get("history") or {}).get(prompt_id)
        if entry and entry.get("status", {}).get("completed"):
            return {"status": "completed", "history": entry}
        await asyncio.sleep(interval)
        elapsed += interval
    return {"status": "timeout", "prompt_id": prompt_id, "elapsed_seconds": elapsed}


def _format_json(value: Any) -> str:
    import json

    try:
        return json.dumps(value, indent=2, default=str)
    except Exception:
        return str(value)


# --- entrypoint --------------------------------------------------------

async def main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
