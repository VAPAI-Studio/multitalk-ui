import { config } from '../config/environment'

class ApiClient {
  private baseURL: string

  constructor() {
    this.baseURL = config.apiBaseUrl
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retries: number = 3): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Add timeout to prevent hanging requests
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout
        
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          signal: controller.signal,
          ...options,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          // Don't retry on client errors (4xx), only on server errors (5xx) and network issues
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`)
          }
          throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      } catch (error) {
        console.warn(`API request attempt ${attempt}/${retries} failed:`, error)
        
        // If this is the last attempt, throw the error
        if (attempt === retries) {
          // Provide more user-friendly error messages
          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              throw new Error('Request timed out. Please check your connection and try again.')
            }
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
    return this.request(`/jobs/recent?limit=${limit}&offset=${offset}`)
  }

  async getJob(jobId: string) {
    return this.request(`/jobs/${jobId}`)
  }

  async getCompletedJobsWithVideos(limit: number = 20, offset: number = 0) {
    return this.request(`/jobs/completed/with-videos?limit=${limit}&offset=${offset}`)
  }

  // Storage endpoints
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
    return this.request('/comfyui/submit-prompt', {
      method: 'POST',
      body: JSON.stringify({
        base_url: baseUrl,
        prompt: prompt,
        client_id: clientId,
      }),
    })
  }

  async submitWorkflow(workflowName: string, parameters: any, baseUrl: string, clientId: string) {
    return this.request('/comfyui/submit-workflow', {
      method: 'POST',
      body: JSON.stringify({
        workflow_name: workflowName,
        parameters: parameters,
        base_url: baseUrl,
        client_id: clientId,
      }),
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
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      completed_only: completedOnly.toString()
    })
    return this.request(`/edited-images?${params.toString()}`)
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
    const queryParams = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      completed_only: completedOnly.toString()
    })
    return this.request(`/style-transfers?${queryParams}`)
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
}

export const apiClient = new ApiClient()