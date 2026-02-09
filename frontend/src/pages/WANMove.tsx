import { useEffect, useState, useCallback } from "react";
import { startJobMonitoring, checkComfyUIHealth } from "../components/utils";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../contexts/AuthContext";
import { useProject } from "../contexts/ProjectContext";
import type { Path, DrawingTool } from "../components/PathAnimator";
import {
  PathCanvas,
  PathControls,
  AnimationPreview,
  getNextColor,
  pathsToWorkflowFormat,
} from "../components/PathAnimator";

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
        <div className="w-2 h-8 bg-gradient-to-b from-cyan-500 to-blue-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

interface Props {
  comfyUrl: string;
}

export default function WANMove({ comfyUrl }: Props) {
  // Auth context
  const { user } = useAuth();
  const { selectedProject } = useProject();

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");

  // Path animator state
  const [paths, setPaths] = useState<Path[]>([]);
  const [pathHistory, setPathHistory] = useState<Path[][]>([]);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>("draw");
  const [currentColor, setCurrentColor] = useState<string>("#BB8FCE");
  const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 });

  // Prompt state
  const [customPrompt, setCustomPrompt] = useState<string>("magical transformation");

  // Job state
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

  // Handle image file change
  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      setPaths([]);
      setPathHistory([]);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    // Reset paths when new image is uploaded
    setPaths([]);
    setPathHistory([]);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Update color when paths change
  useEffect(() => {
    setCurrentColor(getNextColor(paths));
  }, [paths]);

  // Handle paths change with history
  const handlePathsChange = useCallback((newPaths: Path[]) => {
    setPathHistory(prev => [...prev, paths]);
    setPaths(newPaths);
  }, [paths]);

  // Undo last path action
  const handleUndo = useCallback(() => {
    if (pathHistory.length > 0) {
      const previousPaths = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      setPaths(previousPaths);
      setSelectedPathId(null);
    }
  }, [pathHistory]);

  // Clear all paths
  const handleClearAll = useCallback(() => {
    if (paths.length > 0) {
      setPathHistory(prev => [...prev, paths]);
      setPaths([]);
      setSelectedPathId(null);
    }
  }, [paths]);

  // Build prompt JSON for ComfyUI
  async function buildPromptJSON(imageFilename: string, pathsData: string, prompt: string) {
    try {
      const response = await fetch('/workflows/WanMove.json');
      if (!response.ok) {
        throw new Error(`Failed to load workflow template: ${response.status}`);
      }
      const template = await response.json();

      // Deep clone the template
      const modifiedTemplate = JSON.parse(JSON.stringify(template));

      // Replace image filename in node 58 (LoadImage)
      if (modifiedTemplate["58"] && modifiedTemplate["58"].inputs) {
        modifiedTemplate["58"].inputs.image = imageFilename;
      }

      // Replace paths_data in node 92 (FL_PathAnimator)
      if (modifiedTemplate["92"] && modifiedTemplate["92"].inputs) {
        modifiedTemplate["92"].inputs.paths_data = pathsData;
      }

      // Replace positive_prompt in node 107 (WanVideoTextEncode)
      if (modifiedTemplate["107"] && modifiedTemplate["107"].inputs) {
        modifiedTemplate["107"].inputs.positive_prompt = prompt;
      }

      return modifiedTemplate;
    } catch (error: any) {
      throw new Error(`Failed to build prompt JSON: ${error.message}`);
    }
  }

  // Submit to ComfyUI
  async function submit() {
    setStatus("");
    setVideoUrl("");
    setJobId("");

    // Validation
    if (!comfyUrl) {
      setStatus("Please enter a ComfyUI URL.");
      return;
    }
    if (!imageFile) {
      setStatus("Please upload an image.");
      return;
    }
    if (paths.length === 0) {
      setStatus("Please draw at least one path or static point on the image.");
      return;
    }
    if (!customPrompt.trim()) {
      setStatus("Please enter a prompt.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Health check
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Upload image to ComfyUI
      setStatus("Uploading image to ComfyUI...");
      const uploadResult = await apiClient.uploadImageToComfyUI(comfyUrl, imageFile);

      if (!uploadResult.success || !uploadResult.filename) {
        throw new Error(uploadResult.error || 'Failed to upload image to ComfyUI');
      }

      const uploadedFilename = uploadResult.filename;
      console.log('Uploaded image filename:', uploadedFilename);

      // Generate paths data JSON
      const pathsData = pathsToWorkflowFormat(paths, canvasSize);
      console.log('Paths data:', pathsData);

      // Build and submit prompt
      setStatus("Sending prompt to ComfyUI...");
      const clientId = `wan-move-ui-${Math.random().toString(36).slice(2)}`;
      const promptJson = await buildPromptJSON(uploadedFilename, pathsData, customPrompt);

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
        workflow_name: 'wan-move',
        comfy_url: comfyUrl,
        input_image_urls: [imageFile.name],
        width: canvasSize.width,
        height: canvasSize.height,
        fps: 16,
        duration_seconds: 5,
        project_id: selectedProject?.id || null,
        parameters: {
          prompt: customPrompt,
          paths_count: paths.length,
          static_points: paths.filter(p => p.isSinglePoint).length,
          motion_paths: paths.filter(p => !p.isSinglePoint).length,
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
            // Construct video URL
            const resultVideoUrl = videoInfo.subfolder
              ? `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=temp`
              : `${comfyUrl}/api/view?filename=${encodeURIComponent(videoInfo.filename)}&type=temp`;

            setVideoUrl(resultVideoUrl);
            setStatus("Video generated successfully!");
            setIsSubmitting(false);

            // Complete job
            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [resultVideoUrl]
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
      link.download = `wan-move-${Date.now()}.mp4`;
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
        <div className="flex-1 max-w-5xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              WAN Move
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Animate objects in your images with custom motion paths. Draw paths to guide movement and add static anchors for stabilization.
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
                className="w-full p-3 border-2 border-dashed border-cyan-300 dark:border-cyan-700 rounded-2xl bg-cyan-50 dark:bg-cyan-900/20 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors cursor-pointer dark:text-dark-text-secondary"
              />
            </Field>
          </Section>

          {/* Path Editor */}
          {imagePreview && (
            <Section title="Path Editor">
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Canvas */}
                <div>
                  <Label>Draw Paths</Label>
                  <PathCanvas
                    imageUrl={imagePreview}
                    paths={paths}
                    onPathsChange={handlePathsChange}
                    selectedPathId={selectedPathId}
                    onSelectPath={setSelectedPathId}
                    tool={tool}
                    currentColor={currentColor}
                    canvasSize={canvasSize}
                    onCanvasSizeChange={setCanvasSize}
                  />
                </div>

                {/* Controls */}
                <div>
                  <Label>Tools & Settings</Label>
                  <PathControls
                    paths={paths}
                    onPathsChange={handlePathsChange}
                    selectedPathId={selectedPathId}
                    onSelectPath={setSelectedPathId}
                    tool={tool}
                    onToolChange={setTool}
                    currentColor={currentColor}
                    onColorChange={setCurrentColor}
                    onClearAll={handleClearAll}
                    onUndo={handleUndo}
                    canUndo={pathHistory.length > 0}
                  />
                </div>
              </div>
            </Section>
          )}

          {/* Animation Preview */}
          {imagePreview && (
            <Section title="Animation Preview">
              <AnimationPreview
                paths={paths}
                canvasSize={canvasSize}
                imageUrl={imagePreview}
              />
            </Section>
          )}

          {/* Prompt */}
          <Section title="Prompt">
            <Field>
              <Label>Describe the animation</Label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., magical transformation, dancing, moving gracefully..."
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-cyan-500 focus:outline-none transition-colors min-h-[100px] resize-vertical"
              />
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
                    <span>🎬</span>
                    Generate Video
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && (
                <span className={`text-sm ${status.includes('Error') ? 'text-red-600' : status.includes('successfully') ? 'text-green-600' : 'text-gray-600'}`}>
                  {status}
                </span>
              )}
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

        {/* Right Sidebar - Generation Feed */}
        <ResizableFeedSidebar
          storageKey="wan-move"
          config={{
            mediaType: 'all',
            pageContext: 'wan-move',
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
