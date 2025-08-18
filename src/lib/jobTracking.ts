import { supabase, type CreateJobPayload, type CompleteJobPayload, type MultiTalkJob } from './supabase'

/**
 * Creates a new job record in Supabase when submission starts
 */
export async function createJob(payload: CreateJobPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const jobData = {
      job_id: payload.job_id,
      status: 'submitted' as const,
      timestamp_submitted: new Date().toISOString(),
      comfy_url: payload.comfy_url,
      image_filename: payload.image_filename,
      audio_filename: payload.audio_filename,
      width: payload.width,
      height: payload.height,
      trim_to_audio: payload.trim_to_audio,
    }

    const { error } = await supabase
      .from('multitalk_jobs')
      .insert([jobData])

    if (error) {
      console.error('Error creating job:', error)
      return { success: false, error: error.message }
    }

    console.log('Job created successfully:', payload.job_id)
    return { success: true }
  } catch (error) {
    console.error('Error creating job:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Updates job status to processing
 */
export async function updateJobToProcessing(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('multitalk_jobs')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId)

    if (error) {
      console.error('Error updating job to processing:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating job to processing:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Completes a job with success or error status
 */
export async function completeJob(payload: CompleteJobPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData = {
      status: payload.status,
      timestamp_completed: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(payload.filename && { filename: payload.filename }),
      ...(payload.subfolder && { subfolder: payload.subfolder }),
      ...(payload.error_message && { error_message: payload.error_message }),
    }

    const { error } = await supabase
      .from('multitalk_jobs')
      .update(updateData)
      .eq('job_id', payload.job_id)

    if (error) {
      console.error('Error completing job:', error)
      return { success: false, error: error.message }
    }

    console.log('Job completed successfully:', payload.job_id)
    return { success: true }
  } catch (error) {
    console.error('Error completing job:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Gets recent jobs from Supabase
 */
export async function getRecentJobs(limit: number = 50): Promise<{ jobs: MultiTalkJob[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('multitalk_jobs')
      .select('*')
      .order('timestamp_submitted', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching jobs:', error)
      return { jobs: [], error: error.message }
    }

    return { jobs: data || [] }
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return { jobs: [], error: String(error) }
  }
}

/**
 * Gets a specific job by ID
 */
export async function getJob(jobId: string): Promise<{ job: MultiTalkJob | null; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('multitalk_jobs')
      .select('*')
      .eq('job_id', jobId)
      .single()

    if (error) {
      console.error('Error fetching job:', error)
      return { job: null, error: error.message }
    }

    return { job: data }
  } catch (error) {
    console.error('Error fetching job:', error)
    return { job: null, error: String(error) }
  }
}

/**
 * Gets jobs with completed status that have video files
 */
export async function getCompletedJobsWithVideos(limit: number = 20): Promise<{ jobs: MultiTalkJob[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('multitalk_jobs')
      .select('*')
      .eq('status', 'completed')
      .not('filename', 'is', null)
      .order('timestamp_completed', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching completed jobs:', error)
      return { jobs: [], error: error.message }
    }

    return { jobs: data || [] }
  } catch (error) {
    console.error('Error fetching completed jobs:', error)
    return { jobs: [], error: String(error) }
  }
}