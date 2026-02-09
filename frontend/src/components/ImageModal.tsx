import { useState, useEffect } from 'react'
import { apiClient } from '../lib/apiClient'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import type { ImageItem } from '../types/ui'

interface ImageModalProps {
  image: ImageItem
  isOpen: boolean
  onClose: () => void
  focusedImageIndex?: number // Index of the focused image (for multi-image jobs)
  comfyUrl?: string // ComfyUI server URL for upscaling
  onUpscaleComplete?: () => void // Callback when upscale completes (to refresh feed)
}

export default function ImageModal({ image, isOpen, onClose, focusedImageIndex, comfyUrl, onUpscaleComplete }: ImageModalProps) {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const [sourceLoaded, setSourceLoaded] = useState(false)
  const [resultLoaded, setResultLoaded] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(focusedImageIndex ?? 0)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const [upscaleStatus, setUpscaleStatus] = useState<string>('')

  // Reset current image index when modal opens or focused index changes
  useEffect(() => {
    setCurrentImageIndex(focusedImageIndex ?? 0)
  }, [focusedImageIndex, isOpen])

  if (!isOpen) return null

  // Check if this is a multi-image job (like image-grid)
  const isMultiImageJob = image.all_result_urls && image.all_result_urls.length > 1
  const currentImageUrl = isMultiImageJob
    ? image.all_result_urls![currentImageIndex]
    : image.result_url

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) {
      return `${diffInSeconds}s ago`
    } else if (diffInSeconds < 3600) {
      return `${Math.floor(diffInSeconds / 60)}m ago`
    } else if (diffInSeconds < 86400) {
      return `${Math.floor(diffInSeconds / 3600)}h ago`
    } else {
      return `${Math.floor(diffInSeconds / 86400)}d ago`
    }
  }

  const formatProcessingTime = (seconds?: number) => {
    if (!seconds) return null
    if (seconds < 60) {
      return `${seconds}s`
    } else {
      return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'processing':
        return 'bg-yellow-100 text-yellow-800'
      case 'pending':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const downloadImage = (imageUrl: string, filename: string) => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = filename
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Upscale the current image to 4K using Nanobanana workflow
  const handleUpscale = async () => {
    if (!comfyUrl || !currentImageUrl) {
      setUpscaleStatus('ComfyUI URL or image not available')
      return
    }

    setIsUpscaling(true)
    setUpscaleStatus('Preparing image...')

    let databaseJobId: string | null = null

    try {
      // 1. Fetch the image and convert to File for upload
      setUpscaleStatus('Downloading image...')
      const response = await fetch(currentImageUrl)
      if (!response.ok) {
        throw new Error('Failed to fetch image')
      }
      const blob = await response.blob()
      const filename = `upscale-source-${Date.now()}.png`
      const file = new File([blob], filename, { type: 'image/png' })

      // 2. Upload image to ComfyUI
      setUpscaleStatus('Uploading to ComfyUI...')
      const uploadFormData = new FormData()
      uploadFormData.append('image', file)
      const uploadResponse = await fetch(`${comfyUrl}/upload/image`, {
        method: 'POST',
        body: uploadFormData,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image to ComfyUI: ${uploadResponse.status}`)
      }

      const uploadData = await uploadResponse.json()
      const uploadedFilename = uploadData.name || filename

      // 3. Submit the Nanobanana_4K_Upscale workflow
      setUpscaleStatus('Submitting upscale workflow...')
      const clientId = `upscale-4k-${Math.random().toString(36).slice(2)}`
      const workflowResponse = await apiClient.submitWorkflow(
        'Nanobanana_4K_Upscale',
        {
          IMAGE_FILENAME: uploadedFilename
        },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string }

      if (!workflowResponse.success || !workflowResponse.prompt_id) {
        throw new Error(workflowResponse.error || 'Failed to submit upscale workflow')
      }

      const promptId = workflowResponse.prompt_id

      // 4. Create image job in database
      setUpscaleStatus('Creating job record...')
      const jobCreationResponse = await apiClient.createImageJob({
        user_id: user?.id || null,
        project_id: selectedProject?.id || null,
        comfy_job_id: promptId,
        workflow_name: 'nanobanana-upscale',
        comfy_url: comfyUrl,
        input_image_urls: [currentImageUrl],
        parameters: {
          source_image_id: image.id,
          source_workflow: image.workflow_name || 'unknown'
        }
      }) as any

      if (!jobCreationResponse.success || !jobCreationResponse.image_job?.id) {
        throw new Error('Failed to create job record in database')
      }

      databaseJobId = jobCreationResponse.image_job.id

      // 5. Poll for completion
      setUpscaleStatus('Upscaling in progress...')
      const startTime = Date.now()
      const maxWaitTime = 300000 // 5 minutes

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime
        if (elapsed > maxWaitTime) {
          throw new Error('Upscale timeout after 5 minutes')
        }

        try {
          const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, promptId) as {
            success: boolean;
            history?: any;
            error?: string;
          }

          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history')
          }

          const history = historyResponse.history
          const historyEntry = history?.[promptId]

          // Check for errors
          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message ||
                            historyEntry.status?.error ||
                            "Unknown error in ComfyUI"
            throw new Error(`ComfyUI error: ${errorMsg}`)
          }

          // Check if completed
          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            const outputs = historyEntry.outputs

            // Extract upscaled image from SaveImage node (node 81)
            const outputNode = outputs['81']
            if (!outputNode?.images || outputNode.images.length === 0) {
              throw new Error('No upscaled image found in output')
            }

            const imageInfo = outputNode.images[0]
            const comfyImageUrl = imageInfo.subfolder
              ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
              : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`

            // 6. Complete job with upscaled image URL
            setUpscaleStatus('Saving upscaled image...')
            if (!databaseJobId) {
              throw new Error('Database job ID is missing')
            }

            const completionResult = await apiClient.completeImageJob(databaseJobId, {
              job_id: databaseJobId,
              status: 'completed',
              output_image_urls: [comfyImageUrl]
            }) as any

            if (!completionResult.success) {
              throw new Error('Failed to save upscaled image')
            }

            setUpscaleStatus('Upscale complete!')
            setIsUpscaling(false)

            // Trigger feed refresh
            if (onUpscaleComplete) {
              onUpscaleComplete()
            }

            // Clear status after a delay
            setTimeout(() => setUpscaleStatus(''), 3000)
            return
          }

          // Still processing, poll again
          const elapsedSeconds = Math.floor(elapsed / 1000)
          setUpscaleStatus(`Upscaling in progress... (${elapsedSeconds}s)`)
          await new Promise(resolve => setTimeout(resolve, 3000))
          return pollForResult()

        } catch (pollError: any) {
          if (pollError.message.includes('timeout') || pollError.message.includes('save')) {
            throw pollError
          }
          await new Promise(resolve => setTimeout(resolve, 3000))
          return pollForResult()
        }
      }

      await pollForResult()

    } catch (err: any) {
      console.error('Upscale error:', err)
      setUpscaleStatus(`Error: ${err.message || 'Unknown error'}`)
      setIsUpscaling(false)

      // Mark job as failed if it was created
      if (databaseJobId) {
        await apiClient.completeImageJob(databaseJobId, {
          job_id: databaseJobId,
          status: 'error',
          error_message: err.message || 'Unknown error'
        }).catch(() => {})
      }

      // Clear error status after a delay
      setTimeout(() => setUpscaleStatus(''), 5000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-7xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Image Generation Details
            </h2>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(image.status)}`}>
              {image.status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Multi-Image Grid Layout (for image-grid jobs) */}
          {isMultiImageJob ? (
            <div className="mb-8">
              {/* Current Image Display with Navigation */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {currentImageIndex === 0 ? 'Full Grid' : `Image ${currentImageIndex}`}
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      ({currentImageIndex + 1} of {image.all_result_urls!.length})
                    </span>
                  </h3>
                  {currentImageUrl && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadImage(currentImageUrl, `grid-image-${currentImageIndex === 0 ? 'full' : currentImageIndex}-${image.id}.png`)}
                        className="px-3 py-1 text-sm bg-green-100 hover:bg-green-200 text-green-800 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download
                      </button>
                      {comfyUrl && (
                        <button
                          onClick={handleUpscale}
                          disabled={isUpscaling}
                          className="px-3 py-1 text-sm bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpscaling ? (
                            <>
                              <div className="w-3 h-3 border-2 border-purple-600/30 border-t-purple-600 rounded-full animate-spin" />
                              Upscaling...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                              </svg>
                              Upres to 4K
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Upscale Status */}
                {upscaleStatus && (
                  <div className={`mt-2 p-2 rounded-lg text-sm ${
                    upscaleStatus.includes('Error')
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : upscaleStatus.includes('complete')
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-purple-50 text-purple-700 border border-purple-200'
                  }`}>
                    {upscaleStatus}
                  </div>
                )}

                {/* Main Image with Navigation Arrows */}
                <div className="relative bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden">
                  {/* Previous Arrow */}
                  {currentImageIndex > 0 && (
                    <button
                      onClick={() => setCurrentImageIndex(currentImageIndex - 1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}

                  {/* Next Arrow */}
                  {currentImageIndex < image.all_result_urls!.length - 1 && (
                    <button
                      onClick={() => setCurrentImageIndex(currentImageIndex + 1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}

                  {currentImageUrl && (
                    <img
                      src={currentImageUrl}
                      alt={currentImageIndex === 0 ? 'Full Grid' : `Image ${currentImageIndex}`}
                      className="w-full max-h-[50vh] object-contain"
                    />
                  )}
                </div>

                {/* Thumbnail Navigation */}
                <div className="grid grid-cols-5 gap-2 mt-4">
                  {image.all_result_urls!.map((url, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={`aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                        currentImageIndex === index
                          ? 'border-purple-500 ring-2 ring-purple-300'
                          : 'border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <img
                        src={url}
                        alt={index === 0 ? 'Full Grid' : `Image ${index}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-0.5 text-center">
                        {index === 0 ? 'Grid' : index}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Source Image (smaller, below) */}
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Original Reference
                  </h3>
                  <button
                    onClick={() => downloadImage(image.source_image_url, `original-${image.id}.png`)}
                    className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download
                  </button>
                </div>
                <div className="relative bg-gray-50 dark:bg-gray-900 rounded-xl overflow-hidden max-w-xs">
                  <img
                    src={image.source_image_url}
                    alt="Original reference"
                    className="w-full max-h-32 object-contain"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Single Image Layout (original behavior) */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              {/* Source Image */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Original Image
                  </h3>
                  <button
                    onClick={() => downloadImage(image.source_image_url, `original-${image.id}.png`)}
                    className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download
                  </button>
                </div>
                <div className="relative bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden">
                  {!sourceLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  )}
                  <img
                    src={image.source_image_url}
                    alt={`Original image | Source: ${image.source_image_url.startsWith('data:') ? 'Data URL' : image.source_image_url.startsWith('blob:') ? 'Blob URL (may fail)' : image.source_image_url.includes('supabase') ? 'Supabase' : 'External'}`}
                    className={`w-full max-h-96 object-contain ${sourceLoaded ? 'opacity-100' : 'opacity-0'}`}
                    onLoad={() => setSourceLoaded(true)}
                    onError={(e) => {
                      console.error(`Failed to load source image: ${image.source_image_url}`)
                      const target = e.target as HTMLImageElement
                      target.alt = `Failed to load source: ${image.source_image_url.startsWith('blob:') ? 'Blob URL expired' : 'Image not accessible from localhost'}`
                    }}
                  />
                </div>
              </div>

              {/* Result Image */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Generated Result
                  </h3>
                  {image.result_url && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadImage(image.result_url!, `generated-${image.id}.png`)}
                        className="px-3 py-1 text-sm bg-green-100 hover:bg-green-200 text-green-800 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Download
                      </button>
                      {comfyUrl && (
                        <button
                          onClick={handleUpscale}
                          disabled={isUpscaling}
                          className="px-3 py-1 text-sm bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isUpscaling ? (
                            <>
                              <div className="w-3 h-3 border-2 border-purple-600/30 border-t-purple-600 rounded-full animate-spin" />
                              Upscaling...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                              </svg>
                              Upres to 4K
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {/* Upscale Status for single image */}
                {upscaleStatus && !isMultiImageJob && (
                  <div className={`p-2 rounded-lg text-sm ${
                    upscaleStatus.includes('Error')
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : upscaleStatus.includes('complete')
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-purple-50 text-purple-700 border border-purple-200'
                  }`}>
                    {upscaleStatus}
                  </div>
                )}
                <div className="relative bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden">
                  {image.result_url ? (
                    <>
                      {!resultLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                        </div>
                      )}
                      <img
                        src={image.result_url || ''}
                        alt={`Generated result | Source: ${image.result_url && image.result_url.startsWith('data:') ? 'Data URL' : image.result_url && image.result_url.startsWith('blob:') ? 'Blob URL (may fail)' : image.result_url && image.result_url.includes('supabase') ? 'Supabase' : 'External'}`}
                        className={`w-full max-h-96 object-contain ${resultLoaded ? 'opacity-100' : 'opacity-0'}`}
                        onLoad={() => setResultLoaded(true)}
                        onError={(e) => {
                          console.error(`Failed to load result image: ${image.result_url || 'undefined'}`)
                          const target = e.target as HTMLImageElement
                          target.alt = `Failed to load result: ${image.result_url && image.result_url.startsWith('blob:') ? 'Blob URL expired' : 'Image not accessible from localhost'}`
                        }}
                      />
                    </>
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-gray-400 dark:text-gray-500">
                      {image.status === 'pending' ? 'Pending...' :
                       image.status === 'processing' ? 'Processing...' :
                       image.status === 'failed' ? 'Generation Failed' : 'No result'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Prompt Section */}
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Generation Prompt
            </h3>
            <p className="text-gray-700 dark:text-gray-300 text-lg leading-relaxed">
              "{image.prompt}"
            </p>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Created</h4>
              <p className="text-sm text-gray-900 dark:text-gray-100">{formatTimeAgo(image.created_at)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {new Date(image.created_at).toLocaleString()}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Workflow</h4>
              <p className="text-sm text-gray-900 dark:text-gray-100">{image.workflow_name}</p>
            </div>

            {image.model_used && !image.model_used.startsWith('Error:') && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Model</h4>
                <p className="text-sm text-gray-900 dark:text-gray-100">{image.model_used}</p>
              </div>
            )}

            {image.processing_time && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Processing Time</h4>
                <p className="text-sm text-gray-900 dark:text-gray-100">{formatProcessingTime(image.processing_time)}</p>
              </div>
            )}
          </div>

          {/* Error Message */}
          {image.status === 'failed' && image.model_used?.startsWith('Error:') && (
            <div className="mt-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Error Details</h4>
              <p className="text-sm text-red-600 dark:text-red-300">{image.model_used.replace('Error: ', '')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}