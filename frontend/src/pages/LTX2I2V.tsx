import { useEffect, useRef, useState } from "react";
import { startJobMonitoring, checkComfyUIHealth } from "../components/utils";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { useSmartResolution } from "../hooks/useSmartResolution";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../contexts/AuthContext";
import { useProject } from "../contexts/ProjectContext";

// UI Components
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-cyan-500 to-blue-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
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

interface Props {
  comfyUrl: string;
}

// Duration presets in seconds and their frame equivalents (24fps)
const DURATION_PRESETS = [
  { label: '3s', seconds: 3, frames: 72 },
  { label: '5s', seconds: 5, frames: 120 },
  { label: '10s', seconds: 10, frames: 240 },
];

export default function LTX2I2V({ comfyUrl }: Props) {
  // Auth context
  const { user } = useAuth();
  const { selectedProject } = useProject();

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageAR, setImageAR] = useState<number | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [duration, setDuration] = useState<number>(5); // Default 5 seconds
  const [strength, setStrength] = useState<number>(0.6); // Default strength

  // Smart resolution handling
  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
    setWidth,
    setHeight
  } = useSmartResolution(1280, 720);

  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  // Handle image upload and aspect ratio
  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setImageAR(ar);
      // Initialize to nearest multiples of 32, max width 1280
      const targetW = Math.max(32, Math.round(Math.min(1280, img.width) / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
      setWidth(targetW);
      setHeight(targetH);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile, setWidth, setHeight]);

  // Maintain aspect ratio when width changes
  useEffect(() => {
    if (imageAR) {
      const h = Math.max(32, Math.round((width / imageAR) / 32) * 32);
      if (h !== height) setHeight(h);
    }
  }, [width, imageAR, height, setHeight]);

  async function buildPromptJSON(imageFilename: string, prompt: string) {
    try {
      const safeWidth = width || 1280;
      const safeHeight = height || 720;
      const frameCount = duration * 24; // Convert seconds to frames

      const response = await fetch('/workflows/LTX2_Simple.json');
      if (!response.ok) {
        throw new Error(`Failed to load workflow template: ${response.status}`);
      }
      const template = await response.json();

      // Create a deep copy and modify values
      const modifiedTemplate = JSON.parse(JSON.stringify(template));

      // Replace placeholders by modifying the template object directly
      // Node 32 - Width
      if (modifiedTemplate["32"]?.inputs) {
        modifiedTemplate["32"].inputs.value = safeWidth;
      }

      // Node 34 - Height
      if (modifiedTemplate["34"]?.inputs) {
        modifiedTemplate["34"].inputs.value = safeHeight;
      }

      // Node 26 - Prompt
      if (modifiedTemplate["26"]?.inputs) {
        modifiedTemplate["26"].inputs.text = prompt;
      }

      // Node 609 - Image Strength
      if (modifiedTemplate["609"]?.inputs) {
        modifiedTemplate["609"].inputs.value = strength;
      }

      // Node 12 - Video Length (frames)
      if (modifiedTemplate["12"]?.inputs) {
        modifiedTemplate["12"].inputs.value = frameCount;
      }

      // Node 849 - Image Filename
      if (modifiedTemplate["849"]?.inputs) {
        modifiedTemplate["849"].inputs.image = imageFilename;
      }

      return modifiedTemplate;
    } catch (error: any) {
      throw new Error(`Failed to build prompt JSON: ${error.message}`);
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
    if (!imageFile) {
      setStatus("Please upload an image.");
      return;
    }
    if (!customPrompt.trim()) {
      setStatus("Please enter a prompt.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Check ComfyUI health
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Resize image to target dimensions
      setStatus(`Resizing image to ${width}x${height}...`);
      const fileToUpload = await resizeImageToTarget(imageFile, width, height);

      // Upload to ComfyUI
      setStatus("Uploading image to ComfyUI...");
      const uploadResult = await apiClient.uploadImageToComfyUI(comfyUrl, fileToUpload);

      if (!uploadResult.success || !uploadResult.filename) {
        throw new Error(uploadResult.error || 'Failed to upload image to ComfyUI');
      }

      const uploadedFilename = uploadResult.filename;
      console.log('Uploaded image filename:', uploadedFilename);

      // Build and submit workflow
      setStatus("Sending prompt to ComfyUI...");
      const clientId = `ltx2-i2v-ui-${Math.random().toString(36).slice(2)}`;
      const promptJson = await buildPromptJSON(uploadedFilename, customPrompt);

      const response = await apiClient.submitPromptToComfyUI(
        comfyUrl,
        promptJson,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit prompt to ComfyUI');
      }

      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      // Create job record
      await apiClient.createVideoJob({
        user_id: user?.id || null,
        comfy_job_id: id,
        workflow_name: 'ltx2-i2v',
        comfy_url: comfyUrl,
        input_image_urls: [imageFile.name],
        width,
        height,
        fps: 24,
        duration_seconds: duration,
        project_id: selectedProject?.id || null,
        parameters: {
          prompt: customPrompt,
          strength: strength
        }
      });

      // Update job to processing
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
            const videoUrl = videoInfo.subfolder
              ? `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=temp`
              : `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&type=temp`;

            setVideoUrl(videoUrl);
            setStatus("Video generated successfully!");
            setIsSubmitting(false);

            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [videoUrl]
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
      if (jobId) {
        await apiClient.completeVideoJob(jobId, {
          job_id: jobId,
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
      link.download = `ltx2-i2v-${Date.now()}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              LTX2 I2V
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Transform your images into high-quality videos with the LTX2 model
            </p>
          </div>

          {/* Image Upload */}
          <Section title="Upload Image">
            <Field>
              <Label>Select Image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="w-full p-3 border-2 border-dashed border-cyan-300 rounded-2xl bg-cyan-50 hover:bg-cyan-100 transition-colors cursor-pointer"
              />
            </Field>
            {imagePreview && (
              <div className="mt-4 p-4 border-2 border-cyan-200 rounded-2xl bg-white">
                <img
                  ref={imgRef}
                  src={imagePreview}
                  alt="Preview"
                  className="max-w-full max-h-64 mx-auto rounded-xl shadow-lg"
                />
                {imageAR && (
                  <p className="text-sm text-gray-500 mt-2 text-center">
                    Aspect ratio: {imageAR.toFixed(2)}
                  </p>
                )}
              </div>
            )}
          </Section>

          {/* Prompt */}
          <Section title="Prompt">
            <Field>
              <Label>Describe the video transformation</Label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., A cinematic scene with smooth camera movement, the subject comes to life with natural motion..."
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-cyan-500 focus:outline-none transition-colors min-h-[100px] resize-vertical"
              />
            </Field>
          </Section>

          {/* Video Settings */}
          <Section title="Video Settings">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>Width</Label>
                <input
                  type="number"
                  value={widthInput}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-cyan-500 focus:outline-none transition-colors"
                  step="32"
                  min="64"
                  max="1920"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {width}px (multiple of 32)</p>
              </Field>
              <Field>
                <Label>Height</Label>
                <input
                  type="number"
                  value={heightInput}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-cyan-500 focus:outline-none transition-colors"
                  step="32"
                  min="64"
                  max="1080"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {height}px (multiple of 32)</p>
              </Field>
            </div>

            {/* Duration Presets */}
            <Field>
              <Label>Duration</Label>
              <div className="flex gap-3">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.seconds}
                    onClick={() => setDuration(preset.seconds)}
                    className={`flex-1 py-3 px-4 rounded-2xl font-semibold transition-all duration-200 ${
                      duration === preset.seconds
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {preset.label}
                    <span className="block text-xs opacity-75">{preset.frames} frames</span>
                  </button>
                ))}
              </div>
            </Field>

            {/* Strength Slider */}
            <Field>
              <Label>Image Strength: {strength.toFixed(1)}</Label>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-500">0.4</span>
                <input
                  type="range"
                  min="0.4"
                  max="1"
                  step="0.1"
                  value={strength}
                  onChange={(e) => setStrength(parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
                <span className="text-sm text-gray-500">1.0</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Lower values allow more creative freedom, higher values stay closer to the original image
              </p>
            </Field>
          </Section>

          {/* Generate */}
          <Section title="Generate Video">
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
                <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <div>
                  <button
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                    onClick={handleDownload}
                  >
                    <span>Download MP4</span>
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Feed */}
        <ResizableFeedSidebar
          storageKey="ltx2-i2v"
          config={{
            mediaType: 'all',
            pageContext: 'ltx2-i2v',
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
