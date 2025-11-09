# Workflow System Documentation

## Overview

The MultiTalk UI uses a **centralized workflow system** where ComfyUI workflow templates are stored in the backend and processed through a standardized API.

## Architecture

```
Frontend → Backend API → Workflow Service → ComfyUI
```

### Components

1. **Backend Workflows Directory** (`backend/workflows/`)
   - Stores all ComfyUI workflow JSON templates
   - Version controlled with the backend code

2. **Workflow Service** (`backend/services/workflow_service.py`)
   - Loads workflow templates
   - Fills placeholders with runtime parameters
   - Validates workflows before submission

3. **API Endpoints** (`backend/api/comfyui.py`)
   - `/comfyui/submit-workflow` - Submit workflow with template name + parameters
   - `/comfyui/workflows` - List available workflows
   - `/comfyui/workflows/{name}/parameters` - Get required parameters for a workflow

4. **Frontend API Client** (`frontend/src/lib/apiClient.ts`)
   - `submitWorkflow()` - New standardized method
   - `listWorkflows()` - List available templates
   - `getWorkflowParameters()` - Get template parameters

## Workflow Template Format

### Template Structure

Workflow templates use placeholder syntax: `{{PARAMETER_NAME}}`

Example template (`backend/workflows/VideoLipsync.json`):

```json
{
  "1": {
    "class_type": "LoadImage",
    "inputs": {
      "image": "{{VIDEO_FILENAME}}"
    }
  },
  "2": {
    "class_type": "LoadAudio",
    "inputs": {
      "audio": "{{AUDIO_FILENAME}}"
    }
  },
  "3": {
    "class_type": "ResizeNode",
    "inputs": {
      "width": "{{WIDTH}}",
      "height": "{{HEIGHT}}"
    }
  }
}
```

### Supported Parameter Types

The workflow service handles different data types automatically:

- **String**: `"{{FILENAME}}"` → `"video.mp4"`
- **Number**: `"{{WIDTH}}"` → `640`
- **Boolean**: `"{{ENABLED}}"` → `true`
- **Null**: `"{{OPTIONAL}}"` → `null`

## Usage

### Backend: Creating a New Workflow Template

1. **Create workflow JSON** in `backend/workflows/YourWorkflow.json`

2. **Use placeholders** for dynamic values:
   ```json
   {
     "inputs": {
       "image": "{{IMAGE_FILENAME}}",
       "prompt": "{{PROMPT}}",
       "width": "{{WIDTH}}"
     }
   }
   ```

3. **Document required parameters** in your feature's API documentation

### Frontend: Using the Workflow System

#### Option 1: Use New `submitWorkflow()` Method (Recommended)

```tsx
async function submit() {
  const clientId = `my-feature-${Math.random().toString(36).slice(2)}`;

  const response = await apiClient.submitWorkflow(
    'VideoLipsync',  // workflow name (matches backend/workflows/VideoLipsync.json)
    {
      VIDEO_FILENAME: 'uploaded-video.mp4',
      AUDIO_FILENAME: 'uploaded-audio.wav',
      WIDTH: 640,
      HEIGHT: 360
    },
    comfyUrl,
    clientId
  );

  if (response.success) {
    const promptId = response.prompt_id;
    // Start monitoring...
  }
}
```

#### Option 2: Continue Using Old Method (Legacy)

```tsx
// Old method still works for backward compatibility
const promptJson = await buildPromptJSON();
const response = await apiClient.submitPromptToComfyUI(
  comfyUrl,
  promptJson,
  clientId
);
```

### Migration Guide

To migrate existing features to the new workflow system:

1. **Move workflow from frontend to backend**:
   ```bash
   mv frontend/public/workflows/MyWorkflow.json backend/workflows/
   ```

2. **Update frontend code**:

   **Before:**
   ```tsx
   const template = await fetch('/workflows/MyWorkflow.json');
   const workflow = await template.json();
   let workflowStr = JSON.stringify(workflow)
     .replace(/"\{\{PARAM\}\}"/g, `"${value}"`);
   const promptJson = JSON.parse(workflowStr);

   const response = await apiClient.submitPromptToComfyUI(
     comfyUrl,
     promptJson,
     clientId
   );
   ```

   **After:**
   ```tsx
   const response = await apiClient.submitWorkflow(
     'MyWorkflow',
     { PARAM: value },
     comfyUrl,
     clientId
   );
   ```

3. **Remove `buildPromptJSON()` functions** - no longer needed

## Benefits

### ✅ Centralized Management
- All workflows in one location
- Easy to update and version control
- No frontend redeployment needed for workflow updates

### ✅ Smaller Payloads
- Frontend sends parameters only
- Backend handles template loading and processing
- Reduced network traffic

### ✅ Validation
- Backend validates workflows before submission
- Catches errors before sending to ComfyUI
- Better error messages

### ✅ Security
- Workflows can be validated and sanitized
- Prevent injection of malicious workflow nodes
- Centralized access control (future feature)

### ✅ DRY Principle
- No duplicate workflow loading logic
- Consistent placeholder replacement
- Reusable across multiple frontends

## API Reference

### POST `/comfyui/submit-workflow`

Submit a workflow using a template and parameters.

**Request:**
```json
{
  "workflow_name": "VideoLipsync",
  "parameters": {
    "VIDEO_FILENAME": "video.mp4",
    "AUDIO_FILENAME": "audio.wav",
    "WIDTH": 640,
    "HEIGHT": 360
  },
  "client_id": "my-client-123",
  "base_url": "https://comfy.vapai.studio"
}
```

**Response:**
```json
{
  "success": true,
  "prompt_id": "abc123-def456",
  "workflow_name": "VideoLipsync",
  "error": null
}
```

### GET `/comfyui/workflows`

List all available workflow templates.

**Response:**
```json
{
  "success": true,
  "workflows": {
    "VideoLipsync": "Workflow template: VideoLipsync",
    "WANI2V": "Workflow template: WANI2V",
    "MultiTalkMultiplePeople": "Workflow template: MultiTalkMultiplePeople"
  }
}
```

### GET `/comfyui/workflows/{workflow_name}/parameters`

Get required parameters for a specific workflow.

**Response:**
```json
{
  "success": true,
  "workflow_name": "VideoLipsync",
  "parameters": [
    "VIDEO_FILENAME",
    "AUDIO_FILENAME",
    "WIDTH",
    "HEIGHT"
  ]
}
```

## Best Practices

### 1. Naming Conventions

- **Workflow files**: PascalCase matching feature name (e.g., `VideoLipsync.json`)
- **Parameters**: SCREAMING_SNAKE_CASE (e.g., `{{IMAGE_FILENAME}}`)
- **Consistent naming**: Use same parameter names across similar workflows

### 2. Parameter Validation

Always validate parameters before submission:

```tsx
if (!videoFile) {
  setStatus("Please upload a video file");
  return;
}

if (width <= 0 || height <= 0) {
  setStatus("Invalid resolution");
  return;
}
```

### 3. Error Handling

Handle workflow errors gracefully:

```tsx
const response = await apiClient.submitWorkflow(
  workflowName,
  parameters,
  comfyUrl,
  clientId
);

if (!response.success) {
  setStatus(`❌ Error: ${response.error}`);
  return;
}
```

### 4. Documentation

Document workflow parameters in your feature's code:

```tsx
/**
 * Submit video lipsync workflow to ComfyUI
 *
 * Required parameters:
 * - VIDEO_FILENAME: Uploaded video file (string)
 * - AUDIO_FILENAME: Uploaded audio file (string)
 * - WIDTH: Video width in pixels (number, multiple of 32)
 * - HEIGHT: Video height in pixels (number, multiple of 32)
 */
async function submitVideoLipsync() {
  // ...
}
```

## Troubleshooting

### Workflow not found

**Error:** `Template 'MyWorkflow' not found`

**Solution:** Ensure the workflow file exists at `backend/workflows/MyWorkflow.json`

### Unsubstituted placeholders

**Error:** `Unsubstituted placeholders found: {{MISSING_PARAM}}`

**Solution:** Provide all required parameters in your submission:

```tsx
// Check what parameters are needed first:
const { parameters } = await apiClient.getWorkflowParameters('MyWorkflow');
console.log('Required parameters:', parameters);
```

### Workflow validation failed

**Error:** `Workflow validation failed: Node 5 missing required 'class_type' field`

**Solution:** Check your workflow JSON structure:
- Each node must have `class_type` and `inputs` fields
- Node IDs should be strings
- Verify workflow works in ComfyUI UI first

### JSON parsing errors

**Error:** `Invalid JSON after substitution`

**Solution:**
- Ensure parameter values don't contain unescaped quotes
- Backend handles escaping automatically, but verify complex values
- Check that numeric values aren't wrapped in quotes in template

## Future Enhancements

- [ ] Workflow versioning (e.g., `VideoLipsync_v2.json`)
- [ ] Dynamic workflow generation based on user tier
- [ ] Workflow caching for improved performance
- [ ] Schema validation for workflow structure
- [ ] Workflow testing framework
- [ ] Web UI for workflow management

## Related Documentation

- [new_feature_guide.md](new_feature_guide.md) - Creating new features
- [api_doc.md](api_doc.md) - ComfyUI API reference
- [CLAUDE.md](CLAUDE.md) - Project overview
