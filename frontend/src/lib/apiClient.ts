import { config } from '../config/environment'

class ApiClient {
  private baseURL: string

  constructor() {
    this.baseURL = config.apiBaseUrl
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
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

  async getRecentJobs(limit: number = 50) {
    return this.request(`/jobs/recent?limit=${limit}`)
  }

  async getJob(jobId: string) {
    return this.request(`/jobs/${jobId}`)
  }

  async getCompletedJobsWithVideos(limit: number = 20) {
    return this.request(`/jobs/completed/with-videos?limit=${limit}`)
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

  async getComfyUIHistory(baseUrl: string, jobId: string) {
    const queryParam = `?base_url=${encodeURIComponent(baseUrl)}`
    return this.request(`/comfyui/history/${jobId}${queryParam}`)
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
}

export const apiClient = new ApiClient()