import { useState, useEffect } from 'react'
import { apiClient } from '../lib/apiClient'
import ImageModal from './ImageModal'

// Define interface locally to avoid import issues
interface EditedImage {
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

interface EditedImagesResponse {
  success: boolean
  edited_images: EditedImage[]
  total_count: number
  error?: string
}

interface RecentImagesFeedProps {
  refreshTrigger?: number // Optional prop to trigger refresh from parent
}

export default function RecentImagesFeed({ refreshTrigger }: RecentImagesFeedProps) {
  const [recentImages, setRecentImages] = useState<EditedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<EditedImage | null>(null)

  const fetchRecentImages = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiClient.getRecentEditedImages(10, 0, false) as EditedImagesResponse
      if (response.success) {
        setRecentImages(response.edited_images)
      } else {
        setError(response.error || 'Failed to load recent images')
      }
    } catch (err: any) {
      console.error('Failed to load recent images:', err)
      setError(err.message || 'Failed to load recent images')
    } finally {
      setLoading(false)
    }
  }

  // Load recent images on component mount and when refresh is triggered
  useEffect(() => {
    fetchRecentImages()
  }, [refreshTrigger])

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

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-200/50 h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🎨</span>
            Recent Generations
          </h3>
          <button
            onClick={fetchRecentImages}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-600">Your recent AI image edits</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500 mb-3"></div>
            <span className="text-sm text-gray-600">Loading...</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-red-800 text-sm font-medium">Error loading images</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
        ) : recentImages.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">🎨</div>
            <p className="text-sm">No recent generations</p>
            <p className="text-xs text-gray-400 mt-1">Your edited images will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentImages.map((image) => (
              <div
                key={image.id}
                className="bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-all cursor-pointer border border-gray-100"
                onClick={() => setSelectedImage(image)}
              >
                {/* Status and time */}
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(image.status)}`}>
                    {image.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatTimeAgo(image.created_at)}
                  </span>
                </div>

                {/* Image preview */}
                <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 mb-2">
                  {image.result_image_url ? (
                    <>
                      <img
                        src={image.result_image_url}
                        alt="Generated result"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2">
                        <span className="bg-green-500/90 text-white text-xs px-2 py-1 rounded-full font-medium">
                          ✨
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <img
                        src={image.source_image_url}
                        alt="Source"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="bg-white/90 text-gray-800 text-xs px-2 py-1 rounded-full font-medium">
                          {image.status === 'pending' ? '⏳' : 
                           image.status === 'processing' ? '⚙️' :
                           image.status === 'failed' ? '❌' : '📁'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Prompt preview */}
                <p className="text-xs text-gray-600 line-clamp-2">
                  "{image.prompt}"
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <ImageModal
          image={selectedImage}
          isOpen={!!selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  )
}