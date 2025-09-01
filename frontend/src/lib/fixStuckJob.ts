import { completeJob } from './jobTracking'
import { uploadVideoToSupabaseStorage } from './storageUtils'
import { findVideoFromHistory } from '../components/utils'
import { apiClient } from './apiClient'

/**
 * Manually fix a stuck job by checking ComfyUI and completing it properly
 */
export async function fixStuckJob(jobId: string, comfyUrl: string) {
  try {
    console.log('🔧 Manually fixing stuck job:', jobId)
    
    // Get ComfyUI history for this job via backend
    const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, jobId) as { 
      success: boolean; 
      history?: any; 
      error?: string 
    }
    
    if (!historyResponse.success) {
      console.error('❌ Could not fetch ComfyUI history for job:', jobId, historyResponse.error)
      return { success: false, error: historyResponse.error || 'Could not fetch history' }
    }
    
    const historyData = historyResponse.history
    console.log('📊 ComfyUI history fetched for job:', jobId)
    
    // Check if video exists in the history
    const videoInfo = findVideoFromHistory(historyData)
    
    if (videoInfo) {
      console.log('🎥 Video found in ComfyUI history:', videoInfo)
      
      // Try to upload to Supabase Storage
      const uploadResult = await uploadVideoToSupabaseStorage(
        comfyUrl,
        videoInfo.filename,
        videoInfo.subfolder || '',
        jobId
      )
      
      if (uploadResult.success && uploadResult.publicUrl) {
        // Complete job with Supabase URL
        console.log('✅ Completing job with Supabase URL')
        await completeJob({
          job_id: jobId,
          status: 'completed',
          filename: videoInfo.filename,
          subfolder: videoInfo.subfolder || undefined,
          video_url: uploadResult.publicUrl
        })
        
        return { 
          success: true, 
          message: 'Job fixed successfully with Supabase URL',
          videoUrl: uploadResult.publicUrl 
        }
      } else {
        // Complete job without Supabase URL (fallback to ComfyUI)
        console.warn('⚠️ Could not upload to Supabase, completing with ComfyUI fallback')
        await completeJob({
          job_id: jobId,
          status: 'completed',
          filename: videoInfo.filename,
          subfolder: videoInfo.subfolder || undefined
        })
        
        return { 
          success: true, 
          message: 'Job fixed with ComfyUI fallback (Supabase upload failed)',
          error: uploadResult.error
        }
      }
    } else {
      console.error('❌ No video found in ComfyUI history for job:', jobId)
      
      // Mark as error since no video was produced
      await completeJob({
        job_id: jobId,
        status: 'error',
        error_message: 'No video output found in ComfyUI history'
      })
      
      return { 
        success: false, 
        error: 'No video output found in ComfyUI history' 
      }
    }
    
  } catch (error: any) {
    console.error('💥 Error fixing stuck job:', error)
    return { 
      success: false, 
      error: error.message || 'Unknown error while fixing job'
    }
  }
}