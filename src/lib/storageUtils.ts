import { supabase } from './supabase'

/**
 * Downloads a video from ComfyUI and uploads it to Supabase Storage
 */
export async function uploadVideoToSupabaseStorage(
  comfyUrl: string,
  filename: string,
  subfolder: string,
  jobId: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    
    // Download video from ComfyUI
    const cleanUrl = comfyUrl.replace(/\/$/, '')
    const params = new URLSearchParams({
      filename,
      subfolder: subfolder || '',
      type: 'output'
    })
    
    const videoUrl = `${cleanUrl}/view?${params.toString()}`
    
    const videoResponse = await fetch(videoUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(60000), // 60 second timeout for video download
      mode: 'cors', // Explicitly set CORS mode
      cache: 'no-store'
    })
    
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video from ComfyUI: ${videoResponse.status} ${videoResponse.statusText}`)
    }
    
    const videoBlob = await videoResponse.blob()
    
    if (videoBlob.size === 0) {
      throw new Error('Downloaded video file is empty')
    }
    
    // Generate storage path
    const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    const storagePath = `videos/${timestamp}/${jobId}_${filename}`
    
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('multitalk-videos')
      .upload(storagePath, videoBlob, {
        contentType: videoBlob.type || 'video/mp4',
        cacheControl: '3600', // Cache for 1 hour
        upsert: true // Allow overwriting if file exists
      })
    
    if (uploadError) {
      throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`)
    }
    
    // Get signed URL (since bucket is private)
    const { data: urlData, error: urlError } = await supabase.storage
      .from('multitalk-videos')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7) // 7 days expiry
    
    if (urlError || !urlData?.signedUrl) {
      throw new Error('Failed to get signed URL from Supabase Storage')
    }
    
    return {
      success: true,
      publicUrl: urlData.signedUrl
    }
    
  } catch (error: any) {
    
    let errorMessage = error.message || 'Unknown error during video upload'
    
    // Provide more specific error messages
    if (error.name === 'TypeError' && error.message?.includes('fetch')) {
      errorMessage = 'Cannot connect to ComfyUI - check if server is running and URL is correct'
    } else if (error.name === 'TimeoutError') {
      errorMessage = 'Timeout connecting to ComfyUI - server may be slow or unreachable'
    } else if (error.message?.includes('CORS')) {
      errorMessage = 'CORS error - ComfyUI may need --enable-cors-header flag'
    }
    
    return {
      success: false,
      error: errorMessage
    }
  }
}

/**
 * Delete a video from Supabase Storage
 */
export async function deleteVideoFromStorage(publicUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Extract path from public URL
    const url = new URL(publicUrl)
    const pathParts = url.pathname.split('/storage/v1/object/public/multitalk-videos/')
    if (pathParts.length < 2) {
      throw new Error('Invalid public URL format')
    }
    
    const filePath = pathParts[1]
    
    const { error } = await supabase.storage
      .from('multitalk-videos')
      .remove([filePath])
    
    if (error) {
      throw new Error(`Failed to delete from storage: ${error.message}`)
    }
    
    return { success: true }
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error during video deletion'
    }
  }
}

/**
 * List all videos in Supabase Storage
 */
export async function listStorageVideos(): Promise<{ files: Array<{ name: string; publicUrl: string }>; error?: string }> {
  try {
    const { data: files, error } = await supabase.storage
      .from('multitalk-videos')
      .list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      })
    
    if (error) {
      throw new Error(`Failed to list videos: ${error.message}`)
    }
    
    const filesWithUrls = files.map(file => ({
      name: file.name,
      publicUrl: supabase.storage.from('multitalk-videos').getPublicUrl(file.name).data.publicUrl
    }))
    
    return { files: filesWithUrls }
    
  } catch (error: any) {
    return {
      files: [],
      error: error.message || 'Unknown error listing videos'
    }
  }
}

