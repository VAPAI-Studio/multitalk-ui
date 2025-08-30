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
}

export const apiClient = new ApiClient()