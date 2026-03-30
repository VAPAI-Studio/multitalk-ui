import { useState, useRef, useCallback } from 'react';
import { uploadMediaToComfy, checkComfyUIHealth, startJobMonitoring, generateId } from '../components/utils';
import { apiClient } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';

// --- Interfaces ---

interface BatchVideoItem {
  id: string;
  file: File;
  thumbnail: string | null;
  duration: number;
  size: number;
  repetitions: number;
}

interface BatchJob {
  id: string;
  videoItemId: string;
  videoFile: File;
  videoName: string;
  repetitionIndex: number;
  totalRepetitions: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  comfyJobId: string | null;
  resultUrl: string | null;
  errorMessage: string | null;
  statusMessage: string;
}

// --- Fixed Settings ---

const FIXED_WIDTH = 1248;
const FIXED_HEIGHT = 640;
const FIXED_AUDIO_SCALE = 1.5;
const FIXED_PROMPT = 'a person is speaking';

const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];

// --- UI Sub-components ---

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 dark:text-dark-text-primary mb-2"}>{children}</label>;
}

function Section({ title, children, gradient = 'from-blue-500 to-purple-600' }: { title: string; children: React.ReactNode; gradient?: string }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 dark:border-dark-border-primary p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-dark-surface-primary dark:to-dark-surface-primary backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-6 flex items-center gap-3">
        <div className={`w-2 h-8 bg-gradient-to-b ${gradient} rounded-full`}></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; text: string; dot: string }> = {
    pending: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
    uploading: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500 animate-pulse' },
    processing: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500 animate-pulse' },
    completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
    failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  };
  const colors = colorMap[status] || colorMap.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-2 h-2 rounded-full ${colors.dot}`}></span>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Video Metadata Extraction ---

async function extractVideoMetadata(file: File): Promise<{ thumbnail: string | null; duration: number }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ thumbnail: null, duration: 0 });
    }, 5000);

    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 72;
      const ctx = canvas.getContext('2d');
      let thumbnail: string | null = null;
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      }
      URL.revokeObjectURL(objectUrl);
      resolve({ thumbnail, duration: video.duration });
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      resolve({ thumbnail: null, duration: 0 });
    };
  });
}

// --- Workflow Builder ---

async function buildSimpleVideoLipsyncPrompt(videoFilename: string, duration: number) {
  const response = await fetch('/workflows/VideoLipsync.json');
  if (!response.ok) throw new Error('Failed to load VideoLipsync workflow template');
  const template = await response.json();

  const minutes = Math.floor(duration / 60);
  const seconds = Math.ceil(duration % 60);
  const audioEndTime = `${minutes}:${String(seconds).padStart(2, '0')}`;

  const promptString = JSON.stringify(template)
    .replace(/"\{\{VIDEO_FILENAME\}\}"/g, `"${videoFilename}"`)
    .replace(/"\{\{AUDIO_FILENAME\}\}"/g, `"${videoFilename}"`)
    .replace(/"\{\{WIDTH\}\}"/g, FIXED_WIDTH.toString())
    .replace(/"\{\{HEIGHT\}\}"/g, FIXED_HEIGHT.toString())
    .replace(/"\{\{AUDIO_SCALE\}\}"/g, FIXED_AUDIO_SCALE.toString())
    .replace(/"\{\{AUDIO_START_TIME\}\}"/g, `"0:00"`)
    .replace(/"\{\{AUDIO_END_TIME\}\}"/g, `"${audioEndTime}"`)
    .replace(/"\{\{VIDEO_START_FRAME\}\}"/g, '0')
    .replace(/"\{\{CUSTOM_PROMPT\}\}"/g, `"${FIXED_PROMPT}"`)
    .replace(/"\{\{TRIM_TO_AUDIO\}\}"/g, 'true')
    .replace(/"\{\{BLACK_FRAME_COUNT_START\}\}"/g, '0')
    .replace(/"\{\{BLACK_FRAME_COUNT_END\}\}"/g, '0')
    .replace(/"\{\{CONCAT_INPUT_COUNT\}\}"/g, '2')
    .replace(/"\{\{CONCAT_INPUT_1_NODE\}\}"/g, '"301"')
    .replace(/"\{\{CONCAT_INPUT_1_INDEX\}\}"/g, '0')
    .replace(/"\{\{CONCAT_INPUT_2_NODE\}\}"/g, '"301"')
    .replace(/"\{\{CONCAT_INPUT_2_INDEX\}\}"/g, '0')
    .replace(/"\{\{CONCAT_INPUT_3_NODE\}\}"/g, '"301"')
    .replace(/"\{\{CONCAT_INPUT_3_INDEX\}\}"/g, '0');

  return JSON.parse(promptString);
}

// --- Promise-wrapped Job Monitoring ---

function waitForCompletion(
  jobId: string,
  comfyUrl: string,
  onProgress: (message: string) => void
): Promise<{ success: boolean; url?: string; error?: string }> {
  return new Promise((resolve) => {
    const cleanup = startJobMonitoring(jobId, comfyUrl, async (status, message, videoInfo) => {
      if (status === 'processing') {
        onProgress(message || 'Processing in ComfyUI...');
      } else if (status === 'completed' && videoInfo) {
        cleanup();
        const url = videoInfo.subfolder
          ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
          : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
        resolve({ success: true, url });
      } else if (status === 'error') {
        cleanup();
        resolve({ success: false, error: message || 'Unknown error' });
      }
    });
  });
}

// --- File Validation ---

function filterVideoFiles(files: File[]): { valid: File[]; invalid: string[] } {
  const valid: File[] = [];
  const invalid: string[] = [];
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext) || file.type.startsWith('video/')) {
      valid.push(file);
    } else {
      invalid.push(file.name);
    }
  }
  return { valid, invalid };
}

// --- Main Component ---

interface Props {
  comfyUrl: string;
}

export default function BatchVideoLipsync({ comfyUrl }: Props) {
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Setup view state
  const [videoItems, setVideoItems] = useState<BatchVideoItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Monitoring view state
  const [view, setView] = useState<'setup' | 'monitoring'>('setup');
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentJobIndex, setCurrentJobIndex] = useState(-1);
  const isProcessingRef = useRef(false);

  // Track uploaded filenames to avoid re-uploading same video for multiple reps
  const uploadedFilenamesRef = useRef<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const totalJobs = videoItems.reduce((sum, item) => sum + item.repetitions, 0);
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const failedJobs = jobs.filter(j => j.status === 'failed').length;
  const progressPercentage = jobs.length > 0 ? Math.round(((completedJobs + failedJobs) / jobs.length) * 100) : 0;

  // Handle folder/file upload
  const handleFiles = useCallback(async (files: File[]) => {
    setUploadError('');
    const { valid, invalid } = filterVideoFiles(files);

    if (invalid.length > 0) {
      setUploadError(`Skipped non-video files: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? ` and ${invalid.length - 3} more` : ''}`);
    }

    if (valid.length === 0) return;

    setIsLoadingFiles(true);
    const newItems: BatchVideoItem[] = [];

    for (const file of valid) {
      const { thumbnail, duration } = await extractVideoMetadata(file);
      newItems.push({
        id: generateId(),
        file,
        thumbnail,
        duration,
        size: file.size,
        repetitions: 1,
      });
    }

    setVideoItems(prev => [...prev, ...newItems]);
    setIsLoadingFiles(false);
  }, []);

  // Drag & drop handlers
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Update repetitions for a video
  const setRepetitions = (itemId: string, reps: number) => {
    setVideoItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, repetitions: Math.max(1, Math.min(10, reps)) } : item
    ));
  };

  // Remove a video from queue
  const removeItem = (itemId: string) => {
    setVideoItems(prev => prev.filter(item => item.id !== itemId));
  };

  // Clear all videos
  const clearAll = () => {
    setVideoItems([]);
    setUploadError('');
  };

  // Expand video items into individual jobs
  const expandToJobs = (): BatchJob[] => {
    const allJobs: BatchJob[] = [];
    for (const item of videoItems) {
      for (let i = 1; i <= item.repetitions; i++) {
        allJobs.push({
          id: generateId(),
          videoItemId: item.id,
          videoFile: item.file,
          videoName: item.file.name,
          repetitionIndex: i,
          totalRepetitions: item.repetitions,
          status: 'pending',
          comfyJobId: null,
          resultUrl: null,
          errorMessage: null,
          statusMessage: 'Waiting...',
        });
      }
    }
    return allJobs;
  };

  // Update a specific job in state
  const updateJob = useCallback((jobId: string, updates: Partial<BatchJob>) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j));
  }, []);

  // Start batch processing
  const startBatch = async () => {
    if (videoItems.length === 0 || !comfyUrl) return;

    const expandedJobs = expandToJobs();
    setJobs(expandedJobs);
    setView('monitoring');
    setIsProcessing(true);
    isProcessingRef.current = true;
    uploadedFilenamesRef.current = {};

    try {
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`ComfyUI not available: ${healthCheck.error}`);
      }

      for (let i = 0; i < expandedJobs.length; i++) {
        if (!isProcessingRef.current) break;

        const job = expandedJobs[i];
        setCurrentJobIndex(i);

        // Upload phase
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'uploading', statusMessage: 'Uploading video...' } : j));

        try {
          // Reuse filename if same video was already uploaded
          let videoFilename = uploadedFilenamesRef.current[job.videoFile.name];
          if (!videoFilename) {
            videoFilename = await uploadMediaToComfy(comfyUrl, job.videoFile);
            uploadedFilenamesRef.current[job.videoFile.name] = videoFilename;
          }

          // Get duration from the matching video item
          const videoItem = videoItems.find(v => v.id === job.videoItemId);
          const duration = videoItem?.duration || 0;

          // Build workflow
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, statusMessage: 'Building workflow...' } : j));
          const promptJson = await buildSimpleVideoLipsyncPrompt(videoFilename, duration);

          // Submit to ComfyUI
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, statusMessage: 'Submitting to ComfyUI...' } : j));
          const clientId = `batch-vls-${generateId()}`;
          const r = await fetch(`${comfyUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptJson, client_id: clientId }),
            signal: AbortSignal.timeout(30000),
          });

          if (!r.ok) {
            let errorDetail = '';
            try { const ed = await r.json(); errorDetail = ed.error || ed.message || ''; } catch { errorDetail = await r.text().catch(() => ''); }
            throw new Error(`ComfyUI rejected prompt (${r.status}): ${errorDetail || 'Unknown'}`);
          }

          const resp = await r.json();
          const promptId = resp?.prompt_id || resp?.promptId || '';
          if (!promptId) throw new Error('No prompt ID returned');

          // Create job record
          await apiClient.createVideoJob({
            user_id: user?.id || null,
            project_id: selectedProject?.id || null,
            comfy_job_id: promptId,
            workflow_name: 'video-lipsync',
            comfy_url: comfyUrl,
            input_video_urls: [job.videoFile.name],
            input_audio_urls: [],
            width: FIXED_WIDTH,
            height: FIXED_HEIGHT,
            fps: 25,
            parameters: {
              audio_scale: FIXED_AUDIO_SCALE,
              batch_mode: true,
              repetition: `${job.repetitionIndex}/${job.totalRepetitions}`,
            },
          });

          await apiClient.updateVideoJobToProcessing(promptId);

          // Processing phase
          setJobs(prev => prev.map(j => j.id === job.id ? {
            ...j,
            status: 'processing',
            comfyJobId: promptId,
            statusMessage: 'Processing in ComfyUI...',
          } : j));

          // Wait for completion
          const result = await waitForCompletion(promptId, comfyUrl, (msg) => {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, statusMessage: msg } : j));
          });

          if (result.success && result.url) {
            setJobs(prev => prev.map(j => j.id === job.id ? {
              ...j,
              status: 'completed',
              resultUrl: result.url!,
              statusMessage: 'Completed!',
            } : j));

            await apiClient.completeVideoJob(promptId, {
              job_id: promptId,
              status: 'completed',
              output_video_urls: [result.url],
            });
          } else {
            setJobs(prev => prev.map(j => j.id === job.id ? {
              ...j,
              status: 'failed',
              errorMessage: result.error || 'Unknown error',
              statusMessage: `Failed: ${result.error || 'Unknown error'}`,
            } : j));

            await apiClient.completeVideoJob(promptId, {
              job_id: promptId,
              status: 'failed',
              error_message: result.error || 'Unknown error',
            }).catch(() => {});
          }
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          setJobs(prev => prev.map(j => j.id === job.id ? {
            ...j,
            status: 'failed',
            errorMessage: errorMsg,
            statusMessage: `Failed: ${errorMsg}`,
          } : j));

          if (job.comfyJobId) {
            await apiClient.completeVideoJob(job.comfyJobId, {
              job_id: job.comfyJobId,
              status: 'failed',
              error_message: errorMsg,
            }).catch(() => {});
          }
        }
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Batch processing failed');
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
      setCurrentJobIndex(-1);
    }
  };

  // Retry a failed job
  const retryJob = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.status !== 'failed') return;

    updateJob(jobId, { status: 'uploading', errorMessage: null, statusMessage: 'Retrying...', comfyJobId: null, resultUrl: null });

    try {
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) throw new Error('ComfyUI not available');

      let videoFilename = uploadedFilenamesRef.current[job.videoFile.name];
      if (!videoFilename) {
        videoFilename = await uploadMediaToComfy(comfyUrl, job.videoFile);
        uploadedFilenamesRef.current[job.videoFile.name] = videoFilename;
      }

      const videoItem = videoItems.find(v => v.id === job.videoItemId);
      const duration = videoItem?.duration || 0;

      const promptJson = await buildSimpleVideoLipsyncPrompt(videoFilename, duration);
      const clientId = `batch-vls-retry-${generateId()}`;

      const r = await fetch(`${comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptJson, client_id: clientId }),
        signal: AbortSignal.timeout(30000),
      });

      if (!r.ok) throw new Error(`ComfyUI rejected prompt (${r.status})`);

      const resp = await r.json();
      const promptId = resp?.prompt_id || '';
      if (!promptId) throw new Error('No prompt ID returned');

      await apiClient.createVideoJob({
        user_id: user?.id || null,
        project_id: selectedProject?.id || null,
        comfy_job_id: promptId,
        workflow_name: 'video-lipsync',
        comfy_url: comfyUrl,
        input_video_urls: [job.videoFile.name],
        input_audio_urls: [],
        width: FIXED_WIDTH,
        height: FIXED_HEIGHT,
        fps: 25,
        parameters: { audio_scale: FIXED_AUDIO_SCALE, batch_mode: true, retry: true },
      });
      await apiClient.updateVideoJobToProcessing(promptId);

      updateJob(jobId, { status: 'processing', comfyJobId: promptId, statusMessage: 'Processing in ComfyUI...' });

      const result = await waitForCompletion(promptId, comfyUrl, (msg) => {
        updateJob(jobId, { statusMessage: msg });
      });

      if (result.success && result.url) {
        updateJob(jobId, { status: 'completed', resultUrl: result.url, statusMessage: 'Completed!' });
        await apiClient.completeVideoJob(promptId, { job_id: promptId, status: 'completed', output_video_urls: [result.url] });
      } else {
        updateJob(jobId, { status: 'failed', errorMessage: result.error || 'Unknown error', statusMessage: `Failed: ${result.error}` });
        await apiClient.completeVideoJob(promptId, { job_id: promptId, status: 'failed', error_message: result.error }).catch(() => {});
      }
    } catch (err: any) {
      updateJob(jobId, { status: 'failed', errorMessage: err?.message, statusMessage: `Failed: ${err?.message}` });
    }
  };

  // New batch - reset everything
  const newBatch = () => {
    setView('setup');
    setJobs([]);
    setVideoItems([]);
    setCurrentJobIndex(-1);
    setIsProcessing(false);
    isProcessingRef.current = false;
    uploadedFilenamesRef.current = {};
    setUploadError('');
  };

  // --- RENDER ---

  if (view === 'monitoring') {
    return (
      <div className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-4">
            <h1 className="text-3xl md:text-5xl font-black bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
              Batch Video Lipsync
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {isProcessing
                ? `Processing job ${currentJobIndex + 1} of ${jobs.length}...`
                : `Batch complete: ${completedJobs} completed, ${failedJobs} failed`
              }
            </p>
          </div>

          {/* Progress Bar */}
          <Section title="Progress" gradient="from-green-500 to-blue-600">
            <div className="space-y-2">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-green-500 to-blue-600 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <span className="text-green-600 dark:text-green-400 font-medium">{completedJobs} completed</span>
                  {failedJobs > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{failedJobs} failed</span>}
                  <span className="text-gray-500 dark:text-gray-400">{jobs.length - completedJobs - failedJobs} pending</span>
                </div>
                <span className="text-gray-600 dark:text-gray-300 font-semibold">{progressPercentage}%</span>
              </div>
            </div>
          </Section>

          {/* Jobs List */}
          <Section title="Jobs" gradient="from-blue-500 to-purple-600">
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="border border-gray-200 dark:border-dark-border-primary rounded-2xl p-4 space-y-3">
                  {/* Job header */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
                        {job.videoName}
                        {job.totalRepetitions > 1 && (
                          <span className="text-gray-500 dark:text-gray-400 ml-2 text-sm">
                            (run {job.repetitionIndex}/{job.totalRepetitions})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{job.statusMessage}</p>
                    </div>
                    <StatusBadge status={job.status} />
                    {job.status === 'failed' && (
                      <button
                        onClick={() => retryJob(job.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                    {job.status === 'completed' && job.resultUrl && (
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = job.resultUrl!;
                          a.download = `lipsync-${job.videoName}-run${job.repetitionIndex}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                      >
                        Download
                      </button>
                    )}
                  </div>

                  {/* Inline video player for completed jobs */}
                  {job.status === 'completed' && job.resultUrl && (
                    <video
                      src={job.resultUrl}
                      controls
                      className="w-full max-h-64 rounded-xl border border-gray-200 dark:border-dark-border-primary bg-black"
                    />
                  )}

                  {/* Error details */}
                  {job.status === 'failed' && job.errorMessage && (
                    <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2">
                      {job.errorMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Actions */}
          <div className="flex justify-center">
            <button
              onClick={newBatch}
              disabled={isProcessing}
              className="px-8 py-4 rounded-2xl bg-gradient-to-r from-gray-600 to-gray-700 text-white font-bold text-lg shadow-lg hover:from-gray-700 hover:to-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              New Batch
            </button>
          </div>
        </div>
    );
  }

  // --- SETUP VIEW ---
  return (
    <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-4 py-8">
          <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
            Batch Video Lipsync
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Upload a folder of videos and process them all with lip-sync automatically. Each video uses its own audio track.
          </p>
        </div>

        {/* Upload Section */}
        <Section title="Upload Videos" gradient="from-green-500 to-blue-600">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer"
            onClick={() => folderInputRef.current?.click()}
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              Click to upload a folder or drag & drop videos here
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Supports MP4, MOV, AVI, WebM, MKV
            </p>
          </div>

          {/* Hidden inputs */}
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            {...({ webkitdirectory: 'true', directory: '' } as any)}
            multiple
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="video/*"
            multiple
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
          />

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium text-sm hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              Upload Folder
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Select Files
            </button>
            {videoItems.length > 0 && (
              <button
                onClick={clearAll}
                className="px-4 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-medium text-sm hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors ml-auto"
              >
                Clear All
              </button>
            )}
          </div>

          {uploadError && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-3">{uploadError}</p>
          )}

          {isLoadingFiles && (
            <div className="flex items-center gap-2 mt-4 text-sm text-gray-500 dark:text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Loading video metadata...
            </div>
          )}
        </Section>

        {/* Video Queue */}
        {videoItems.length > 0 && (
          <Section title={`Video Queue (${videoItems.length} videos)`} gradient="from-blue-500 to-purple-600">
            <div className="space-y-3">
              {videoItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-3 border border-gray-200 dark:border-dark-border-primary rounded-xl bg-white/50 dark:bg-dark-surface-secondary/50"
                >
                  {/* Thumbnail */}
                  <div className="w-20 h-12 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.file.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No preview</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate text-sm">{item.file.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDuration(item.duration)} &middot; {formatBytes(item.size)}
                    </p>
                  </div>

                  {/* Repetitions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Label className="text-xs text-gray-600 dark:text-gray-400 mb-0">Runs:</Label>
                    <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setRepetitions(item.id, item.repetitions - 1)}
                        className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
                        disabled={item.repetitions <= 1}
                      >
                        -
                      </button>
                      <span className="px-3 py-1 text-sm font-semibold text-gray-900 dark:text-dark-text-primary min-w-[2rem] text-center bg-gray-50 dark:bg-gray-800">
                        {item.repetitions}
                      </span>
                      <button
                        onClick={() => setRepetitions(item.id, item.repetitions + 1)}
                        className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm font-bold"
                        disabled={item.repetitions >= 10}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Summary & Start */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-dark-border-primary">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-900 dark:text-dark-text-primary text-lg">{totalJobs}</span> total jobs
                {totalJobs !== videoItems.length && (
                  <span className="ml-1">({videoItems.length} videos)</span>
                )}
              </div>
              <button
                onClick={startBatch}
                disabled={!comfyUrl || videoItems.length === 0}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
              >
                <span>Start Batch</span>
                <span className="text-sm opacity-80">({totalJobs} jobs)</span>
              </button>
            </div>
          </Section>
        )}

        {/* Fixed settings info */}
        <div className="text-center text-xs text-gray-400 dark:text-gray-500 space-y-1">
          <p>Resolution: {FIXED_WIDTH}x{FIXED_HEIGHT} &middot; Audio Scale: {FIXED_AUDIO_SCALE} &middot; Prompt: "{FIXED_PROMPT}"</p>
        </div>
    </div>
  );
}
