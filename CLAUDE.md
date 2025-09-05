# Creating New Feature Pages - Documentation for Claude

This document provides comprehensive guidance for creating new feature pages in the MultiTalk UI application. Follow these patterns and requirements to ensure consistency and proper integration with the existing system.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Creating a New Feature Page](#creating-a-new-feature-page)
3. [Frontend Integration](#frontend-integration)
4. [Backend API Integration](#backend-api-integration)
5. [ComfyUI Integration](#comfyui-integration)
6. [UnifiedFeed Integration](#unifiedfeed-integration)
7. [File Structure and Patterns](#file-structure-and-patterns)
8. [Common Hooks and Utilities](#common-hooks-and-utilities)
9. [Testing and Development](#testing-and-development)
10. [Examples and Templates](#examples-and-templates)

## Architecture Overview

The MultiTalk UI follows a modern React architecture with these key components:

### Technology Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: FastAPI + Python
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **AI Processing**: ComfyUI integration
- **Styling**: TailwindCSS

### Key Architectural Patterns
- **Page-based routing**: Single App.tsx with conditional rendering
- **Unified job tracking**: All AI jobs tracked in Supabase with real-time status updates
- **Modular API client**: Centralized API communication through `apiClient`
- **Reusable components**: Shared UI components and utilities
- **Real-time progress**: WebSocket integration for ComfyUI progress tracking

## Creating a New Feature Page

### Step 1: Plan Your Feature

Before coding, define:
- **Feature purpose**: What AI workflow will this trigger?
- **Input requirements**: What files/data does the user provide?
- **ComfyUI workflow**: Which workflow JSON file will be used?
- **Output type**: Video, image, or other media?
- **Job tracking**: How will progress be monitored?

### Step 2: Create the Page Component

Create a new file: `frontend/src/YourFeatureName.tsx`

```tsx
import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
import { startJobMonitoring, checkComfyUIHealth } from "./components/utils";
import UnifiedFeed from "./components/UnifiedFeed";
import { useSmartResolution } from "./hooks/useSmartResolution";
import { apiClient } from "./lib/apiClient";

// UI Components (reuse these patterns)
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

interface Props {
  comfyUrl: string;
}

export default function YourFeatureName({ comfyUrl }: Props) {
  // State management (follow these patterns)
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('default prompt text');
  
  // Use smart resolution for video outputs
  const { 
    width, 
    height, 
    widthInput, 
    heightInput, 
    handleWidthChange, 
    handleHeightChange, 
    setWidth, 
    setHeight 
  } = useSmartResolution(640, 360);

  // Job tracking state
  const [status, setStatus] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  // Main submission function
  async function submit() {
    setStatus("");
    setResultUrl("");
    setJobId("");

    // Validation
    if (!comfyUrl) {
      setStatus("Please enter a ComfyUI URL.");
      return;
    }
    if (!inputFile) {
      setStatus("Please upload a file.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Health check
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Process files and submit to ComfyUI
      setStatus("Processing input...");
      // Add your file processing logic here

      setStatus("Sending prompt to ComfyUI...");
      const clientId = `your-feature-ui-${Math.random().toString(36).slice(2)}`;
      const promptJson = await buildPromptJSON(/* your parameters */);

      const response = await apiClient.submitPromptToComfyUI(
        comfyUrl,
        promptJson,
        clientId
      );
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to submit prompt to ComfyUI');
      }
      
      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      // Create job record
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        image_filename: inputFile?.name,
        audio_filename: undefined, // if no audio
        width,
        height,
        trim_to_audio: false,
        workflow_type: 'your-feature-type' // Important: set this for filtering
      });

      await updateJobToProcessing(id);

      // Start monitoring
      setStatus("Processing in ComfyUI…");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, outputInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI…');
          } else if (jobStatus === 'completed' && outputInfo) {
            setResultUrl(/* construct URL from outputInfo */);
            setStatus("✅ Generation completed!");
            setIsSubmitting(false);
          } else if (jobStatus === 'error') {
            setStatus(`❌ ${message}`);
            setIsSubmitting(false);
            
            await completeJob({
              job_id: id,
              status: 'error',
              error_message: message || 'Unknown error'
            }).catch(() => {});
          }
        }
      );
      
      setJobMonitorCleanup(() => cleanup);

    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
      if (jobId) {
        await completeJob({
          job_id: jobId,
          status: 'error',
          error_message: error.message || 'Unknown error'
        }).catch(() => {});
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Your Feature Name
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Description of what your feature does
            </p>
          </div>

          {/* Input Section */}
          <Section title="Input">
            <Field>
              <Label>Upload File</Label>
              <input
                type="file"
                accept="image/*" // or audio/*, video/*, etc.
                onChange={(e) => setInputFile(e.target.files?.[0] || null)}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
              />
            </Field>
          </Section>

          {/* Settings Section */}
          <Section title="Settings">
            <Field>
              <Label>Prompt</Label>
              <textarea
                rows={3}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Enter your prompt..."
              />
            </Field>
          </Section>

          {/* Resolution Section (if applicable) */}
          <Section title="Resolution">
            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Width (px)</Label>
                <input
                  type="number"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                  value={widthInput}
                  onChange={(e) => handleWidthChange(e.target.value)}
                />
              </Field>
              <Field>
                <Label>Height (px)</Label>
                <input
                  type="number"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                  value={heightInput}
                  onChange={(e) => handleHeightChange(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-gray-500 mt-3">Auto-corrected to multiples of 32</p>
          </Section>

          {/* Generation Section */}
          <Section title="Generate">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Generate
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {/* Result Display */}
            {resultUrl && (
              <div className="mt-6 space-y-3">
                {/* For video */}
                <video src={resultUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                {/* For image */}
                {/* <img src={resultUrl} alt="Result" className="w-full rounded-3xl shadow-2xl border border-gray-200/50" /> */}
                <div>
                  <button 
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" 
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = resultUrl;
                      a.download = "result.mp4"; // or appropriate extension
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }}
                  >
                    <span>⬇️</span>
                    Download
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - ALWAYS include UnifiedFeed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <UnifiedFeed 
              comfyUrl={comfyUrl} 
              config={{
                type: 'video', // or 'image' or 'both'
                title: 'Your Feature',
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                pageContext: 'your-feature-type' // MUST match workflow_type in createJob
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to build ComfyUI workflow JSON
async function buildPromptJSON(/* parameters */) {
  try {
    const response = await fetch('/workflows/YourWorkflow.json');
    if (!response.ok) {
      throw new Error('Failed to load workflow template');
    }
    const template = await response.json();
    
    // Replace placeholders in the workflow
    let promptString = JSON.stringify(template)
      .replace(/"\{\{PARAMETER_1\}\}"/g, `"${value1}"`)
      .replace(/"\{\{PARAMETER_2\}\}"/g, `"${value2}"`);
    
    return JSON.parse(promptString);
  } catch (error) {
    console.error('Error loading workflow template:', error);
    throw new Error('Failed to build prompt JSON');
  }
}
```

### Step 3: Add to App.tsx Navigation

Update `frontend/src/App.tsx`:

1. **Import your component**:
```tsx
import YourFeatureName from "./YourFeatureName";
```

2. **Add to currentPage type**:
```tsx
const [currentPage, setCurrentPage] = useState<"home" | "multitalk-one" | /* existing */ | "your-feature">("home");
```

3. **Add navigation button in sidebar**:
```tsx
<button
  onClick={() => handlePageChange("your-feature")}
  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
    currentPage === "your-feature"
      ? "bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
  }`}
>
  <span className="text-lg">🎯</span>
  <span className="font-medium">Your Feature Name</span>
</button>
```

4. **Add to main content switch**:
```tsx
{currentPage === "your-feature" && (
  <YourFeatureName comfyUrl={comfyUrl} />
)}
```

5. **Update localStorage validation**:
```tsx
if (savedPage && ['home', 'multitalk-one', /* existing pages */, 'your-feature'].includes(savedPage)) {
  setCurrentPage(savedPage);
}
```

## Frontend Integration

### Required Imports and Dependencies

Every feature page should import these core dependencies:

```tsx
// React hooks
import React, { useEffect, useRef, useState } from "react";

// Job tracking (REQUIRED)
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";

// ComfyUI utilities (REQUIRED)
import { startJobMonitoring, checkComfyUIHealth } from "./components/utils";

// API communication (REQUIRED)
import { apiClient } from "./lib/apiClient";

// UnifiedFeed (REQUIRED)
import UnifiedFeed from "./components/UnifiedFeed";

// Common hooks
import { useSmartResolution } from "./hooks/useSmartResolution";
```

### State Management Patterns

Follow these state patterns for consistency:

```tsx
// Input files
const [inputFile, setInputFile] = useState<File | null>(null);
const [audioFile, setAudioFile] = useState<File | null>(null); // if needed

// User settings
const [customPrompt, setCustomPrompt] = useState<string>('default value');

// Resolution (for video/image outputs)
const { width, height, widthInput, heightInput, handleWidthChange, handleHeightChange, setWidth, setHeight } = useSmartResolution(640, 360);

// Job status
const [status, setStatus] = useState<string>("");
const [resultUrl, setResultUrl] = useState<string>("");
const [jobId, setJobId] = useState<string>("");
const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);
```

### File Processing Patterns

#### Convert file to Base64:
```tsx
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data URL prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

#### Upload files to ComfyUI:
```tsx
async function uploadFileToComfyUI(baseUrl: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('image', file); // ComfyUI uses 'image' for all file types
  
  const response = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    body: formData,
    credentials: 'omit'
  });
  
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.name || data.files?.[0] || '';
}
```

## Backend API Integration

### Adding New API Endpoints

If your feature needs new backend endpoints, follow these patterns:

#### 1. Create Model Classes
Create `backend/models/your_feature.py`:

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class YourFeatureRequest(BaseModel):
    input_data: str
    parameters: dict
    user_id: Optional[str] = None

class YourFeatureResponse(BaseModel):
    success: bool
    result_id: Optional[str] = None
    error: Optional[str] = None
```

#### 2. Create Service Layer
Create `backend/services/your_feature_service.py`:

```python
from typing import Tuple, Optional, Any

class YourFeatureService:
    async def process_request(self, request_data: dict) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Process your feature request
        Returns: (success, result_id, error_message)
        """
        try:
            # Your processing logic here
            return True, result_id, None
        except Exception as e:
            return False, None, str(e)
```

#### 3. Create API Router
Create `backend/api/your_feature.py`:

```python
from fastapi import APIRouter, HTTPException
from models.your_feature import YourFeatureRequest, YourFeatureResponse
from services.your_feature_service import YourFeatureService

router = APIRouter(prefix="/your-feature", tags=["your-feature"])

def get_service():
    return YourFeatureService()

@router.post("/", response_model=YourFeatureResponse)
async def create_request(payload: YourFeatureRequest):
    service = get_service()
    success, result_id, error = await service.process_request(payload.dict())
    
    return YourFeatureResponse(
        success=success,
        result_id=result_id,
        error=error
    )
```

#### 4. Register Router
Add to `backend/main.py`:

```python
from api import your_feature

app.include_router(your_feature.router)
```

#### 5. Add to Frontend API Client
Update `frontend/src/lib/apiClient.ts`:

```tsx
// Add your methods to the ApiClient class
async yourFeatureMethod(payload: any) {
  return this.request('/your-feature', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
```

## ComfyUI Integration

### Workflow JSON Files

Store ComfyUI workflow files in `frontend/public/workflows/YourWorkflow.json`.

#### Template Placeholders
Use these placeholder patterns in your JSON:

- `{{BASE64_IMAGE}}` - Base64 encoded images
- `{{AUDIO_FILENAME}}` - Uploaded audio filenames
- `{{WIDTH}}` - Image/video width
- `{{HEIGHT}}` - Image/video height
- `{{CUSTOM_PROMPT}}` - User text input
- `{{PARAMETER_NAME}}` - Any custom parameter

#### Example Workflow Structure:
```json
{
  "1": {
    "class_type": "Base64DecodeNode",
    "inputs": {
      "image": "{{BASE64_IMAGE}}"
    }
  },
  "2": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "{{CUSTOM_PROMPT}}",
      "clip": ["3", 1]
    }
  },
  "3": {
    "class_type": "ResizeImageToResolution",
    "inputs": {
      "width": "{{WIDTH}}",
      "height": "{{HEIGHT}}",
      "image": ["1", 0]
    }
  }
}
```

### ComfyUI Health Checks

Always check ComfyUI health before submitting:

```tsx
const healthCheck = await checkComfyUIHealth(comfyUrl);
if (!healthCheck.available) {
  throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
}
```

### Job Monitoring

Use the standardized job monitoring:

```tsx
const cleanup = startJobMonitoring(
  jobId,
  comfyUrl,
  async (jobStatus, message, outputInfo) => {
    if (jobStatus === 'processing') {
      setStatus(message || 'Processing...');
    } else if (jobStatus === 'completed' && outputInfo) {
      // Handle completion
      setResultUrl(constructUrlFromOutputInfo(outputInfo));
      setStatus("✅ Completed!");
      setIsSubmitting(false);
    } else if (jobStatus === 'error') {
      // Handle error
      setStatus(`❌ ${message}`);
      setIsSubmitting(false);
    }
  }
);
```

## UnifiedFeed Integration

### REQUIRED: Every page must include UnifiedFeed

The UnifiedFeed is a critical component that:
- Shows real-time progress of all jobs
- Allows users to see their generation history
- Provides debugging capabilities with the "Fix" button
- Maintains UI consistency across all features

### Configuration

```tsx
<UnifiedFeed 
  comfyUrl={comfyUrl} 
  config={{
    type: 'video', // 'video', 'image', or 'both'
    title: 'Your Feature Name',
    showCompletedOnly: false,
    maxItems: 10,
    showFixButton: true,
    showProgress: true,
    pageContext: 'your-feature-type' // MUST match workflow_type in job creation
  }}
/>
```

### Page Context and Filtering

The `pageContext` is crucial for filtering:

1. **Set in UnifiedFeed config**:
```tsx
config={{
  pageContext: 'your-feature-type'
}}
```

2. **Set when creating jobs**:
```tsx
await createJob({
  job_id: id,
  workflow_type: 'your-feature-type', // Must match pageContext
  // ... other fields
});
```

This enables the "Show Mine" / "Show All" filtering in the feed.

### Layout Requirements

Always use this sidebar layout:

```tsx
return (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
    <div className="flex gap-6 p-6 md:p-10">
      {/* Main Content */}
      <div className="flex-1 max-w-4xl space-y-8">
        {/* Your feature UI */}
      </div>

      {/* Right Sidebar - UnifiedFeed */}
      <div className="w-96 space-y-6">
        <div className="sticky top-6 h-[calc(100vh-3rem)]">
          <UnifiedFeed 
            comfyUrl={comfyUrl} 
            config={{ /* your config */ }}
          />
        </div>
      </div>
    </div>
  </div>
);
```

## File Structure and Patterns

### Directory Structure
```
frontend/src/
├── YourFeatureName.tsx          # Main feature component
├── components/
│   ├── UnifiedFeed.tsx          # Job feed (already exists)
│   ├── utils.ts                 # Utility functions (already exists)
│   └── YourFeatureComponents/   # Feature-specific components (if needed)
├── hooks/
│   ├── useSmartResolution.ts    # Resolution management (already exists)
│   └── useYourFeature.ts        # Feature-specific hooks (if needed)
├── lib/
│   ├── apiClient.ts             # API communication (already exists)
│   ├── jobTracking.ts           # Job tracking (already exists)
│   └── yourFeatureUtils.ts      # Feature-specific utilities (if needed)
└── public/workflows/
    └── YourWorkflow.json        # ComfyUI workflow definition

backend/
├── api/
│   └── your_feature.py          # API endpoints (if needed)
├── models/
│   └── your_feature.py          # Data models (if needed)
├── services/
│   └── your_feature_service.py  # Business logic (if needed)
└── main.py                      # Router registration
```

### Naming Conventions

- **Components**: PascalCase (`YourFeatureName.tsx`)
- **Files**: camelCase (`yourFeatureUtils.ts`)
- **API endpoints**: snake_case (`/your-feature`)
- **Database fields**: snake_case (`workflow_type`)
- **CSS classes**: kebab-case (follow TailwindCSS)

## Common Hooks and Utilities

### useSmartResolution Hook
For video/image outputs that need specific dimensions:

```tsx
const { 
  width,           // Current width (always multiple of 32)
  height,          // Current height (always multiple of 32)
  widthInput,      // Input field value (can be any number)
  heightInput,     // Input field value (can be any number)
  handleWidthChange,  // Handler for width input
  handleHeightChange, // Handler for height input
  setWidth,        // Programmatic setter
  setHeight        // Programmatic setter
} = useSmartResolution(640, 360); // default width, height
```

### Common Utility Functions

Already available in `components/utils.ts`:

- `fileToBase64(file: File): Promise<string>` - Convert files to base64
- `checkComfyUIHealth(baseUrl: string)` - Health check ComfyUI
- `startJobMonitoring(jobId, baseUrl, callback)` - Monitor job progress
- `findVideoFromHistory(historyJson)` - Extract video info from ComfyUI response

### Progress Tracking Hook

For real-time ComfyUI progress:

```tsx
import { useComfyUIProgress } from './hooks/useComfyUIProgress';

const { progress } = useComfyUIProgress(comfyUrl, true);

// Use in UI:
if (progress.total_nodes > 0) {
  const percentage = (progress.completed_nodes / progress.total_nodes) * 100;
  // Show progress bar
}
```

## Testing and Development

### Development Workflow

1. **Start development servers**:
```bash
# Frontend
cd frontend && npm run dev

# Backend
cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

2. **Test ComfyUI integration**:
   - Ensure ComfyUI is running with CORS enabled
   - Test workflow JSON manually in ComfyUI first
   - Use ComfyUI's `/object_info` endpoint to verify required nodes

3. **Test job tracking**:
   - Submit jobs and verify they appear in Supabase
   - Check real-time status updates
   - Verify file uploads to Supabase Storage

### Debug Workflow JSON

If your workflow fails:

1. **Check ComfyUI logs**:
   ```bash
   # Look for node errors or missing dependencies
   tail -f comfyui.log
   ```

2. **Validate JSON placeholders**:
   ```tsx
   console.log('Workflow JSON:', JSON.stringify(promptJson, null, 2));
   ```

3. **Test workflow manually**:
   - Copy the generated JSON to ComfyUI interface
   - Run manually to identify issues

### Common Issues and Solutions

#### "Node not found" errors:
- Ensure required custom nodes are installed in ComfyUI
- Check node names match exactly (case-sensitive)
- Verify ComfyUI `/object_info` contains your nodes

#### CORS errors:
- Start ComfyUI with: `--enable-cors-header`
- Or use a proxy/tunnel service

#### File upload failures:
- Check file size limits
- Verify file types are supported
- Ensure proper error handling

#### Job tracking issues:
- Check Supabase connection
- Verify job IDs are unique
- Check for database schema mismatches

## Examples and Templates

### Simple Image Generation Feature

```tsx
export default function SimpleImageGen({ comfyUrl }: Props) {
  const [prompt, setPrompt] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  
  async function buildPromptJSON(prompt: string) {
    const response = await fetch('/workflows/SimpleImageGen.json');
    const template = await response.json();
    
    return JSON.parse(
      JSON.stringify(template)
        .replace(/"\{\{PROMPT\}\}"/g, `"${prompt.replace(/"/g, '\\"')}"`)
    );
  }

  async function submit() {
    // ... standard submission logic
    const promptJson = await buildPromptJSON(prompt);
    // ... submit to ComfyUI
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        <div className="flex-1 max-w-4xl space-y-8">
          <Section title="Generate Image">
            <Field>
              <Label>Prompt</Label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-blue-500 transition-colors"
              />
            </Field>
            <button onClick={submit} disabled={isSubmitting}>
              Generate
            </button>
          </Section>
          {imageUrl && <img src={imageUrl} alt="Generated" />}
        </div>
        
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <UnifiedFeed 
              comfyUrl={comfyUrl} 
              config={{
                type: 'image',
                title: 'Simple Image Gen',
                pageContext: 'simple-image-gen'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Video Processing Feature Template

```tsx
export default function VideoProcessor({ comfyUrl }: Props) {
  const [inputVideo, setInputVideo] = useState<File | null>(null);
  const { width, height, widthInput, heightInput, handleWidthChange, handleHeightChange } = useSmartResolution(1280, 720);
  
  async function submit() {
    // Upload video to ComfyUI
    const videoFilename = await uploadFileToComfyUI(comfyUrl, inputVideo);
    
    // Build workflow with video filename
    const promptJson = await buildPromptJSON(videoFilename, width, height);
    
    // Standard submission flow
    // ...
  }

  return (
    // Standard layout with UnifiedFeed
    // Video-specific UI components
    // Resolution controls
    // Progress display
  );
}
```

### Workflow Type Reference

Use these standardized workflow types:

- `'lipsync-one'` - Single person lipsync
- `'lipsync-multi'` - Multiple person lipsync  
- `'video-lipsync'` - Video-to-video lipsync
- `'image-edit'` - Image editing
- `'image-gen'` - Image generation
- `'video-gen'` - Video generation
- `'i2v'` - Image to video
- `'v2v'` - Video to video
- `'audio-gen'` - Audio generation
- `'your-feature-type'` - Your custom type

### Required Environment Setup

Ensure these are configured:

#### Frontend `.env`:
```env
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

#### Backend environment:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
OPENROUTER_API_KEY=your_openrouter_key (if using AI)
```

## Final Checklist

Before considering your feature complete:

### ✅ Frontend Requirements
- [ ] Uses standard component structure (Section, Field, Label)
- [ ] Implements proper error handling and validation
- [ ] Includes ComfyUI health check before submission
- [ ] Uses job tracking (createJob, updateJobToProcessing, completeJob)
- [ ] Implements startJobMonitoring for real-time updates
- [ ] Includes UnifiedFeed with correct pageContext
- [ ] Follows standard styling and layout patterns
- [ ] Handles file uploads properly (if applicable)
- [ ] Uses useSmartResolution for video/image dimensions (if applicable)
- [ ] Implements proper cleanup on unmount

### ✅ Backend Requirements (if needed)
- [ ] Creates appropriate API endpoints
- [ ] Implements proper error handling
- [ ] Uses async/await patterns
- [ ] Returns standardized response formats
- [ ] Registers routers in main.py

### ✅ ComfyUI Integration
- [ ] Workflow JSON uses proper placeholder patterns
- [ ] Tests workflow manually in ComfyUI first
- [ ] Handles ComfyUI errors gracefully
- [ ] Implements proper file upload to ComfyUI
- [ ] Uses correct node names and parameters

### ✅ Navigation Integration
- [ ] Adds component to App.tsx imports
- [ ] Updates currentPage type definition
- [ ] Adds navigation button to sidebar
- [ ] Adds route to main content area
- [ ] Updates localStorage validation array

### ✅ Job Tracking
- [ ] Sets correct workflow_type for filtering
- [ ] Creates job record before processing
- [ ] Updates status during processing
- [ ] Completes job with success/error status
- [ ] Handles video/result URL properly

### ✅ Testing and Polish
- [ ] Tests complete workflow end-to-end
- [ ] Verifies UnifiedFeed shows jobs correctly
- [ ] Tests filtering (Show Mine/Show All)
- [ ] Handles network errors gracefully
- [ ] Provides clear user feedback
- [ ] Includes download functionality for results

This documentation should provide everything needed to create new feature pages that integrate properly with the MultiTalk UI system. Follow these patterns closely to ensure consistency, proper functionality, and maintainability.