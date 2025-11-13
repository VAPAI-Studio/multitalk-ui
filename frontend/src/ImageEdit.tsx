import React, { useState, useEffect } from "react";
import { Label, Field, Section } from "./components/UI";
import { apiClient } from "./lib/apiClient";
import ImageFeed from "./components/ImageFeed";
import { useSmartResolution } from "./hooks/useSmartResolution";

type Tab = "edit" | "camera-angle";

interface Props {
  comfyUrl?: string;
}

export default function ImageEdit({ comfyUrl = "" }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("edit");

  // Original Image Edit State
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [editedImageUrl, setEditedImageUrl] = useState<string>("");
  const [originalImageUrl, setOriginalImageUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isConfigured, setIsConfigured] = useState<boolean>(false);

  // Camera Angle State
  const [cameraPrompt, setCameraPrompt] = useState<string>("Turn the camera to a top-down view, the person face up, eye look at camera view.");
  const [cameraImage, setCameraImage] = useState<File | null>(null);
  const [cameraImagePreview, setCameraImagePreview] = useState<string>("");
  const [isCameraGenerating, setIsCameraGenerating] = useState<boolean>(false);
  const [cameraStatus, setCameraStatus] = useState<string>("");
  const [cameraResultUrl, setCameraResultUrl] = useState<string>("");
  const [cameraJobId, setCameraJobId] = useState<string>("");

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

  // Aspect ratio lock state
  const [aspectRatioLocked, setAspectRatioLocked] = useState<boolean>(true);
  const [aspectRatio, setAspectRatio] = useState<number>(1280 / 720);

  // Check OpenRouter configuration on component mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await apiClient.checkOpenRouterConfig() as any;
        setIsConfigured(response.configured);
      } catch (error) {
        console.error('Failed to check OpenRouter config:', error);
        setIsConfigured(false);
      }
    };
    checkConfig();
  }, []);

  // Original Image Edit Handlers
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("Please select a valid image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setOriginalImageUrl(result);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const editImage = async () => {
    if (!userPrompt.trim()) {
      setError("Please enter edit instructions");
      return;
    }

    if (!originalImageUrl) {
      setError("Please upload an image to edit");
      return;
    }

    if (!isConfigured) {
      setError("OpenRouter API key is not configured on the backend");
      return;
    }

    setIsGenerating(true);
    setError("");
    setEditedImageUrl("");

    try {
      const response = await apiClient.editImage(originalImageUrl, userPrompt) as any;

      if (response.success && response.image_url) {
        setEditedImageUrl(response.image_url);
      } else {
        throw new Error(response.error || "No edited image received");
      }

    } catch (err: any) {
      setError(err.message || "Failed to edit image");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      editImage();
    }
  };

  // Camera Angle Handlers
  const handleWidthChangeWithAspectRatio = (value: string) => {
    handleWidthChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericWidth = parseInt(value) || 32;
      const calculatedHeight = Math.round(numericWidth / aspectRatio);
      const roundedHeight = Math.round(calculatedHeight / 32) * 32;
      setHeight(roundedHeight);
    }
  };

  const handleHeightChangeWithAspectRatio = (value: string) => {
    handleHeightChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericHeight = parseInt(value) || 32;
      const calculatedWidth = Math.round(numericHeight * aspectRatio);
      const roundedWidth = Math.round(calculatedWidth / 32) * 32;
      setWidth(roundedWidth);
    }
  };

  const toggleAspectRatioLock = () => {
    const newLockState = !aspectRatioLocked;
    setAspectRatioLocked(newLockState);

    // When locking, update aspect ratio to current dimensions
    if (newLockState && width > 0 && height > 0) {
      setAspectRatio(width / height);
    }
  };

  const handleCameraImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCameraStatus("❌ Please select a valid image file");
      return;
    }

    setCameraImage(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCameraImagePreview(result);
      setCameraStatus("");

      // Automatically set width and height based on image dimensions
      const img = new Image();
      img.onload = () => {
        // Round to nearest multiple of 32 for compatibility
        const roundedWidth = Math.round(img.width / 32) * 32;
        const roundedHeight = Math.round(img.height / 32) * 32;
        setWidth(roundedWidth);
        setHeight(roundedHeight);
        // Update aspect ratio for locked mode
        setAspectRatio(roundedWidth / roundedHeight);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const generateCameraAngle = async () => {
    if (!cameraImage) {
      setCameraStatus("❌ Please upload an image");
      return;
    }

    if (!cameraPrompt.trim()) {
      setCameraStatus("❌ Please enter a camera angle prompt");
      return;
    }

    if (!comfyUrl) {
      setCameraStatus("❌ ComfyUI URL is not configured");
      return;
    }

    setIsCameraGenerating(true);
    setCameraStatus("📤 Converting image...");
    setCameraResultUrl("");
    setCameraJobId("");

    let databaseJobId: string | null = null;

    try {
      setCameraStatus("☁️ Uploading to ComfyUI...");

      // 2. Upload image to ComfyUI
      const uploadFormData = new FormData();
      uploadFormData.append('image', cameraImage);
      const uploadResponse = await fetch(`${comfyUrl}/upload/image`, {
        method: 'POST',
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image to ComfyUI: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      const uploadedFilename = uploadData.name || cameraImage.name;

      setCameraStatus("🔨 Building workflow...");

      // 3. Build workflow using backend template
      const clientId = `camera-angle-${Math.random().toString(36).slice(2)}`;
      const workflowResponse = await apiClient.submitWorkflow(
        'QwenCameraAngle',
        {
          IMAGE_FILENAME: uploadedFilename,
          PROMPT: cameraPrompt,
          WIDTH: width,
          HEIGHT: height
        },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!workflowResponse.success || !workflowResponse.prompt_id) {
        throw new Error(workflowResponse.error || 'Failed to submit workflow to ComfyUI');
      }

      const promptId = workflowResponse.prompt_id;
      setCameraJobId(promptId);

      setCameraStatus("💾 Creating job record...");

      // 4. Create image job in database
      const jobCreationResponse = await apiClient.createImageJob({
        comfy_job_id: promptId,
        workflow_name: 'camera-angle',
        comfy_url: comfyUrl,
        input_image_urls: [uploadedFilename],
        width,
        height,
        parameters: {
          prompt: cameraPrompt
        }
      }) as any;

      if (!jobCreationResponse.success || !jobCreationResponse.image_job?.id) {
        throw new Error('Failed to create job record in database');
      }

      databaseJobId = jobCreationResponse.image_job.id;

      setCameraStatus("⏳ Processing in ComfyUI...");

      // 5. Poll for completion
      const startTime = Date.now();
      const maxWaitTime = 300000; // 5 minutes

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          throw new Error('Processing timeout after 5 minutes');
        }

        try {
          const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, promptId) as {
            success: boolean;
            history?: any;
            error?: string;
          };

          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history');
          }

          const history = historyResponse.history;
          const historyEntry = history?.[promptId];

          // Check for errors
          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message ||
                            historyEntry.status?.error ||
                            "Unknown error in ComfyUI";
            throw new Error(`ComfyUI error: ${errorMsg}`);
          }

          // Check if completed
          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            const outputs = historyEntry.outputs;
            let imageInfo = null;

            // Find the generated image
            for (const nodeId in outputs) {
              const nodeOutputs = outputs[nodeId];
              if (nodeOutputs.images && nodeOutputs.images.length > 0) {
                imageInfo = nodeOutputs.images[0];
                break;
              }
            }

            if (imageInfo) {
              // Construct the ComfyUI view URL
              const comfyImageUrl = imageInfo.subfolder
                ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
                : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`;

              setCameraStatus("💾 Saving image to storage...");

              // Complete job - backend will download from ComfyUI and upload to Supabase
              if (!databaseJobId) {
                throw new Error('Database job ID is missing');
              }

              const completionResult = await apiClient.completeImageJob(databaseJobId, {
                job_id: databaseJobId,
                status: 'completed',
                output_image_urls: [comfyImageUrl] // Pass ComfyUI URL, backend handles storage upload
              }) as any;

              if (!completionResult.success || !completionResult.image_job?.output_image_urls?.[0]) {
                throw new Error('Failed to save image to storage');
              }

              const storedImageUrl = completionResult.image_job.output_image_urls[0];

              setCameraResultUrl(storedImageUrl);
              setCameraStatus("✅ Camera angle generated successfully!");
              setIsCameraGenerating(false);
              return; // STOP POLLING - job is complete!
            }
          }

          // Still processing, poll again
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();

        } catch (pollError: any) {
          // If it's a timeout or completion error, rethrow (don't retry)
          if (pollError.message.includes('timeout') || pollError.message.includes('save image')) {
            throw pollError;
          }
          // Only retry on transient ComfyUI history fetch errors
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();
        }
      };

      await pollForResult();

    } catch (err: any) {
      setCameraStatus(`❌ Error: ${err.message || "Unknown error"}`);
      if (databaseJobId) {
        await apiClient.completeImageJob(databaseJobId, {
          job_id: databaseJobId,
          status: 'error',
          error_message: err.message || 'Unknown error'
        }).catch(() => {});
      }
    } finally {
      setIsCameraGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
              Image Edit
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-purple-100 to-pink-100 px-4 py-2 rounded-full border border-purple-200/50">
                AI Image Generation
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Upload an image and edit it using AI-powered image editing technology.
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 p-2 bg-white/80 rounded-2xl border border-gray-200 shadow-sm">
            <button
              onClick={() => setActiveTab("edit")}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                activeTab === "edit"
                  ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span>✨</span>
                <span>AI Edit</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("camera-angle")}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                activeTab === "camera-angle"
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span>📷</span>
                <span>Change Camera Angle</span>
              </span>
            </button>
          </div>

          {/* AI Edit Tab Content */}
          {activeTab === "edit" && (
            <>
              <Section title="Edit Image">
                <div className="space-y-6">
                  <Field>
                    <Label>Upload Image to Edit</Label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition-all duration-200 bg-white/80 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                    />
                    {originalImageUrl && (
                      <div className="mt-4">
                        <img
                          src={originalImageUrl}
                          alt="Original image"
                          className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-purple-200"
                        />
                        <p className="text-sm text-purple-600 text-center mt-2">Original image loaded</p>
                      </div>
                    )}
                  </Field>

                  <Field>
                    <Label>Edit Instructions</Label>
                    <textarea
                      rows={4}
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 resize-vertical"
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder="Describe how to edit the image... (e.g., 'Remove the background and add a sunset sky')"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Press Enter to edit, or Shift+Enter for new line
                    </p>
                  </Field>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={editImage}
                      disabled={isGenerating || !userPrompt.trim() || !originalImageUrl || !isConfigured}
                      className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Editing Image...
                        </>
                      ) : (
                        <>
                          <span>✨</span>
                          Edit Image
                        </>
                      )}
                    </button>
                  </div>

                  {error && (
                    <div className="p-4 rounded-2xl bg-red-50 border border-red-200">
                      <div className="flex items-center gap-2 text-red-800">
                        <span>❌</span>
                        <span className="font-medium">Error</span>
                      </div>
                      <p className="text-red-600 mt-1">{error}</p>
                    </div>
                  )}

                  {editedImageUrl && (
                    <div className="space-y-4">
                      <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2 text-purple-800">
                            <span>✨</span>
                            <span className="font-medium">Edited Image</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = editedImageUrl;
                                link.download = `edited-image-${Date.now()}.png`;
                                link.click();
                              }}
                              className="px-4 py-2 rounded-xl bg-white text-purple-700 hover:bg-purple-50 font-medium text-sm transition-all duration-200 border border-purple-200"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                        <img
                          src={editedImageUrl}
                          alt="Edited image"
                          className="w-full rounded-xl shadow-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {!isConfigured && (
                <Section title="API Configuration">
                  <div className="p-4 rounded-2xl bg-yellow-50 border border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-800 mb-2">
                      <span>⚠️</span>
                      <span className="font-medium">OpenRouter API Key Required</span>
                    </div>
                    <p className="text-yellow-700 text-sm">
                      To use image editing, you need to configure your OpenRouter API key on the backend.
                      Get one at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai</a>
                      <br /><br />
                      Set <code className="bg-yellow-200 px-1 rounded">OPENROUTER_API_KEY</code> environment variable in your backend .env file
                    </p>
                  </div>
                </Section>
              )}
            </>
          )}

          {/* Camera Angle Tab Content */}
          {activeTab === "camera-angle" && (
            <>
              <Section title="Input">
                <Field>
                  <Label>Upload Image</Label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCameraImageUpload}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                  />
                  {cameraImagePreview && (
                    <div className="mt-4">
                      <img
                        src={cameraImagePreview}
                        alt="Camera input"
                        className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-blue-200"
                      />
                      <p className="text-sm text-blue-600 text-center mt-2">✓ Image loaded</p>
                    </div>
                  )}
                </Field>
              </Section>

              <Section title="Settings">
                <Field>
                  <Label>Camera Angle Prompt</Label>
                  <textarea
                    rows={3}
                    className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical"
                    value={cameraPrompt}
                    onChange={(e) => setCameraPrompt(e.target.value)}
                    placeholder="Describe the desired camera angle... (e.g., 'Turn the camera to a top-down view')"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Describe how you want the camera angle to change
                  </p>
                </Field>
              </Section>

              <Section title="Resolution">
                {/* Aspect Ratio Lock Toggle */}
                <div className="mb-4 flex items-center gap-3">
                  <button
                    onClick={toggleAspectRatioLock}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 ${
                      aspectRatioLocked
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="text-lg">{aspectRatioLocked ? '🔒' : '🔓'}</span>
                    <span>Maintain Aspect Ratio</span>
                  </button>
                  {aspectRatioLocked && aspectRatio > 0 && (
                    <span className="text-xs text-gray-500">
                      ({aspectRatio.toFixed(2)}:1)
                    </span>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <Field>
                    <Label>Width (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                      value={widthInput}
                      onChange={(e) => handleWidthChangeWithAspectRatio(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <Label>Height (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                      value={heightInput}
                      onChange={(e) => handleHeightChangeWithAspectRatio(e.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-xs text-gray-500 mt-3">Auto-corrected to multiples of 32</p>
              </Section>

              <Section title="Generate">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                    onClick={generateCameraAngle}
                    disabled={isCameraGenerating || !cameraImage}
                  >
                    {isCameraGenerating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Processing…
                      </>
                    ) : (
                      <>
                        <span>📷</span>
                        Generate
                      </>
                    )}
                  </button>
                  {cameraJobId && <span className="text-xs text-gray-500">Job ID: {cameraJobId}</span>}
                  {cameraStatus && <span className="text-sm">{cameraStatus}</span>}
                </div>

                {cameraResultUrl && (
                  <div className="mt-6 space-y-3">
                    <img src={cameraResultUrl} alt="Result" className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                    <div>
                      <button
                        className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = cameraResultUrl;
                          a.download = `camera-angle-${Date.now()}.png`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                      >
                        <span>⬇️</span>
                        Download
                      </button>
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Right Sidebar - Image Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <ImageFeed
              config={{
                useNewJobSystem: true, // Both tabs use new system
                workflowName: undefined, // Show all image jobs (both image-edit and camera-angle)
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: false,
                showProgress: false,
                pageContext: "image-edit" // Single context for the whole page
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
