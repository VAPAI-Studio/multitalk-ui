---
name: sideoutsticks
description: Control sideOUTsticks AI generation platform — submit workflows, check jobs, browse generations
---

# sideOUTsticks API

sideOUTsticks is an AI-powered video and image generation platform. Use this skill to submit ComfyUI workflows, check job status, and browse generation results.

## Authentication

All requests require the `X-API-Key` header. The user generates their API key from the Profile Settings page in the web app.

```bash
export SOUT_API_KEY="sout_your_key_here"
```

Every request must include:
```
X-API-Key: $SOUT_API_KEY
```

## Base URL

The API base URL depends on the deployment:
- Local development: `http://localhost:8000/api`
- Production: check with user (typically a Heroku URL at `/api`)

## Available Workflows

### List all workflows

```bash
curl -H "X-API-Key: $SOUT_API_KEY" $SOUT_BASE_URL/comfyui/workflows
```

Returns: `{ "success": true, "workflows": { "WorkflowName": "description", ... } }`

### Get workflow parameters

```bash
curl -H "X-API-Key: $SOUT_API_KEY" $SOUT_BASE_URL/comfyui/workflows/VideoLipsync/parameters
```

Returns: `{ "success": true, "parameters": ["PARAM_1", "PARAM_2", ...] }`

## Submit a Workflow

```bash
curl -X POST \
  -H "X-API-Key: $SOUT_API_KEY" \
  -H "Content-Type: application/json" \
  $SOUT_BASE_URL/comfyui/submit-workflow \
  -d '{
    "workflow_name": "VideoLipsync",
    "parameters": {
      "VIDEO_FILENAME": "video.mp4",
      "AUDIO_FILENAME": "audio.wav",
      "WIDTH": 640,
      "HEIGHT": 360
    },
    "client_id": "openclaw-session-123",
    "base_url": "https://comfy.vapai.studio"
  }'
```

Returns: `{ "success": true, "prompt_id": "abc-123", "workflow_name": "VideoLipsync" }`

**Important:** `base_url` is the ComfyUI server URL, not the app URL. Ask the user for their ComfyUI server address.

### Common workflows

| Workflow Name | Purpose | Key Parameters |
|---|---|---|
| `VideoLipsync` | Add lip-sync to video | VIDEO_FILENAME, AUDIO_FILENAME, WIDTH, HEIGHT |
| `WANI2V` | Image to video | IMAGE_BASE64, PROMPT, WIDTH, HEIGHT, NUM_FRAMES |
| `NanoBanana` | Image editing | IMAGE_BASE64, PROMPT |
| `StyleTransfer` | Style transfer | CONTENT_IMAGE, STYLE_REFERENCE, PROMPT |

Always call the parameters endpoint first to get the exact required parameters for any workflow.

## Upload Files to ComfyUI

Before submitting workflows that reference filenames, upload files to ComfyUI:

### Upload image
```bash
curl -X POST \
  -H "X-API-Key: $SOUT_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  $SOUT_BASE_URL/comfyui/upload-image \
  -F "file=@/path/to/image.png" \
  -F "base_url=https://comfy.vapai.studio"
```

### Upload audio
```bash
curl -X POST \
  -H "X-API-Key: $SOUT_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  $SOUT_BASE_URL/comfyui/upload-audio \
  -F "file=@/path/to/audio.wav" \
  -F "base_url=https://comfy.vapai.studio"
```

## Check Job Status

### Video jobs
```bash
curl -H "X-API-Key: $SOUT_API_KEY" $SOUT_BASE_URL/video-jobs/{job_id}
```

### Image jobs
```bash
curl -H "X-API-Key: $SOUT_API_KEY" $SOUT_BASE_URL/image-jobs/{job_id}
```

Job statuses: `pending`, `processing`, `completed`, `failed`

## Browse Generations

### Unified feed (all types)
```bash
curl -H "X-API-Key: $SOUT_API_KEY" \
  "$SOUT_BASE_URL/feed/unified?limit=10&completed_only=true"
```

### Filter by type
```bash
# Videos only
curl -H "X-API-Key: $SOUT_API_KEY" \
  "$SOUT_BASE_URL/feed/unified?types=video&limit=10"

# Images only
curl -H "X-API-Key: $SOUT_API_KEY" \
  "$SOUT_BASE_URL/feed/unified?types=image&limit=10"
```

## Typical Workflow

1. **List workflows** to see what's available
2. **Get parameters** for the chosen workflow
3. **Upload files** to ComfyUI if needed (images, audio, video)
4. **Submit workflow** with the right parameters
5. **Poll job status** until `completed` or `failed`
6. **Get output URLs** from the completed job response

## Error Handling

- `401 Unauthorized` — Invalid or revoked API key
- `400 Bad Request` — Missing required parameters or invalid workflow name
- `404 Not Found` — Job or workflow not found
- `500 Internal Server Error` — Server-side error

## Installation

Copy this skill to your OpenClaw skills directory:

```bash
mkdir -p ~/.openclaw/skills/sideoutsticks
cp SKILL.md ~/.openclaw/skills/sideoutsticks/SKILL.md
```

Configure in `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "sideoutsticks": {
        "enabled": true,
        "env": {
          "SOUT_API_KEY": "sout_your_key_here",
          "SOUT_BASE_URL": "http://localhost:8000/api"
        }
      }
    }
  }
}
```
