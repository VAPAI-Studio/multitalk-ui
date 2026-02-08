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
            throw new Error(`API request failed: ${response.status} ${response.statusText}`)
          }
          throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      } catch (error) {
        clearTimeout(timeoutId)

        // AbortError = intentional cancellation (React cleanup or timeout) - don't retry
        if (error instanceof Error && error.name === 'AbortError') {
          // Just re-throw silently - this is expected during component unmount
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

  // Job endpoints
  async createJob(payload: any) {
    return this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async updateJobToProcessing(jobId: string) {
    return this.request(`/jobs/${jobId}/processing`, {
      method: 'PUT',
    })
  }

  async completeJob(jobId: string, payload: any) {
    return this.request(`/jobs/${jobId}/complete`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getRecentJobs(limit: number = 50, offset: number = 0) {
    const cacheKey = `jobs-recent-${limit}-${offset}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/jobs/recent?limit=${limit}&offset=${offset}`)
    this.setCache(cacheKey, result)
    return result
  }

  async getJob(jobId: string) {
    return this.request(`/jobs/${jobId}`)
  }

  async getCompletedJobsWithVideos(limit: number = 20, offset: number = 0) {
    const cacheKey = `jobs-completed-videos-${limit}-${offset}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const result = await this.request(`/jobs/completed/with-videos?limit=${limit}&offset=${offset}`)
    this.setCache(cacheKey, result)
    return result
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

  // Edited Images endpoints
  async createEditedImage(payload: any) {
    return this.request('/edited-images', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getEditedImage(imageId: string) {
    return this.request(`/edited-images/${imageId}`)
  }

  async updateEditedImage(imageId: string, payload: any) {
    return this.request(`/edited-images/${imageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async updateToProcessing(imageId: string) {
    return this.request(`/edited-images/${imageId}/processing`, {
      method: 'PUT',
    })
  }

  async completeEditedImage(imageId: string, resultImageUrl: string, processingTimeSeconds?: number, modelUsed?: string) {
    const params = new URLSearchParams({ result_image_url: resultImageUrl })
    if (processingTimeSeconds !== undefined) params.append('processing_time_seconds', processingTimeSeconds.toString())
    if (modelUsed) params.append('model_used', modelUsed)
    
    return this.request(`/edited-images/${imageId}/complete?${params.toString()}`, {
      method: 'PUT',
    })
  }

  async failEditedImage(imageId: string, errorMessage: string) {
    const params = new URLSearchParams({ error_message: errorMessage })
    return this.request(`/edited-images/${imageId}/fail?${params.toString()}`, {
      method: 'PUT',
    })
  }

  async getRecentEditedImages(limit: number = 20, offset: number = 0, completedOnly: boolean = false) {
    const cacheKey = `edited-images-${limit}-${offset}-${completedOnly}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      completed_only: completedOnly.toString()
    })
    const result = await this.request(`/edited-images?${params.toString()}`)
    this.setCache(cacheKey, result)
    return result
  }

  // Style Transfer endpoints
  async createStyleTransfer(payload: any) {
    return this.request('/style-transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getStyleTransfer(transferId: string) {
    return this.request(`/style-transfers/${transferId}`)
  }

  async updateStyleTransfer(transferId: string, payload: any) {
    return this.request(`/style-transfers/${transferId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async updateStyleTransferToProcessing(transferId: string) {
    return this.request(`/style-transfers/${transferId}/processing`, {
      method: 'PUT',
    })
  }

  async completeStyleTransfer(transferId: string, resultImageUrl: string, processingTimeSeconds?: number, modelUsed?: string) {
    const queryParams = new URLSearchParams({
      result_image_url: resultImageUrl,
      ...(processingTimeSeconds && { processing_time_seconds: processingTimeSeconds.toString() }),
      ...(modelUsed && { model_used: modelUsed })
    })
    return this.request(`/style-transfers/${transferId}/complete?${queryParams}`, {
      method: 'PUT',
    })
  }

  async failStyleTransfer(transferId: string, errorMessage: string) {
    const queryParams = new URLSearchParams({
      error_message: errorMessage
    })
    return this.request(`/style-transfers/${transferId}/fail?${queryParams}`, {
      method: 'PUT',
    })
  }

  async getRecentStyleTransfers(limit: number = 20, offset: number = 0, completedOnly: boolean = false) {
    const cacheKey = `style-transfers-${limit}-${offset}-${completedOnly}`
    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const queryParams = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      completed_only: completedOnly.toString()
    })
    const result = await this.request(`/style-transfers?${queryParams}`)
    this.setCache(cacheKey, result)
    return result
  }

  async submitStyleTransferToComfyUI(comfyUrl: string, transferId: string, promptJson: any) {
    const queryParams = new URLSearchParams({
      comfy_url: comfyUrl,
      transfer_id: transferId
    })
    return this.request(`/style-transfers/submit-to-comfyui?${queryParams}`, {
      method: 'POST',
      body: JSON.stringify(promptJson),
    })
  }

  async submitStyleTransferWithUpload(payload: {
    subject_image_data: string;
    style_image_data: string;
    prompt: string;
    workflow_json: any;
    comfy_url?: string;
  }) {
    return this.request('/style-transfers-v2/submit-with-upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async completeStyleTransferWithUpload(transferId: string, resultUrl: string) {
    return this.request(`/style-transfers-v2/complete-with-upload/${transferId}`, {
      method: 'POST',
      body: JSON.stringify({ result_url: resultUrl }),
    })
  }

  // New template-based approach
  async submitStyleTransferWithTemplate(payload: {
    subject_image_data: string;
    style_image_data: string;
    prompt: string;
    width: number;
    height: number;
    comfy_url?: string;
  }) {
    return this.request('/style-transfers-v3/submit-with-template', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async completeStyleTransferV3(transferId: string, resultUrl: string) {
    return this.request(`/style-transfers-v3/complete-with-upload/${transferId}`, {
      method: 'POST',
      body: JSON.stringify({ result_url: resultUrl }),
    })
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
}

export const apiClient = new ApiClient()