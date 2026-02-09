// Note: Direct Supabase access removed from frontend
// All database operations now go through the backend API

// Job status types (standardized across all job tables)
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

// Unified Job interface (works for both video and image jobs)
export interface Job {
  id: string // UUID
  user_id: string
  workflow_id: number
  workflow_name?: string // Denormalized from workflows table
  status: JobStatus
  created_at: string
  comfy_job_id?: string
  comfy_url: string
  error_message?: string
  project_id?: string // Google Drive folder ID
  parameters?: Record<string, any>
  // Video-specific fields
  input_image_urls?: string[]
  input_audio_urls?: string[]
  input_video_urls?: string[]
  output_video_urls?: string[]
  thumbnail_url?: string
  fps?: number
  duration_seconds?: number
  // Image-specific fields
  output_image_urls?: string[]
  prompt?: string
  // Common fields
  width?: number
  height?: number
}

// Backward compatible alias
export type MultiTalkJob = Job

// Job creation payload for video jobs
export interface CreateVideoJobPayload {
  user_id: string
  workflow_name: string
  comfy_url: string
  comfy_job_id?: string
  input_image_urls?: string[]
  input_audio_urls?: string[]
  input_video_urls?: string[]
  width?: number
  height?: number
  fps?: number
  duration_seconds?: number
  parameters?: Record<string, any>
  project_id?: string
}

// Job creation payload for image jobs
export interface CreateImageJobPayload {
  user_id: string
  workflow_name: string
  comfy_url: string
  comfy_job_id?: string
  input_image_urls?: string[]
  prompt?: string
  width?: number
  height?: number
  parameters?: Record<string, any>
  project_id?: string
}

// Legacy payload (for backward compatibility with old components)
export interface CreateJobPayload {
  job_id: string
  comfy_url: string
  image_filename?: string
  audio_filename?: string
  width: number
  height: number
  trim_to_audio?: boolean
  project_id?: string
  user_id?: string
  workflow_name?: string
  workflow_type?: string
}

// Job completion payload
export interface CompleteJobPayload {
  job_id: string
  status: 'completed' | 'failed'
  output_video_urls?: string[]
  output_image_urls?: string[]
  thumbnail_url?: string
  width?: number
  height?: number
  fps?: number
  duration_seconds?: number
  error_message?: string
}

// Video storage functions - now handled by backend API
export async function uploadVideoToStorage(_file: File | Blob, _fileName: string): Promise<string | null> {
  // This function is no longer used - the job monitoring in utils.ts handles uploads
  // via the backend API (uploadVideoToSupabaseStorage from storageUtils)
  console.warn('uploadVideoToStorage called but deprecated - job monitoring should handle uploads')
  return null
}

// New function that calls the backend API with the correct parameters
export async function uploadVideoToSupabaseStorage(
  comfyUrl: string, 
  filename: string, 
  subfolder: string | undefined, 
  jobId: string
): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/storage/videos/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comfy_url: comfyUrl,
        filename: filename,
        subfolder: subfolder || '',
        job_id: jobId
      })
    });

    if (!response.ok) {
      throw new Error(`Storage API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Storage upload failed');
    }
    
    return data.public_url || null;
  } catch (error) {
    console.error('Error uploading to Supabase storage:', error);
    return null;
  }
}

export async function downloadVideoFromComfy(comfyUrl: string, filename: string, subfolder?: string): Promise<Blob | null> {
  try {
    const url = subfolder 
      ? `${comfyUrl}/api/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=temp`
      : `${comfyUrl}/api/view?filename=${encodeURIComponent(filename)}&type=temp`
    
    console.log('Downloading video from ComfyUI:', url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`)
    }
    
    return await response.blob()
  } catch (error) {
    console.error('Error downloading video from ComfyUI:', error)
    return null
  }
}