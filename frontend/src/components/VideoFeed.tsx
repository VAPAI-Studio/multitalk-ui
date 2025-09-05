import { useState, useEffect, useRef } from 'react'
import { getCompletedJobsWithVideos, getRecentJobs, completeJob } from '../lib/jobTracking'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
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

// Lazy Video Component that only loads when visible
const LazyVideo = ({ item, onError }: { item: VideoItem; onError: (error: any) => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          // Delay loading slightly to prevent resource exhaustion
          setTimeout(() => setShouldLoad(true), 100)
        } else {
          // Unload video when not visible to save resources
          if (video.src && video.src !== '') {
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
          setShouldLoad(false)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={videoRef}
      src={shouldLoad ? item.result_url : undefined}
      controls={shouldLoad}
      className="w-full rounded-xl shadow-lg"
      style={{ maxHeight: '200px' }}
      preload="none"
      onError={onError}
    />
  )
}

export default function VideoFeed({ comfyUrl, config }: VideoFeedProps) {
  const [feedItems, setFeedItems] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())
  const [showFilteredOnly, setShowFilteredOnly] = useState(false) // Toggle between "Show All" and "Show Mine"
  
  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(comfyUrl, true)
  
  const getShortJobId = (jobId: string) => jobId.slice(-8)

  const loadFeed = async () => {
    setLoading(true)
    try {
      const jobsResponse = config.showCompletedOnly 
        ? await getCompletedJobsWithVideos(config.maxItems || 10)
        : await getRecentJobs(config.maxItems || 10)
      
      if (!jobsResponse || !jobsResponse.jobs) {
        setFeedItems([])
        return
      }

      const jobs = jobsResponse.jobs

      // Check for stale jobs and update their status
      const now = new Date()
      const staleThresholdMs = 6 * 60 * 60 * 1000 // 6 hours (very lenient for video generation)
      
      const processedJobs = jobs.map((job: MultiTalkJob) => {
        // Check if job is stale (processing/submitted for more than 6 hours)
        if ((job.status === 'processing' || job.status === 'submitted')) {
          // Handle timestamp parsing - the timestamp is already in ISO format
          const submittedTime = new Date(job.timestamp_submitted)
          const timeDiff = now.getTime() - submittedTime.getTime()
          
          // Debug logging for timeout detection
          console.log(`🔍 Job ${getShortJobId(job.job_id)} (full: ${job.job_id}) timeout check:`, {
            status: job.status,
            timestamp_submitted: job.timestamp_submitted,
            submittedTime: submittedTime.toISOString(),
            submittedTimeLocal: submittedTime.toLocaleString(),
            now: now.toISOString(),
            nowLocal: now.toLocaleString(),
            timeDiffMs: timeDiff,
            timeDiffMinutes: Math.round(timeDiff / (1000 * 60)),
            timeDiffHours: Math.round(timeDiff / (1000 * 60 * 60)),
            staleThresholdMs,
            staleThresholdHours: staleThresholdMs / (1000 * 60 * 60),
            isStale: timeDiff > staleThresholdMs
          })
          
          if (timeDiff > staleThresholdMs) {
            // Check if job is actively processing (has progress data or is connected to WebSocket)
            const isActivelyProcessing = progress.total_nodes > 0 && progress.completed_nodes > 0
            const isWebSocketConnected = progress.is_connected
            
            // Be more lenient - only mark as stale if it's really old AND not processing
            if (isActivelyProcessing || isWebSocketConnected) {
              console.log(`⏰ Job ${getShortJobId(job.job_id)} is old (${Math.round(timeDiff / (1000 * 60))} minutes) but actively processing, keeping alive`)
            } else {
              console.log(`⏰ Marking job ${getShortJobId(job.job_id)} as stale (${Math.round(timeDiff / (1000 * 60))} minutes old)`)
              // Update stale job status in database (fire and forget)
              completeJob({
                job_id: job.job_id,
                status: 'error',
                error_message: 'Job timed out - likely cancelled or failed'
              }).catch(e => console.error('Failed to update stale job:', e))
              
              // Return updated job for UI
              return {
                ...job,
                status: 'error' as const,
                error_message: 'Timed out'
              }
            }
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

      setFeedItems(filteredItems)
    } catch (error) {
      console.error('Error loading video feed:', error)
    } finally {
      setLoading(false)
    }
  }

  // Fix stuck job manually
  const handleFixStuckJob = async (job: VideoJob) => {
    if (fixingJobs.has(job.job_id)) return // Already fixing
    
    setFixingJobs(prev => new Set([...prev, job.job_id]))
    
    try {
      console.log('🔧 Manual fix requested for job:', job.job_id)
      // You can implement fixStuckJob logic here if needed
      
      // For now, just refresh the feed
      await loadFeed()
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
    loadFeed()
    
    // Refresh every 30 seconds
    const interval = setInterval(loadFeed, 30000)
    return () => clearInterval(interval)
  }, [config.showCompletedOnly, config.maxItems, showFilteredOnly])


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-3">
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading videos...</p>
        </div>
      ) : feedItems.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">No videos found</p>
        </div>
      ) : (
        <div className="space-y-4 flex-1 overflow-y-auto">
          {feedItems.map((item) => {
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
        </div>
      )}
    </div>
  )
}
