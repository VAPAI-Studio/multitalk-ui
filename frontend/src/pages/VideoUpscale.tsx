import { useEffect, useState } from "react";
import { startJobMonitoring, checkComfyUIHealth } from "../components/utils";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../contexts/AuthContext";
import { useProject } from "../contexts/ProjectContext";

// UI Components
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
        <div className="w-2 h-8 bg-gradient-to-b from-green-500 to-emerald-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

const RESOLUTION_PRESETS = [
  { label: '720p', value: 720, description: 'HD' },
  { label: '1080p', value: 1080, description: 'Full HD' },
  { label: '1440p', value: 1440, description: '2K' },
  { label: '2160p', value: 2160, description: '4K' },
];

interface Props {
  comfyUrl: string;
}

export default function VideoUpscale({ comfyUrl }: Props) {
  const { user } = useAuth();
  const { selectedProject } = useProject();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null);
  const [resolution, setResolution] = useState<number>(1080);
  const [customResolution, setCustomResolution] = useState<string>("1080");

  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  // Cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  // Video preview + detect original dimensions
  useEffect(() => {
    if (!videoFile) {
      setVideoPreview("");
      setOriginalSize(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoPreview(url);

    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      setOriginalSize({ width: vid.videoWidth, height: vid.videoHeight });
    };
    vid.src = url;

    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  function selectPreset(value: number) {
    setResolution(value);
    setCustomResolution(String(value));
  }

  function handleCustomResolutionChange(val: string) {
    setCustomResolution(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setResolution(num);
    }
  }

  async function submit() {
    setStatus("");
    setVideoUrl("");
    setJobId("");

    if (!comfyUrl) {
      setStatus("Please enter a ComfyUI URL.");
      return;
    }
    if (!videoFile) {
      setStatus("Please upload a video.");
      return;
    }
    if (resolution < 64 || resolution > 4320) {
      setStatus("Resolution must be between 64 and 4320.");
      return;
    }

    setIsSubmitting(true);
    let currentJobId = "";
    try {
      // Health check
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Upload video to ComfyUI
      setStatus("Uploading video to ComfyUI...");
      const uploadResult = await apiClient.uploadImageToComfyUI(comfyUrl, videoFile);

      if (!uploadResult.success || !uploadResult.filename) {
        throw new Error(uploadResult.error || 'Failed to upload video to ComfyUI');
      }

      const uploadedFilename = uploadResult.filename;
      console.log('Uploaded video filename:', uploadedFilename);

      // Submit workflow via backend
      setStatus("Sending workflow to ComfyUI...");
      const clientId = `upscale-vid-${Math.random().toString(36).slice(2)}`;
      const response = await apiClient.submitWorkflow(
        'SeedVR2VideoUpscale',
        {
          VIDEO_FILENAME: uploadedFilename,
          RESOLUTION: resolution
        },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit workflow to ComfyUI');
      }

      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);
      currentJobId = id;

      // Create job record
      await apiClient.createVideoJob({
        user_id: user?.id || null,
        comfy_job_id: id,
        workflow_name: 'upscale-vid',
        comfy_url: comfyUrl,
        input_video_urls: [videoFile.name],
        project_id: selectedProject?.id || null,
        parameters: {
          resolution
        }
      });

      // Update job to processing status
      await apiClient.updateVideoJobToProcessing(id);

      // Start monitoring
      setStatus("Processing in ComfyUI...");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI...');
          } else if (jobStatus === 'completed' && videoInfo) {
            const resultUrl = videoInfo.subfolder
              ? `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=temp`
              : `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&type=temp`;

            setVideoUrl(resultUrl);
            setStatus("Video upscaled successfully!");
            setIsSubmitting(false);

            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [resultUrl]
            });
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);

            try {
              await apiClient.completeVideoJob(id, {
                job_id: id,
                status: 'failed',
                error_message: message || 'Unknown error'
              });
            } catch (dbError) {
              console.error('Failed to update job error:', dbError);
            }
          }
        }
      );

      setJobMonitorCleanup(() => cleanup);

    } catch (error: any) {
      if (currentJobId) {
        await apiClient.completeVideoJob(currentJobId, {
          job_id: currentJobId,
          status: 'failed',
          error_message: error.message || 'Unknown error'
        }).catch(() => {});
      }
      setStatus(`Error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleDownload = () => {
    if (videoUrl) {
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = `upscale-vid-${Date.now()}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Video Upscale
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Upscale your videos to higher resolutions with AI-powered super-resolution
            </p>
          </div>

          {/* Video Upload */}
          <Section title="Upload Video">
            <Field>
              <Label>Select Video</Label>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="w-full p-3 border-2 border-dashed border-green-300 dark:border-green-700 rounded-2xl bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors cursor-pointer dark:text-dark-text-secondary"
              />
            </Field>
            {videoPreview && (
              <div className="mt-4 p-4 border-2 border-green-200 dark:border-green-800 rounded-2xl bg-white dark:bg-dark-surface-secondary">
                <video
                  src={videoPreview}
                  controls
                  className="max-w-full max-h-64 mx-auto rounded-xl shadow-lg"
                />
                {originalSize && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                    Original: {originalSize.width} x {originalSize.height}px
                  </p>
                )}
              </div>
            )}
          </Section>

          {/* Resolution Settings */}
          <Section title="Upscale Settings">
            <Field>
              <Label>Target Resolution (shortest side)</Label>
              <div className="flex flex-wrap gap-3 mb-4">
                {RESOLUTION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => selectPreset(preset.value)}
                    className={`px-5 py-3 rounded-2xl font-semibold transition-all duration-200 ${
                      resolution === preset.value
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg scale-[1.02]'
                        : 'border-2 border-gray-200 dark:border-dark-border-primary bg-white dark:bg-dark-surface-secondary text-gray-700 dark:text-dark-text-secondary hover:border-green-400 dark:hover:border-green-600'
                    }`}
                  >
                    <span className="block text-sm">{preset.label}</span>
                    <span className="block text-xs opacity-75">{preset.description}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-sm font-semibold text-gray-800 dark:text-dark-text-primary mb-0 whitespace-nowrap">Custom:</Label>
                <input
                  type="number"
                  value={customResolution}
                  onChange={(e) => handleCustomResolutionChange(e.target.value)}
                  min="64"
                  max="4320"
                  className="w-32 px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-green-500 focus:outline-none transition-colors"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">px</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                The shortest side of the output video will be upscaled to {resolution}px. The other side scales proportionally.
              </p>
            </Field>
          </Section>

          {/* Generate */}
          <Section title="Upscale Video">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-lg shadow-lg hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    Upscale Video
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {videoUrl && (
              <div className="mt-6 space-y-3">
                <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <div>
                  <button className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" onClick={handleDownload}>
                    <span>⬇️</span>
                    Download MP4
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Resizable Feed */}
        <ResizableFeedSidebar
          storageKey="upscale-vid"
          config={{
            mediaType: 'all',
            pageContext: 'upscale-vid',
            showCompletedOnly: false,
            maxItems: 10,
            showFixButton: true,
            showProgress: true,
            comfyUrl: comfyUrl
          }}
        />
      </div>
    </div>
  );
}
