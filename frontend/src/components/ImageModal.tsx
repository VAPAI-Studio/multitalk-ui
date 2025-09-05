import { useState } from 'react'

// Define interface locally to avoid import issues
interface ImageItem {
  id: string
  type: 'edited-image' | 'style-transfer'
  created_at: string
  title: string
  status: string
  preview_url: string
  result_url?: string
  processing_time?: number
  source_image_url: string
  prompt: string
  workflow_name: string
  model_used?: string
  user_ip?: string
}

interface ImageModalProps {
  image: ImageItem
  isOpen: boolean
  onClose: () => void
}

export default function ImageModal({ image, isOpen, onClose }: ImageModalProps) {
  const [sourceLoaded, setSourceLoaded] = useState(false)
  const [resultLoaded, setResultLoaded] = useState(false)

  if (!isOpen) return null

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
          {/* Images Side by Side */}
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
                  alt="Original image"
                  className={`w-full max-h-96 object-contain ${sourceLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setSourceLoaded(true)}
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
                  <button
                    onClick={() => downloadImage(image.result_url!, `generated-${image.id}.png`)}
                    className="px-3 py-1 text-sm bg-green-100 hover:bg-green-200 text-green-800 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download
                  </button>
                )}
              </div>
              <div className="relative bg-gray-50 dark:bg-gray-900 rounded-2xl overflow-hidden">
                {image.result_url ? (
                  <>
                    {!resultLoaded && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                      </div>
                    )}
                    <img
                      src={image.result_url}
                      alt="Generated result"
                      className={`w-full max-h-96 object-contain ${resultLoaded ? 'opacity-100' : 'opacity-0'}`}
                      onLoad={() => setResultLoaded(true)}
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