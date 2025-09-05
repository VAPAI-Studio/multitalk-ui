import { useState, useEffect } from 'react'
import { getRecentJobs, completeJob } from '../lib/jobTracking'
import { fixStuckJob } from '../lib/fixStuckJob'
import { useComfyUIProgress } from '../hooks/useComfyUIProgress'
import type { MultiTalkJob } from '../lib/supabase'

interface JobFeedProps {
  comfyUrl: string
}

export default function JobFeed({ comfyUrl }: JobFeedProps) {
  const [videoFeed, setVideoFeed] = useState<MultiTalkJob[]>([])
  const [fixingJobs, setFixingJobs] = useState<Set<string>>(new Set())
  
  // Use ComfyUI progress tracking
  const { progress } = useComfyUIProgress(comfyUrl, true)
  
  // Helper function to get short job ID consistently
  const getShortJobId = (jobId: string) => jobId.slice(-8)

  const loadVideoFeedFromDB = async () => {
    try {
      console.log('🔄 Fetching video feed...')
      const { jobs, error } = await getRecentJobs(10)
      
      if (error) {
        console.error("Error loading video feed:", error);
        return;
      }
      
      // Smart stuck job detection - focus on truly stuck jobs, not just time
      const now = new Date();
      const maxJobAgeMs = 4 * 60 * 60 * 1000; // 4 hours maximum (very generous for video generation)
      const noProgressTimeoutMs = 45 * 60 * 1000; // 45 minutes without progress = likely stuck
      
      const processedJobs = jobs.map(job => {
        // Only check jobs that are in processing/submitted state
        if ((job.status === 'processing' || job.status === 'submitted')) {
          const submittedTime = new Date(job.timestamp_submitted);
          const timeDiff = now.getTime() - submittedTime.getTime();
          const timeDiffMinutes = Math.round(timeDiff / (1000 * 60));
          
          // Debug logging for stuck job detection
          console.log(`🔍 JobFeed - Job ${getShortJobId(job.job_id)} (full: ${job.job_id}) stuck detection:`, {
            status: job.status,
            timestamp_submitted: job.timestamp_submitted,
            submittedTime: submittedTime.toISOString(),
            now: now.toISOString(),
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
            console.log(`⏰ JobFeed - Job ${getShortJobId(job.job_id)} is definitely stuck (${timeDiffMinutes} minutes old, over 4 hours)`)
            // Update stale job status in database (fire and forget)
            completeJob({
              job_id: job.job_id,
              status: 'error',
              error_message: 'Job exceeded maximum runtime (4 hours)'
            }).catch(e => console.error('Failed to update stuck job:', e));
            
            return {
              ...job,
              status: 'error' as const,
              error_message: 'Exceeded maximum runtime'
            };
          } else if (isLikelyStuck) {
            console.log(`⚠️ JobFeed - Job ${getShortJobId(job.job_id)} appears stuck (${timeDiffMinutes} minutes old, no progress/connection)`)
            // Don't automatically mark as failed, but log for manual review
            return {
              ...job,
              status: job.status,
              error_message: job.error_message || 'Appears stuck - use manual fix'
            };
          } else if (isActivelyProcessing || isWebSocketConnected) {
            console.log(`✅ JobFeed - Job ${getShortJobId(job.job_id)} is actively processing (${timeDiffMinutes} minutes old)`)
          }
        }
        return job;
      });
      
      // console.log('📊 Video feed result:', { 
      //   jobCount: processedJobs.length, 
      //   error, 
      //   jobsWithVideos: processedJobs.filter(j => j.video_url || j.filename).length,
      //   staleJobs: processedJobs.filter(j => j.error_message === 'Timed out').length
      // })
      
      setVideoFeed(processedJobs);
    } catch (e) {
      console.error("Error loading video feed from DB:", e);
    }
  }

  // Fix stuck job manually
  const handleFixStuckJob = async (job: MultiTalkJob) => {
    if (fixingJobs.has(job.job_id)) return // Already fixing
    
    setFixingJobs(prev => new Set([...prev, job.job_id]))
    
    try {
      console.log('🔧 Manual fix requested for job:', job.job_id)
      const result = await fixStuckJob(job.job_id, comfyUrl)
      
      if (result.success) {
        console.log('✅ Job fixed successfully:', result.message)
        // Refresh the feed to show updated status
        await loadVideoFeedFromDB()
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

  // Load video feed from Supabase
  useEffect(() => {
    loadVideoFeedFromDB();
    const interval = setInterval(loadVideoFeedFromDB, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []); // No dependencies - completely independent

  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm h-full flex flex-col">
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
        Feed de Generaciones
      </h2>
      
      {videoFeed.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 mb-3">No hay videos generados aún</p>
          <p className="text-xs text-gray-400">Los videos aparecerán aquí cuando generes contenido</p>
        </div>
      ) : (
        <div className="space-y-4 flex-1 overflow-y-auto">
          {videoFeed.map((job) => {
            // Prefer Supabase video_url, fallback to current ComfyUI URL (not stored comfy_url)
            const videoUrl = job.video_url || 
              (job.filename && comfyUrl ? 
                `${comfyUrl.replace(/\/$/, '')}/api/view?filename=${encodeURIComponent(job.filename)}&subfolder=${encodeURIComponent(job.subfolder || '')}&type=temp`
                : null);
            
            const usingComfyFallback = !job.video_url && job.filename && comfyUrl;
            if (usingComfyFallback) {
              //console.warn('⚠️ Job', job.job_id.slice(-8), 'using ComfyUI fallback URL - Supabase upload likely failed');
            }
            // console.log('🎥 Video URL for job', job.job_id.slice(-8), ':', {
            //   hasSupabaseUrl: !!job.video_url,
            //   hasFilename: !!job.filename,
            //   usingSupabaseUrl: !!job.video_url,
            //   usingComfyFallback,
            //   finalUrl: videoUrl,
            //   filename: job.filename
            // });
              
            // Show compact view for failed/error jobs (now yellow)
            if (job.status === 'error' || job.error_message === 'Timed out') {
              return (
                <div key={job.job_id} className="border border-yellow-200 rounded-lg p-2 bg-yellow-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-600">
                      {getShortJobId(job.job_id)}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                      {job.error_message === 'Timed out' ? 'cancelled' : job.status}
                    </span>
                  </div>
                  {job.error_message && (
                    <div className="text-xs text-yellow-600 mt-1 truncate">
                      {job.error_message === 'Timed out' ? 'Timed out' : job.error_message}
                    </div>
                  )}
                </div>
              );
            }
            
            // Full view for completed/processing jobs
            return (
              <div key={job.job_id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                {videoUrl && job.status === 'completed' ? (
                  <video 
                    src={videoUrl} 
                    controls 
                    className="w-full rounded-xl mb-2"
                    style={{ maxHeight: '150px' }}
                    preload="metadata"
                    onError={(e) => {
                      console.error('❌ Video error for job', getShortJobId(job.job_id), ':', e);
                      console.error('Failed video URL:', videoUrl);
                    }}
                    onLoadStart={() => {
                      console.log('⏳ Loading video for job', getShortJobId(job.job_id), ':', videoUrl);
                    }}
                    onLoadedMetadata={() => {
                      console.log('✅ Video loaded for job', getShortJobId(job.job_id));
                    }}
                  />
                ) : job.status === 'processing' || job.status === 'submitted' ? (
                  <div className="w-full h-20 bg-blue-50 rounded-xl mb-2 flex items-center justify-center">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <div className="text-blue-600 text-sm">
                        {progress.total_nodes > 0 ? (
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
                      {(job.status === 'processing' && comfyUrl && !(progress.total_nodes > 0 && progress.completed_nodes > 0)) && (
                        <button
                          onClick={() => handleFixStuckJob(job)}
                          disabled={fixingJobs.has(job.job_id)}
                          className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded border border-orange-300 disabled:opacity-50"
                          title="Manually check ComfyUI and fix if completed"
                        >
                          {fixingJobs.has(job.job_id) ? '...' : 'Fix'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-20 bg-gray-100 rounded-xl mb-2 flex items-center justify-center">
                    <p className="text-gray-500 text-sm">No video available</p>
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 truncate" title={job.filename || job.job_id}>
                    {job.filename || `Job: ${getShortJobId(job.job_id)}...`}
                  </div>
                  <div className="text-xs text-gray-400">
                    {job.timestamp_completed ? new Date(job.timestamp_completed).toLocaleString() : 
                     job.status === 'processing' ? 'Processing...' : 'Submitted'}
                  </div>
                  <div className="text-xs">
                    <span className={`px-2 py-1 rounded-full ${
                      job.status === 'completed' ? 'bg-green-100 text-green-700' :
                      job.error_message === 'Timed out' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {job.error_message === 'Timed out' ? 'cancelled' : job.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {job.width}×{job.height} • {job.trim_to_audio ? 'Trim to audio' : 'Fixed length'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}