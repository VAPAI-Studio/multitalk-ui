// Note: Direct Supabase access removed from frontend
// All database operations now go through the backend API

// Job status types
export type JobStatus = 'submitted' | 'processing' | 'completed' | 'error'

// Job record type
export interface MultiTalkJob {
  job_id: string // Primary key from ComfyUI
  status: JobStatus
  timestamp_submitted: string
  timestamp_completed?: string
  filename?: string
  subfolder?: string
  image_filename?: string
  audio_filename?: string
  width: number
  height: number
  trim_to_audio: boolean
  comfy_url: string
  error_message?: string
  video_url?: string // Supabase Storage URL
  // Additional metadata
  created_at?: string
  updated_at?: string
}

// Job creation payload (what we send when starting a job)
export interface CreateJobPayload {
  job_id: string
  comfy_url: string
  image_filename?: string
  audio_filename?: string
  width: number
  height: number
  trim_to_audio: boolean
}

// Job completion payload (what we send when job finishes)
export interface CompleteJobPayload {
  job_id: string
  status: 'completed' | 'error'
  filename?: string
  subfolder?: string
  error_message?: string
  video_url?: string // Added for Supabase Storage URL
  comfy_url?: string // Added to avoid database lookup
  video_type?: string // Added to use correct ComfyUI type
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