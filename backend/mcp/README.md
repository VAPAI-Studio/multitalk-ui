# sideOUTsticks MCP Server

Expose the sideOUTsticks platform to MCP-aware agents (Claude Desktop, Cursor,
custom SDK agents, etc.) using the **same API keys** users already generate in
the app (Settings → API Keys).

## How auth works

The platform already supports `X-API-Key` auth on every endpoint (see
`backend/core/auth.py`). Keys are prefixed `sout_`, SHA-256 hashed server-side,
per-user, revocable. The MCP server reads one key from the environment and
forwards it on every HTTP call — no new auth path, no service accounts.

## Setup

```bash
pip install -r backend/mcp/requirements.txt

export SOUTSTICKS_API_KEY=sout_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export SOUTSTICKS_BASE_URL=https://api.vapai.studio       # optional, defaults to prod
export SOUTSTICKS_COMFY_URL=https://comfy.vapai.studio    # user's ComfyUI endpoint
```

## Run (stdio)

```bash
python -m backend.mcp.server
```

## Register with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sideoutsticks": {
      "command": "python",
      "args": ["-m", "backend.mcp.server"],
      "cwd": "/path/to/multitalk-ui",
      "env": {
        "SOUTSTICKS_API_KEY": "sout_...",
        "SOUTSTICKS_COMFY_URL": "https://comfy.vapai.studio"
      }
    }
  }
}
```

## Tools (v1)

| Tool | Purpose |
|---|---|
| `list_workflows` | Discover available workflow templates |
| `get_workflow_parameters` | Get required params for a workflow |
| `upload_image` / `upload_audio` | Upload input media (base64) |
| `submit_workflow` | Queue a job, returns `prompt_id` |
| `get_job_status` | Poll a single job |
| `wait_for_job` | Server-side polling helper for short jobs |
| `list_my_generations` | Browse the user's feed |

## Typical agent flow

1. `list_workflows` → pick one (e.g. `VideoLipsync`)
2. `get_workflow_parameters` → learn it needs `VIDEO_FILENAME`, `AUDIO_FILENAME`, `WIDTH`, `HEIGHT`
3. `upload_image` + `upload_audio` → get filenames back
4. `submit_workflow` with those filenames + resolution → get `prompt_id`
5. `wait_for_job` or poll `get_job_status` → extract output URLs when complete

## Not in v1 (intentionally)

- Streaming progress events (poll is sufficient for now)
- Direct workflow JSON editing (foot-gun; templates only)
- Admin / user-management tools
- HTTP/SSE transport (stdio covers local agents; add later for hosted)

## Next steps

- Add rate limiting per API key on the backend (the key is enough to identify
  the user, so limits should live there rather than in the MCP server)
- Consider a `create_upload_url` tool that returns a Supabase pre-signed URL
  for large files, so agents don't have to base64 big blobs through MCP
- Add a workflow-specific tool layer on top of the generic `submit_workflow`
  (e.g. `lipsync_video`, `style_transfer`) once the generic path is proven
