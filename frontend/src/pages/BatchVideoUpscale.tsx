import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/apiClient';
import { useProject } from '../contexts/ProjectContext';

// --- TypeScript Interfaces ---

interface VideoMetadata {
  file: File;
  thumbnailUrl: string | null;
  duration: number;
  width: number;
  height: number;
  size: number;
  warnings: string[];
}

interface UpscaleSettings {
  resolution: '1k' | '2k' | '4k';
  creativity: number;
  sharpen: number;
  grain: number;
  fps_boost: boolean;
  flavor: 'vivid' | 'natural';
}

interface UpscaleVideoItem {
  id: string;
  batch_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
  queue_position: number;
  input_filename: string;
  input_storage_url: string;
  output_storage_url: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface UpscaleBatchData {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  resolution: string;
  creativity: number;
  sharpen: number;
  grain: number;
  fps_boost: boolean;
  flavor: string;
  project_id: string | null;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  videos: UpscaleVideoItem[];
}

// --- Freepik Limits ---

const MAX_DURATION_SECONDS = 15;
const MAX_FILE_SIZE_BYTES = 157286400; // 150 MB
const ACCEPTED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm'];

// --- UI Components ---

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 dark:text-dark-text-primary mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 dark:border-dark-border-primary p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-dark-surface-primary dark:to-dark-surface-primary backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-amber-500 to-orange-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

// --- Utility Functions ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatResolution(w: number, h: number): string {
  if (w <= 0 || h <= 0) return 'N/A';
  return `${w}x${h}`;
}

async function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  const warnings: string[] = [];

  return new Promise<VideoMetadata>((resolve) => {
    const timeout = setTimeout(() => {
      // Timeout fallback -- do not block the flow
      if (file.size > MAX_FILE_SIZE_BYTES) warnings.push('Exceeds 150MB limit');
      resolve({
        file,
        thumbnailUrl: null,
        duration: 0,
        width: 0,
        height: 0,
        size: file.size,
        warnings,
      });
    }, 5000);

    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      if (video.duration > MAX_DURATION_SECONDS) warnings.push('Exceeds 15s Freepik limit');
      if (file.size > MAX_FILE_SIZE_BYTES) warnings.push('Exceeds 150MB limit');

      // Seek to 0.1s for thumbnail
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 72;
      const ctx = canvas.getContext('2d');
      let thumbnailUrl: string | null = null;
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
      }
      const result: VideoMetadata = {
        file,
        thumbnailUrl,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        size: file.size,
        warnings,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      if (file.size > MAX_FILE_SIZE_BYTES) warnings.push('Exceeds 150MB limit');
      URL.revokeObjectURL(objectUrl);
      resolve({
        file,
        thumbnailUrl: null,
        duration: 0,
        width: 0,
        height: 0,
        size: file.size,
        warnings,
      });
    };
  });
}

function validateFiles(files: File[]): { valid: File[]; invalid: string[] } {
  const valid: File[] = [];
  const invalid: string[] = [];

  for (const file of files) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (ACCEPTED_MIME_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext)) {
      valid.push(file);
    } else {
      invalid.push(file.name);
    }
  }

  return { valid, invalid };
}

// --- StatusBadge Sub-component ---

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; text: string; dot: string }> = {
    pending: {
      bg: 'bg-gray-100 dark:bg-gray-800',
      text: 'text-gray-700 dark:text-gray-300',
      dot: 'bg-gray-400',
    },
    processing: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      dot: 'bg-blue-500 animate-pulse',
    },
    completed: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      dot: 'bg-green-500',
    },
    failed: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      dot: 'bg-red-500',
    },
    paused: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-300',
      dot: 'bg-amber-500',
    },
    cancelled: {
      bg: 'bg-gray-100 dark:bg-gray-800',
      text: 'text-gray-600 dark:text-gray-400',
      dot: 'bg-gray-500',
    },
  };

  const colors = colorMap[status] || colorMap.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-2 h-2 rounded-full ${colors.dot}`}></span>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// --- BatchProgress Sub-component ---

function BatchProgress({ batch }: { batch: UpscaleBatchData }) {
  const total = batch.total_videos;
  const completed = batch.completed_videos;
  const failed = batch.failed_videos;
  const pending = total - completed - failed;
  const percentage = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-amber-500 to-orange-600 h-3 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="text-green-600 dark:text-green-400 font-medium">{completed} completed</span>
          {failed > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{failed} failed</span>}
          <span className="text-gray-500 dark:text-gray-400">{pending} pending</span>
        </div>
        <span className="text-gray-600 dark:text-gray-300 font-semibold">{percentage}%</span>
      </div>
    </div>
  );
}

// --- UpscaleBatchSummary for history ---

interface UpscaleBatchSummary {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  resolution: string;
  creativity: number;
  sharpen: number;
  grain: number;
  fps_boost: boolean;
  flavor: string;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  created_at: string;
}

function formatHistoryDate(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

// --- BatchHistoryCard Sub-component ---

function BatchHistoryCard({
  batch,
  onView,
  onRerun,
}: {
  batch: UpscaleBatchSummary;
  onView: (batchId: string) => void;
  onRerun: (batch: UpscaleBatchSummary) => void;
}) {
  const isProcessing = batch.status === 'processing';
  const total = batch.total_videos;
  const completed = batch.completed_videos;
  const failed = batch.failed_videos;
  const percentage = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-dark-surface-secondary border border-gray-100 dark:border-dark-border-primary space-y-3">
      {/* Top row: status + date */}
      <div className="flex items-center justify-between">
        <StatusBadge status={batch.status} />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatHistoryDate(batch.created_at)}
        </span>
      </div>

      {/* Video counts */}
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {total} video{total !== 1 ? 's' : ''}{' '}
        <span className="text-gray-500 dark:text-gray-400">
          ({completed} completed{failed > 0 ? `, ${failed} failed` : ''})
        </span>
      </p>

      {/* Settings summary */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {batch.resolution.toUpperCase()}, {batch.flavor}{batch.fps_boost ? ', FPS boost' : ''}
      </p>

      {/* Progress bar (if processing) */}
      {isProcessing && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-amber-500 to-orange-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onView(batch.id)}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          View
        </button>
        <button
          onClick={() => onRerun(batch)}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
        >
          Re-run with same settings
        </button>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function BatchVideoUpscale() {
  const { selectedProject } = useProject();

  // Upload + queue state
  const [queuedVideos, setQueuedVideos] = useState<VideoMetadata[]>([]);
  const [settings, setSettings] = useState<UpscaleSettings>({
    resolution: '2k',
    creativity: 0,
    sharpen: 0,
    grain: 0,
    fps_boost: false,
    flavor: 'natural',
  });
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<UpscaleBatchData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePreset, setActivePreset] = useState<'realistic' | 'animation' | 'artistic' | null>('realistic');
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string>('');

  // History state
  const [batchHistory, setBatchHistory] = useState<UpscaleBatchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>('');
  const [historyLimit, setHistoryLimit] = useState(20);
  const [rerunNotice, setRerunNotice] = useState<string>('');
  const uploadSectionRef = useRef<HTMLDivElement>(null);

  // Polling state
  const [pollVersion, setPollVersion] = useState(0);


  // ZIP download state
  const [, setZipJobId] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<string>('');
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Status polling ---
  useEffect(() => {
    if (!activeBatchId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await apiClient.getUpscaleBatchDetail(activeBatchId) as { success: boolean; batch?: UpscaleBatchData };
        if (cancelled) return;
        if (response.success && response.batch) {
          setBatch(response.batch);
          if (['completed', 'failed', 'paused', 'cancelled'].includes(response.batch.status)) {
            if (intervalId) clearInterval(intervalId);
            loadHistory();
          }
        }
      } catch {
        // Silently handle polling errors
      }
    };

    poll();
    intervalId = setInterval(poll, 4000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeBatchId, pollVersion]);

  // --- History loading ---

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await apiClient.listUpscaleBatches();
      // Backend returns a raw array of batches
      const batches = Array.isArray(response) ? response : [];
      setBatchHistory(batches as UpscaleBatchSummary[]);
    } catch {
      setHistoryError('Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // --- File handling ---

  const handleFiles = useCallback(async (files: File[]) => {
    setFileError('');
    const { valid, invalid } = validateFiles(files);

    if (invalid.length > 0) {
      setFileError(`Invalid format: ${invalid.join(', ')}. Accepted: MP4, MOV, AVI, WebM`);
    }

    if (valid.length === 0) return;

    const metadataPromises = valid.map((f) => extractVideoMetadata(f));
    const metadataResults = await Promise.all(metadataPromises);
    setQueuedVideos((prev) => [...prev, ...metadataResults]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    handleFiles(files);
    // Reset input so same files can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFiles]);

  const removeVideo = useCallback((index: number) => {
    setQueuedVideos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // --- Submit flow ---

  async function handleSubmit() {
    if (queuedVideos.length === 0) {
      setError('Please add at least one video to the queue.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    setUploadProgress({});

    try {
      // 1. Create batch
      const createResp = await apiClient.createUpscaleBatch(settings, selectedProject?.id) as { success: boolean; batch_id?: string; error?: string };
      if (!createResp.success || !createResp.batch_id) {
        throw new Error(createResp.error || 'Failed to create batch');
      }
      const batchId = createResp.batch_id;

      // 2. Upload each video sequentially
      for (let i = 0; i < queuedVideos.length; i++) {
        const vm = queuedVideos[i];
        const key = vm.file.name + '-' + i;

        try {
          setUploadProgress((prev) => ({ ...prev, [key]: 'Uploading...' }));

          const formData = new FormData();
          formData.append('file', vm.file);
          formData.append('batch_id', batchId);

          const uploadResp = await apiClient.uploadVideoForUpscale(formData);
          if (!uploadResp.success || !uploadResp.storage_url) {
            setUploadProgress((prev) => ({ ...prev, [key]: `Failed: ${uploadResp.error || 'Upload failed'}` }));
            continue;
          }

          await apiClient.addVideoToBatch(batchId, {
            input_filename: uploadResp.filename || vm.file.name,
            input_storage_url: uploadResp.storage_url,
            input_file_size: vm.size,
            duration_seconds: vm.duration > 0 ? vm.duration : undefined,
            width: vm.width > 0 ? vm.width : undefined,
            height: vm.height > 0 ? vm.height : undefined,
          });

          setUploadProgress((prev) => ({ ...prev, [key]: 'Added' }));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          setUploadProgress((prev) => ({ ...prev, [key]: `Failed: ${msg}` }));
        }
      }

      // 3. Start batch
      await apiClient.startUpscaleBatch(batchId);

      // 4. Switch to monitoring view
      setActiveBatchId(batchId);

      setQueuedVideos([]);
      setUploadProgress({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to start batch: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  // --- Batch actions ---

  async function handleResume() {
    if (!activeBatchId) return;
    try {
      await apiClient.resumeUpscaleBatch(activeBatchId);

      setPollVersion((v) => v + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resume';
      setError(msg);
    }
  }

  async function handleRetry(videoId: string) {
    if (!activeBatchId) return;
    try {
      await apiClient.retryUpscaleVideo(activeBatchId, videoId);
      setPollVersion((v) => v + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retry';
      setError(msg);
    }
  }

  async function handleDownloadZip() {
    if (!activeBatchId || isDownloadingZip) return;
    setIsDownloadingZip(true);
    setZipProgress('Creating ZIP...');

    try {
      const createResp = await apiClient.createUpscaleZipDownload(activeBatchId) as { success: boolean; job_id?: string; error?: string };
      if (!createResp.success || !createResp.job_id) {
        throw new Error(createResp.error || 'Failed to create ZIP job');
      }

      const jobId = createResp.job_id;
      setZipJobId(jobId);

      // Poll for ZIP completion
      const pollZip = async (): Promise<void> => {
        const statusResp = await apiClient.getUpscaleZipJobStatus(jobId) as { status: string; progress_pct: number; files_done: number; total_files: number; error?: string };

        if (statusResp.status === 'ready') {
          setZipProgress('Downloading...');
          const blob = await apiClient.downloadUpscaleZip(jobId);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `upscaled_batch_${activeBatchId.slice(0, 8)}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setZipProgress('');
          setZipJobId(null);
          setIsDownloadingZip(false);
        } else if (statusResp.status === 'error') {
          throw new Error(statusResp.error || 'ZIP build failed');
        } else {
          setZipProgress(`Building ZIP... ${statusResp.files_done}/${statusResp.total_files} files`);
          setTimeout(pollZip, 2000);
        }
      };

      await pollZip();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ZIP download failed';
      setZipProgress(`Error: ${msg}`);
      setIsDownloadingZip(false);
      setZipJobId(null);
    }
  }

  function handleNewBatch() {
    setActiveBatchId(null);
    setBatch(null);

    setError('');
    setZipProgress('');
    setZipJobId(null);
    setIsDownloadingZip(false);
    loadHistory();
  }

  // --- History actions ---

  function handleViewBatch(batchId: string) {
    setActiveBatchId(batchId);

    setPollVersion((v) => v + 1);
  }

  function handleRerun(historyBatch: UpscaleBatchSummary) {
    setSettings({
      resolution: historyBatch.resolution as UpscaleSettings['resolution'],
      creativity: historyBatch.creativity,
      sharpen: historyBatch.sharpen,
      grain: historyBatch.grain,
      fps_boost: historyBatch.fps_boost,
      flavor: historyBatch.flavor as UpscaleSettings['flavor'],
    });
    setActiveBatchId(null);
    setBatch(null);
    setRerunNotice('Settings loaded from previous batch. Upload new videos to start.');
    // Clear notice after 5 seconds
    setTimeout(() => setRerunNotice(''), 5000);
    // Scroll to upload section
    setTimeout(() => {
      uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  // --- Render ---

  const showMonitoring = activeBatchId && batch;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-amber-600 via-orange-600 to-yellow-600 bg-clip-text text-transparent">
            Batch Video Upscale
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Upload multiple videos and upscale them in batch using Freepik AI
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Re-run notice */}
        {rerunNotice && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm flex items-center justify-between">
            <span>{rerunNotice}</span>
            <button
              onClick={() => setRerunNotice('')}
              className="ml-3 text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* === UPLOAD & SETTINGS VIEW === */}
        {!showMonitoring && (
          <>
            {/* Upload Section */}
            <div ref={uploadSectionRef}>
            <Section title="Upload Videos">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 md:p-12 text-center transition-all duration-200 ${
                  isDragging
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-400'
                    : 'border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-dark-surface-secondary hover:border-amber-400 dark:hover:border-amber-500 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,.mp4,.mov,.avi,.webm"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div className="space-y-3">
                  <div className="text-4xl">
                    {isDragging ? '📥' : '🎬'}
                  </div>
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">
                    {isDragging ? 'Drop videos here' : 'Drag & drop videos or click to browse'}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Accepted formats: MP4, MOV, AVI, WebM
                  </p>
                </div>
              </div>

              {fileError && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{fileError}</p>
              )}
            </Section>
            </div>

            {/* Video Queue */}
            {queuedVideos.length > 0 && (
              <Section title={`Video Queue (${queuedVideos.length})`}>
                <div className="space-y-3">
                  {queuedVideos.map((vm, index) => (
                    <div
                      key={`${vm.file.name}-${index}`}
                      className="flex items-center gap-4 p-3 rounded-2xl bg-white dark:bg-dark-surface-secondary border border-gray-100 dark:border-dark-border-primary"
                    >
                      {/* Thumbnail */}
                      <div className="w-16 h-12 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0">
                        {vm.thumbnailUrl ? (
                          <img src={vm.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                            N/A
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {vm.file.name}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          <span>{formatDuration(vm.duration)}</span>
                          <span>{formatResolution(vm.width, vm.height)}</span>
                          <span>{formatBytes(vm.size)}</span>
                        </div>
                      </div>

                      {/* Warnings */}
                      {vm.warnings.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {vm.warnings.map((w, wi) => (
                            <span
                              key={wi}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Upload progress (during submission) */}
                      {uploadProgress[vm.file.name + '-' + index] && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {uploadProgress[vm.file.name + '-' + index]}
                        </span>
                      )}

                      {/* Remove button */}
                      {!isSubmitting && (
                        <button
                          onClick={() => removeVideo(index)}
                          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title="Remove"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Settings */}
            <Section title="Settings">
              {/* Resolution */}
              <Field>
                <Label>Resolution</Label>
                <div className="flex gap-3">
                  {(['1k', '2k', '4k'] as const).map((res) => (
                    <button
                      key={res}
                      onClick={() => setSettings((s) => ({ ...s, resolution: res }))}
                      className={`px-6 py-3 rounded-2xl font-semibold transition-all duration-200 ${
                        settings.resolution === res
                          ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg scale-[1.02]'
                          : 'border-2 border-gray-200 dark:border-dark-border-primary bg-white dark:bg-dark-surface-secondary text-gray-700 dark:text-dark-text-secondary hover:border-amber-400 dark:hover:border-amber-600'
                      }`}
                    >
                      {res.toUpperCase()}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Style Presets */}
              <Field>
                <Label>Style Preset</Label>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: 'realistic' as const, label: 'Realistic', desc: 'Faithful to source', icon: '🎬' },
                    { key: 'animation' as const, label: 'Animation & 3D', desc: 'Vivid colors & detail', icon: '🎨' },
                    { key: 'artistic' as const, label: 'Artistic', desc: 'Maximum creative freedom', icon: '✨' },
                  ]).map(({ key, label, desc, icon }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setActivePreset(key);
                        if (key === 'realistic') {
                          setSettings((s) => ({ ...s, creativity: 0, sharpen: 0, grain: 0, flavor: 'natural' }));
                        } else if (key === 'animation') {
                          setSettings((s) => ({ ...s, creativity: 0, sharpen: 0, grain: 0, flavor: 'vivid' }));
                        } else {
                          setSettings((s) => ({ ...s, creativity: 100, sharpen: 50, grain: 30, flavor: 'vivid' }));
                        }
                      }}
                      className={`flex flex-col items-center gap-1 px-3 py-4 rounded-2xl font-semibold transition-all duration-200 ${
                        activePreset === key
                          ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg scale-[1.02]'
                          : 'border-2 border-gray-200 dark:border-dark-border-primary bg-white dark:bg-dark-surface-secondary text-gray-700 dark:text-dark-text-secondary hover:border-amber-400 dark:hover:border-amber-600'
                      }`}
                    >
                      <span className="text-xl">{icon}</span>
                      <span className="text-sm">{label}</span>
                      <span className={`text-xs font-normal ${activePreset === key ? 'text-white/80' : 'text-gray-400 dark:text-dark-text-muted'}`}>{desc}</span>
                    </button>
                  ))}
                </div>
              </Field>

              {/* Advanced Settings Toggle */}
              <div>
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-dark-text-secondary hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  <span className={`transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}>&#9654;</span>
                  Advanced Settings
                </button>
              </div>

              {showAdvanced && (
                <>
                  {/* Creativity */}
                  <Field>
                    <Label>Creativity: {settings.creativity}</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.creativity}
                      onChange={(e) => { setActivePreset(null); setSettings((s) => ({ ...s, creativity: parseInt(e.target.value) })); }}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </Field>

                  {/* Sharpen */}
                  <Field>
                    <Label>Sharpen: {settings.sharpen}</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.sharpen}
                      onChange={(e) => { setActivePreset(null); setSettings((s) => ({ ...s, sharpen: parseInt(e.target.value) })); }}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </Field>

                  {/* Smart Grain */}
                  <Field>
                    <Label>Smart Grain: {settings.grain}</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.grain}
                      onChange={(e) => { setActivePreset(null); setSettings((s) => ({ ...s, grain: parseInt(e.target.value) })); }}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </Field>

                  {/* FPS Boost */}
                  <Field>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setActivePreset(null); setSettings((s) => ({ ...s, fps_boost: !s.fps_boost })); }}
                        className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                          settings.fps_boost
                            ? 'bg-amber-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            settings.fps_boost ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        ></span>
                      </button>
                      <Label className="text-sm font-semibold text-gray-800 dark:text-dark-text-primary mb-0">FPS Boost</Label>
                    </div>
                  </Field>

                  {/* Flavor */}
                  <Field>
                    <Label>Flavor</Label>
                    <div className="flex gap-3">
                      {(['vivid', 'natural'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => { setActivePreset(null); setSettings((s) => ({ ...s, flavor: f })); }}
                          className={`px-6 py-3 rounded-2xl font-semibold transition-all duration-200 ${
                            settings.flavor === f
                              ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg scale-[1.02]'
                              : 'border-2 border-gray-200 dark:border-dark-border-primary bg-white dark:bg-dark-surface-secondary text-gray-700 dark:text-dark-text-secondary hover:border-amber-400 dark:hover:border-amber-600'
                          }`}
                        >
                          {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </Section>

            {/* Start Processing */}
            <Section title="Start Processing">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || queuedVideos.length === 0}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-lg shadow-lg hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Uploading & Starting...
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    Start Batch ({queuedVideos.length} video{queuedVideos.length !== 1 ? 's' : ''})
                  </>
                )}
              </button>

              {/* Upload progress summary during submission */}
              {isSubmitting && Object.keys(uploadProgress).length > 0 && (
                <div className="mt-4 p-4 rounded-2xl bg-gray-50 dark:bg-dark-surface-secondary border border-gray-200 dark:border-dark-border-primary">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Upload Progress:</p>
                  <div className="space-y-1">
                    {Object.entries(uploadProgress).map(([key, status]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{key.replace(/-\d+$/, '')}</span>
                        <span className={status.startsWith('Failed') ? 'text-red-500' : status === 'Added' ? 'text-green-500' : 'text-amber-500'}>
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            {/* Batch History */}
            <Section title="Batch History">
              {historyLoading ? (
                <p className="text-gray-500 dark:text-gray-400">Loading history...</p>
              ) : historyError ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>
                  <button
                    onClick={loadHistory}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : batchHistory.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">No previous batches. Upload videos above to get started.</p>
              ) : (
                <div className="space-y-4">
                  {batchHistory.slice(0, historyLimit).map((hBatch) => (
                    <BatchHistoryCard
                      key={hBatch.id}
                      batch={hBatch}
                      onView={handleViewBatch}
                      onRerun={handleRerun}
                    />
                  ))}
                  {batchHistory.length > historyLimit && (
                    <button
                      onClick={() => setHistoryLimit((l) => l + 20)}
                      className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-amber-400 dark:hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                    >
                      Show more ({batchHistory.length - historyLimit} remaining)
                    </button>
                  )}
                </div>
              )}
            </Section>
          </>
        )}

        {/* === MONITORING VIEW === */}
        {showMonitoring && batch && (
          <>
            {/* Batch Status Header */}
            <Section title="Batch Status">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <StatusBadge status={batch.status} />
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Batch {batch.id.slice(0, 8)}
                  </span>
                </div>

                <BatchProgress batch={batch} />

                {/* Batch actions */}
                <div className="flex items-center gap-3 pt-2">
                  {batch.status === 'paused' && (
                    <button
                      onClick={handleResume}
                      className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold shadow hover:from-amber-600 hover:to-orange-700 transition-all"
                    >
                      Resume
                    </button>
                  )}

                  {(batch.status === 'completed' || (batch.status === 'failed' && batch.completed_videos > 0)) && (
                    <button
                      onClick={handleDownloadZip}
                      disabled={isDownloadingZip}
                      className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2"
                    >
                      {isDownloadingZip ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          {zipProgress || 'Preparing...'}
                        </>
                      ) : (
                        <>
                          <span>📦</span>
                          Download All (ZIP)
                        </>
                      )}
                    </button>
                  )}

                  <button
                    onClick={handleNewBatch}
                    className="px-5 py-2.5 rounded-2xl border-2 border-gray-300 dark:border-dark-border-primary bg-white dark:bg-dark-surface-secondary text-gray-700 dark:text-dark-text-secondary font-semibold hover:border-amber-400 dark:hover:border-amber-500 transition-all"
                  >
                    New Batch
                  </button>
                </div>

                {/* ZIP progress text */}
                {zipProgress && !isDownloadingZip && (
                  <p className="text-sm text-red-500">{zipProgress}</p>
                )}
              </div>
            </Section>

            {/* Video List */}
            <Section title={`Videos (${batch.videos.length})`}>
              <div className="space-y-3">
                {[...batch.videos]
                  .sort((a, b) => a.queue_position - b.queue_position)
                  .map((video) => (
                    <div
                      key={video.id}
                      className="flex items-center gap-4 p-3 rounded-2xl bg-white dark:bg-dark-surface-secondary border border-gray-100 dark:border-dark-border-primary"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {video.input_filename}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          <StatusBadge status={video.status} />
                          {video.started_at && (
                            <span>Started: {new Date(video.started_at).toLocaleTimeString()}</span>
                          )}
                          {video.completed_at && (
                            <span>Done: {new Date(video.completed_at).toLocaleTimeString()}</span>
                          )}
                        </div>
                        {video.status === 'failed' && video.error_message && (
                          <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">
                            {video.error_message}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {video.status === 'completed' && video.output_storage_url && (
                          <a
                            href={video.output_storage_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                          >
                            Download
                          </a>
                        )}
                        {video.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(video.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
