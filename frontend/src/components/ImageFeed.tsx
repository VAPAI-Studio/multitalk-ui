import { useState, useEffect } from 'react'
import { apiClient } from '../lib/apiClient'
import ImageModal from './ImageModal'

// Define interfaces
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

interface StyleTransfer {
  id: string
  created_at: string
  source_image_url: string
  style_image_url: string
  prompt: string
  result_image_url?: string
  workflow_name: string
  model_used?: string
  processing_time_seconds?: number
  user_ip?: string
  status: string
  comfyui_prompt_id?: string
  error_message?: string
  updated_at?: string
}

interface StyleTransfersResponse {
  success: boolean
  style_transfers: StyleTransfer[]
  total_count: number
  error?: string
}

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
  metadata: EditedImage | StyleTransfer
}

// Feed configuration
export interface ImageFeedConfig {
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  pageContext?: string // Identifies which page/tool this feed is on (e.g., 'image-edit', 'style-transfer')
}

interface ImageFeedProps {
  config: ImageFeedConfig
}

export default function ImageFeed({ config }: ImageFeedProps) {
  const [feedItems, setFeedItems] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [showFilteredOnly, setShowFilteredOnly] = useState(false) // Toggle between "Show All" and "Show Mine"
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  
  const loadFeed = async () => {
    setLoading(true)
    try {
      const items: ImageItem[] = []

      // Load edited images
      try {
        const response = await apiClient.getRecentEditedImages(config.maxItems || 10, 0, config.showCompletedOnly || false) as EditedImagesResponse
        
        if (response.success && response.edited_images) {
          for (const image of response.edited_images) {
            items.push({
              id: image.id,
              type: 'edited-image',
              created_at: image.created_at,
              title: image.prompt || 'Image Edit',
              status: image.status,
              preview_url: image.result_image_url || image.source_image_url,
              result_url: image.result_image_url,
              processing_time: image.processing_time_seconds,
              source_image_url: image.source_image_url,
              prompt: image.prompt,
              workflow_name: image.workflow_name,
              model_used: image.model_used,
              user_ip: image.user_ip,
              metadata: image
            })
          }
        }
      } catch (error) {
        console.error('Error loading edited images:', error)
      }

      // Load style transfers (always load both types for unified feed)
      try {
        const styleResponse = await apiClient.getRecentStyleTransfers(config.maxItems || 10, 0, config.showCompletedOnly || false) as StyleTransfersResponse
        
        if (styleResponse.success && styleResponse.style_transfers) {
          for (const transfer of styleResponse.style_transfers) {
            items.push({
              id: transfer.id,
              type: 'style-transfer',
              created_at: transfer.created_at,
              title: transfer.prompt || 'Style Transfer',
              status: transfer.status,
                              preview_url: transfer.result_image_url || transfer.source_image_url,
              result_url: transfer.result_image_url,
              processing_time: transfer.processing_time_seconds,
              source_image_url: transfer.source_image_url,
              prompt: transfer.prompt,
              workflow_name: transfer.workflow_name,
              model_used: transfer.model_used,
              user_ip: transfer.user_ip,
              metadata: transfer
            })
          }
        }
      } catch (error) {
        console.error('Error loading style transfers:', error)
      }

      // Sort by creation date (newest first)
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      
      // Apply filtering if needed
      const filteredItems = showFilteredOnly 
        ? items.filter(item => item.status === 'completed' && item.result_url)
        : items

      setFeedItems(filteredItems)
    } catch (error) {
      console.error('Error loading image feed:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFeed()
    
    // Refresh every 30 seconds
    const interval = setInterval(loadFeed, 30000)
    return () => clearInterval(interval)
  }, [config.showCompletedOnly, config.maxItems, showFilteredOnly])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100'
      case 'processing': return 'text-blue-600 bg-blue-100'
      case 'failed': return 'text-red-600 bg-red-100'
      case 'pending': return 'text-yellow-600 bg-yellow-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed'
      case 'processing': return 'Processing'
      case 'failed': return 'Failed'
      case 'pending': return 'Pending'
      default: return status
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-3">
          <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
          Image Generation Feed
        </h2>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilteredOnly(!showFilteredOnly)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              showFilteredOnly 
                ? 'bg-purple-100 text-purple-700 border border-purple-300' 
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}
          >
            {showFilteredOnly ? 'Show Completed Only' : 'Show All'}
          </button>
          <button
            onClick={loadFeed}
            disabled={loading}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full border border-blue-300 hover:bg-blue-200 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && feedItems.length === 0 ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading images...</p>
        </div>
      ) : feedItems.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">No images found</p>
        </div>
      ) : (
        <div className="space-y-4 flex-1 overflow-y-auto">
          {feedItems.map((item) => {
            // Show compact view for failed items
            if (item.status === 'failed') {
              return (
                <div key={item.id} className="border border-yellow-200 rounded-lg p-2 bg-yellow-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-600">
                      {item.id.slice(-8)}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                      {item.status}
                    </span>
                  </div>
                  <div className="text-xs text-yellow-600 mt-1 truncate">
                    {item.type === 'style-transfer' ? '🎨 Style Transfer' : '🖼️ Image Edit'}
                  </div>
                </div>
              )
            }
            
            // Full view for completed/processing items
            return (
              <div key={item.id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                {/* Image content */}
                <div 
                  className="aspect-video bg-gray-100 rounded-xl mb-3 relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setSelectedImage(item)}
                >
                  {item.preview_url ? (
                    <img 
                      src={item.preview_url} 
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-4xl mb-2">
                          {item.type === 'style-transfer' ? '🎨' : '🖼️'}
                        </div>
                        <p className="text-gray-400 text-sm">No preview</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Status badge */}
                  <div className="absolute top-2 right-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                      {getStatusText(item.status)}
                    </span>
                  </div>

                  {/* Type badge */}
                  <div className="absolute top-2 left-2">
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-black/70 text-white">
                      {item.type === 'style-transfer' ? 'Style' : 'Edit'}
                    </span>
                  </div>
                </div>
                
                {/* Content info */}
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                  
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    {item.processing_time && (
                      <span>{item.processing_time}s</span>
                    )}
                  </div>

                  {/* Result image if completed */}
                  {item.status === 'completed' && item.result_url && (
                    <div className="pt-2">
                      <a 
                        href={item.result_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="block w-full bg-purple-600 text-white text-center py-2 rounded-lg hover:bg-purple-700 transition-colors text-sm"
                      >
                        View Result
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
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
  )
}
