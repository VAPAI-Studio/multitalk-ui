import { createClient } from '@supabase/supabase-js'

// These would normally come from environment variables
// For now, using placeholder values - you'll need to replace these with your actual Supabase credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
}