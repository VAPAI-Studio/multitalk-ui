import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { apiClient } from '../lib/apiClient'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
import { fixStuckJob } from '../lib/fixStuckJob'
import VideoThumbnail from './VideoThumbnail'
import ImageModal from './ImageModal'
import type { ImageItem } from '../types/ui'

// Unified item type that can be video or image
interface GenerationItem {
  id: string
  type: 'video' | 'image'
  created_at: string
  title: string
  status: string
  preview_url?: string
  result_url?: string
  processing_time?: number
  progress?: {
    completed_nodes: number
    total_nodes: number
    current_node?: string
  }
  // Image-specific fields
  all_result_urls?: string[]
  source_image_url?: string
  prompt?: string
  workflow_name?: string
  model_used?: string
  // Metadata
  metadata: any
}

// Feed configuration
export interface GenerationFeedConfig {
  // Media type filtering
  mediaType: 'video' | 'image' | 'all'

  // Workflow filtering
  workflowNames?: string[]  // Filter to specific workflows (multi-select)

  // Page context for "Show Mine" toggle
  pageContext?: string      // Current page's workflow name

  // Display options
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  showMediaTypeToggle?: boolean  // Whether to show the media type toggle (default: true)

  // ComfyUI integration
  comfyUrl?: string
}

interface GenerationFeedProps {
  config: GenerationFeedConfig
  onUpscaleComplete?: () => void
}

// Lazy Video Component with thumbnail support
const LazyVideo = ({ item, onError }: { item: GenerationItem; onError: (error: any) => void }) => {
  const [shouldLoad, setShouldLoad] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          setTimeout(() => setShouldLoad(true), 100)
        } else {
          setShouldLoad(false)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="w-full">
      <VideoThumbnail
        videoUrl={item.result_url || ''}
        className="w-full rounded-xl shadow-lg"
        style={{ maxHeight: '200px' }}
        onError={onError}
        showPlayButton={shouldLoad}
      />
    </div>
  )
}

export default function GenerationFeed({ config, onUpscaleComplete }: GenerationFeedProps) {
  const [displayedItems, setDisplayedItems] = useState<GenerationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())
  const [showMineOnly, setShowMineOnly] = useState(true) // Default to showing current page's items
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'video' | 'image' | 'all'>(config.mediaType)
  const [currentOffset, setCurrentOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // For image modal
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [focusedImageIndex, setFocusedImageIndex] = useState<number | undefined>(undefined)

  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(config.comfyUrl || '', !!config.comfyUrl)

  const getShortJobId = (jobId: string) => jobId.slice(-8)

  const loadFeed = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setCurrentOffset(0)
      setHasMore(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }

    try {
      const items: GenerationItem[] = []
      const limit = config.maxItems || 10

      // Determine which workflows to fetch based on filters
      const effectiveWorkflows = showMineOnly && config.pageContext
        ? [config.pageContext]
        : config.workflowNames

      // Load videos if needed
      if (mediaTypeFilter === 'video' || mediaTypeFilter === 'all') {
        try {
          const videoParams = {
            limit: limit * 2,
            offset: 0,
            workflow_name: effectiveWorkflows?.length === 1 ? effectiveWorkflows[0] : undefined
          }

          const videoResponse = config.showCompletedOnly
            ? await apiClient.getCompletedVideoJobs(videoParams) as any
            : await apiClient.getVideoJobs(videoParams) as any

          if (videoResponse?.success && videoResponse.video_jobs) {
            for (const job of videoResponse.video_jobs) {
              // Skip if filtering by workflows and this one isn't included
              if (effectiveWorkflows && effectiveWorkflows.length > 1 &&
                  !effectiveWorkflows.includes(job.workflow_name)) {
                continue
              }

              // Build video URL
              const videoUrl: string | undefined = job.output_video_urls?.[0]

              items.push({
                id: job.id || job.comfy_job_id,
                type: 'video',
                created_at: job.created_at,
                title: `${job.input_image_urls?.[0]?.split('/').pop() || 'Video'} + Audio`,
                status: job.status,
                result_url: videoUrl,
                workflow_name: job.workflow_name,
                metadata: job
              })
            }
          }
        } catch (err) {
          console.error('Error loading videos:', err)
        }
      }

      // Load images if needed
      if (mediaTypeFilter === 'image' || mediaTypeFilter === 'all') {
        try {
          const imageParams = {
            limit: limit * 2,
            offset: 0,
            workflow_name: effectiveWorkflows?.length === 1 ? effectiveWorkflows[0] : undefined
          }

          const imageResponse = config.showCompletedOnly
            ? await apiClient.getCompletedImageJobs(imageParams) as any
            : await apiClient.getImageJobs(imageParams) as any

          if (imageResponse?.success && imageResponse.image_jobs) {
            for (const job of imageResponse.image_jobs) {
              // Skip if filtering by workflows and this one isn't included
              if (effectiveWorkflows && effectiveWorkflows.length > 1 &&
                  !effectiveWorkflows.includes(job.workflow_name)) {
                continue
              }

              // Filter out blob URLs
              const getValidImageUrl = (url?: string) => {
                if (!url || url.startsWith('blob:')) return undefined
                return url
              }

              const validResultUrl = getValidImageUrl(job.output_image_urls?.[0])
              const validSourceUrl = getValidImageUrl(job.input_image_urls?.[0])

              // Get all valid result URLs for multi-image outputs
              const allValidResultUrls = (job.output_image_urls || [])
                .map((url: string) => getValidImageUrl(url))
                .filter((url: string | undefined): url is string => !!url)

              items.push({
                id: job.id,
                type: 'image',
                created_at: job.created_at,
                title: job.prompt || job.workflow_name || 'Image',
                status: job.status,
                preview_url: validResultUrl || validSourceUrl || '',
                result_url: validResultUrl,
                all_result_urls: allValidResultUrls.length > 0 ? allValidResultUrls : undefined,
                source_image_url: job.input_image_urls?.[0] || '',
                prompt: job.prompt || '',
                workflow_name: job.workflow_name,
                model_used: job.model_used,
                metadata: job
              })
            }
          }
        } catch (err) {
          console.error('Error loading images:', err)
        }
      }

      // Sort by creation date (newest first)
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // Apply pagination
      const paginatedItems = items.slice(0, reset ? limit : currentOffset + limit)

      if (reset) {
        setDisplayedItems(paginatedItems)
      } else {
        setDisplayedItems(paginatedItems)
      }

      setCurrentOffset((reset ? 0 : currentOffset) + limit)
      setHasMore(paginatedItems.length < items.length)

    } catch (err) {
      console.error('Error loading feed:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      if (reset) {
        setDisplayedItems([])
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [config.maxItems, config.showCompletedOnly, config.workflowNames, config.pageContext,
      mediaTypeFilter, showMineOnly, currentOffset])

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadFeed(false)
    }
  }

  // Fix stuck video job manually
  const handleFixStuckJob = async (jobId: string, comfyUrl: string) => {
    if (fixingJobs.has(jobId)) return

    setFixingJobs(prev => new Set([...prev, jobId]))

    try {
      const result = await fixStuckJob(jobId, comfyUrl)
      if (result.success) {
        await loadFeed()
      } else {
        alert(`Failed to fix job: ${result.error}`)
      }
    } catch (err) {
      alert(`Error fixing job: ${err}`)
    } finally {
      setFixingJobs(prev => {
        const newSet = new Set(prev)
        newSet.delete(jobId)
        return newSet
      })
    }
  }

  // Convert GenerationItem to ImageItem for modal
  const toImageItem = (item: GenerationItem): ImageItem => ({
    id: item.id,
    type: item.workflow_name === 'style-transfer' ? 'style-transfer' : 'edited-image',
    created_at: item.created_at,
    title: item.title,
    status: item.status as 'pending' | 'processing' | 'completed' | 'error',
    preview_url: item.preview_url || '',
    result_url: item.result_url || '',
    all_result_urls: item.all_result_urls,
    source_image_url: item.source_image_url || '',
    prompt: item.prompt || '',
    workflow_name: item.workflow_name || '',
    model_used: item.model_used,
    metadata: item.metadata
  })

  useEffect(() => {
    loadFeed(true)

    // Refresh every 15 seconds
    const interval = setInterval(() => loadFeed(true), 15000)
    return () => clearInterval(interval)
  }, [mediaTypeFilter, showMineOnly])

  // Re-run effect when config changes
  useEffect(() => {
    loadFeed(true)
  }, [config.showCompletedOnly, config.workflowNames, config.pageContext])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100'
      case 'processing': return 'text-blue-600 bg-blue-100'
      case 'failed': return 'text-red-600 bg-red-100'
      case 'pending': return 'text-yellow-600 bg-yellow-100'
      case 'error': return 'text-red-600 bg-red-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed'
      case 'processing': return 'Processing'
      case 'failed': return 'Failed'
      case 'pending': return 'Pending'
      case 'error': return 'Error'
      default: return status
    }
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-lg border border-gray-200">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <div className="w-2 h-6 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
            Generation Feed
          </h2>

          <button
            onClick={() => loadFeed(true)}
            disabled={loading}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full border border-blue-300 hover:bg-blue-200 disabled:opacity-50"
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Media type toggle - only show if showMediaTypeToggle is true (default) */}
          {(config.showMediaTypeToggle !== false) && (
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
              <button
                onClick={() => setMediaTypeFilter('all')}
                className={`px-2 py-1 transition-colors ${
                  mediaTypeFilter === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setMediaTypeFilter('video')}
                className={`px-2 py-1 border-l border-gray-300 transition-colors ${
                  mediaTypeFilter === 'video'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Videos
              </button>
              <button
                onClick={() => setMediaTypeFilter('image')}
                className={`px-2 py-1 border-l border-gray-300 transition-colors ${
                  mediaTypeFilter === 'image'
                    ? 'bg-pink-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Images
              </button>
            </div>
          )}

          {/* Show Mine toggle - only show if pageContext is set */}
          {config.pageContext && (
            <button
              onClick={() => setShowMineOnly(!showMineOnly)}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                showMineOnly
                  ? 'bg-purple-100 text-purple-700 border border-purple-300'
                  : 'bg-gray-100 text-gray-600 border border-gray-300'
              }`}
            >
              {showMineOnly ? 'This Page' : 'Show All'}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {error ? (
          <div className="text-center py-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700 text-sm mb-2">{error}</p>
              <button
                onClick={() => loadFeed(true)}
                className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading && displayedItems.length === 0 ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
            <p className="text-gray-500 mt-2 text-sm">Loading...</p>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">
              {mediaTypeFilter === 'video' ? '🎬' : mediaTypeFilter === 'image' ? '🖼️' : '📁'}
            </div>
            <p className="text-gray-500 text-sm">No generations found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayedItems.map((item) => {
              // Compact view for failed/error items
              if (item.status === 'failed' || item.status === 'error') {
                return (
                  <div key={item.id} className="border border-yellow-200 rounded-lg p-2 bg-yellow-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{item.type === 'video' ? '🎬' : '🖼️'}</span>
                        <span className="text-xs font-mono text-gray-600">
                          {getShortJobId(item.id)}
                        </span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(item.status)}`}>
                        {getStatusText(item.status)}
                      </span>
                    </div>
                  </div>
                )
              }

              // Video item
              if (item.type === 'video') {
                return (
                  <div key={item.id} className="border border-gray-200 rounded-xl p-3 bg-white">
                    {item.result_url && item.status === 'completed' ? (
                      <LazyVideo
                        item={item}
                        onError={() => {
                          console.error('Video load failed:', item.id)
                        }}
                      />
                    ) : item.status === 'processing' || item.status === 'submitted' ? (
                      <div className="w-full h-16 bg-blue-50 rounded-lg flex items-center justify-center">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                          <span className="text-blue-600 text-sm">
                            {config.showProgress && progress.total_nodes > 0
                              ? `${Math.round((progress.completed_nodes / progress.total_nodes) * 100)}%`
                              : 'Processing...'}
                          </span>
                          {config.showFixButton && config.comfyUrl && (
                            <button
                              onClick={() => handleFixStuckJob(item.id, config.comfyUrl!)}
                              disabled={fixingJobs.has(item.id)}
                              className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded border border-orange-300 disabled:opacity-50"
                            >
                              {fixingJobs.has(item.id) ? '...' : 'Fix'}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                        <span className="text-2xl">🎬</span>
                      </div>
                    )}

                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-gray-900 text-sm truncate flex-1">{item.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ml-2 ${getStatusColor(item.status)}`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{new Date(item.created_at).toLocaleDateString()}</span>
                        {item.workflow_name && (
                          <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                            {item.workflow_name}
                          </span>
                        )}
                      </div>
                      {item.status === 'completed' && item.result_url && (
                        <a
                          href={item.result_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full bg-blue-600 text-white text-center py-1.5 rounded-lg hover:bg-blue-700 text-sm mt-2"
                        >
                          View Video
                        </a>
                      )}
                    </div>
                  </div>
                )
              }

              // Image item
              const hasMultipleImages = item.all_result_urls && item.all_result_urls.length > 1

              return (
                <div key={item.id} className="border border-gray-200 rounded-xl p-3 bg-white">
                  {/* Multi-image grid (for image-grid workflow) */}
                  {hasMultipleImages && item.status === 'completed' ? (
                    <div className="mb-2">
                      <div className="grid grid-cols-3 gap-1 relative">
                        <div className="absolute top-1 right-1 z-10">
                          <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                            {getStatusText(item.status)}
                          </span>
                        </div>
                        {item.all_result_urls!.slice(1, 10).map((url, index) => (
                          <div
                            key={index}
                            className="aspect-square bg-gray-100 rounded-lg relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              setSelectedImage(toImageItem(item))
                              setFocusedImageIndex(index + 1)
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
                      className="aspect-video bg-gray-100 rounded-lg mb-2 relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setSelectedImage(toImageItem(item))}
                    >
                      {item.preview_url ? (
                        <img
                          src={item.preview_url}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-3xl">🖼️</span>
                        </div>
                      )}
                      <div className="absolute top-1 right-1">
                        <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <h3 className="font-medium text-gray-900 text-sm truncate">{item.title}</h3>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                      {item.workflow_name && (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                          {item.workflow_name}
                        </span>
                      )}
                    </div>
                    {item.status === 'completed' && item.result_url && (
                      <a
                        href={item.result_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-purple-600 text-white text-center py-1.5 rounded-lg hover:bg-purple-700 text-sm mt-2"
                      >
                        View Result
                      </a>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Load More */}
            {hasMore && displayedItems.length > 0 && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-sm flex items-center gap-2"
                >
                  {loadingMore ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Image Modal - rendered in portal to escape container constraints */}
      {selectedImage && createPortal(
        <ImageModal
          image={selectedImage}
          isOpen={!!selectedImage}
          onClose={() => {
            setSelectedImage(null)
            setFocusedImageIndex(undefined)
          }}
          focusedImageIndex={focusedImageIndex}
          comfyUrl={config.comfyUrl}
          onUpscaleComplete={() => {
            loadFeed(true)
            if (onUpscaleComplete) onUpscaleComplete()
          }}
        />,
        document.body
      )}
    </div>
  )
}
