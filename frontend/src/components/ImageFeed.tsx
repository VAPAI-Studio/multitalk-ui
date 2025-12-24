import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../lib/apiClient'
import ImageModal from './ImageModal'
import type { ImageItem, StyleTransfer } from '../types/ui'
import type { EditedImagesResponse } from '../types/api'

// Response type for style transfers API
interface StyleTransfersResponse {
  success: boolean
  style_transfers: StyleTransfer[]
  total_count: number
  error?: string
}

// Feed configuration
export interface ImageFeedConfig {
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  pageContext?: string // Identifies which page/tool this feed is on (e.g., 'image-edit', 'style-transfer') - DEPRECATED, use workflowName
  useNewJobSystem?: boolean // Use new image_jobs table instead of edited_images + style_transfers
  workflowName?: string // Filter by workflow_name in new system (img2img, style-transfer, image-edit)
  userId?: string // Filter by user_id in new system
}

interface ImageFeedProps {
  config: ImageFeedConfig
}

export default function ImageFeed({ config }: ImageFeedProps) {
  const [feedItems, setFeedItems] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showFilteredOnly, setShowFilteredOnly] = useState(false) // Toggle between "Show All" and "Show Mine"
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [focusedImageIndex, setFocusedImageIndex] = useState<number | undefined>(undefined) // For multi-image modal navigation
  const [currentOffset, setCurrentOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const loadFeed = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setCurrentOffset(0)
      setHasMore(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const items: ImageItem[] = []
      const offset = reset ? 0 : currentOffset
      const limit = config.maxItems || 10

      // Use new image_jobs system if enabled
      if (config.useNewJobSystem) {
        const params = {
          limit,
          offset,
          workflow_name: config.workflowName,
          user_id: config.userId
        }

        const jobsResponse = config.showCompletedOnly
          ? await apiClient.getCompletedImageJobs(params) as any
          : await apiClient.getImageJobs(params) as any

        if (jobsResponse && jobsResponse.success && jobsResponse.image_jobs) {
          for (const job of jobsResponse.image_jobs) {
            // Filter out blob URLs
            const getValidImageUrl = (url?: string) => {
              if (!url || url.startsWith('blob:')) return undefined
              return url
            }

            const validResultUrl = getValidImageUrl(job.output_image_urls?.[0])
            const validSourceUrl = getValidImageUrl(job.input_image_urls?.[0])

            // Get all valid result URLs for multi-image outputs (like image-grid)
            const allValidResultUrls = (job.output_image_urls || [])
              .map((url: string) => getValidImageUrl(url))
              .filter((url: string | undefined): url is string => !!url)

            items.push({
              id: job.id,
              type: job.workflow_name === 'style-transfer' ? 'style-transfer' : 'edited-image',
              created_at: job.created_at,
              title: job.prompt || job.workflow_name || 'Image',
              status: job.status,
              preview_url: validResultUrl || validSourceUrl || '',
              result_url: validResultUrl,
              all_result_urls: allValidResultUrls.length > 0 ? allValidResultUrls : undefined,
              processing_time: undefined, // Not stored in new schema
              source_image_url: job.input_image_urls?.[0] || '',
              prompt: job.prompt || '',
              workflow_name: job.workflow_name,
              model_used: job.model_used,
              user_ip: job.user_ip,
              metadata: job as any
            })
          }
        }
      } else {
        // Use old system - load from both edited_images and style_transfers tables
        // Load edited images
        try {
          const response = await apiClient.getRecentEditedImages(limit, offset, config.showCompletedOnly || false) as EditedImagesResponse

          if (response.success && response.edited_images) {
            for (const image of response.edited_images) {
              const getValidImageUrl = (url?: string) => {
                if (!url || url.startsWith('blob:')) return undefined
                return url
              }

              const validResultUrl = getValidImageUrl(image.result_image_url)
              const validSourceUrl = getValidImageUrl(image.source_image_url)

              items.push({
                id: image.id,
                type: 'edited-image',
                created_at: image.created_at,
                title: image.prompt || 'Image Edit',
                status: image.status,
                preview_url: validResultUrl || validSourceUrl || '',
                result_url: validResultUrl,
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

        // Load style transfers
        try {
          const styleResponse = await apiClient.getRecentStyleTransfers(limit, offset, config.showCompletedOnly || false) as StyleTransfersResponse

          if (styleResponse.success && styleResponse.style_transfers) {
            for (const transfer of styleResponse.style_transfers) {
              const getValidImageUrl = (url?: string) => {
                if (!url || url.startsWith('blob:')) return undefined
                return url
              }

              const validResultUrl = getValidImageUrl(transfer.result_image_url)
              const validSourceUrl = getValidImageUrl(transfer.source_image_url)

              items.push({
                id: transfer.id,
                type: 'style-transfer',
                created_at: transfer.created_at,
                title: transfer.prompt || 'Style Transfer',
                status: transfer.status,
                preview_url: validResultUrl || validSourceUrl || '',
                result_url: validResultUrl,
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
      }

      // Sort by creation date (newest first)
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // Apply filtering if needed
      const filteredItems = showFilteredOnly
        ? items.filter(item => item.status === 'completed' && item.result_url)
        : items

      if (reset) {
        setFeedItems(filteredItems)
      } else {
        setFeedItems(prev => [...prev, ...filteredItems])
      }

      // Update pagination state
      setCurrentOffset(offset + limit)
      setHasMore(filteredItems.length === limit)

    } catch (error) {
      console.error('Error loading image feed:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [config.showCompletedOnly, config.maxItems, config.useNewJobSystem, config.workflowName, config.userId, showFilteredOnly])

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadFeed(false)
    }
  }

  useEffect(() => {
    loadFeed()

    // Refresh every 10 seconds for more responsive updates
    const interval = setInterval(() => loadFeed(), 10000)
    return () => clearInterval(interval)
  }, [loadFeed])

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
    <div className="h-full flex flex-col">
      {/* Header - Fixed */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
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
              onClick={() => loadFeed()}
              disabled={loading}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full border border-blue-300 hover:bg-blue-200 disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4">

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
            const hasMultipleImages = item.all_result_urls && item.all_result_urls.length > 1

            return (
              <div key={item.id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                {/* Show all images for multi-image jobs (like image-grid) */}
                {hasMultipleImages && item.status === 'completed' ? (
                  <div className="mb-3">
                    {/* 3x3 grid of individual images (skip first which is the stitched full grid) */}
                    <div className="grid grid-cols-3 gap-1 relative">
                      {/* Status badge on top-right corner of grid */}
                      <div className="absolute top-1 right-1 z-10">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                      {item.all_result_urls!.slice(1, 10).map((url, index) => (
                        <div
                          key={index}
                          className="aspect-square bg-gray-100 rounded-lg relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => {
                            setSelectedImage(item)
                            setFocusedImageIndex(index + 1) // +1 because index 0 is full grid, individual images start at 1
                          }}
                        >
                          <img
                            src={url}
                            alt={`Image ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-0.5 left-0.5 bg-black/70 text-white text-[10px] px-1 rounded">
                            {index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Single image display */
                  <div
                    className="aspect-video bg-gray-100 rounded-xl mb-3 relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setSelectedImage(item)}
                  >
                    {item.preview_url ? (
                      <img
                        src={item.preview_url}
                        alt={`${item.title} | Source: ${item.preview_url.startsWith('data:') ? 'Data URL' : item.preview_url.startsWith('blob:') ? 'Blob URL (may fail)' : item.preview_url.includes('supabase') ? 'Supabase' : 'External'}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.error(`Failed to load image: ${item.preview_url}`)
                          const target = e.target as HTMLImageElement
                          target.alt = `Failed to load: ${item.preview_url.startsWith('blob:') ? 'Blob URL expired' : 'Image not accessible'}`
                        }}
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
                )}
                
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

        {/* Load More Button */}
        {!loading && feedItems.length > 0 && hasMore && (
          <div className="flex justify-center pt-4">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-xl hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
            >
              {loadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Loading...
                </>
              ) : (
                <>
                  <span>📸</span>
                  Load More
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <ImageModal
          image={selectedImage}
          isOpen={!!selectedImage}
          onClose={() => {
            setSelectedImage(null)
            setFocusedImageIndex(undefined)
          }}
          focusedImageIndex={focusedImageIndex}
        />
      )}
    </div>
  )
}
