/* eslint-disable react-refresh/only-export-components */
import { config } from '../config/environment'

// Simple cache for API responses
interface CacheEntry<T> {
  data: T
  timestamp: number
}

class ApiClient {
  private baseURL: string
  private cache: Map<string, CacheEntry<any>> = new Map()
  private readonly CACHE_TTL = 30000 // 30 seconds cache for feed data (matches polling interval)
  private refreshTokenCallback: (() => Promise<string | null>) | null = null
  private isRefreshing = false
  private refreshPromise: Promise<string | null> | null = null

  constructor() {
    this.baseURL = config.apiBaseUrl
  }

  // Set the callback for refreshing tokens (called from AuthContext)
  setRefreshTokenCallback(callback: () => Promise<string | null>) {
    this.refreshTokenCallback = callback
  }

  // Attempt to refresh the token, ensuring only one refresh happens at a time
  private async attemptTokenRefresh(): Promise<string | null> {
    if (!this.refreshTokenCallback) return null

    // If already refreshing, wait for that to complete
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise
    }

    this.isRefreshing = true
    this.refreshPromise = this.refreshTokenCallback()
      .finally(() => {
        this.isRefreshing = false
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  // Get cached response if still valid
  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.data as T
    }
    return null
  }

  // Set cache entry
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  // Clear specific cache entry or all cache
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key)
    } else {
      this.cache.clear()
    }
  }

  private getAuthToken(): string | null {
    return localStorage.getItem('vapai-auth-token')
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retries: number = 3): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    const token = this.getAuthToken()

    for (let attempt = 1; attempt <= retries; attempt++) {
      // Create timeout controller for each attempt
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout (increased for slow Supabase)

      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers,
          },
          signal: controller.signal,
          ...options,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          // Handle 401 Unauthorized - attempt token refresh
          if (response.status === 401 && this.refreshTokenCallback) {
            const newToken = await this.attemptTokenRefresh()
            if (newToken) {
              // Retry the request with the new token (only once)
              if (attempt === 1) {
                const retryResponse = await fetch(url, {
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${newToken}`,
                    ...options.headers,
                  },
                  ...options,
                })
                if (retryResponse.ok) {
                  return retryResponse.json()
                }
              }
            }
            throw new Error('Session expired. Please log in again.')
          }

          // Don't retry on client errors (4xx), only on server errors (5xx) and network issues
          if (response.status >= 400 && response.status < 500) {
            // Extract FastAPI error detail from response body
            let detail = `${response.status} ${response.statusText}`
            try {
              const body = await response.json()
              if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
            } catch {}
            const err = new Error(detail)
            ;(err as any).noRetry = true
            throw err
          }
          throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      } catch (error) {
        clearTimeout(timeoutId)

        // AbortError or 4xx client errors = don't retry
        if (error instanceof Error && (error.name === 'AbortError' || (error as any).noRetry)) {
          throw error
        }

        // Log non-abort errors
        if (attempt < retries) {
          console.warn(`API request attempt ${attempt}/${retries} failed:`, error)
        }

        // If this is the last attempt, throw the error
        if (attempt === retries) {
          // Provide more user-friendly error messages
          if (error instanceof Error) {
            if (error.message.includes('Resource temporarily unavailable') ||
                error.message.includes('ECONNREFUSED') ||
                error.message.includes('ENOTFOUND')) {
              throw new Error('Unable to connect to the server. Please check your connection and try again.')
            }
          }
          throw error
        }

        // Wait before retrying (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw new Error('All retry attempts failed')
  }

  // Legacy Job endpoints - redirect to video-jobs (backward compatibility)
  // These were primarily used for video workflows (lipsync, multitalk, etc.)
  async createJob(payload: any) {
    // Transform legacy payload to new format
    const videoJobPayload = {
      user_id: payload.user_id,
      workflow_name: payload.workflow_name || payload.workflow_type || 'lipsync-one',
      comfy_url: payload.comfy_url,
      comfy_job_id: payload.job_id,
      input_image_urls: payload.image_filename ? [payload.image_filename] : undefined,
      input_audio_urls: payload.audio_filename ? [payload.audio_filename] : undefined,
      width: payload.width,
      height: payload.height,
      parameters: payload.trim_to_audio !== undefined ? { trim_to_audio: payload.trim_to_audio } : undefined,
      project_id: payload.project_id,
    }
    return this.request('/video-jobs', {
      method: 'POST',
      body: JSON.stringify(videoJobPayload),
    })
  }

  async updateJobToProcessing(jobId: string) {
    // jobId is the comfy_job_id - use the video-jobs endpoint
    return this.request(`/video-jobs/${jobId}/processing`, {
      method: 'PUT',
    })
  }

  async completeJob(jobId: string, payload: any) {
    // Transform legacy payload to new format
    const completePayload = {
      job_id: jobId,
      status: payload.status === 'error' ? 'failed' : payload.status,
      output_video_urls: payload.video_url ? [payload.video_url] : undefined,
      error_message: payload.error_message,
    }
    return this.request(`/video-jobs/${jobId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(completePayload),
    })
  }

  async getRecentJobs(limit: number = 50, offset: number = 0) {
    const cacheKey = `jobs-recent-${limit}-${offset}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    // Redirect to video-jobs feed
    const result = await this.request<{ success: boolean; video_jobs: unknown[]; error?: string }>(`/video-jobs/feed?limit=${limit}&offset=${offset}`)
    // Transform response for backward compatibility
    const transformed = {
      success: result.success,
      jobs: result.video_jobs,
      error: result.error
    }
    this.setCache(cacheKey, transformed)
    return transformed
  }

  async getJob(jobId: string) {
    // Try to get from video-jobs
    const result = await this.request<{ success: boolean; video_job: unknown; error?: string }>(`/video-jobs/${jobId}`)
    return {
      success: result.success,
      job: result.video_job,
      error: result.error
    }
  }

  async getCompletedJobsWithVideos(limit: number = 20, offset: number = 0) {
    const cacheKey = `jobs-completed-videos-${limit}-${offset}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    // Redirect to video-jobs completed endpoint
    const result = await this.request<{ success: boolean; video_jobs: unknown[]; error?: string }>(`/video-jobs/completed/recent?limit=${limit}&offset=${offset}`)
    const transformed = {
      success: result.success,
      jobs: result.video_jobs,
      error: result.error
    }
    this.setCache(cacheKey, transformed)
    return transformed
  }

  // Storage endpoints
  async uploadImageFromUrl(imageUrl: string, folder: string = 'images') {
    return this.request('/storage/images/upload-from-url', {
      method: 'POST',
      body: JSON.stringify({ image_url: imageUrl, folder }),
    })
  }

  async uploadVideoToStorage(payload: any) {
    return this.request('/storage/videos/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async deleteVideoFromStorage(publicUrl: string) {
    return this.request(`/storage/videos?public_url=${encodeURIComponent(publicUrl)}`, {
      method: 'DELETE',
    })
  }

  async listStorageVideos() {
    return this.request('/storage/videos')
  }

  // Dataset endpoints
  async createDataset(formData: FormData) {
    return fetch(`${this.baseURL}/datasets`, {
      method: 'POST',
      body: formData, // Don't set Content-Type for FormData
    }).then(response => {
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      return response.json()
    })
  }

  async getAllDatasets() {
    return this.request('/datasets')
  }

  async loadDataset(datasetId: string) {
    return this.request(`/datasets/${datasetId}`)
  }

  async uploadDatasetImage(datasetId: string, formData: FormData) {
    return fetch(`${this.baseURL}/datasets/${datasetId}/images`, {
      method: 'POST',
      body: formData,
    }).then(response => {
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
      return response.json()
    })
  }

  // Image editing endpoints
  async editImage(imageData: string, prompt: string) {
    return this.request('/image-edit', {
      method: 'POST',
      body: JSON.stringify({
        image_data: imageData,
        prompt: prompt,
      }),
    })
  }

  async checkOpenRouterConfig() {
    return this.request('/image-edit/health')
  }

  // ComfyUI endpoints
  async getComfyUIStatus(baseUrl?: string) {
    const queryParam = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : ''
    return this.request(`/comfyui/status${queryParam}`)
  }

  async uploadAudioToComfyUI(baseUrl: string, audioFile: File) {
    const formData = new FormData()
    formData.append('audio', audioFile)
    
    return fetch(`${this.baseURL}/comfyui/upload-audio?base_url=${encodeURIComponent(baseUrl)}`, {
      method: 'POST',
      body: formData,
    }).then(response => {
      if (!response.ok) {
        throw new Error(`Audio upload failed: ${response.status} ${response.statusText}`)
      }
      return response.json()
    })
  }

  async submitPromptToComfyUI(baseUrl: string, prompt: any, clientId: string) {
    // Use longer timeout for workflow submissions with large base64 images
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout

    try {
      const response = await fetch(`${this.baseURL}/comfyui/submit-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_url: baseUrl,
          prompt: prompt,
          client_id: clientId,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out. The workflow may be too large or the server is slow.')
      }
      throw error
    }
  }

  async submitWorkflow(workflowName: string, parameters: any, baseUrl: string, clientId: string, comfyuiApiKey?: string) {
    const payload: any = {
      workflow_name: workflowName,
      parameters: parameters,
      base_url: baseUrl,
      client_id: clientId,
    }

    // Add ComfyUI API key if provided (required for paid API nodes like Gemini)
    if (comfyuiApiKey) {
      payload.comfyui_api_key = comfyuiApiKey
    }

    return this.request('/comfyui/submit-workflow', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async listWorkflows() {
    return this.request('/comfyui/workflows')
  }

  async getWorkflowParameters(workflowName: string) {
    return this.request(`/comfyui/workflows/${workflowName}/parameters`)
  }

  async getComfyUIHistory(baseUrl: string, jobId: string) {
    const queryParam = `?base_url=${encodeURIComponent(baseUrl)}`
    return this.request(`/comfyui/history/${jobId}${queryParam}`)
  }

  async uploadImageToComfyUI(baseUrl: string, file: File) {
    const formData = new FormData()
    formData.append('image', file)

    const url = `${this.baseURL}/comfyui/upload-image?base_url=${encodeURIComponent(baseUrl)}`
    console.log('Upload URL:', url)
    console.log('File:', file.name, file.size, 'bytes')

    // Use fetch directly to avoid Content-Type header issues with FormData
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout for file uploads

    try {
      console.log('Sending upload request...')
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        // Don't set Content-Type - browser will set it with multipart boundary
      })

      clearTimeout(timeoutId)
      console.log('Upload response status:', response.status, response.statusText)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Upload failed:', response.status, errorText)
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      console.log('Upload result:', result)
      return result
    } catch (error) {
      clearTimeout(timeoutId)
      console.error('Upload error:', error)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Upload timed out. Please try again.')
      }
      throw error
    }
  }

  // Legacy Edited Images endpoints - redirect to image-jobs (backward compatibility)
  async createEditedImage(payload: any) {
    // Transform to image-jobs format
    const imageJobPayload = {
      user_id: payload.user_id,
      workflow_name: 'image-edit',
      comfy_url: payload.comfy_url,
      comfy_job_id: payload.comfy_job_id,
      input_image_urls: payload.original_image_url ? [payload.original_image_url] : undefined,
      prompt: payload.edit_prompt,
      width: payload.width,
      height: payload.height,
      project_id: payload.project_id,
    }
    return this.request('/image-jobs', {
      method: 'POST',
      body: JSON.stringify(imageJobPayload),
    })
  }

  async getEditedImage(imageId: string) {
    const result = await this.request<{ success: boolean; image_job: unknown; error?: string }>(`/image-jobs/${imageId}`)
    return { success: result.success, edited_image: result.image_job, error: result.error }
  }

  async updateEditedImage(imageId: string, payload: any) {
    return this.request(`/image-jobs/${imageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async updateToProcessing(imageId: string) {
    return this.request(`/image-jobs/${imageId}/processing`, {
      method: 'PUT',
    })
  }

  async completeEditedImage(imageId: string, resultImageUrl: string, _processingTimeSeconds?: number, _modelUsed?: string) {
    const payload = {
      job_id: imageId,
      status: 'completed',
      output_image_urls: [resultImageUrl],
    }
    return this.request(`/image-jobs/${imageId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async failEditedImage(imageId: string, errorMessage: string) {
    const payload = {
      job_id: imageId,
      status: 'failed',
      error_message: errorMessage,
    }
    return this.request(`/image-jobs/${imageId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getRecentEditedImages(limit: number = 20, offset: number = 0, completedOnly: boolean = false) {
    const cacheKey = `edited-images-${limit}-${offset}-${completedOnly}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      workflow_name: 'image-edit',
    })
    if (completedOnly) params.append('status', 'completed')

    const result = await this.request<{ success: boolean; image_jobs: unknown[]; total_count: number; error?: string }>(`/image-jobs/feed?${params.toString()}`)
    const transformed = {
      success: result.success,
      edited_images: result.image_jobs,
      total_count: result.total_count,
      error: result.error
    }
    this.setCache(cacheKey, transformed)
    return transformed
  }

  // Legacy Style Transfer endpoints - redirect to image-jobs (backward compatibility)
  async createStyleTransfer(payload: any) {
    const imageJobPayload = {
      user_id: payload.user_id,
      workflow_name: 'style-transfer',
      comfy_url: payload.comfy_url,
      comfy_job_id: payload.comfy_job_id,
      input_image_urls: [payload.subject_image_url, payload.style_image_url].filter(Boolean),
      prompt: payload.prompt,
      width: payload.width,
      height: payload.height,
      project_id: payload.project_id,
    }
    return this.request('/image-jobs', {
      method: 'POST',
      body: JSON.stringify(imageJobPayload),
    })
  }

  async getStyleTransfer(transferId: string) {
    const result = await this.request<{ success: boolean; image_job: unknown; error?: string }>(`/image-jobs/${transferId}`)
    return { success: result.success, style_transfer: result.image_job, error: result.error }
  }

  async updateStyleTransfer(transferId: string, payload: any) {
    return this.request(`/image-jobs/${transferId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async updateStyleTransferToProcessing(transferId: string) {
    return this.request(`/image-jobs/${transferId}/processing`, {
      method: 'PUT',
    })
  }

  async completeStyleTransfer(transferId: string, resultImageUrl: string, _processingTimeSeconds?: number, _modelUsed?: string) {
    const payload = {
      job_id: transferId,
      status: 'completed',
      output_image_urls: [resultImageUrl],
    }
    return this.request(`/image-jobs/${transferId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async failStyleTransfer(transferId: string, errorMessage: string) {
    const payload = {
      job_id: transferId,
      status: 'failed',
      error_message: errorMessage,
    }
    return this.request(`/image-jobs/${transferId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getRecentStyleTransfers(limit: number = 20, offset: number = 0, completedOnly: boolean = false) {
    const cacheKey = `style-transfers-${limit}-${offset}-${completedOnly}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      workflow_name: 'style-transfer',
    })
    if (completedOnly) params.append('status', 'completed')

    const result = await this.request<{ success: boolean; image_jobs: unknown[]; total_count: number; error?: string }>(`/image-jobs/feed?${params.toString()}`)
    const transformed = {
      success: result.success,
      style_transfers: result.image_jobs,
      total_count: result.total_count,
      error: result.error
    }
    this.setCache(cacheKey, transformed)
    return transformed
  }

  // Legacy method - no longer needed, use submitWorkflow or submitPromptToComfyUI directly
  async submitStyleTransferToComfyUI(_comfyUrl: string, _transferId: string, _promptJson: any) {
    console.warn('submitStyleTransferToComfyUI is deprecated - use submitWorkflow instead')
    return { success: false, error: 'This method is deprecated' }
  }

  // DEPRECATED: Legacy v2/v3 style transfer methods - these endpoints have been removed
  // Style transfers should now use the unified image-jobs workflow
  async submitStyleTransferWithUpload(_payload: {
    subject_image_data: string;
    style_image_data: string;
    prompt: string;
    workflow_json: any;
    comfy_url?: string;
  }) {
    console.warn('submitStyleTransferWithUpload is deprecated - use submitWorkflow with workflow_name="style-transfer" instead')
    return { success: false, error: 'This method is deprecated. Use the image-jobs API with workflow_name="style-transfer"' }
  }

  async completeStyleTransferWithUpload(_transferId: string, _resultUrl: string) {
    console.warn('completeStyleTransferWithUpload is deprecated - use completeImageJob instead')
    return { success: false, error: 'This method is deprecated. Use the image-jobs API' }
  }

  // DEPRECATED: Legacy template-based approach - now use submitWorkflow directly
  async submitStyleTransferWithTemplate(_payload: {
    subject_image_data: string;
    style_image_data: string;
    prompt: string;
    width: number;
    height: number;
    comfy_url?: string;
  }) {
    console.warn('submitStyleTransferWithTemplate is deprecated - use submitWorkflow with workflow_name="style-transfer" instead')
    return { success: false, error: 'This method is deprecated. Use submitWorkflow with workflow_name="style-transfer"' }
  }

  async completeStyleTransferV3(_transferId: string, _resultUrl: string) {
    console.warn('completeStyleTransferV3 is deprecated - use completeImageJob instead')
    return { success: false, error: 'This method is deprecated. Use the image-jobs API' }
  }

  // Unified Feed endpoints (optimized - single request for all feed types)
  async getUnifiedFeed(params?: {
    limit?: number;
    offset?: number;
    completedOnly?: boolean;
    types?: string; // Comma-separated: 'video,edited_image,style_transfer'
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.completedOnly) queryParams.append('completed_only', 'true')
    if (params?.types) queryParams.append('types', params.types)

    const query = queryParams.toString()
    const cacheKey = `unified-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/feed/unified${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getVideoFeed(params?: {
    limit?: number;
    offset?: number;
    completedOnly?: boolean;
    workflowName?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.completedOnly) queryParams.append('completed_only', 'true')
    if (params?.workflowName) queryParams.append('workflow_name', params.workflowName)

    const query = queryParams.toString()
    const cacheKey = `video-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/feed/videos${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getImagesFeed(params?: {
    limit?: number;
    offset?: number;
    completedOnly?: boolean;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.completedOnly) queryParams.append('completed_only', 'true')

    const query = queryParams.toString()
    const cacheKey = `images-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/feed/images${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getStyleTransfersFeed(params?: {
    limit?: number;
    offset?: number;
    completedOnly?: boolean;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.completedOnly) queryParams.append('completed_only', 'true')

    const query = queryParams.toString()
    const cacheKey = `style-transfers-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/feed/style-transfers${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  // MultiTalk endpoints
  async uploadAudioForMultiTalk(audioFile: File, comfyUrl: string = "https://comfy.vapai.studio") {
    const formData = new FormData()
    formData.append('audio', audioFile)
    formData.append('comfy_url', comfyUrl)
    
    return fetch(`${this.baseURL}/multitalk/upload-audio`, {
      method: 'POST',
      body: formData,
    }).then(response => {
      if (!response.ok) {
        throw new Error(`Audio upload failed: ${response.status} ${response.statusText}`)
      }
      return response.json()
    })
  }

  async submitMultiTalkWithTemplate(payload: {
    image_data: string;
    audio_filename: string;
    width: number;
    height: number;
    mode: string;
    audio_scale?: number;
    custom_prompt: string;
    trim_to_audio: boolean;
    audio_end_time?: number;
    comfy_url?: string;
  }) {
    return this.request('/multitalk/submit-with-template', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getMultiTalkTemplates() {
    return this.request('/multitalk/templates')
  }

  // Video Jobs endpoints (new output-type-based system)
  async createVideoJob(payload: any) {
    return this.request('/video-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getVideoJobs(params?: {
    limit?: number;
    offset?: number;
    workflow_name?: string;
    user_id?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.workflow_name) queryParams.append('workflow_name', params.workflow_name)
    if (params?.user_id) queryParams.append('user_id', params.user_id)
    if (params?.status) queryParams.append('status', params.status)

    const query = queryParams.toString()
    const cacheKey = `video-jobs-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    // Use optimized /feed endpoint with server-side caching
    const result = await this.request(`/video-jobs/feed${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getCompletedVideoJobs(params?: {
    limit?: number;
    offset?: number;
    workflow_name?: string;
    user_id?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.workflow_name) queryParams.append('workflow_name', params.workflow_name)
    if (params?.user_id) queryParams.append('user_id', params.user_id)

    const query = queryParams.toString()
    const cacheKey = `video-jobs-completed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/video-jobs/completed/recent/${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getVideoJob(jobId: string) {
    return this.request(`/video-jobs/${jobId}`)
  }

  async getVideoJobByComfyId(comfyJobId: string) {
    return this.request(`/video-jobs/comfy/${comfyJobId}`)
  }

  async updateVideoJobToProcessing(jobId: string) {
    return this.request(`/video-jobs/${jobId}/processing`, {
      method: 'PUT',
    })
  }

  async updateVideoJob(jobId: string, payload: any) {
    return this.request(`/video-jobs/${jobId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async completeVideoJob(jobId: string, payload: any) {
    return this.request(`/video-jobs/${jobId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  // Image Jobs endpoints (new output-type-based system)
  async createImageJob(payload: any) {
    return this.request('/image-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getImageJobs(params?: {
    limit?: number;
    offset?: number;
    workflow_name?: string;
    user_id?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.workflow_name) queryParams.append('workflow_name', params.workflow_name)
    if (params?.user_id) queryParams.append('user_id', params.user_id)
    if (params?.status) queryParams.append('status', params.status)

    const query = queryParams.toString()
    const cacheKey = `image-jobs-feed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    // Use optimized /feed endpoint with server-side caching
    const result = await this.request(`/image-jobs/feed${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getCompletedImageJobs(params?: {
    limit?: number;
    offset?: number;
    workflow_name?: string;
    user_id?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    if (params?.offset) queryParams.append('offset', params.offset.toString())
    if (params?.workflow_name) queryParams.append('workflow_name', params.workflow_name)
    if (params?.user_id) queryParams.append('user_id', params.user_id)

    const query = queryParams.toString()
    const cacheKey = `image-jobs-completed-${query}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/image-jobs/completed/recent${query ? `?${query}` : ''}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getImageJob(jobId: string) {
    return this.request(`/image-jobs/${jobId}`)
  }

  async getImageJobByComfyId(comfyJobId: string) {
    return this.request(`/image-jobs/comfy/${comfyJobId}`)
  }

  async updateImageJobToProcessing(jobId: string) {
    return this.request(`/image-jobs/${jobId}/processing`, {
      method: 'PUT',
    })
  }

  async updateImageJob(jobId: string, payload: any) {
    return this.request(`/image-jobs/${jobId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async completeImageJob(jobId: string, payload: any) {
    return this.request(`/image-jobs/${jobId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  // LoRA Trainer endpoints (Musubi Tuner for QWEN Image LoRA)
  async startMusubiTraining(payload: {
    images: Array<{ filename: string; data: string; caption: string }>;
    output_name: string;
    network_dim?: number;
    network_alpha?: number;
    learning_rate?: number;
    max_train_epochs?: number;
    max_train_steps?: number;
    seed?: number;
    resolution?: [number, number];
  }) {
    // Use longer timeout for training requests with potentially large base64 images
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minute timeout
    const token = this.getAuthToken()

    try {
      const response = await fetch(`${this.baseURL}/lora-trainer/train`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Training request timed out. The server may be processing the request.')
      }
      throw error
    }
  }

  async getMusubiTrainingStatus(jobId: string) {
    return this.request(`/lora-trainer/status/${jobId}`)
  }

  async getMusubiTrainingJobs() {
    return this.request('/lora-trainer/jobs')
  }

  async cancelMusubiTraining(jobId: string) {
    return this.request(`/lora-trainer/cancel/${jobId}`, {
      method: 'POST',
    })
  }

  async getMusubiTrainingLogs(jobId: string) {
    return this.request(`/lora-trainer/logs/${jobId}`)
  }

  async checkMusubiHealth() {
    return this.request('/lora-trainer/health')
  }

  // Profile picture methods
  async uploadProfilePicture(file: File): Promise<{ success: boolean; profile_picture_url: string }> {
    const formData = new FormData()
    formData.append('file', file)

    const token = this.getAuthToken()
    const url = `${this.baseURL}/auth/upload-avatar`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(errorData.detail || 'Failed to upload profile picture')
    }

    return response.json()
  }

  async deleteProfilePicture(): Promise<{ success: boolean; message: string }> {
    return this.request('/auth/delete-avatar', {
      method: 'DELETE',
    })
  }

  async updateProfile(data: { full_name?: string }): Promise<any> {
    return this.request('/auth/update-profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // Google Drive endpoints
  async checkGoogleDriveConnection() {
    return this.request('/google-drive/status')
  }

  async listGoogleDriveFiles(params?: {
    folderId?: string;
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }) {
    const queryParams = new URLSearchParams()
    if (params?.folderId) queryParams.append('folder_id', params.folderId)
    if (params?.pageSize) queryParams.append('page_size', params.pageSize.toString())
    if (params?.pageToken) queryParams.append('page_token', params.pageToken)
    if (params?.orderBy) queryParams.append('order_by', params.orderBy)

    const query = queryParams.toString()
    return this.request(`/google-drive/files${query ? `?${query}` : ''}`)
  }

  async getGoogleDriveFolder(folderId: string) {
    return this.request(`/google-drive/folders/${folderId}`)
  }

  // Virtual Set (World Labs / Marble API)
  async generateVirtualSetWorld(imageData: string, displayName?: string, model?: string) {
    return this.request('/virtual-set/generate', {
      method: 'POST',
      body: JSON.stringify({
        image_data: imageData,
        display_name: displayName || 'Virtual Set Scene',
        model: model || 'Marble 0.1-plus',
      }),
    })
  }

  async getVirtualSetStatus(operationId: string) {
    return this.request(`/virtual-set/status/${operationId}`)
  }

  async reconstructVirtualSet(screenshotData: string, originalImageData: string, prompt?: string) {
    return this.request('/virtual-set/reconstruct', {
      method: 'POST',
      body: JSON.stringify({
        screenshot_data: screenshotData,
        original_image_data: originalImageData,
        prompt: prompt || '',
      }),
    })
  }

  async saveVirtualSetWorld(imageData: string, splatUrl: string, worldId?: string, model?: string) {
    return this.request('/virtual-set/save-world', {
      method: 'POST',
      body: JSON.stringify({
        image_data: imageData,
        splat_url: splatUrl,
        world_id: worldId || null,
        model: model || 'Marble 0.1-plus',
      }),
    })
  }

  async checkVirtualSetConfig() {
    return this.request('/virtual-set/health')
  }

  // ============================================================================
  // RunPod Serverless Methods
  // ============================================================================

  async submitWorkflowToRunPod(
    workflowName: string,
    parameters: Record<string, any>,
    endpointId?: string
  ) {
    return this.request('/runpod/submit-workflow', {
      method: 'POST',
      body: JSON.stringify({
        workflow_name: workflowName,
        parameters,
        endpoint_id: endpointId
      })
    })
  }

  async getRunPodJobStatus(jobId: string, endpointId?: string) {
    const params = new URLSearchParams()
    if (endpointId) params.append('endpoint_id', endpointId)

    const query = params.toString()
    return this.request(`/runpod/status/${jobId}${query ? `?${query}` : ''}`)
  }

  async cancelRunPodJob(jobId: string, endpointId?: string) {
    const params = new URLSearchParams()
    if (endpointId) params.append('endpoint_id', endpointId)

    const query = params.toString()
    return this.request(`/runpod/cancel/${jobId}${query ? `?${query}` : ''}`, {
      method: 'POST'
    })
  }

  async getRunPodHealth() {
    return this.request('/runpod/health')
  }

  async getRunPodEndpointInfo(endpointId?: string) {
    const params = new URLSearchParams()
    if (endpointId) params.append('endpoint_id', endpointId)

    const query = params.toString()
    return this.request(`/runpod/endpoint-info${query ? `?${query}` : ''}`)
  }

  async updateUserMetadata(metadata: Record<string, any>) {
    return this.request('/auth/update-metadata', {
      method: 'PUT',
      body: JSON.stringify(metadata)
    })
  }

  // ============================================================================
  // Infrastructure / Network Volume File Browser Methods
  // ============================================================================

  /**
   * List files and folders on RunPod network volume
   * @param path Directory path (empty string for root)
   * @param limit Max items per page (default 200)
   * @param continuationToken Pagination token from previous response
   */
  async listFiles(
    path: string = "",
    limit: number = 200,
    continuationToken?: string
  ): Promise<{
    items: Array<{
      type: "file" | "folder";
      name: string;
      path: string;
      size: number | null;
      sizeHuman: string | null;
      lastModified: string | null;
      childCount: number | null;
    }>;
    totalItems: number;
    hasMore: boolean;
    continuationToken: string | null;
  }> {
    const params = new URLSearchParams({
      path,
      limit: limit.toString(),
    });
    if (continuationToken) {
      params.append("continuation_token", continuationToken);
    }

    return this.request(`/infrastructure/files?${params.toString()}`);
  }

  /**
   * Step 1: Initialize a multipart upload. Returns upload_id, key, total_parts.
   */
  async initUpload(filename: string, targetPath: string, fileSize: number): Promise<{
    upload_id: string; key: string; total_parts: number;
  }> {
    return this.request('/infrastructure/upload/init', {
      method: 'POST',
      body: JSON.stringify({ filename, target_path: targetPath, file_size: fileSize }),
    });
  }

  /**
   * Step 2: Upload one 5MB chunk via XHR for upload progress events.
   * Returns the ETag — store it for the complete step.
   */
  uploadPart(
    uploadId: string,
    key: string,
    partNumber: number,
    chunk: Blob,
    onProgress: (loaded: number, total: number) => void
  ): Promise<{ part_number: number; etag: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('chunk', chunk, `part-${partNumber}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Part ${partNumber} upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error(`Network error on part ${partNumber}`));

      const token = localStorage.getItem('vapai-auth-token');
      xhr.open('PUT', `${this.baseURL}/infrastructure/upload/part?upload_id=${encodeURIComponent(uploadId)}&part_number=${partNumber}&key=${encodeURIComponent(key)}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  /**
   * Step 3: Finalize the multipart upload.
   */
  async completeUpload(uploadId: string, key: string, parts: Array<{ part_number: number; etag: string }>): Promise<{ success: boolean; key: string }> {
    return this.request('/infrastructure/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ upload_id: uploadId, key, parts }),
    });
  }

  /**
   * Abort: MUST be called on any upload failure to prevent orphaned S3 parts and storage charges.
   */
  async abortUpload(uploadId: string, key: string): Promise<{ success: boolean }> {
    return this.request('/infrastructure/upload/abort', {
      method: 'POST',
      body: JSON.stringify({ upload_id: uploadId, key }),
    });
  }

  /**
   * Download a file from the RunPod network volume.
   * Streams through the authenticated backend proxy (RunPod S3 does not support presigned URLs).
   * Uses fetch+blob — works for typical admin files. Large files (>1GB) may require
   * significant browser memory; this is a known limitation of the fetch+blob approach.
   * @param filePath  Full S3 key (e.g. "models/checkpoints/my-model.safetensors")
   * @param filename  Filename for the browser save dialog
   */
  async downloadFile(filePath: string, filename: string): Promise<void> {
    const token = this.getAuthToken();
    const url = `${this.baseURL}/infrastructure/download?path=${encodeURIComponent(filePath)}`;

    const response = await fetch(url, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Download failed: ${response.status} ${errorText}`);
    }

    // Stream to blob then trigger browser save dialog
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  /**
   * Delete a single file from the RunPod network volume.
   * Returns 403 if path is a protected system directory.
   */
  async deleteFile(path: string): Promise<{ success: boolean; path: string }> {
    return this.request(
      `/infrastructure/files?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Recursively delete all objects under a folder prefix.
   * Returns deleted_count — number of S3 objects removed.
   * WARNING: irreversible — use only after user confirmation.
   */
  async deleteFolder(path: string): Promise<{ success: boolean; path: string; deleted_count: number }> {
    return this.request(
      `/infrastructure/folders?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Move or rename a single file via server-side S3 copy + delete.
   * @param sourcePath Current S3 key
   * @param destPath   New S3 key (may be in a different directory = move, or same dir = rename)
   */
  async moveFile(sourcePath: string, destPath: string): Promise<{ success: boolean; source_path: string; dest_path: string }> {
    return this.request('/infrastructure/files/move', {
      method: 'POST',
      body: JSON.stringify({ source_path: sourcePath, dest_path: destPath }),
    });
  }

  /**
   * Move or rename a folder by recursively copying all objects then batch-deleting originals.
   * Large folders (>1000 files) may be slow — Heroku 30s timeout applies.
   */
  async moveFolder(sourcePath: string, destPath: string): Promise<{ success: boolean; source_path: string; dest_path: string; moved_count: number }> {
    return this.request('/infrastructure/folders/move', {
      method: 'POST',
      body: JSON.stringify({ source_path: sourcePath, dest_path: destPath }),
    });
  }

  async createFolder(path: string): Promise<{ success: boolean; path: string }> {
    return this.request('/infrastructure/folders', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  // ============================================================================
  // HuggingFace Download Methods
  // ============================================================================

  /**
   * Start a HuggingFace model download to the RunPod network volume.
   * Returns job_id immediately — poll getHFDownloadStatus for progress.
   * @param url         Full HuggingFace URL (blob or resolve form)
   * @param targetPath  Target directory on volume (e.g. "models/checkpoints")
   * @param hfToken     Optional HF access token for gated/private repos
   */
  async startHFDownload(
    url: string,
    targetPath: string,
    hfToken?: string
  ): Promise<{ success: boolean; job_id: string; filename: string; s3_key: string }> {
    return this.request('/infrastructure/hf-download', {
      method: 'POST',
      body: JSON.stringify({
        url,
        target_path: targetPath,
        hf_token: hfToken || undefined,
      }),
    });
  }

  /**
   * Poll the status of a HuggingFace download job.
   * Call every 2-3 seconds until status === "done" or "error".
   */
  async getHFDownloadStatus(jobId: string): Promise<{
    job_id: string;
    status: 'pending' | 'downloading' | 'uploading' | 'done' | 'error';
    progress_pct: number;
    bytes_done: number;
    total_bytes: number | null;
    filename: string;
    s3_key: string;
    error: string | null;
  }> {
    return this.request(`/infrastructure/hf-download/${encodeURIComponent(jobId)}`);
  }

  // Dockerfile editor methods (Phase 6)
  async getDockerfile(): Promise<{ success: boolean; content: string; sha: string; path: string }> {
    return this.request('/infrastructure/dockerfiles/content')
  }

  async saveDockerfile(
    content: string,
    sha: string,
    commitMessage: string,
    triggerDeploy: boolean = false
  ): Promise<{
    success: boolean;
    commit_sha: string;
    deploy_triggered: boolean;
    release?: { tag_name: string; html_url: string } | null;
    deploy_error?: string | null;
  }> {
    return this.request('/infrastructure/dockerfiles/content', {
      method: 'PUT',
      body: JSON.stringify({
        content,
        sha,
        commit_message: commitMessage,
        trigger_deploy: triggerDeploy,
      }),
    })
  }

  // Helper method for authenticated requests (backward compatibility)
  async fetchWithAuth(endpoint: string, options: RequestInit = {}) {
    return this.request(endpoint, options);
  }
}

export const apiClient = new ApiClient()