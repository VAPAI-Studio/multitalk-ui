// Note: Direct Supabase access removed from frontend
// All database operations now go through the backend API via apiClient

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
}

// Video storage functions - now handled by backend API
export async function uploadVideoToStorage(file: File | Blob, fileName: string): Promise<string | null> {
  try {
    // Convert blob to base64 for API transmission
    const arrayBuffer = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    
    // Use the API client to upload through backend
    const { apiClient } = await import('./apiClient')
    const response = await apiClient.uploadVideoToStorage({
      file_data: base64,
      file_name: fileName,
      content_type: 'video/mp4'
    })
    
    return response.public_url || null
  } catch (error) {
    console.error('Error uploading video via API:', error)
    return null
  }
}

export async function downloadVideoFromComfy(comfyUrl: string, filename: string, subfolder?: string): Promise<Blob | null> {
  try {
    const url = subfolder 
      ? `${comfyUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`
      : `${comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=output`
    
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