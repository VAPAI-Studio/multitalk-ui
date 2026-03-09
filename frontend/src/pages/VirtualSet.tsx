import React, { useState, useEffect, useRef, useCallback } from "react";
import { Label, Field, Section } from "../components/UI";
import { apiClient } from "../lib/apiClient";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import SplatViewer from "../components/SplatViewer";

type Phase = "upload" | "generating-3d" | "navigate-3d" | "reconstructing" | "complete";

interface Props {
  comfyUrl?: string;
}

export default function VirtualSet({ comfyUrl = "" }: Props) {
  // Phase tracking
  const [phase, setPhase] = useState<Phase>("upload");

  // Config
  const [isConfigured, setIsConfigured] = useState(false);
  const [configMessage, setConfigMessage] = useState("");

  // Upload state
  const [inputImageDataUrl, setInputImageDataUrl] = useState("");
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

  // Image upload handler
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file");
      return;
    }
    // Check size (10MB max)
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

  // Generate 3D world
  const handleGenerate3D = async () => {
    if (!inputImageDataUrl) {
      setError("Please upload an image first");
      return;
    }
    setError("");
    setPhase("generating-3d");
    setGenerationStatus("Uploading image...");
    setGenerationStartTime(Date.now());
    setElapsedSeconds(0);

    try {
      const response = (await apiClient.generateVirtualSetWorld(
        inputImageDataUrl,
        `Virtual Set - ${new Date().toLocaleString()}`,
        worldModel
      )) as any;

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
        apiClient.saveVirtualSetWorld(
          inputImageDataUrl,
          status.splat_url,
          status.world_id,
          worldModel
        ).catch(() => {}); // Don't block on save errors

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

  // Reconstruct image via Nano Banana
  const handleReconstruct = async () => {
    if (!screenshotDataUrl || !inputImageDataUrl) return;
    setIsReconstructing(true);
    setError("");
    setResultImageUrl("");
    setPhase("reconstructing");

    try {
      const response = (await apiClient.reconstructVirtualSet(
        screenshotDataUrl,
        inputImageDataUrl,
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
    const params = item.metadata?.parameters;
    if (params?.splat_url && item.workflow_name === "virtual-set-world") {
      // Load the saved world
      setSplatUrl(params.splat_url);
      setInputImageDataUrl(item.source_image_url || item.preview_url || "");
      setScreenshotDataUrl("");
      setScreenshotHistory([]);
      setResultImageUrl("");
      setReconstructionPrompt("");
      setError("");
      setPhase("navigate-3d");
      return true; // prevent default modal
    }
    return false; // use default behavior for reconstruction images
  }, []);

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
            Transform a single photo into an explorable 3D world. Navigate
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

        {/* Section 1: Input Image */}
        <Section title="Input Image">
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
              disabled={!inputImageDataUrl || !isConfigured}
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
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Original (reference)
                  </p>
                  <img
                    src={inputImageDataUrl}
                    alt="Original"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
                  />
                </div>
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
                New Image
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
