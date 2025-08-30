// Core data models - moved here to avoid import issues
export interface EditedImage {
  id: string
  created_at: string
  source_image_url: string
  prompt: string
  result_image_url?: string
  workflow_name: string
  model_used?: string
  processing_time_seconds?: number
  user_ip?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface VideoFile {
  name: string
  public_url: string
}

export interface Job {
  id: string
  created_at: string
  status: string
  workflow_name?: string
  comfy_workflow?: any
  result_video_url?: string
  processing_time_seconds?: number
  user_ip?: string
  error_message?: string
}

// Dataset interface defined locally to avoid import issues
interface Dataset {
  id: string
  name: string
  description?: string
  created_at: string
  image_count?: number
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T = any> {
  success: boolean
  data: T[]
  total_count: number
  page?: number
  limit?: number
  error?: string
}

// Specific API Response types
export interface EditedImagesResponse {
  success: boolean
  edited_images: EditedImage[]
  total_count: number
  error?: string
}

export interface JobsResponse {
  success: boolean
  jobs: Job[]
  total_count: number
  error?: string
}

export interface VideoFilesResponse {
  success: boolean
  files: VideoFile[]
  error?: string
}

export interface DatasetsResponse {
  success: boolean
  datasets: Dataset[]
  error?: string
}

// Request types
export interface ImageEditRequest {
  image_data: string
  prompt: string
}

export interface ImageEditResponse {
  success: boolean
  image_url?: string
  error?: string
}

export interface JobCreateRequest {
  workflow_name: string
  comfy_workflow: any
  user_ip?: string
}

export interface ConfigResponse {
  configured: boolean
  message: string
}

// Pagination parameters
export interface PaginationParams {
  limit?: number
  offset?: number
  page?: number
}

// Filter parameters
export interface ImageFilterParams extends PaginationParams {
  completed_only?: boolean
  status?: EditedImage['status']
  workflow_name?: string
}