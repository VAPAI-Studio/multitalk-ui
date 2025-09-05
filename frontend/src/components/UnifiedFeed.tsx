import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../lib/apiClient'
import { getCompletedJobsWithVideos, getRecentJobs, completeJob } from '../lib/jobTracking'
import { fixStuckJob } from '../lib/fixStuckJob'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
import VideoThumbnail from './VideoThumbnail'
import type { MultiTalkJob } from '../lib/supabase'

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

interface VideoJob extends MultiTalkJob {
  progress?: {
    completed_nodes: number
    total_nodes: number
    current_node?: string
  }
  workflow_type?: string
}

// Unified feed item interface
interface FeedItem {
  id: string
  type: 'image' | 'video'
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
  metadata: EditedImage | StyleTransfer | VideoJob
}

// Feed configuration
export interface FeedConfig {
  type: 'video' | 'image' | 'both'
  title: string
  showCompletedOnly?: boolean
  maxItems?: number
  showFixButton?: boolean
  showProgress?: boolean
  pageContext?: string // Identifies which page/tool this feed is on (e.g., 'lipsync-one', 'lipsync-multi', 'videolipsync', 'wani2v')
}

interface UnifiedFeedProps {
  comfyUrl: string
  config: FeedConfig
}

// Lazy Video Component with thumbnail support
const LazyVideo = ({ item, onError }: { item: FeedItem; onError: (error: any) => void }) => {
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

export default function UnifiedFeed({ comfyUrl, config }: UnifiedFeedProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())
  const [showFilteredOnly, setShowFilteredOnly] = useState(false) // Toggle between "Show All" and "Show Mine"
  
  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(comfyUrl, true)
  
  // Helper function to get short job ID consistently
  const getShortJobId = (jobId: string) => jobId.slice(-8)

  const loadFeed = async () => {
    setLoading(true)
    try {
      const items: FeedItem[] = []

      // Load videos if requested
      if (config.type === 'video' || config.type === 'both') {
        const { jobs, error: videoError } = config.showCompletedOnly 
          ? await getCompletedJobsWithVideos(config.maxItems || 10)
          : await getRecentJobs(config.maxItems || 10)
        
        if (!videoError && jobs) {
          // Smart stuck job detection - focus on truly stuck jobs, not just time
          const now = new Date()
          const maxJobAgeMs = 4 * 60 * 60 * 1000 // 4 hours maximum (very generous for video generation)
          const noProgressTimeoutMs = 45 * 60 * 1000 // 45 minutes without progress = likely stuck
          
          const processedJobs = jobs.map(job => {
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

          for (const video of processedJobs) {
            let videoUrl: string | undefined = undefined
            
            // Always prefer Supabase URL if it exists and is not empty
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
        }
      }

      // Load images if requested
      if (config.type === 'image' || config.type === 'both') {
        try {
          const response = await apiClient.getRecentEditedImages(config.maxItems || 10, 0, config.showCompletedOnly || false) as EditedImagesResponse
          
          if (response.success && response.edited_images) {
            for (const image of response.edited_images) {
              items.push({
                id: image.id,
                type: 'image',
                created_at: image.created_at,
                title: image.prompt || 'Image Edit',
                status: image.status,
                preview_url: image.source_image_url,
                result_url: image.result_image_url,
                processing_time: image.processing_time_seconds,
                metadata: image
              })
            }
          }
        } catch (error) {
          console.error('Error loading images:', error)
        }

        // Load style transfers if on style-transfer page
        if (config.pageContext === 'style-transfer') {
          try {
            const styleResponse = await apiClient.getRecentStyleTransfers(config.maxItems || 10, 0, config.showCompletedOnly || false) as StyleTransfersResponse
            
            if (styleResponse.success && styleResponse.style_transfers) {
              for (const transfer of styleResponse.style_transfers) {
                items.push({
                  id: transfer.id,
                  type: 'image',
                  created_at: transfer.created_at,
                  title: transfer.prompt || 'Style Transfer',
                  status: transfer.status,
                  preview_url: transfer.source_image_url,
                  result_url: transfer.result_image_url,
                  processing_time: transfer.processing_time_seconds,
                  metadata: transfer
                })
              }
            }
          } catch (error) {
            console.error('Error loading style transfers:', error)
          }
        }
      }

      // Sort by creation date (newest first)
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      
      // Apply filtering if needed
      let filteredItems = items
      if (showFilteredOnly && config.pageContext) {
        filteredItems = items.filter(item => {
          if (item.type === 'video') {
            const videoJob = item.metadata as VideoJob
            return videoJob.workflow_type === config.pageContext
          }
          // For images, we might need to add workflow_type later, for now show all images
          return item.type === 'image'
        })
      }
      
      setFeedItems(filteredItems.slice(0, config.maxItems || 10))
    } catch (error) {
      console.error('Error loading feed:', error)
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
    loadFeed()
    const interval = setInterval(loadFeed, 3000) // Refresh every 3 seconds
    return () => clearInterval(interval)
  }, [config, showFilteredOnly]) // Also reload when filter changes

  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm h-full flex flex-col">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-3 flex items-center gap-3">
          <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
          {config.title} 
        </h2>
        
        {/* Filter Toggle - only show if pageContext is provided */}
        {config.pageContext && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilteredOnly(!showFilteredOnly)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                showFilteredOnly 
                  ? 'bg-purple-100 text-purple-700 border-purple-200' 
                  : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
              }`}
            >
              {showFilteredOnly ? '🔍 Show Mine' : '🌍 Show All'}
            </button>
            <span className="text-xs text-gray-500">
              {showFilteredOnly ? `Filtered to ${config.title} results` : 'Showing all results'}
            </span>
          </div>
        )}
      </div>
      
      {loading && feedItems.length === 0 ? (
        <div className="text-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      ) : feedItems.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-3">No items found</p>
          <p className="text-xs text-gray-400">Items will appear here when generated</p>
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
                      {item.id.slice(-8)}
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
                {/* Content based on type */}
                {item.type === 'video' ? (
                  <>
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
                        <p className="text-gray-500 text-sm">No video available</p>
                      </div>
                    )}
                  </>
                ) : (
                  // Image content
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    {item.preview_url && (
                      <div>
                        <img 
                          src={item.preview_url} 
                          alt="Source" 
                          className="w-full h-24 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => window.open(item.preview_url!, '_blank')}
                        />
                        <p className="text-xs text-gray-500 text-center mt-1">Source</p>
                      </div>
                    )}
                    {item.result_url ? (
                      <div>
                        <img 
                          src={item.result_url} 
                          alt="Result" 
                          className="w-full h-24 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => window.open(item.result_url!, '_blank')}
                        />
                        <p className="text-xs text-gray-500 text-center mt-1">Result</p>
                      </div>
                    ) : item.status === 'processing' ? (
                      <div className="w-full h-24 bg-blue-50 rounded-lg flex items-center justify-center">
                        <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      </div>
                    ) : (
                      <div className="w-full h-24 bg-gray-100 rounded-lg flex items-center justify-center">
                        <p className="text-gray-500 text-xs">No result</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Item Details */}
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 truncate" title={item.title}>
                    {item.title}
                  </div>
                  <div className="text-xs text-gray-400">
                    {item.status === 'completed' && item.processing_time ? 
                      `Completed in ${item.processing_time}s` :
                      item.status === 'processing' ? 'Processing...' : 
                      item.status === 'pending' ? 'Pending...' : 'Submitted'
                    }
                  </div>
                  <div className="text-xs">
                    <span className={`px-2 py-1 rounded-full ${
                      item.status === 'completed' ? 'bg-green-100 text-green-700' :
                      (item.metadata as VideoJob).error_message === 'Timed out' ? 'bg-yellow-100 text-yellow-700' :
                      item.status === 'failed' || item.status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {(item.metadata as VideoJob).error_message === 'Timed out' ? 'cancelled' : item.status}
                    </span>
                  </div>
                  {item.type === 'video' && (
                    <div className="text-xs text-gray-400">
                      {(item.metadata as VideoJob).width}×{(item.metadata as VideoJob).height}
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