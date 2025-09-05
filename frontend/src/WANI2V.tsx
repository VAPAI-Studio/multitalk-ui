import { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
import { startJobMonitoring, checkComfyUIHealth } from "./components/utils";
import UnifiedFeed from "./components/UnifiedFeed";
import { useSmartResolution } from "./hooks/useSmartResolution";
import { apiClient } from "./lib/apiClient";

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
        <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

// Helper functions
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data:image/...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Props {
  comfyUrl: string;
}

export default function WANI2V({ comfyUrl }: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageAR, setImageAR] = useState<number | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('a beautiful scene transforming through time');

  // Smart resolution handling with auto-correction to multiples of 32
  const { 
    width, 
    height, 
    widthInput, 
    heightInput, 
    handleWidthChange, 
    handleHeightChange, 
    setWidth, 
    setHeight 
  } = useSmartResolution(640, 360) // defaults for video

  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setImageAR(ar);
      // Initialize W/H to the nearest multiples of 32 preserving aspect, max width ~ 640
      const targetW = Math.max(32, Math.round(Math.min(640, img.width) / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
      setWidth(targetW);
      setHeight(targetH);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile, setWidth, setHeight]);

  // maintain image aspect ratio
  useEffect(() => {
    if (imageAR) {
      const h = Math.max(32, Math.round((width / imageAR) / 32) * 32);
      if (h !== height) setHeight(h);
    }
  }, [width, imageAR, height, setHeight]);

  async function buildPromptJSON(base64Image: string, prompt: string) {
    try {
      // Ensure width and height are valid numbers
      const safeWidth = width || 640;
      const safeHeight = height || 360;
      
      const response = await fetch('/workflows/WANI2V.json');
      if (!response.ok) {
        throw new Error(`Failed to load workflow template: ${response.status}`);
      }
      const template = await response.json();
      
      // Clean the prompt to avoid JSON issues
      const cleanPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      
      // Instead of string replacement on the entire JSON, let's modify the template object directly
      const modifiedTemplate = JSON.parse(JSON.stringify(template));
      
      // Replace prompt
      if (modifiedTemplate["149"] && modifiedTemplate["149"].inputs) {
        modifiedTemplate["149"].inputs.value = cleanPrompt;
      }
      
      // Replace image
      if (modifiedTemplate["295"] && modifiedTemplate["295"].inputs) {
        modifiedTemplate["295"].inputs.image = base64Image;
      }
      
      // Replace width and height in all relevant nodes
      const widthHeightNodes = ["257", "258", "259", "264"];
      widthHeightNodes.forEach(nodeId => {
        if (modifiedTemplate[nodeId] && modifiedTemplate[nodeId].inputs) {
          if ('width' in modifiedTemplate[nodeId].inputs) {
            modifiedTemplate[nodeId].inputs.width = safeWidth;
          }
          if ('height' in modifiedTemplate[nodeId].inputs) {
            modifiedTemplate[nodeId].inputs.height = safeHeight;
          }
        }
      });
      
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
      // First check ComfyUI health
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus("Converting image to Base64…");
      const base64Image = await fileToBase64(imageFile);

      setStatus("Sending prompt to ComfyUI…");
      const clientId = `wani2v-ui-${Math.random().toString(36).slice(2)}`;
      const promptJson = await buildPromptJSON(base64Image, customPrompt);

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

      // Create job record in Supabase
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        image_filename: imageFile?.name,
        audio_filename: undefined, // No audio for I2V
        width,
        height,
        trim_to_audio: false
      });

      // Update job to processing status
      await updateJobToProcessing(id);

      // Start monitoring job status
      setStatus("Processing in ComfyUI…");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI…');
          } else if (jobStatus === 'completed' && videoInfo) {
            // Job monitoring in utils.ts will handle Supabase upload
            // Just set the ComfyUI URL for immediate viewing and let the job monitor complete the job
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=temp`
              : `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&type=temp`;
            setVideoUrl(fallbackUrl);
            setStatus("✅ Video generated successfully!");
            setIsSubmitting(false);
          } else if (jobStatus === 'error') {
            // Handle error
            setStatus(`❌ ${message}`);
            setIsSubmitting(false);
            
            try {
              await completeJob({
                job_id: id,
                status: 'error',
                error_message: message || 'Unknown error'
              });
            } catch (dbError) {
              // Silent error for DB issues
            }
          }
        }
      );
      
      setJobMonitorCleanup(() => cleanup);

    } catch (error: any) {
      if (jobId) {
        await completeJob({
          job_id: jobId,
          status: 'error',
          error_message: error.message || 'Unknown error'
        }).catch(() => {});
      }
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleDownload = () => {
    if (videoUrl) {
      const link = document.createElement('a');
      link.href = videoUrl;
      link.download = `wan-i2v-${Date.now()}.mp4`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-indigo-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 bg-clip-text text-transparent">
              WAN I2V
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Transform your images into captivating videos with AI-powered image-to-video generation
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
                className="w-full p-3 border-2 border-dashed border-purple-300 rounded-2xl bg-purple-50 hover:bg-purple-100 transition-colors cursor-pointer"
              />
            </Field>
            {imagePreview && (
              <div className="mt-4 p-4 border-2 border-purple-200 rounded-2xl bg-white">
                <img
                  ref={imgRef}
                  src={imagePreview}
                  alt="Preview"
                  className="max-w-full max-h-64 mx-auto rounded-xl shadow-lg"
                />
                {imageAR && (
                  <p className="text-sm text-gray-500 mt-2 text-center">
                    Aspect ratio: {imageAR.toFixed(2)} ({Math.round(imageAR * 100) / 100})
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
                placeholder="e.g., a beautiful scene transforming through time, day turning into night, flowers blooming..."
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none transition-colors min-h-[100px] resize-vertical"
              />
            </Field>
          </Section>

          {/* Resolution */}
          <Section title="Video Resolution">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>Width</Label>
                <input
                  type="number"
                  value={widthInput}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none transition-colors"
                  step="32"
                  min="64"
                  max="1024"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {width}px (auto-adjusted to multiple of 32)</p>
              </Field>
              <Field>
                <Label>Height</Label>
                <input
                  type="number"
                  value={heightInput}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none transition-colors"
                  step="32"
                  min="64"
                  max="1024"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {height}px (auto-adjusted to multiple of 32)</p>
              </Field>
            </div>
            {imageAR && (
              <p className="text-sm text-gray-600 mt-2">
                💡 Resolution will be adjusted to maintain aspect ratio: {imageAR.toFixed(2)}
              </p>
            )}
          </Section>

          {/* Generation */}
          <Section title="Generate Video">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>🎬</span>
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
                  <button className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" onClick={handleDownload}>
                    <span>⬇️</span>
                    Download MP4
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Video Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <UnifiedFeed 
              comfyUrl={comfyUrl} 
              config={{
                type: 'video',
                title: 'WAN I2V',
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                pageContext: 'wani2v'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}