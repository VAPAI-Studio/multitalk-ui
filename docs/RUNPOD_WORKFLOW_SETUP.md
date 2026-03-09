# RunPod Workflow Setup Guide

Complete guide to deploying ComfyUI workflows to RunPod serverless using pre-converted handlers.

## Overview

This project supports dual execution backends:
- **ComfyUI (Local)**: Self-hosted ComfyUI server (default)
- **RunPod (Cloud)**: Serverless ComfyUI execution with auto-scaling

Each workflow is deployed as a separate RunPod endpoint with its own optimized handler.

## Prerequisites

1. **RunPod Account**: Sign up at https://www.runpod.io/
2. **API Key**: Get from https://www.runpod.io/console/user/settings
3. **Network Volume**: Create a persistent storage volume with ComfyUI models
4. **Workflow JSONs**: Export workflows from ComfyUI (stored in `backend/workflows/`)

## Step-by-Step Workflow Deployment

### Step 1: Export Workflow from ComfyUI

1. Open your workflow in ComfyUI
2. Click "Save" or "Export" to get the workflow JSON
3. Copy the JSON to `backend/workflows/YourWorkflow.json`
4. Example: `backend/workflows/VideoLipsync.json`

### Step 2: Convert Workflow to RunPod Handler

1. **Go to** https://comfy.getrunpod.io/

2. **Upload** your workflow JSON:
   ```
   Click "Choose File" → Select backend/workflows/VideoLipsync.json
   ```

3. **Configure** parameters (optional):
   - Input nodes: Specify which nodes receive runtime parameters
   - Output nodes: Specify which nodes produce results
   - File handling: Choose how to handle input/output files

4. **Generate Handler**:
   ```
   Click "Generate Handler" button
   Downloads: handler.py
   ```

5. **Review** the generated `handler.py`:
   ```python
   # The handler will have your workflow embedded
   # and parameter substitution logic auto-generated
   def handler(event):
       input_params = event['input']
       # ... workflow execution ...
       return {"output": results}
   ```

### Step 3: Deploy to RunPod Serverless

#### Option A: Using RunPod Web UI

1. **Go to** https://www.runpod.io/console/serverless

2. **Create New Endpoint**:
   ```
   Name: comfyui-videolipsync
   GPU: A4000 or better (depends on workflow)
   Container Image: runpod/worker-comfyui:latest
   ```

3. **Configure Network Volume**:
   ```
   Attach your Network Volume with ComfyUI models
   Volume Path: /runpod-volume
   ```

4. **Upload Handler**:
   ```
   Upload the generated handler.py
   ```

5. **Set Environment Variables** (if needed):
   ```
   COMFYUI_MODELS_PATH=/runpod-volume/models
   ```

6. **Deploy**:
   ```
   Click "Deploy Endpoint"
   Wait for deployment to complete
   Copy the Endpoint ID (looks like: abc123xyz456)
   ```

#### Option B: Using RunPod CLI

```bash
# Install RunPod CLI
pip install runpod

# Login
runpod login

# Deploy endpoint
runpod create endpoint \
  --name comfyui-videolipsync \
  --handler handler.py \
  --gpu-type "NVIDIA RTX A4000" \
  --volume-id your-volume-id

# Get endpoint ID from output
```

### Step 4: Configure Backend

1. **Add to** `backend/.env`:
   ```bash
   # Enable RunPod
   ENABLE_RUNPOD=true

   # Global RunPod credentials
   RUNPOD_API_KEY=your-api-key-here

   # Workflow-specific endpoints (recommended)
   RUNPOD_ENDPOINT_VIDEOLIPSYNC=abc123xyz456
   RUNPOD_ENDPOINT_WAN_I2V=def789ghi012
   # ... add more as you deploy them

   # OR use a single fallback endpoint for all workflows
   RUNPOD_ENDPOINT_ID=your-default-endpoint-id
   ```

2. **Or configure per-workflow** in `backend/config/runpod_endpoints.py`:
   ```python
   RUNPOD_WORKFLOW_ENDPOINTS = {
       'VideoLipsync': 'abc123xyz456',
       'wan-i2v': 'def789ghi012',
       # ... etc
   }
   ```

### Step 5: Test the Integration

1. **Start backend**:
   ```bash
   cd backend
   source venv/bin/activate
   python -m uvicorn main:app --reload
   ```

2. **Check health**:
   ```bash
   curl http://localhost:8000/api/runpod/health

   # Should return:
   {
     "enabled": true,
     "configured": true
   }
   ```

3. **Test submission** (via frontend or API):
   ```bash
   curl -X POST http://localhost:8000/api/runpod/submit-workflow \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{
       "workflow_name": "VideoLipsync",
       "parameters": {
         "VIDEO_FILENAME": "test.mp4",
         "AUDIO_FILENAME": "test.wav",
         "WIDTH": 640,
         "HEIGHT": 360
       }
     }'
   ```

4. **Check status**:
   ```bash
   curl http://localhost:8000/api/runpod/status/JOB_ID
   ```

## Workflow Parameter Mapping

Each workflow has specific parameters. Here are common examples:

### VideoLipsync
```json
{
  "VIDEO_FILENAME": "input.mp4",
  "AUDIO_FILENAME": "audio.wav",
  "WIDTH": 640,
  "HEIGHT": 360
}
```

### WAN I2V
```json
{
  "IMAGE_FILENAME": "image.png",
  "PROMPT": "a woman walking",
  "WIDTH": 1280,
  "HEIGHT": 720,
  "NUM_FRAMES": 81
}
```

### Image Edit
```json
{
  "IMAGE_FILENAME": "photo.jpg",
  "PROMPT": "make the sky blue",
  "STRENGTH": 0.7
}
```

## Troubleshooting

### Workflow Not Found Error
```
Error: No RunPod endpoint configured for workflow 'VideoLipsync'
```

**Solution**: Add endpoint ID to `.env`:
```bash
RUNPOD_ENDPOINT_VIDEOLIPSYNC=your-endpoint-id
```

### Handler Execution Failed
```
Error: RunPod job failed
```

**Check RunPod logs**:
1. Go to RunPod console → Your endpoint
2. Click "Logs" tab
3. Look for Python errors in handler execution

**Common issues**:
- Missing parameters in input
- Wrong parameter types (string vs number)
- ComfyUI models not found in Network Volume
- GPU out of memory

### Slow Cold Starts
```
Job stuck in "IN_QUEUE" for 30+ seconds
```

**Solutions**:
- Enable "Min Workers: 1" to keep one pod warm
- Use faster GPU type (A4000 → A5000)
- Reduce model size if possible

### Parameter Mismatch
```
Error: Workflow validation failed
```

**Solution**: Ensure parameters match exactly what comfy.getrunpod.io generated:
- Check parameter names (case-sensitive)
- Check parameter types
- Review generated handler.py for expected inputs

## Cost Optimization

### Tips to Reduce RunPod Costs

1. **Use appropriate GPU**:
   - Small workflows: RTX 3090 (~$0.20/hr)
   - Medium workflows: RTX A4000 (~$0.35/hr)
   - Large workflows: A5000+ (~$0.50/hr)

2. **Set Min Workers = 0** for development:
   - Pods shut down when idle
   - Accept cold start delay

3. **Set Min Workers = 1** for production:
   - One pod always warm
   - Instant execution
   - Pay for idle time

4. **Use Network Volume efficiently**:
   - Share volume across endpoints
   - Only load required models
   - $0.10/GB/month storage

5. **Monitor usage**:
   - RunPod dashboard shows cost per endpoint
   - Set billing alerts

## Best Practices

1. **Test locally first**: Always test workflows in local ComfyUI before deploying

2. **Version handlers**: Keep generated handlers in git with workflow version tags

3. **Document parameters**: Add comments in handler.py for required parameters

4. **Monitor costs**: Check RunPod dashboard regularly

5. **Update gradually**: Deploy new versions to test endpoint before updating production

6. **Use feature flags**: Keep `ENABLE_RUNPOD=false` until fully tested

## Example: Complete Deployment

Here's a complete example deploying the VideoLipsync workflow:

```bash
# 1. Export workflow
# Save backend/workflows/VideoLipsync.json from ComfyUI

# 2. Generate handler
# Go to https://comfy.getrunpod.io/
# Upload VideoLipsync.json
# Download handler.py

# 3. Deploy to RunPod
runpod create endpoint \
  --name comfyui-videolipsync \
  --handler handler.py \
  --gpu-type "NVIDIA RTX A4000" \
  --volume-id vol_abc123 \
  --min-workers 0 \
  --max-workers 3

# Output: Endpoint ID: xyz789

# 4. Configure backend
echo "RUNPOD_ENDPOINT_VIDEOLIPSYNC=xyz789" >> backend/.env

# 5. Restart backend
cd backend && uvicorn main:app --reload

# 6. Test via frontend
# Open app → Toggle to "Cloud" → Run VideoLipsync
```

## Next Steps

- [Main Documentation](../CLAUDE.md)
- [Workflow System](../WORKFLOW_SYSTEM.md)
- [RunPod Documentation](https://docs.runpod.io/)
- [ComfyUI-to-API Tool](https://comfy.getrunpod.io/)
