import { type CreateJobPayload, type CompleteJobPayload, type MultiTalkJob } from './supabase'
import { apiClient } from './apiClient'

/**
 * Creates a new job record via API when submission starts
 */
export async function createJob(payload: CreateJobPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.createJob(payload)
    
    if (response.success) {
      console.log('Job created successfully:', payload.job_id)
      return { success: true, error: response.error }
    } else {
      console.error('Error creating job:', response.error)
      console.warn('Job tracking failed but continuing with ComfyUI processing')
      return { success: true, error: `DB error (non-blocking): ${response.error}` }
    }
  } catch (error: any) {
    console.error('Error creating job:', error)
    
    // Don't block the main workflow if API operations fail
    if (error.name === 'TypeError' || error.message?.includes('fetch')) {
      console.warn('API timeout/connection error but continuing with processing')
      return { success: true, error: 'API error (non-blocking)' }
    }
    
    return { success: true, error: `API error (non-blocking): ${String(error)}` }
  }
}

/**
 * Updates job status to processing via API
 */
export async function updateJobToProcessing(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.updateJobToProcessing(jobId)
    
    if (response.success) {
      return { success: true, error: response.error }
    } else {
      console.error('Error updating job to processing:', response.error)
      return { success: false, error: response.error }
    }
  } catch (error) {
    console.error('Error updating job to processing:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Completes a job with success or error status via API
 */
export async function completeJob(payload: CompleteJobPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiClient.completeJob(payload.job_id, payload)
    
    if (response.success) {
      console.log('Job completed successfully:', payload.job_id)
      return { success: true, error: response.error }
    } else {
      console.error('Error completing job:', response.error)
      return { success: false, error: response.error }
    }
  } catch (error) {
    console.error('Error completing job:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Gets recent jobs via API
 */
export async function getRecentJobs(limit: number = 50): Promise<{ jobs: MultiTalkJob[]; error?: string }> {
  try {
    const response = await apiClient.getRecentJobs(limit)
    
    if (response.success) {
      return { jobs: response.jobs || [], error: response.error }
    } else {
      console.error('Error fetching jobs:', response.error)
      return { jobs: [], error: response.error }
    }
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return { jobs: [], error: String(error) }
  }
}

/**
 * Gets a specific job by ID via API
 */
export async function getJob(jobId: string): Promise<{ job: MultiTalkJob | null; error?: string }> {
  try {
    const response = await apiClient.getJob(jobId)
    
    if (response.success) {
      return { job: response.job || null, error: response.error }
    } else {
      console.error('Error fetching job:', response.error)
      return { job: null, error: response.error }
    }
  } catch (error) {
    console.error('Error fetching job:', error)
    return { job: null, error: String(error) }
  }
}

/**
 * Gets jobs with completed status that have video files via API
 */
export async function getCompletedJobsWithVideos(limit: number = 20): Promise<{ jobs: MultiTalkJob[]; error?: string }> {
  try {
    const response = await apiClient.getCompletedJobsWithVideos(limit)
    
    if (response.success) {
      return { jobs: response.jobs || [], error: response.error }
    } else {
      console.error('Error fetching completed jobs:', response.error)
      return { jobs: [], error: response.error }
    }
  } catch (error: any) {
    console.error('Error fetching completed jobs:', error)
    
    // Handle specific error types more gracefully
    if (error.name === 'TypeError' || error.message?.includes('fetch')) {
      return { jobs: [], error: 'Network error - check connection' }
    }
    
    if (error.message?.includes('timeout')) {
      return { jobs: [], error: 'Request timeout - using offline mode' }
    }
    
    // Return empty array for any other errors to keep UI functional
    return { jobs: [], error: String(error) }
  }
}