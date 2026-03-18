import React, { useState, useEffect, useRef, useCallback } from "react";
import { Label, Field, Section } from "../components/UI";
import { apiClient } from "../lib/apiClient";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import SplatViewer from "../components/SplatViewer";

type Phase = "upload" | "generating-3d" | "navigate-3d" | "reconstructing" | "complete";
type PromptType = "image" | "multi-image" | "video";

const AZIMUTH_OPTIONS = [
  { label: "Front (0°)", value: 0 },
  { label: "Right (90°)", value: 90 },
  { label: "Back (180°)", value: 180 },
  { label: "Left (270°)", value: 270 },
];

interface MultiImageEntry {
  dataUrl: string;
  azimuth: number;
}

interface Props {
  comfyUrl?: string;
}

export default function VirtualSet({ comfyUrl = "" }: Props) {
  // Phase tracking
  const [phase, setPhase] = useState<Phase>("upload");

  // Config
  const [isConfigured, setIsConfigured] = useState(false);
  const [configMessage, setConfigMessage] = useState("");

  // Prompt type
  const [promptType, setPromptType] = useState<PromptType>("image");

  // Upload state — single image
  const [inputImageDataUrl, setInputImageDataUrl] = useState("");

  // Upload state — multi-image
  const [multiImages, setMultiImages] = useState<MultiImageEntry[]>([]);
  const [reconstructImages, setReconstructImages] = useState(false);

  // Upload state — video
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");

  // Common
  const [textPrompt, setTextPrompt] = useState("");
  const [worldModel, setWorldModel] = useState("Marble 0.1-plus");

  // Generation state
  const [_operationId, setOperationId] = useState("");
  const [splatUrl, setSplatUrl] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [generationStartTime, setGenerationStartTime] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollingRef = useRef(false);

  // Screenshot state
  const [screenshotDataUrl, setScreenshotDataUrl] = useState("");
  const [screenshotHistory, setScreenshotHistory] = useState<string[]>([]);

  // Reconstruction state
  const [reconstructionPrompt, setReconstructionPrompt] = useState("");
  const [resultImageUrl, setResultImageUrl] = useState("");
  const [isReconstructing, setIsReconstructing] = useState(false);

  // General
  const [error, setError] = useState("");

  // Check config on mount
  useEffect(() => {
    apiClient.checkVirtualSetConfig().then((r: any) => {
      setIsConfigured(r.configured);
      if (!r.configured) setConfigMessage(r.message);
    }).catch(() => setIsConfigured(false));
  }, []);

  // Elapsed time counter during generation
  useEffect(() => {
    if (phase !== "generating-3d" || !generationStartTime) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - generationStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, generationStartTime]);

  // Get the first available image data URL for reconstruction reference
  const getReferenceImageUrl = () => {
    if (promptType === "image") return inputImageDataUrl;
    if (promptType === "multi-image" && multiImages.length > 0) return multiImages[0].dataUrl;
    return "";
  };

  // Single image upload handler
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setInputImageDataUrl(e.target?.result as string);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  // Multi-image: add an image
  const handleMultiImageAdd = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }
    const maxImages = reconstructImages ? 8 : 4;
    if (multiImages.length >= maxImages) {
      setError(`Maximum ${maxImages} images allowed`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const usedAzimuths = new Set(multiImages.map((i) => i.azimuth));
      const nextAzimuth = AZIMUTH_OPTIONS.find((o) => !usedAzimuths.has(o.value))?.value ?? 0;
      setMultiImages((prev) => [...prev, { dataUrl: e.target?.result as string, azimuth: nextAzimuth }]);
      setError("");
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be selected again
    event.target.value = "";
  };

  // Multi-image: remove an image
  const handleMultiImageRemove = (index: number) => {
    setMultiImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Multi-image: change azimuth
  const handleMultiImageAzimuthChange = (index: number, azimuth: number) => {
    setMultiImages((prev) => prev.map((img, i) => (i === index ? { ...img, azimuth } : img)));
  };

  // Video upload handler
  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Please select a valid video file");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError("Video must be under 100MB");
      return;
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    setError("");
  };

  // Check if we can generate
  const canGenerate = () => {
    if (!isConfigured) return false;
    if (promptType === "image") return !!inputImageDataUrl;
    if (promptType === "multi-image") return multiImages.length >= 2;
    if (promptType === "video") return !!videoFile;
    return false;
  };

  // Generate 3D world
  const handleGenerate3D = async () => {
    if (!canGenerate()) return;
    setError("");
    setPhase("generating-3d");
    setGenerationStartTime(Date.now());
    setElapsedSeconds(0);

    try {
      let videoUrl: string | undefined;

      if (promptType === "video" && videoFile) {
        setGenerationStatus("Uploading video...");
        const uploadResult = await apiClient.uploadVideoForVirtualSet(videoFile);
        if (!uploadResult.success || !uploadResult.video_url) {
          throw new Error(uploadResult.error || "Failed to upload video");
        }
        videoUrl = uploadResult.video_url;
      } else {
        setGenerationStatus("Uploading media...");
      }

      const response = (await apiClient.generateVirtualSetWorld({
        promptType,
        imageData: promptType === "image" ? inputImageDataUrl : undefined,
        images: promptType === "multi-image"
          ? multiImages.map((i) => ({ imageData: i.dataUrl, azimuth: i.azimuth }))
          : undefined,
        reconstructImages: promptType === "multi-image" ? reconstructImages : undefined,
        videoUrl: promptType === "video" ? videoUrl : undefined,
        textPrompt: textPrompt || undefined,
        displayName: `Virtual Set - ${new Date().toLocaleString()}`,
        model: worldModel,
      })) as any;

      if (!response.success) {
        throw new Error(response.error || "Failed to start world generation");
      }

      setOperationId(response.operation_id);
      setGenerationStatus("World generation started...");
      await pollForWorld(response.operation_id);
    } catch (err: any) {
      setError(err.message);
      setPhase("upload");
      setGenerationStatus("");
    }
  };

  // Poll for world generation completion
  const pollForWorld = async (opId: string) => {
    pollingRef.current = true;
    const maxWait = 600000; // 10 minutes
    const startTime = Date.now();

    const poll = async (): Promise<void> => {
      if (!pollingRef.current) return;
      if (Date.now() - startTime > maxWait) {
        throw new Error("World generation timed out after 10 minutes");
      }

      const status = (await apiClient.getVirtualSetStatus(opId)) as any;

      if (!status.success) {
        throw new Error(status.error || "Failed to check generation status");
      }

      if (status.done) {
        if (!status.splat_url) {
          throw new Error("Generation completed but no 3D asset was returned");
        }
        setSplatUrl(status.splat_url);
        setPhase("navigate-3d");
        setGenerationStatus("");
        pollingRef.current = false;

        // Save world to feed for later access
        const refImage = getReferenceImageUrl();
        if (refImage) {
          apiClient.saveVirtualSetWorld(
            refImage,
            status.splat_url,
            status.world_id,
            worldModel,
            promptType
          ).catch((err) => console.error('[VirtualSet] Failed to save world:', err));
        } else {
          console.warn('[VirtualSet] No reference image available for world save (prompt_type:', promptType, ')');
        }

        return;
      }

      setGenerationStatus("Generating 3D world...");
      await new Promise((r) => setTimeout(r, 5000));
      return poll();
    };

    try {
      await poll();
    } catch (err: any) {
      pollingRef.current = false;
      setError(err.message);
      setPhase("upload");
      setGenerationStatus("");
    }
  };

  // Handle screenshot from SplatViewer
  const handleScreenshot = useCallback((dataUrl: string) => {
    setScreenshotDataUrl(dataUrl);
    setScreenshotHistory((prev) => [...prev, dataUrl]);
  }, []);

  // Select screenshot from history
  const selectScreenshot = (dataUrl: string) => {
    setScreenshotDataUrl(dataUrl);
  };

  // Reconstruct image
  const handleReconstruct = async () => {
    const refImage = getReferenceImageUrl();
    if (!screenshotDataUrl || !refImage) return;
    setIsReconstructing(true);
    setError("");
    setResultImageUrl("");
    setPhase("reconstructing");

    try {
      const response = (await apiClient.reconstructVirtualSet(
        screenshotDataUrl,
        refImage,
        reconstructionPrompt
      )) as any;

      if (!response.success) {
        throw new Error(response.error || "Image reconstruction failed");
      }

      setResultImageUrl(response.image_url);
      setPhase("complete");
    } catch (err: any) {
      setError(err.message);
      setPhase("navigate-3d");
    } finally {
      setIsReconstructing(false);
    }
  };

  // Cancel generation
  const handleCancelGeneration = () => {
    pollingRef.current = false;
    setPhase("upload");
    setGenerationStatus("");
    setError("");
  };

  // Go back to 3D viewer for another screenshot
  const handleTakeAnother = () => {
    setScreenshotDataUrl("");
    setResultImageUrl("");
    setReconstructionPrompt("");
    setError("");
    setPhase("navigate-3d");
  };

  // Start over
  const handleStartOver = () => {
    setPhase("upload");
    setInputImageDataUrl("");
    setMultiImages([]);
    setReconstructImages(false);
    setVideoFile(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl("");
    setTextPrompt("");
    setSplatUrl("");
    setOperationId("");
    setScreenshotDataUrl("");
    setScreenshotHistory([]);
    setResultImageUrl("");
    setReconstructionPrompt("");
    setGenerationStatus("");
    setError("");
  };

  // Handle feed item click - load a saved world
  const handleFeedItemClick = useCallback((item: any): boolean => {
    // World items from world_jobs have splat_url as top-level field
    const splatUrl = item.splat_url || item.metadata?.splat_url || item.metadata?.parameters?.splat_url;
    if (splatUrl && (item.type === 'world' || item.workflow_name === 'virtual-set-world')) {
      setSplatUrl(splatUrl);
      setInputImageDataUrl(item.source_image_url || item.preview_url || item.thumbnail_url || "");
      setScreenshotDataUrl("");
      setScreenshotHistory([]);
      setResultImageUrl("");
      setReconstructionPrompt("");
      setError("");
      setPhase("navigate-3d");
      return true;
    }
    return false;
  }, []);

  const promptTypeToggleClass = (type: PromptType) =>
    `flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
      promptType === type
        ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md"
        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
    }`;

  return (
    <div className="flex gap-6">
      {/* Main Content */}
      <div className="flex-1 max-w-4xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3 py-6">
          <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600 bg-clip-text text-transparent">
            Virtual Set
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto text-sm">
            Transform photos or videos into explorable 3D worlds. Navigate
            freely and capture new camera angles, then reconstruct photorealistic
            images.
          </p>
        </div>

        {/* Config warning */}
        {!isConfigured && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
            <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">
              API keys not fully configured
            </p>
            <p className="text-amber-600 dark:text-amber-300 text-xs mt-1">
              {configMessage || "Set WORLDLABS_API_KEY and OPENROUTER_API_KEY in your backend .env"}
            </p>
          </div>
        )}

        {/* Section 1: Input */}
        <Section title="Input">
          {/* Prompt Type Selector */}
          <Field>
            <Label>Input Type</Label>
            <div className="flex gap-2">
              <button onClick={() => setPromptType("image")} className={promptTypeToggleClass("image")}>
                Image
              </button>
              <button onClick={() => setPromptType("multi-image")} className={promptTypeToggleClass("multi-image")}>
                Multi-Image
              </button>
              <button onClick={() => setPromptType("video")} className={promptTypeToggleClass("video")}>
                Video
              </button>
            </div>
          </Field>

          {/* Single Image Input */}
          {promptType === "image" && (
            <>
              <Field>
                <Label>Upload Image</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageUpload}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-6 text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-teal-500 file:to-emerald-600 file:text-white file:font-semibold hover:file:from-teal-600 hover:file:to-emerald-700 transition-all duration-200 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </Field>
              {inputImageDataUrl && (
                <div className="mt-4">
                  <img
                    src={inputImageDataUrl}
                    alt="Input"
                    className="max-h-48 rounded-xl border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}
            </>
          )}

          {/* Multi-Image Input */}
          {promptType === "multi-image" && (
            <>
              <Field>
                <Label>Upload Images (2-{reconstructImages ? 8 : 4})</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleMultiImageAdd}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-6 text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-teal-500 file:to-emerald-600 file:text-white file:font-semibold hover:file:from-teal-600 hover:file:to-emerald-700 transition-all duration-200 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </Field>

              {/* Image list with azimuth selectors */}
              {multiImages.length > 0 && (
                <div className="space-y-3 mt-4">
                  {multiImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
                    >
                      <img
                        src={img.dataUrl}
                        alt={`Image ${idx + 1}`}
                        className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-gray-700"
                      />
                      <div className="flex-1">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Image {idx + 1}
                        </p>
                        <select
                          value={img.azimuth}
                          onChange={(e) => handleMultiImageAzimuthChange(idx, Number(e.target.value))}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm px-3 py-1.5"
                        >
                          {AZIMUTH_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => handleMultiImageRemove(idx)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Reconstruct mode toggle */}
              <Field>
                <label className="flex items-center gap-3 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={reconstructImages}
                    onChange={(e) => setReconstructImages(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-teal-500 focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Reconstruct mode (allows up to 8 images)
                  </span>
                </label>
              </Field>

              {multiImages.length < 2 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Add at least 2 images to generate a world
                </p>
              )}
            </>
          )}

          {/* Video Input */}
          {promptType === "video" && (
            <>
              <Field>
                <Label>Upload Video (max 100MB)</Label>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                  onChange={handleVideoUpload}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 px-4 py-6 text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-teal-500 file:to-emerald-600 file:text-white file:font-semibold hover:file:from-teal-600 hover:file:to-emerald-700 transition-all duration-200 bg-gray-50/50 dark:bg-gray-800/50"
                />
              </Field>
              {videoPreviewUrl && (
                <div className="mt-4">
                  <video
                    src={videoPreviewUrl}
                    controls
                    className="max-h-48 rounded-xl border border-gray-200 dark:border-gray-700"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {videoFile?.name} ({((videoFile?.size || 0) / 1024 / 1024).toFixed(1)}MB)
                  </p>
                </div>
              )}
            </>
          )}

          {/* Text Prompt (common to all types) */}
          <Field>
            <Label>Text Prompt (optional)</Label>
            <textarea
              rows={2}
              className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 px-4 py-3 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-900 transition-all resize-none text-sm"
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="Describe the scene to guide 3D world generation..."
            />
          </Field>

          {/* Model toggle */}
          <Field>
            <Label>Generation Quality</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setWorldModel("Marble 0.1-plus")}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  worldModel === "Marble 0.1-plus"
                    ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                <div className="font-semibold">Standard</div>
                <div className="text-xs opacity-75">~5 min, best quality</div>
              </button>
              <button
                onClick={() => setWorldModel("Marble 0.1-mini")}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                  worldModel === "Marble 0.1-mini"
                    ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                <div className="font-semibold">Draft</div>
                <div className="text-xs opacity-75">~30 sec, fast preview</div>
              </button>
            </div>
          </Field>

          {phase === "upload" && (
            <button
              onClick={handleGenerate3D}
              disabled={!canGenerate()}
              className="w-full mt-4 px-6 py-3 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-bold text-lg shadow-lg hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Generate 3D World
            </button>
          )}
        </Section>

        {/* Section 2: Generation Progress */}
        {phase === "generating-3d" && (
          <Section title="Generating 3D World">
            <div className="flex flex-col items-center py-8 space-y-4">
              <div className="w-12 h-12 border-3 border-teal-200 dark:border-teal-800 border-t-teal-500 rounded-full animate-spin" />
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                {generationStatus}
              </p>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {elapsedSeconds > 0 && `${elapsedSeconds}s elapsed`}
                {worldModel === "Marble 0.1-plus" &&
                  elapsedSeconds < 300 &&
                  " — Standard quality takes ~5 minutes"}
              </p>
              <button
                onClick={handleCancelGeneration}
                className="text-sm text-gray-500 hover:text-red-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </Section>
        )}

        {/* Section 3: 3D Viewer */}
        {splatUrl && phase !== "upload" && phase !== "generating-3d" && (
          <Section title="3D Scene">
            <SplatViewer
              splatUrl={splatUrl}
              onScreenshot={handleScreenshot}
              height={500}
            />
          </Section>
        )}

        {/* Section 4: Screenshot Review + Reconstruction */}
        {screenshotDataUrl &&
          (phase === "navigate-3d" ||
            phase === "reconstructing" ||
            phase === "complete") && (
            <Section title="Reconstruct Image">
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Screenshot (new angle)
                  </p>
                  <img
                    src={screenshotDataUrl}
                    alt="Screenshot"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
                  />
                </div>
                {getReferenceImageUrl() && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Original (reference)
                    </p>
                    <img
                      src={getReferenceImageUrl()}
                      alt="Original"
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
                    />
                  </div>
                )}
              </div>

              <Field>
                <Label>Additional Instructions (optional)</Label>
                <textarea
                  rows={2}
                  className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 px-4 py-3 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 dark:focus:ring-teal-900 transition-all resize-none text-sm"
                  value={reconstructionPrompt}
                  onChange={(e) => setReconstructionPrompt(e.target.value)}
                  placeholder="e.g., Make it warmer lighting, enhance details..."
                />
              </Field>

              {phase !== "complete" && (
                <button
                  onClick={handleReconstruct}
                  disabled={isReconstructing}
                  className="w-full mt-3 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {isReconstructing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Reconstructing...
                    </>
                  ) : (
                    "Reconstruct Image"
                  )}
                </button>
              )}
            </Section>
          )}

        {/* Section 5: Result */}
        {resultImageUrl && phase === "complete" && (
          <Section title="Result">
            <img
              src={resultImageUrl}
              alt="Reconstructed"
              className="w-full rounded-2xl border border-gray-200 dark:border-gray-700 shadow-lg"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = resultImageUrl;
                  a.download = `virtual-set-${Date.now()}.png`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                className="px-6 py-2.5 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
              >
                Download
              </button>
              <button
                onClick={handleTakeAnother}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white font-semibold shadow-md hover:shadow-lg hover:from-teal-600 hover:to-emerald-700 transition-all"
              >
                Take Another Screenshot
              </button>
              <button
                onClick={handleStartOver}
                className="px-6 py-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium transition-colors"
              >
                Start Over
              </button>
            </div>
          </Section>
        )}

        {/* Screenshot History */}
        {screenshotHistory.length > 1 && (
          <Section title="Screenshot History">
            <div className="grid grid-cols-4 gap-3">
              {screenshotHistory.map((url, i) => (
                <button
                  key={i}
                  onClick={() => selectScreenshot(url)}
                  className={`rounded-xl overflow-hidden border-2 transition-all ${
                    url === screenshotDataUrl
                      ? "border-teal-500 shadow-lg ring-2 ring-teal-200 dark:ring-teal-800"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
                  }`}
                >
                  <img
                    src={url}
                    alt={`Screenshot ${i + 1}`}
                    className="w-full aspect-video object-cover"
                  />
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Right Sidebar */}
      <ResizableFeedSidebar
        storageKey="virtual-set"
        config={{
          mediaType: "all" as const,
          pageContext: ["virtual-set", "virtual-set-world"],
          showCompletedOnly: false,
          maxItems: 10,
          showFixButton: true,
          showProgress: true,
          comfyUrl: comfyUrl,
          onItemClick: handleFeedItemClick,
        }}
      />
    </div>
  );
}
