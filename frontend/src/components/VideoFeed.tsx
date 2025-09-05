import { useState, useEffect, useRef } from 'react'
import { getCompletedJobsWithVideos, getRecentJobs, completeJob } from '../lib/jobTracking'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
import { fixStuckJob } from '../lib/fixStuckJob'
import VideoThumbnail from './VideoThumbnail'
import type { MultiTalkJob } from '../lib/supabase'

interface VideoJob extends MultiTalkJob {
  progress?: {
    completed_nodes: number
    total_nodes: number
    current_node?: string
  }
}

interface VideoItem {
  id: string
  type: 'video'
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
  metadata: VideoJob
}

// Feed configuration
export interface VideoFeedConfig {
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  pageContext?: string // Identifies which page/tool this feed is on
}

interface VideoFeedProps {
  comfyUrl: string
  config: VideoFeedConfig
}

// Lazy Video Component with thumbnail support
const LazyVideo = ({ item, onError }: { item: VideoItem; onError: (error: any) => void }) => {
  const [shouldLoad, setShouldLoad] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          // Delay loading slightly to prevent resource exhaustion
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

export default function VideoFeed({ comfyUrl, config }: VideoFeedProps) {
  const [displayedItems, setDisplayedItems] = useState<VideoItem[]>([]) // Currently displayed items
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())
  const [showFilteredOnly, setShowFilteredOnly] = useState(false) // Toggle between "Show All" and "Show Mine"
  const [displayCount, setDisplayCount] = useState(config.maxItems || 10)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(comfyUrl, true)
  
  const getShortJobId = (jobId: string) => jobId.slice(-8)

  const loadFeed = async (reset = true) => {
    if (reset) {
      setLoading(true)
      setDisplayCount(config.maxItems || 10)
      setHasMore(true)
      setError(null) // Clear any previous errors
    } else {
      setLoadingMore(true)
    }
    
    try {
      // Load a large batch of items from the API
      const limit = config.maxItems || 10
      
      console.log(`🔄 Loading videos: reset=${reset}, displayCount=${displayCount}`)
      
      // Try without offset first to see if that works
      const jobsResponse = config.showCompletedOnly 
        ? await getCompletedJobsWithVideos(limit * 3, 0) // Load 3x more items, ignore offset for now
        : await getRecentJobs(limit * 3, 0)
      
      if (!jobsResponse || !jobsResponse.jobs) {
        if (reset) {
          setDisplayedItems([])
        }
        setHasMore(false)
        return
      }

      const jobs = jobsResponse.jobs
      console.log(`📊 Received ${jobs.length} jobs from API`)

      // Smart stuck job detection - focus on truly stuck jobs, not just time
      const now = new Date()
      const maxJobAgeMs = 4 * 60 * 60 * 1000 // 4 hours maximum (very generous for video generation)
      const noProgressTimeoutMs = 45 * 60 * 1000 // 45 minutes without progress = likely stuck
      
      const processedJobs = jobs.map((job: MultiTalkJob) => {
        // Only check jobs that are in processing/submitted state
        if ((job.status === 'processing' || job.status === 'submitted')) {
          const submittedTime = new Date(job.timestamp_submitted)
          const timeDiff = now.getTime() - submittedTime.getTime()
          const timeDiffMinutes = Math.round(timeDiff / (1000 * 60))
          
          // Debug logging for stuck job detection
          console.log(`🔍 Job ${getShortJobId(job.job_id)} (full: ${job.job_id}) stuck detection:`, {
            status: job.status,
            timestamp_submitted: job.timestamp_submitted,
            submittedTime: submittedTime.toISOString(),
            submittedTimeLocal: submittedTime.toLocaleString(),
            now: now.toISOString(),
            nowLocal: now.toLocaleString(),
            timeDiffMs: timeDiff,
            timeDiffMinutes,
            timeDiffHours: Math.round(timeDiff / (1000 * 60 * 60)),
            maxJobAgeMs,
            noProgressTimeoutMs
          })
          
          // Check if job is actively processing (has progress data or is connected to WebSocket)
          const isActivelyProcessing = progress.total_nodes > 0 && progress.completed_nodes > 0
          const isWebSocketConnected = progress.is_connected
          const hasRecentProgress = progress.completed_nodes > 0 && progress.total_nodes > 0
          
          // Smart stuck detection logic:
          // 1. If job is older than 4 hours, it's definitely stuck
          // 2. If job is older than 45 minutes AND not actively processing AND no WebSocket connection, it's likely stuck
          // 3. If job is older than 45 minutes AND no recent progress, it's likely stuck
          const isDefinitelyStuck = timeDiff > maxJobAgeMs
          const isLikelyStuck = timeDiff > noProgressTimeoutMs && 
                               !isActivelyProcessing && 
                               !isWebSocketConnected && 
                               !hasRecentProgress
          
          if (isDefinitelyStuck) {
            console.log(`⏰ Job ${getShortJobId(job.job_id)} is definitely stuck (${timeDiffMinutes} minutes old, over 4 hours)`)
            // Update stale job status in database (fire and forget)
            completeJob({
              job_id: job.job_id,
              status: 'error',
              error_message: 'Job exceeded maximum runtime (4 hours)'
            }).catch(e => console.error('Failed to update stuck job:', e))
            
            return {
              ...job,
              status: 'error' as const,
              error_message: 'Exceeded maximum runtime'
            }
          } else if (isLikelyStuck) {
            console.log(`⚠️ Job ${getShortJobId(job.job_id)} appears stuck (${timeDiffMinutes} minutes old, no progress/connection)`)
            // Don't automatically mark as failed, but log for manual review
            // The manual fix button will be available for these cases
            return {
              ...job,
              status: job.status,
              error_message: job.error_message || 'Appears stuck - use manual fix'
            }
          } else if (isActivelyProcessing || isWebSocketConnected) {
            console.log(`✅ Job ${getShortJobId(job.job_id)} is actively processing (${timeDiffMinutes} minutes old)`)
          }
        }
        return job
      })

      const items: VideoItem[] = []

      for (const video of processedJobs) {
        // Build video URL - prioritize Supabase URL, fallback to ComfyUI
        let videoUrl: string | undefined
        if (video.video_url && video.video_url.trim() !== '') {
          videoUrl = video.video_url
        }
        // Only use ComfyUI URL as fallback if no valid Supabase URL exists
        else if (video.filename && video.comfy_url) {
          videoUrl = `${video.comfy_url.replace(/\/$/, '')}/api/view?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder || '')}&type=temp`
        }
        
        items.push({
          id: video.job_id,
          type: 'video',
          created_at: video.timestamp_submitted,
          title: `${video.image_filename || 'Video'} + ${video.audio_filename || 'Audio'}`,
          status: video.status,
          preview_url: undefined, // Videos don't have preview images
          result_url: videoUrl || undefined,
          processing_time: video.timestamp_completed && video.timestamp_submitted 
            ? Math.round((new Date(video.timestamp_completed).getTime() - new Date(video.timestamp_submitted).getTime()) / 1000)
            : undefined,
          progress: (video as VideoJob).progress,
          metadata: video
        })
      }

      // Sort by creation date (newest first)
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      
      // Apply filtering if needed
      const filteredItems = showFilteredOnly 
        ? items.filter(item => item.status === 'completed' && item.result_url)
        : items

      console.log(`📈 Processed ${filteredItems.length} items after filtering`)

      // Update displayed items
      
      // Update displayed items based on current display count
      const newDisplayCount = reset ? (config.maxItems || 10) : displayCount + (config.maxItems || 10)
      setDisplayCount(newDisplayCount)
      setDisplayedItems(filteredItems.slice(0, newDisplayCount))
      
      // Check if there are more items to show
      setHasMore(newDisplayCount < filteredItems.length)

      console.log(`📊 Display: ${newDisplayCount}/${filteredItems.length} items, hasMore=${newDisplayCount < filteredItems.length}`)
    } catch (error) {
      console.error('Error loading video feed:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      setError(errorMessage)
      
      // If this is a reset (initial load), show empty state
      if (reset) {
        setDisplayedItems([])
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadFeed(false)
    }
  }

  // Fix stuck job manually
  const handleFixStuckJob = async (job: VideoJob) => {
    if (fixingJobs.has(job.job_id)) return // Already fixing
    
    setFixingJobs(prev => new Set([...prev, job.job_id]))
    
    try {
      console.log('🔧 Manual fix requested for job:', job.job_id)
      const result = await fixStuckJob(job.job_id, comfyUrl)
      
      if (result.success) {
        console.log('✅ Job fixed successfully:', result.message)
        // Refresh the feed to show updated status
        await loadFeed()
      } else {
        console.error('❌ Failed to fix job:', result.error)
        alert(`Failed to fix job: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Error during manual job fix:', error)
      alert(`Error fixing job: ${error}`)
    } finally {
      setFixingJobs(prev => {
        const newSet = new Set(prev)
        newSet.delete(job.job_id)
        return newSet
      })
    }
  }

  useEffect(() => {
    loadFeed(true) // Reset pagination when dependencies change
    
    // Refresh every 30 seconds
    const interval = setInterval(() => loadFeed(true), 30000)
    return () => clearInterval(interval)
  }, [config.showCompletedOnly, config.maxItems, showFilteredOnly])


  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
          <div className="w-2 h-8 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
          Video Generation Feed
        </h2>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilteredOnly(!showFilteredOnly)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              showFilteredOnly 
                ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}
          >
            {showFilteredOnly ? 'Show Completed Only' : 'Show All'}
          </button>
          {error && (
            <div className="text-red-600 text-sm flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Connection issue
            </div>
          )}
          <button
            onClick={() => loadFeed(true)}
            disabled={loading}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full border border-blue-300 hover:bg-blue-200 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="text-center py-8">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mx-4">
              <div className="flex items-center justify-center mb-2">
                <svg className="w-6 h-6 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <h3 className="text-red-800 font-medium">Connection Error</h3>
              </div>
              <p className="text-red-700 text-sm mb-3">{error}</p>
              <button
                onClick={() => loadFeed(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : loading && displayedItems.length === 0 ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading videos...</p>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No videos found</p>
          </div>
        ) : (
          <div className="space-y-4">
          {displayedItems.map((item) => {
            // Show compact view for failed/error items
            if (item.status === 'error' || (item.metadata as VideoJob).error_message === 'Timed out') {
              return (
                <div key={item.id} className="border border-yellow-200 rounded-lg p-2 bg-yellow-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-600">
                      {getShortJobId(item.id)}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                      {(item.metadata as VideoJob).error_message === 'Timed out' ? 'cancelled' : item.status}
                    </span>
                  </div>
                  {(item.metadata as VideoJob).error_message && (
                    <div className="text-xs text-yellow-600 mt-1 truncate">
                      {(item.metadata as VideoJob).error_message === 'Timed out' ? 'Timed out' : (item.metadata as VideoJob).error_message}
                    </div>
                  )}
                </div>
              )
            }
            
            // Full view for completed/processing items
            return (
              <div key={item.id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                {/* Video content */}
                {item.result_url && item.status === 'completed' ? (
                  <LazyVideo 
                    item={item} 
                    onError={(e) => {
                      const target = e.target as HTMLVideoElement
                      const videoData = item.metadata as VideoJob
                      
                      // Only try ComfyUI fallback if we started with Supabase and have ComfyUI data
                      if (item.result_url?.includes('supabase.co') && videoData.filename && videoData.comfy_url) {
                        const fallbackUrl = `${videoData.comfy_url.replace(/\/$/, '')}/api/view?filename=${encodeURIComponent(videoData.filename)}&subfolder=${encodeURIComponent(videoData.subfolder || '')}&type=temp`
                        console.log('Video load failed, trying ComfyUI fallback:', fallbackUrl)
                        target.src = fallbackUrl
                        return
                      }
                      
                      // If all URLs fail, show fallback UI
                      console.error('All video URLs failed for job:', item.id)
                      target.style.display = 'none'
                      const fallbackDiv = target.nextElementSibling as HTMLElement
                      if (fallbackDiv) fallbackDiv.style.display = 'block'
                    }}
                  />
                ) : item.status === 'processing' || item.status === 'submitted' ? (
                  <div className="w-full h-20 bg-blue-50 rounded-xl mb-2 flex items-center justify-center">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <div className="text-blue-600 text-sm">
                        {config.showProgress && progress.total_nodes > 0 ? (
                          <div className="w-full">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm font-medium">Processing...</span>
                              <span className="text-xs text-blue-600">
                                {progress.detailed_progress ? 
                                  `${progress.detailed_progress.progress_percentage}%` : 
                                  `${progress.completed_nodes}/${progress.total_nodes}`
                                }
                              </span>
                            </div>
                            <div className="w-full bg-blue-200 rounded-full h-2 mb-1">
                              <div 
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                                style={{ 
                                  width: `${progress.detailed_progress ? 
                                    progress.detailed_progress.progress_percentage : 
                                    (progress.completed_nodes / progress.total_nodes) * 100
                                  }%` 
                                }}
                              ></div>
                            </div>
                            {progress.current_node && (
                              <div className="text-xs text-blue-500 truncate">Current: {progress.current_node}</div>
                            )}
                            {progress.workflow_info && (
                              <div className="text-xs text-blue-400">
                                {progress.workflow_info.workflow_type}: {progress.completed_nodes}/{progress.workflow_info.expected_total_nodes} nodes
                              </div>
                            )}
                            {progress.detailed_progress && (
                              <div className="text-xs text-blue-400">
                                Steps: {progress.detailed_progress.total_progress}/{progress.detailed_progress.max_progress}
                              </div>
                            )}
                            {progress.queue_remaining > 0 && (
                              <div className="text-xs text-blue-400">Queue: {progress.queue_remaining} remaining</div>
                            )}
                          </div>
                        ) : (
                          'Processing...'
                        )}
                      </div>
                      {(item.status === 'processing' && comfyUrl && config.showFixButton && !(progress.total_nodes > 0 && progress.completed_nodes > 0)) && (
                        <button
                          onClick={() => handleFixStuckJob(item.metadata as VideoJob)}
                          disabled={fixingJobs.has(item.id)}
                          className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded border border-orange-300 disabled:opacity-50"
                          title="Manually check ComfyUI and fix if completed"
                        >
                          {fixingJobs.has(item.id) ? '...' : 'Fix'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-20 bg-gray-100 rounded-xl mb-2 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-4xl mb-2">🎬</div>
                      <p className="text-gray-400 text-sm">No video available</p>
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

                  {/* Action buttons */}
                  {item.status === 'completed' && item.result_url && (
                    <div className="pt-2">
                      <a 
                        href={item.result_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="block w-full bg-blue-600 text-white text-center py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                      >
                        View Video
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          
          {/* Load More Button */}
          {hasMore && displayedItems.length > 0 && (
            <div className="flex justify-center pt-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
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
    </div>
  )
}
