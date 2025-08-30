import { apiClient } from './apiClient'

/**
 * Downloads a video from ComfyUI and uploads it to Supabase Storage via API
 */
export async function uploadVideoToSupabaseStorage(
  comfyUrl: string,
  filename: string,
  subfolder: string,
  jobId: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    const payload = {
      comfy_url: comfyUrl,
      filename,
      subfolder,
      job_id: jobId
    }
    
    const response = await apiClient.uploadVideoToStorage(payload)
    
    return {
      success: response.success,
      publicUrl: response.public_url,
      error: response.error
    }
    
  } catch (error: any) {
    let errorMessage = error.message || 'Unknown error during video upload'
    
    // Provide more specific error messages
    if (error.name === 'TypeError' && error.message?.includes('fetch')) {
      errorMessage = 'Cannot connect to API - check if backend server is running'
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Timeout connecting to API - server may be slow or unreachable'
    }
    
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Delete a video from Supabase Storage via API
 */
export async function deleteVideoFromStorage(publicUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.deleteVideoFromStorage(publicUrl)
    
    return {
      success: response.success,
      error: response.error
    }
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error during video deletion'
    }
  }
}

/**
 * List all videos in Supabase Storage via API
 */
export async function listStorageVideos(): Promise<{ files: Array<{ name: string; publicUrl: string }>; error?: string }> {
  try {
    const response = await apiClient.listStorageVideos()
    
    if (response.success) {
      return { 
        files: response.files.map(file => ({
          name: file.name,
          publicUrl: file.public_url
        })), 
        error: response.error 
      }
    } else {
      return {
        files: [],
        error: response.error
      }
    }
    
  } catch (error: any) {
    return {
      files: [],
      error: error.message || 'Unknown error listing videos'
    }
  }
}

