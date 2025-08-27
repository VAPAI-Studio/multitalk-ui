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
    console.log('🔄 Starting video upload process:', { filename, subfolder, comfyUrl, jobId })
    
    // Download video from ComfyUI
    const cleanUrl = comfyUrl.replace(/\/$/, '')
    const params = new URLSearchParams({
      filename,
      subfolder: subfolder || '',
      type: 'output'
    })
    
    const videoUrl = `${cleanUrl}/view?${params.toString()}`
    console.log('📥 Step 1: Downloading video from ComfyUI:', videoUrl)
    
    const videoResponse = await fetch(videoUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(60000), // 60 second timeout for video download
      mode: 'cors', // Explicitly set CORS mode
      cache: 'no-store'
    })
    
    if (!videoResponse.ok) {
      const errorText = await videoResponse.text().catch(() => 'No response text')
      console.error('❌ Step 1 failed - ComfyUI download error:', {
        status: videoResponse.status,
        statusText: videoResponse.statusText,
        url: videoUrl,
        errorText
      })
      throw new Error(`Failed to download video from ComfyUI: ${videoResponse.status} ${videoResponse.statusText}`)
    }
    
    const videoBlob = await videoResponse.blob()
    console.log('✅ Step 1 complete - Video downloaded:', { 
      size: videoBlob.size, 
      type: videoBlob.type,
      sizeInMB: (videoBlob.size / 1024 / 1024).toFixed(2) + ' MB'
    })
    
    if (videoBlob.size === 0) {
      console.error('❌ Downloaded video file is empty')
      throw new Error('Downloaded video file is empty')
    }
    
    // Generate storage path
    const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    const fileExtension = filename.split('.').pop() || 'mp4'
    const storagePath = `videos/${timestamp}/${jobId}_${filename}`
    
    console.log('📤 Step 2: Uploading to Supabase Storage:', { 
      storagePath, 
      size: videoBlob.size,
      sizeInMB: (videoBlob.size / 1024 / 1024).toFixed(2) + ' MB',
      contentType: videoBlob.type || 'video/mp4'
    })
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('multitalk-videos')
      .upload(storagePath, videoBlob, {
        contentType: videoBlob.type || 'video/mp4',
        cacheControl: '3600', // Cache for 1 hour
        upsert: true // Allow overwriting if file exists
      })
    
    if (uploadError) {
      console.error('❌ Step 2 failed - Supabase upload error:', {
        error: uploadError,
        storagePath,
        blobSize: videoBlob.size,
        blobType: videoBlob.type
      })
      throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`)
    }
    
    console.log('✅ Step 2 complete - Upload successful:', uploadData)
    
    // Get signed URL (since bucket is private)
    console.log('🔗 Step 3: Generating signed URL for:', storagePath)
    const { data: urlData, error: urlError } = await supabase.storage
      .from('multitalk-videos')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7) // 7 days expiry
    
    if (urlError || !urlData?.signedUrl) {
      console.error('❌ Step 3 failed - Could not generate signed URL:', urlError)
      throw new Error('Failed to get signed URL from Supabase Storage')
    }
    
    console.log('✅ Step 3 complete - Signed URL generated:', urlData.signedUrl)
    console.log('🎉 Video upload process completed successfully!')
    
    return {
      success: true,
      publicUrl: urlData.signedUrl
    }
    
  } catch (error: any) {
    console.error('💥 Video upload process failed:', {
      error,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack
    })
    
    let errorMessage = error.message || 'Unknown error during video upload'
    
    // Provide more specific error messages
    if (error.name === 'TypeError' && error.message?.includes('fetch')) {
      errorMessage = 'Cannot connect to ComfyUI - check if server is running and URL is correct'
      console.error('🔍 Diagnosis: Network connectivity issue with ComfyUI')
    } else if (error.name === 'TimeoutError') {
      errorMessage = 'Timeout connecting to ComfyUI - server may be slow or unreachable'
      console.error('🔍 Diagnosis: ComfyUI request timeout (>60 seconds)')
    } else if (error.message?.includes('CORS')) {
      errorMessage = 'CORS error - ComfyUI may need --enable-cors-header flag'
      console.error('🔍 Diagnosis: CORS policy blocking request')
    } else if (error.message?.includes('Supabase Storage')) {
      console.error('🔍 Diagnosis: Supabase Storage configuration or permission issue')
    } else if (error.message?.includes('download video from ComfyUI')) {
      console.error('🔍 Diagnosis: ComfyUI video download failed - video may not exist or ComfyUI error')
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
    console.error('Error deleting video from storage:', error)
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
    console.error('Error listing videos from storage:', error)
    return {
      files: [],
      error: error.message || 'Unknown error listing videos'
    }
  }
}

