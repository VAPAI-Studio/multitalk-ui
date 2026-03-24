import { useEffect, useRef, useState } from "react";
import { startJobMonitoring, checkComfyUIHealth } from "../components/utils";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { useSmartResolution } from "../hooks/useSmartResolution";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../contexts/AuthContext";
import { useProject } from "../contexts/ProjectContext";

// UI Components
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 dark:border-gray-700/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-dark-surface dark:to-dark-surface-primary backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-cyan-500 to-blue-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-3 group"
    >
      <div
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
          enabled ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
        {label}
      </span>
    </button>
  );
}

// Helper function to resize image
async function resizeImageToTarget(file: File, targetWidth: number, targetHeight: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to resize image'));
            return;
          }

          const resizedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          console.log(`Resized image: ${img.width}x${img.height} -> ${targetWidth}x${targetHeight}`);
          resolve(resizedFile);
        },
        'image/jpeg',
        0.85
      );
    };

    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = URL.createObjectURL(file);
  });
}

// Workflow routing
type WorkflowKey =
  | 'LTX23/LTX23_T2V_Basic'
  | 'LTX23/LTX23_I2V_Basic'
  | 'LTX23/LTX23_I2V_Audio'
  | 'LTX23/LTX23_FL2V_Injection'
  | 'LTX23/LTX23_FL2V_Audio'
  | 'LTX23/LTX23_FML2V_Injection'
  | 'LTX23/LTX23_FML2V_Guider'
  | 'LTX23/LTX23_FML2V_Guider_Audio';

const WORKFLOW_LABELS: Record<WorkflowKey, string> = {
  'LTX23/LTX23_T2V_Basic': 'Text to Video',
  'LTX23/LTX23_I2V_Basic': 'Image to Video',
  'LTX23/LTX23_I2V_Audio': 'Image to Video + Audio',
  'LTX23/LTX23_FL2V_Injection': 'First + Last Frame',
  'LTX23/LTX23_FL2V_Audio': 'First + Last Frame + Audio',
  'LTX23/LTX23_FML2V_Injection': 'F+M+L Frame (Strict)',
  'LTX23/LTX23_FML2V_Guider': 'F+M+L Frame (Smooth)',
  'LTX23/LTX23_FML2V_Guider_Audio': 'F+M+L Frame + Audio',
};

interface Props {
  comfyUrl: string;
}

export default function LTX23VideoGen({ comfyUrl }: Props) {
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Frame inputs
  const [firstFrameFile, setFirstFrameFile] = useState<File | null>(null);
  const [firstFramePreview, setFirstFramePreview] = useState<string>('');
  const [lastFrameEnabled, setLastFrameEnabled] = useState(false);
  const [lastFrameFile, setLastFrameFile] = useState<File | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string>('');
  const [middleFrameEnabled, setMiddleFrameEnabled] = useState(false);
  const [middleFrameFile, setMiddleFrameFile] = useState<File | null>(null);
  const [middleFramePreview, setMiddleFramePreview] = useState<string>('');

  // Audio
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  // Prompt & settings
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [duration, setDuration] = useState<number>(10);
  const [seed, setSeed] = useState<number>(42);
  const [seedInput, setSeedInput] = useState<string>('42');

  const randomizeSeed = () => {
    const newSeed = Math.floor(Math.random() * 2147483647);
    setSeed(newSeed);
    setSeedInput(String(newSeed));
  };

  const handleSeedChange = (value: string) => {
    setSeedInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed) && parsed >= 0) {
      setSeed(parsed);
    }
  };

  // Smart resolution
  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
    setWidth,
    setHeight
  } = useSmartResolution(960, 544);

  // Aspect ratio lock
  const [aspectRatioLocked, setAspectRatioLocked] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<number>(960 / 544);

  const handleWidthWithAR = (value: string) => {
    handleWidthChange(value);
    if (aspectRatioLocked && aspectRatio > 0) {
      const w = parseInt(value) || 32;
      const h = Math.max(32, Math.round((w / aspectRatio) / 32) * 32);
      setHeight(h);
    }
  };

  const handleHeightWithAR = (value: string) => {
    handleHeightChange(value);
    if (aspectRatioLocked && aspectRatio > 0) {
      const h = parseInt(value) || 32;
      const w = Math.max(32, Math.round((h * aspectRatio) / 32) * 32);
      setWidth(w);
    }
  };

  // FML2V style toggle: true = guider (smooth), false = injection (strict)
  const [useFrameGuider, setUseFrameGuider] = useState(true);

  // Job state
  const [status, setStatus] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [jobId, setJobId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  const firstFrameRef = useRef<HTMLImageElement | null>(null);

  // Cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  // Handle first frame upload and aspect ratio
  useEffect(() => {
    if (!firstFrameFile) {
      setFirstFramePreview('');
      return;
    }
    const url = URL.createObjectURL(firstFrameFile);
    setFirstFramePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      const targetW = Math.max(32, Math.round(Math.min(1280, img.width) / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
      setWidth(targetW);
      setHeight(targetH);
      setAspectRatio(ar);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [firstFrameFile, setWidth, setHeight]);

  // Handle last frame preview
  useEffect(() => {
    if (!lastFrameFile) {
      setLastFramePreview('');
      return;
    }
    const url = URL.createObjectURL(lastFrameFile);
    setLastFramePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [lastFrameFile]);

  // Handle middle frame preview
  useEffect(() => {
    if (!middleFrameFile) {
      setMiddleFramePreview('');
      return;
    }
    const url = URL.createObjectURL(middleFrameFile);
    setMiddleFramePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [middleFrameFile]);

  // Clear dependent state when toggles are disabled
  useEffect(() => {
    if (!lastFrameEnabled) {
      setLastFrameFile(null);
      setMiddleFrameEnabled(false);
      setMiddleFrameFile(null);
    }
  }, [lastFrameEnabled]);

  useEffect(() => {
    if (!middleFrameEnabled) {
      setMiddleFrameFile(null);
    }
  }, [middleFrameEnabled]);

  useEffect(() => {
    if (!audioEnabled) {
      setAudioFile(null);
    }
  }, [audioEnabled]);

  // Derive current mode and selected workflow
  const hasFirstFrame = !!firstFrameFile;
  const hasLastFrame = lastFrameEnabled && !!lastFrameFile;
  const hasMiddleFrame = middleFrameEnabled && !!middleFrameFile;
  const hasAudio = audioEnabled && !!audioFile;

  function getSelectedWorkflow(): WorkflowKey {
    // FML2V: first + middle + last
    if (hasFirstFrame && hasLastFrame && hasMiddleFrame) {
      if (hasAudio) return 'LTX23/LTX23_FML2V_Guider_Audio';
      return useFrameGuider ? 'LTX23/LTX23_FML2V_Guider' : 'LTX23/LTX23_FML2V_Injection';
    }

    // FL2V: first + last
    if (hasFirstFrame && hasLastFrame) {
      if (hasAudio) return 'LTX23/LTX23_FL2V_Audio';
      return 'LTX23/LTX23_FL2V_Injection';
    }

    // I2V: first frame only
    if (hasFirstFrame) {
      if (hasAudio) return 'LTX23/LTX23_I2V_Audio';
      return 'LTX23/LTX23_I2V_Basic';
    }

    // T2V: text only
    return 'LTX23/LTX23_T2V_Basic';
  }

  const selectedWorkflow = getSelectedWorkflow();
  const selectedWorkflowLabel = WORKFLOW_LABELS[selectedWorkflow];

  // Is FML2V mode without audio? Show strict/smooth toggle
  const showStyleToggle = hasFirstFrame && hasLastFrame && hasMiddleFrame && !hasAudio;

  async function submit() {
    setStatus('');
    setVideoUrl('');
    setJobId('');

    if (!comfyUrl) {
      setStatus('Please enter a ComfyUI URL.');
      return;
    }
    if (!customPrompt.trim() && !hasFirstFrame) {
      setStatus('Please enter a prompt or upload a first frame.');
      return;
    }
    if (audioEnabled && !audioFile) {
      setStatus('Audio is enabled but no audio file uploaded.');
      return;
    }

    setIsSubmitting(true);
    let currentJobId = '';

    try {
      // Health check
      setStatus('Checking ComfyUI...');
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Build parameters
      const parameters: Record<string, any> = {
        PROMPT: customPrompt || '',
        WIDTH: width,
        HEIGHT: height,
        LENGTH: duration,
        FPS: 24,
        SEED: seed,
      };

      // Upload first frame
      if (hasFirstFrame) {
        setStatus(`Resizing first frame to ${width}x${height}...`);
        const resized = await resizeImageToTarget(firstFrameFile!, width, height);
        setStatus('Uploading first frame...');
        const upload = await apiClient.uploadImageToComfyUI(comfyUrl, resized);
        if (!upload.success || !upload.filename) {
          throw new Error(upload.error || 'Failed to upload first frame');
        }
        parameters.FIRST_FRAME_FILENAME = upload.filename;
      }

      // Upload last frame
      if (hasLastFrame) {
        setStatus(`Resizing last frame to ${width}x${height}...`);
        const resized = await resizeImageToTarget(lastFrameFile!, width, height);
        setStatus('Uploading last frame...');
        const upload = await apiClient.uploadImageToComfyUI(comfyUrl, resized);
        if (!upload.success || !upload.filename) {
          throw new Error(upload.error || 'Failed to upload last frame');
        }
        parameters.LAST_FRAME_FILENAME = upload.filename;
      }

      // Upload middle frame
      if (hasMiddleFrame) {
        setStatus(`Resizing middle frame to ${width}x${height}...`);
        const resized = await resizeImageToTarget(middleFrameFile!, width, height);
        setStatus('Uploading middle frame...');
        const upload = await apiClient.uploadImageToComfyUI(comfyUrl, resized);
        if (!upload.success || !upload.filename) {
          throw new Error(upload.error || 'Failed to upload middle frame');
        }
        parameters.MIDDLE_FRAME_FILENAME = upload.filename;
      }

      // Upload audio
      if (hasAudio) {
        setStatus('Uploading audio...');
        const upload = await apiClient.uploadAudioToComfyUI(comfyUrl, audioFile!);
        if (!upload.success || !upload.filename) {
          throw new Error(upload.error || 'Failed to upload audio');
        }
        parameters.AUDIO_FILENAME = upload.filename;
      }

      // Submit workflow
      setStatus('Submitting workflow...');
      const clientId = `ltx23-${Math.random().toString(36).slice(2)}`;
      const response = await apiClient.submitWorkflow(
        selectedWorkflow,
        parameters,
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit workflow');
      }

      const promptId = response.prompt_id;
      if (!promptId) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(promptId);
      currentJobId = promptId;

      // Create job record
      const inputImageUrls: string[] = [];
      if (firstFrameFile) inputImageUrls.push(firstFrameFile.name);
      if (lastFrameFile) inputImageUrls.push(lastFrameFile.name);
      if (middleFrameFile) inputImageUrls.push(middleFrameFile.name);

      await apiClient.createVideoJob({
        user_id: user?.id || null,
        comfy_job_id: promptId,
        workflow_name: 'ltx23',
        comfy_url: comfyUrl,
        input_image_urls: inputImageUrls,
        input_audio_urls: audioFile ? [audioFile.name] : [],
        width,
        height,
        fps: 24,
        duration_seconds: duration,
        project_id: selectedProject?.id || null,
        parameters: {
          prompt: customPrompt,
          workflow: selectedWorkflow,
          workflow_label: selectedWorkflowLabel,
          has_audio: hasAudio,
          has_last_frame: hasLastFrame,
          has_middle_frame: hasMiddleFrame,
          seed,
        }
      });

      await apiClient.updateVideoJobToProcessing(promptId);

      // Monitor job
      setStatus('Processing in ComfyUI...');
      const cleanup = startJobMonitoring(
        promptId,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI...');
          } else if (jobStatus === 'completed' && videoInfo) {
            const url = videoInfo.subfolder
              ? `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=temp`
              : `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&type=temp`;

            setVideoUrl(url);
            setStatus('Video generated successfully!');
            setIsSubmitting(false);

            await apiClient.completeVideoJob(promptId, {
              job_id: promptId,
              status: 'completed',
              output_video_urls: [url]
            });
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);

            try {
              await apiClient.completeVideoJob(promptId, {
                job_id: promptId,
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
      link.download = `ltx23-${Date.now()}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              LTX 2.3 Video
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Generate videos from text, images, and frame keypoints with optional audio
            </p>
            {/* Workflow badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-gray-800/80 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Mode: {selectedWorkflowLabel}
              </span>
            </div>
          </div>

          {/* Frame Inputs */}
          <Section title="Frame Inputs">
            {/* First Frame */}
            <Field>
              <Label>First Frame (optional — leave empty for text-to-video)</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFirstFrameFile(e.target.files?.[0] || null)}
                className="w-full p-3 border-2 border-dashed border-cyan-300 dark:border-cyan-700 rounded-2xl bg-cyan-50 dark:bg-cyan-950/30 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors cursor-pointer"
              />
              {firstFramePreview && (
                <div className="mt-3 p-3 border border-cyan-200 dark:border-cyan-800 rounded-2xl bg-white dark:bg-gray-900">
                  <img
                    ref={firstFrameRef}
                    src={firstFramePreview}
                    alt="First frame"
                    className="max-w-full max-h-48 mx-auto rounded-xl shadow-md"
                  />
                </div>
              )}
            </Field>

            {/* Last Frame Toggle + Upload */}
            <div className="mt-4 space-y-3">
              <Toggle
                enabled={lastFrameEnabled}
                onChange={setLastFrameEnabled}
                label="Last Frame"
              />
              {lastFrameEnabled && (
                <div className="ml-14">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setLastFrameFile(e.target.files?.[0] || null)}
                    className="w-full p-3 border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-2xl bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors cursor-pointer"
                  />
                  {lastFramePreview && (
                    <div className="mt-3 p-3 border border-blue-200 dark:border-blue-800 rounded-2xl bg-white dark:bg-gray-900">
                      <img
                        src={lastFramePreview}
                        alt="Last frame"
                        className="max-w-full max-h-48 mx-auto rounded-xl shadow-md"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Middle Frame Toggle + Upload — only when last frame is enabled and has a file */}
            {lastFrameEnabled && lastFrameFile && (
              <div className="mt-4 space-y-3">
                <Toggle
                  enabled={middleFrameEnabled}
                  onChange={setMiddleFrameEnabled}
                  label="Middle Frame"
                />
                {middleFrameEnabled && (
                  <div className="ml-14">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setMiddleFrameFile(e.target.files?.[0] || null)}
                      className="w-full p-3 border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer"
                    />
                    {middleFramePreview && (
                      <div className="mt-3 p-3 border border-indigo-200 dark:border-indigo-800 rounded-2xl bg-white dark:bg-gray-900">
                        <img
                          src={middleFramePreview}
                          alt="Middle frame"
                          className="max-w-full max-h-48 mx-auto rounded-xl shadow-md"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Audio */}
          <Section title="Audio">
            <Toggle
              enabled={audioEnabled}
              onChange={setAudioEnabled}
              label="Custom Audio"
            />
            {audioEnabled && (
              <div className="mt-4 ml-14">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  className="w-full p-3 border-2 border-dashed border-green-300 dark:border-green-700 rounded-2xl bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors cursor-pointer"
                />
                {audioFile && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Selected: {audioFile.name}
                  </p>
                )}
              </div>
            )}
          </Section>

          {/* Prompt */}
          <Section title="Prompt">
            <Field>
              <Label>Describe the video</Label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., A cinematic scene with smooth camera movement, the subject comes to life with natural motion..."
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary focus:border-cyan-500 focus:outline-none transition-colors min-h-[100px] resize-vertical text-gray-900 dark:text-white placeholder-gray-400"
              />
            </Field>
          </Section>

          {/* Video Settings */}
          <Section title="Video Settings">
            <div className="flex items-end gap-3">
              <Field>
                <Label>Width</Label>
                <input
                  type="number"
                  value={widthInput}
                  onChange={(e) => handleWidthWithAR(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary focus:border-cyan-500 focus:outline-none transition-colors text-gray-900 dark:text-white"
                  step="32"
                  min="64"
                  max="1920"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {width}px</p>
              </Field>
              <button
                type="button"
                onClick={() => {
                  const next = !aspectRatioLocked;
                  setAspectRatioLocked(next);
                  if (next && width > 0 && height > 0) {
                    setAspectRatio(width / height);
                  }
                }}
                className={`mb-6 p-2.5 rounded-xl transition-all duration-200 ${
                  aspectRatioLocked
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
                title={aspectRatioLocked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {aspectRatioLocked ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  )}
                </svg>
              </button>
              <Field>
                <Label>Height</Label>
                <input
                  type="number"
                  value={heightInput}
                  onChange={(e) => handleHeightWithAR(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary focus:border-cyan-500 focus:outline-none transition-colors text-gray-900 dark:text-white"
                  step="32"
                  min="64"
                  max="1080"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {height}px</p>
              </Field>
            </div>

            <Field>
              <Label>Duration (seconds)</Label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary focus:border-cyan-500 focus:outline-none transition-colors text-gray-900 dark:text-white"
                min="1"
                max="60"
              />
            </Field>

            <Field>
              <Label>Seed</Label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={seedInput}
                  onChange={(e) => handleSeedChange(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary focus:border-cyan-500 focus:outline-none transition-colors text-gray-900 dark:text-white"
                  min="0"
                  max="2147483647"
                />
                <button
                  type="button"
                  onClick={randomizeSeed}
                  className="px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-surface-primary hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
                  title="Randomize seed"
                >
                  🎲
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Use the same seed with identical settings to reproduce a generation</p>
            </Field>

            {/* Strict / Smooth toggle for FML2V without audio */}
            {showStyleToggle && (
              <Field>
                <Label>Frame Interpolation Style</Label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setUseFrameGuider(false)}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-200 ${
                      !useFrameGuider
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    Strict
                    <span className="block text-xs opacity-75">Frame Injection</span>
                  </button>
                  <button
                    onClick={() => setUseFrameGuider(true)}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-200 ${
                      useFrameGuider
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    Smooth
                    <span className="block text-xs opacity-75">Frame Guider</span>
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Strict forces exact frames at keypoints. Smooth guides the generation for more natural transitions.
                </p>
              </Field>
            )}
          </Section>

          {/* Generate */}
          <Section title="Generate Video">
            <div className="space-y-4">
              {/* Workflow indicator */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-cyan-50 dark:bg-cyan-950/30 rounded-2xl border border-cyan-200 dark:border-cyan-800">
                <span className="text-sm font-medium text-cyan-700 dark:text-cyan-300">
                  Workflow: {selectedWorkflowLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold text-lg shadow-lg hover:from-cyan-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
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
                      <span>🎥</span>
                      Generate Video
                    </>
                  )}
                </button>
                {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
                {status && <span className="text-sm">{status}</span>}
              </div>

              {videoUrl && (
                <div className="mt-6 space-y-3">
                  <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50" />
                  <div>
                    <button
                      className="px-6 py-3 rounded-2xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                      onClick={handleDownload}
                    >
                      <span>Download MP4</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right Sidebar - Feed */}
        <ResizableFeedSidebar
          storageKey="ltx23"
          config={{
            mediaType: 'all',
            pageContext: 'ltx23',
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
