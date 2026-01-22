import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { apiClient } from '../lib/apiClient'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
import { useFeedDisplaySettings } from '../hooks/useFeedDisplaySettings'
import { fixStuckJob } from '../lib/fixStuckJob'
import ImageModal from './ImageModal'
import DisplaySettingsControls from './DisplaySettingsControls'
import { useAuth } from '../contexts/AuthContext'
import FeedListItem from './FeedListItem'
import FeedGridItem from './FeedGridItem'
import type { ImageItem } from '../types/ui'
import type { FeedDisplaySettings } from '../types/feedDisplay'
import { GRID_MIN_ITEM_WIDTH } from '../types/feedDisplay'
import { getWorkflowDisplayName } from '../constants/workflowNames'

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
  // Video-specific fields
  thumbnail_url?: string  // Pre-generated thumbnail for videos
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
  pageContext?: string | string[]  // Current page's workflow name(s) - can be array for multi-workflow pages

  // Display options
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  showMediaTypeToggle?: boolean  // Whether to show the media type toggle (default: true)

  // NEW: Display settings
  displaySettings?: Partial<FeedDisplaySettings>  // Override default display settings
  showDisplayControls?: boolean  // Whether to show view/size/column controls (default: true)

  // ComfyUI integration
  comfyUrl?: string
}

interface GenerationFeedProps {
  config: GenerationFeedConfig
  onUpscaleComplete?: () => void
}

// Progressive loading constants (defaults)
const DEFAULT_MAX_ITEMS = 50       // Default max items for main feed page
const DEFAULT_INITIAL_BATCH = 10   // Fast first paint
const BATCH_SIZE = 10              // Load 10 at a time
const MIN_VISIBLE = 10             // Minimum items to show after filtering
const POLL_INTERVAL = 30000        // 30 seconds polling (cache-friendly)

export default function GenerationFeed({ config, onUpscaleComplete }: GenerationFeedProps) {
  // Auth context for user filtering
  const { user } = useAuth();

  // Compute max items from config (internal pages may want fewer items)
  const maxItems = config.maxItems ?? DEFAULT_MAX_ITEMS
  // For smaller feeds, use smaller initial batch for faster first paint
  const initialBatch = Math.min(DEFAULT_INITIAL_BATCH, maxItems)

  // Normalize pageContext to array for internal use (moved up for localStorage key)
  const pageContexts = useMemo(() => {
    if (!config.pageContext) return undefined
    return Array.isArray(config.pageContext) ? config.pageContext : [config.pageContext]
  }, [config.pageContext])

  // Use first context for storage key
  const storageKeyContext = Array.isArray(config.pageContext)
    ? config.pageContext[0]
    : config.pageContext

  // Helper to get localStorage key for this feed instance
  const getStorageKey = useCallback((suffix: string) =>
    `feed-${storageKeyContext || 'default'}-${suffix}`, [storageKeyContext])

  const [allItems, setAllItems] = useState<GenerationItem[]>([]) // All loaded items (both videos and images)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())

  // Filter states with localStorage persistence
  const [showMineOnly, setShowMineOnly] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(getStorageKey('showMine')) === 'true'
  })

  const [showThisWorkflowOnly, setShowThisWorkflowOnly] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem(getStorageKey('showThisWorkflow'))
    return saved === null ? true : saved === 'true' // Default: true (filter to current workflow)
  })

  const [mediaTypeFilter, setMediaTypeFilter] = useState<'video' | 'image' | 'all'>(config.mediaType)
  const [error, setError] = useState<string | null>(null)

  // Progressive loading state
  const [loadingPhase, setLoadingPhase] = useState<'initial' | 'progressive' | 'complete'>('initial')
  const [videoOffset, setVideoOffset] = useState(0)
  const [imageOffset, setImageOffset] = useState(0)
  const [hasMoreVideos, setHasMoreVideos] = useState(true)
  const [hasMoreImages, setHasMoreImages] = useState(true)
  const [isBackfilling, setIsBackfilling] = useState(false)

  // For image modal
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [focusedImageIndex, setFocusedImageIndex] = useState<number | undefined>(undefined)

  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(config.comfyUrl || '', !!config.comfyUrl)

  // Display settings (persisted to localStorage)
  const {
    settings: displaySettings,
    setViewMode,
    setThumbnailSize,
    setColumnCount,
  } = useFeedDisplaySettings({
    storageKey: storageKeyContext || 'default',
    defaults: config.displaySettings,
  })

  // Compute grid style based on column count and thumbnail size
  const gridStyle = useMemo(() => {
    if (displaySettings.viewMode !== 'grid') return {}
    const minWidth = GRID_MIN_ITEM_WIDTH[displaySettings.thumbnailSize]
    if (displaySettings.columnCount === 'auto') {
      return {
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
      }
    }
    return {
      gridTemplateColumns: `repeat(${displaySettings.columnCount}, 1fr)`,
    }
  }, [displaySettings.viewMode, displaySettings.columnCount, displaySettings.thumbnailSize])

  // Persist filter states to localStorage
  useEffect(() => {
    if (storageKeyContext) {
      localStorage.setItem(getStorageKey('showMine'), String(showMineOnly))
    }
  }, [showMineOnly, storageKeyContext, getStorageKey])

  useEffect(() => {
    if (storageKeyContext) {
      localStorage.setItem(getStorageKey('showThisWorkflow'), String(showThisWorkflowOnly))
    }
  }, [showThisWorkflowOnly, storageKeyContext, getStorageKey])

  // Helper to get display label for pageContexts
  const getWorkflowDisplayLabel = useCallback((contexts: string[]): string => {
    if (contexts.length === 1) {
      return getWorkflowDisplayName(contexts[0])
    }
    return `${contexts.length} Workflows`
  }, [])

  // Sync mediaTypeFilter when config.mediaType changes from parent
  useEffect(() => {
    setMediaTypeFilter(config.mediaType)
  }, [config.mediaType])

  // Compute effective media type (from parent config or internal state)
  const effectiveMediaType = config.showMediaTypeToggle === false
    ? config.mediaType
    : mediaTypeFilter

  // Client-side filtering of already loaded items (instant)
  const displayedItems = useMemo(() => {
    if (effectiveMediaType === 'all') {
      return allItems
    }
    return allItems.filter(item => item.type === effectiveMediaType)
  }, [allItems, effectiveMediaType])

  // Helper to convert API response to GenerationItem
  const videoJobToItem = (job: any): GenerationItem => ({
    id: job.id || job.comfy_job_id,
    type: 'video',
    created_at: job.created_at,
    title: `${job.input_image_urls?.[0]?.split('/').pop() || 'Video'} + Audio`,
    status: job.status,
    result_url: job.output_video_urls?.[0],
    thumbnail_url: job.thumbnail_url,
    workflow_name: job.workflow_name,
    metadata: job
  })

  const imageJobToItem = (job: any): GenerationItem => {
    const getValidImageUrl = (url?: string) => {
      if (!url || url.startsWith('blob:')) return undefined
      return url
    }
    const validResultUrl = getValidImageUrl(job.output_image_urls?.[0])
    const validSourceUrl = getValidImageUrl(job.input_image_urls?.[0])
    const allValidResultUrls = (job.output_image_urls || [])
      .map((url: string) => getValidImageUrl(url))
      .filter((url: string | undefined): url is string => !!url)

    return {
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
    }
  }

  // Get effective workflow filter (now independent of user filtering)
  const getEffectiveWorkflows = useCallback(() => {
    // When "This Workflow" is selected and we have page context, filter to those workflows
    if (showThisWorkflowOnly && pageContexts) {
      return pageContexts
    }
    // Otherwise use config.workflowNames (undefined = all workflows)
    return config.workflowNames
  }, [showThisWorkflowOnly, pageContexts, config.workflowNames])

  // Load a batch of items (progressive loading)
  const loadBatch = useCallback(async (
    type: 'video' | 'image' | 'both',
    batchSize: number,
    vOffset: number,
    iOffset: number
  ): Promise<{ videos: GenerationItem[], images: GenerationItem[], hasMoreV: boolean, hasMoreI: boolean }> => {
    const effectiveWorkflows = getEffectiveWorkflows()
    const videos: GenerationItem[] = []
    const images: GenerationItem[] = []
    let hasMoreV = true
    let hasMoreI = true

    // Load videos
    if (type === 'video' || type === 'both') {
      try {
        const videoParams = {
          limit: batchSize,
          offset: vOffset,
          workflow_name: effectiveWorkflows?.length === 1 ? effectiveWorkflows[0] : undefined,
          user_id: showMineOnly ? user?.id : undefined
        }
        console.log('[GenerationFeed] Fetching videos with params:', videoParams)
        const videoResponse = config.showCompletedOnly
          ? await apiClient.getCompletedVideoJobs(videoParams) as any
          : await apiClient.getVideoJobs(videoParams) as any

        console.log('[GenerationFeed] Video response:', {
          success: videoResponse?.success,
          jobCount: videoResponse?.video_jobs?.length ?? 0,
          totalCount: videoResponse?.total_count,
          error: videoResponse?.error
        })

        if (videoResponse?.success && videoResponse.video_jobs) {
          for (const job of videoResponse.video_jobs) {
            if (effectiveWorkflows && effectiveWorkflows.length > 1 &&
                !effectiveWorkflows.includes(job.workflow_name)) {
              console.log('[GenerationFeed] Filtering out job:', job.id, 'workflow:', job.workflow_name)
              continue
            }
            videos.push(videoJobToItem(job))
          }
          hasMoreV = videoResponse.video_jobs.length === batchSize
          console.log('[GenerationFeed] Processed videos:', videos.length)
        } else {
          console.log('[GenerationFeed] No videos in response or success=false')
          hasMoreV = false
        }
      } catch (err: any) {
        console.error('[GenerationFeed] Error loading videos:', err)
        hasMoreV = false
      }
    }

    // Load images
    if (type === 'image' || type === 'both') {
      try {
        const imageParams = {
          limit: batchSize,
          offset: iOffset,
          workflow_name: effectiveWorkflows?.length === 1 ? effectiveWorkflows[0] : undefined,
          user_id: showMineOnly ? user?.id : undefined
        }
        const imageResponse = config.showCompletedOnly
          ? await apiClient.getCompletedImageJobs(imageParams) as any
          : await apiClient.getImageJobs(imageParams) as any

        if (imageResponse?.success && imageResponse.image_jobs) {
          for (const job of imageResponse.image_jobs) {
            if (effectiveWorkflows && effectiveWorkflows.length > 1 &&
                !effectiveWorkflows.includes(job.workflow_name)) {
              continue
            }
            images.push(imageJobToItem(job))
          }
          hasMoreI = imageResponse.image_jobs.length === batchSize
        } else {
          hasMoreI = false
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.error('Error loading images:', err)
        hasMoreI = false
      }
    }

    return { videos, images, hasMoreV, hasMoreI }
  }, [config.showCompletedOnly, getEffectiveWorkflows, showMineOnly, user])

  // Initial load - load first batch quickly
  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadingPhase('initial')
    setVideoOffset(0)
    setImageOffset(0)

    try {
      const { videos, images, hasMoreV, hasMoreI } = await loadBatch('both', initialBatch, 0, 0)

      // Merge and sort
      const items = [...videos, ...images]
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setAllItems(items)
      setVideoOffset(videos.length)
      setImageOffset(images.length)
      setHasMoreVideos(hasMoreV)
      setHasMoreImages(hasMoreI)

      // Start progressive loading if we have more
      if ((hasMoreV || hasMoreI) && items.length < maxItems) {
        setLoadingPhase('progressive')
      } else {
        setLoadingPhase('complete')
      }
    } catch (err) {
      console.error('Error loading feed:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }, [loadBatch, initialBatch, maxItems])

  // Progressive loading - load more batches in background
  const loadNextBatch = useCallback(async () => {
    if (loadingPhase !== 'progressive' || loadingMore) return
    if (allItems.length >= maxItems) {
      setLoadingPhase('complete')
      return
    }
    if (!hasMoreVideos && !hasMoreImages) {
      setLoadingPhase('complete')
      return
    }

    setLoadingMore(true)

    try {
      const { videos, images, hasMoreV, hasMoreI } = await loadBatch(
        'both', BATCH_SIZE, videoOffset, imageOffset
      )

      if (videos.length > 0 || images.length > 0) {
        setAllItems(prev => {
          const newItems = [...prev, ...videos, ...images]
          // Remove duplicates by id
          const seen = new Set<string>()
          const unique = newItems.filter(item => {
            if (seen.has(item.id)) return false
            seen.add(item.id)
            return true
          })
          // Sort by date
          unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          return unique.slice(0, maxItems)
        })
        setVideoOffset(prev => prev + videos.length)
        setImageOffset(prev => prev + images.length)
      }

      setHasMoreVideos(hasMoreV)
      setHasMoreImages(hasMoreI)

      if (!hasMoreV && !hasMoreI) {
        setLoadingPhase('complete')
      }
    } finally {
      setLoadingMore(false)
    }
  }, [loadingPhase, loadingMore, allItems.length, hasMoreVideos, hasMoreImages, videoOffset, imageOffset, loadBatch, maxItems])

  // Backfill - fetch more of a specific type when filter reduces visible items
  const backfillType = useCallback(async (type: 'video' | 'image') => {
    if (isBackfilling) return

    setIsBackfilling(true)
    try {
      const currentOffset = type === 'video' ? videoOffset : imageOffset
      const { videos, images, hasMoreV, hasMoreI } = await loadBatch(type, BATCH_SIZE * 2, currentOffset, currentOffset)

      const newItems = type === 'video' ? videos : images
      if (newItems.length > 0) {
        setAllItems(prev => {
          const merged = [...prev, ...newItems]
          const seen = new Set<string>()
          const unique = merged.filter(item => {
            if (seen.has(item.id)) return false
            seen.add(item.id)
            return true
          })
          unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          return unique
        })

        if (type === 'video') {
          setVideoOffset(prev => prev + videos.length)
          setHasMoreVideos(hasMoreV)
        } else {
          setImageOffset(prev => prev + images.length)
          setHasMoreImages(hasMoreI)
        }
      }
    } finally {
      setIsBackfilling(false)
    }
  }, [isBackfilling, videoOffset, imageOffset, loadBatch])

  // Refresh - reload from beginning (for polling)
  const refreshFeed = useCallback(async () => {
    // Don't show loading spinner for refresh (keeps existing items visible)
    try {
      const { videos, images } = await loadBatch('both', initialBatch, 0, 0)

      // Merge new items with existing, keeping newest
      setAllItems(prev => {
        const newItems = [...videos, ...images]
        const merged = [...newItems, ...prev]
        const seen = new Set<string>()
        const unique = merged.filter(item => {
          if (seen.has(item.id)) return false
          seen.add(item.id)
          return true
        })
        unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        return unique.slice(0, maxItems)
      })
    } catch (err) {
      // Silently fail refresh - don't clear existing items
      console.error('Error refreshing feed:', err)
    }
  }, [loadBatch, initialBatch, maxItems])

  // Manual load more (user-triggered)
  const loadMore = useCallback(() => {
    if (loadingPhase === 'complete' && (hasMoreVideos || hasMoreImages)) {
      setLoadingPhase('progressive')
    }
    loadNextBatch()
  }, [loadingPhase, hasMoreVideos, hasMoreImages, loadNextBatch])

  // Fix stuck video job manually
  const handleFixStuckJob = async (jobId: string, comfyUrl: string) => {
    if (fixingJobs.has(jobId)) return

    setFixingJobs(prev => new Set([...prev, jobId]))

    try {
      const result = await fixStuckJob(jobId, comfyUrl)
      if (result.success) {
        await loadInitial()
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

  // Initial load on mount + polling
  useEffect(() => {
    // Clear API cache on mount to ensure fresh data
    apiClient.clearCache()
    console.log('[GenerationFeed] Component mounted, cache cleared')
    loadInitial()

    // Refresh every 30 seconds (cache-friendly)
    const interval = setInterval(() => refreshFeed(), POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [loadInitial, refreshFeed])

  // Re-run initial load when config/filters change
  useEffect(() => {
    loadInitial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMineOnly, showThisWorkflowOnly, config.showCompletedOnly, config.workflowNames, pageContexts])

  // Progressive loading - continue loading in background after initial batch
  useEffect(() => {
    if (loadingPhase === 'progressive') {
      const timer = setTimeout(() => loadNextBatch(), 300)
      return () => clearTimeout(timer)
    }
    // loadNextBatch is stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPhase])

  // Hybrid filtering - backfill when filter reduces visible items below threshold
  useEffect(() => {
    if (loadingPhase !== 'complete' || isBackfilling) return

    // Only backfill if we're filtering by type and have few results
    if (effectiveMediaType !== 'all' && displayedItems.length < MIN_VISIBLE) {
      const hasMore = effectiveMediaType === 'video' ? hasMoreVideos : hasMoreImages
      if (hasMore) {
        backfillType(effectiveMediaType)
      }
    }
    // Note: backfillType is intentionally excluded to prevent infinite loops
    // The function is stable and doesn't need to trigger re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMediaType, displayedItems.length, loadingPhase, isBackfilling, hasMoreVideos, hasMoreImages])

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
            onClick={() => loadInitial()}
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
          {pageContexts && (
            <div className="flex items-center bg-gray-100 rounded-full p-0.5">
              <button
                onClick={() => setShowMineOnly(true)}
                className={`px-2 py-1 text-xs rounded-full transition-all ${
                  showMineOnly
                    ? 'bg-white text-purple-700 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                My Content
              </button>
              <button
                onClick={() => setShowMineOnly(false)}
                className={`px-2 py-1 text-xs rounded-full transition-all ${
                  !showMineOnly
                    ? 'bg-white text-purple-700 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All
              </button>
            </div>
          )}

          {/* Workflow filter toggle - only show if pageContext is set */}
          {pageContexts && (
            <div className="flex items-center bg-gray-100 rounded-full p-0.5">
              <button
                onClick={() => setShowThisWorkflowOnly(true)}
                className={`px-2 py-1 text-xs rounded-full transition-all ${
                  showThisWorkflowOnly
                    ? 'bg-white text-blue-700 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {getWorkflowDisplayLabel(pageContexts)}
              </button>
              <button
                onClick={() => setShowThisWorkflowOnly(false)}
                className={`px-2 py-1 text-xs rounded-full transition-all ${
                  !showThisWorkflowOnly
                    ? 'bg-white text-blue-700 shadow-sm font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All Workflows
              </button>
            </div>
          )}
        </div>

        {/* Display settings controls */}
        {(config.showDisplayControls !== false) && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <DisplaySettingsControls
              viewMode={displaySettings.viewMode}
              thumbnailSize={displaySettings.thumbnailSize}
              columnCount={displaySettings.columnCount}
              onViewModeChange={setViewMode}
              onThumbnailSizeChange={setThumbnailSize}
              onColumnCountChange={setColumnCount}
              compact={true}
            />
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {error ? (
          <div className="text-center py-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700 text-sm mb-2">{error}</p>
              <button
                onClick={() => loadInitial()}
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
          <>
            {/* Grid View */}
            {displaySettings.viewMode === 'grid' ? (
              <div className="grid gap-2" style={gridStyle}>
                {displayedItems.map((item) => (
                  <FeedGridItem
                    key={item.id}
                    item={item}
                    thumbnailSize={displaySettings.thumbnailSize}
                    onClick={() => {
                      if (item.type === 'image') {
                        setSelectedImage(toImageItem(item))
                      } else if (item.result_url) {
                        window.open(item.result_url, '_blank')
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              /* List View */
              <div className="space-y-3">
                {displayedItems.map((item) => (
                  <FeedListItem
                    key={item.id}
                    item={item}
                    thumbnailSize={displaySettings.thumbnailSize}
                    comfyUrl={config.comfyUrl}
                    showProgress={config.showProgress}
                    showFixButton={config.showFixButton}
                    fixingJobs={fixingJobs}
                    onFix={(jobId) => handleFixStuckJob(jobId, config.comfyUrl!)}
                    onImageClick={() => {
                      if (item.type === 'image') {
                        setSelectedImage(toImageItem(item))
                      }
                    }}
                    progressValue={
                      config.showProgress && progress.total_nodes > 0
                        ? Math.round((progress.completed_nodes / progress.total_nodes) * 100)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}

            {/* Load More */}
            {(hasMoreVideos || hasMoreImages) && displayedItems.length > 0 && (
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
          </>
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
            loadInitial()
            if (onUpscaleComplete) onUpscaleComplete()
          }}
        />,
        document.body
      )}
    </div>
  )
}
