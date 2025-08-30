import { useState, useEffect } from 'react'
import { apiClient } from './lib/apiClient'
import ImageModal from './components/ImageModal'

// Define interfaces locally to avoid import issues
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

export default function GenerationFeed() {
  const [editedImages, setEditedImages] = useState<EditedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedImage, setSelectedImage] = useState<EditedImage | null>(null)
  const itemsPerPage = 20

  const fetchEditedImages = async (page: number = 1, completedOnly: boolean = true) => {
    try {
      setLoading(true)
      setError(null)
      
      const offset = (page - 1) * itemsPerPage
      const response = await apiClient.getRecentEditedImages(itemsPerPage, offset, completedOnly) as EditedImagesResponse
      
      if (response.success) {
        setEditedImages(response.edited_images)
        setTotalCount(response.total_count)
      } else {
        setError(response.error || 'Failed to load edited images')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load edited images')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEditedImages(currentPage, !showAll)
  }, [currentPage, showAll])

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
  }

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

  const totalPages = Math.ceil(totalCount / itemsPerPage)

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="max-w-7xl mx-auto p-6 md:p-10">
        {/* Header */}
        <div className="text-center space-y-4 py-8 mb-8">
          <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
            Generation Feed
          </h1>
          <div className="text-lg md:text-xl font-medium text-gray-700">
            <span className="bg-gradient-to-r from-purple-100 to-pink-100 px-4 py-2 rounded-full border border-purple-200/50">
              🎨 AI Image Edits Gallery
            </span>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Explore your AI-generated image edits with before & after comparisons, prompts, and generation details.
          </p>
        </div>
        
        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-3 bg-white/80 rounded-2xl border border-gray-200/50 px-4 py-3 shadow-sm hover:shadow-md transition-all">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => {
                  setShowAll(e.target.checked)
                  setCurrentPage(1)
                }}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Show all images (including processing/failed)
              </span>
            </label>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600 bg-white/60 px-3 py-2 rounded-xl">
              {totalCount} total generations
            </div>
            <button
              onClick={() => fetchEditedImages(currentPage, !showAll)}
              className="px-4 py-2 text-sm bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:from-purple-600 hover:to-pink-600 transition-all shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <span className="ml-3 text-gray-600">Loading images...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-800 text-sm font-medium">Error loading images</p>
            <p className="text-red-600 text-xs mt-1">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && editedImages.length === 0 && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎨</div>
            <p className="text-gray-500 text-xl mb-2">
              No edited images found
            </p>
            <p className="text-gray-400 text-sm">
              {showAll ? 'No images have been created yet. Try using the Image Edit feature!' : 'No completed images available. Check back soon!'}
            </p>
          </div>
        )}

        {/* Image Grid */}
        {!loading && !error && editedImages.length > 0 && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {editedImages.map((image) => (
                <div 
                  key={image.id} 
                  className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:scale-[1.02]"
                  onClick={() => setSelectedImage(image)}
                >
                  {/* Status Badge */}
                  <div className="p-4 pb-2">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(image.status)}`}>
                        {image.status}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatTimeAgo(image.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Preview Image */}
                  <div className="px-4 mb-4">
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700">
                      {image.result_image_url ? (
                        <>
                          <img
                            src={image.result_image_url}
                            alt="Generated result"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute top-2 left-2">
                            <span className="bg-green-500/90 text-white text-xs px-2 py-1 rounded-full font-medium">
                              ✨ Generated
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
                            <span className="bg-white/90 text-gray-800 text-sm px-3 py-2 rounded-full font-medium">
                              {image.status === 'pending' ? '⏳ Pending' : 
                               image.status === 'processing' ? '⚙️ Processing...' :
                               image.status === 'failed' ? '❌ Failed' : '📁 Original'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Prompt Preview */}
                  <div className="px-4 pb-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                      "{image.prompt}"
                    </p>

                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span className="truncate">{image.workflow_name}</span>
                      {image.processing_time_seconds && (
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                          {formatProcessingTime(image.processing_time_seconds)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Click hint */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/20 to-transparent p-4 opacity-0 hover:opacity-100 transition-opacity">
                    <div className="text-center">
                      <span className="bg-white/90 text-gray-800 text-xs px-3 py-1 rounded-full font-medium">
                        👁️ Click to view details
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Previous
                </button>
                
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage} of {totalPages} ({totalCount} total)
                </span>
                
                <button
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Image Modal */}
        {selectedImage && (
          <ImageModal
            image={selectedImage}
            isOpen={!!selectedImage}
            onClose={() => setSelectedImage(null)}
          />
        )}
      </div>
    </div>
  )
}