import React, { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/apiClient";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { useSmartResolution } from "../hooks/useSmartResolution";

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

export default function StyleTransfer({ comfyUrl }: Props) {
  const [subjectImage, setSubjectImage] = useState<File | null>(null);
  const [styleImage, setStyleImage] = useState<File | null>(null);
  const [subjectPreview, setSubjectPreview] = useState<string>("");
  const [stylePreview, setStylePreview] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>('A high-quality artistic image with transferred style');

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
  } = useSmartResolution(1024, 1024) // Start with square format for style transfer

  const [status, setStatus] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [imageId, setImageId] = useState<string>("");

  const subjectImgRef = useRef<HTMLImageElement | null>(null);
  const styleImgRef = useRef<HTMLImageElement | null>(null);

  // Handle subject image upload
  useEffect(() => {
    if (!subjectImage) return;
    
    // Convert to data URL for persistent preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setSubjectPreview(dataUrl);
      
      // Calculate dimensions
      const img = new Image();
      img.onload = () => {
        const ar = img.width / img.height;
        // Initialize W/H based on subject image aspect ratio
        const targetW = Math.max(32, Math.round(Math.min(1024, img.width) / 32) * 32);
        const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
        setWidth(targetW);
        setHeight(targetH);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(subjectImage);
  }, [subjectImage, setWidth, setHeight]);

  // Handle style image upload
  useEffect(() => {
    if (!styleImage) return;
    
    // Convert to data URL for persistent preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setStylePreview(dataUrl);
    };
    reader.readAsDataURL(styleImage);
  }, [styleImage]);


  async function submit() {
    setStatus("");
    setResultUrl("");
    setImageId("");

    if (!subjectImage) {
      setStatus("Please upload a subject image.");
      return;
    }
    if (!styleImage) {
      setStatus("Please upload a style reference image.");
      return;
    }
    if (!customPrompt.trim()) {
      setStatus("Please enter a prompt.");
      return;
    }

    setIsSubmitting(true);
    try {
      setStatus("Converting images to Base64…");
      const subjectBase64 = await fileToBase64(subjectImage);
      const styleBase64 = await fileToBase64(styleImage);

      setStatus("Uploading images and creating style transfer…");
      
      // Convert File to data URL for upload
      const subjectDataUrl = `data:${subjectImage.type};base64,${subjectBase64}`;
      const styleDataUrl = `data:${styleImage.type};base64,${styleBase64}`;
      
      // Use the new template-based approach (backend handles workflow building)
      const response = await apiClient.submitStyleTransferWithTemplate({
        subject_image_data: subjectDataUrl,
        style_image_data: styleDataUrl,
        prompt: customPrompt,
        width: width,
        height: height,
        comfy_url: comfyUrl
      }) as { success: boolean; style_transfer_id?: string; prompt_id?: string; error?: string };
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to create style transfer');
      }
      
      const editId = response.style_transfer_id;
      if (!editId) {
        throw new Error('Backend did not return a valid style transfer ID');
      }
      // TypeScript assertion: editId is now guaranteed to be a string
      const transferId: string = editId;
      setImageId(editId);
      const promptId = response.prompt_id;
      if (!promptId) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }

      setStatus("Processing in ComfyUI…");

      // Poll for completion
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
            error?: string 
          };
          
          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history');
          }

          const history = historyResponse.history;
          const historyEntry = history?.[promptId];

          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message || 
                            historyEntry.status?.error || 
                            "Unknown error in ComfyUI";
            throw new Error(`ComfyUI error: ${errorMsg}`);
          }

          // Check if completed
          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            // Find the generated image
            const outputs = historyEntry.outputs;
            let imageInfo = null;
            
            // Look for saved images
            for (const nodeId in outputs) {
              const nodeOutputs = outputs[nodeId];
              if (nodeOutputs.images && nodeOutputs.images.length > 0) {
                imageInfo = nodeOutputs.images[0];
                break;
              }
            }

            if (imageInfo) {
              // Construct the image URL
              const imageUrl = imageInfo.subfolder
                ? `${comfyUrl.replace(/\/$/, '')}/api/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
                : `${comfyUrl.replace(/\/$/, '')}/api/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`;

              if (!imageUrl) {
                throw new Error('Failed to construct image URL');
              }

              setStatus("Uploading result to storage...");

              // Complete the style transfer record with Supabase upload (using v3 API)
              const completionResponse = await apiClient.completeStyleTransferV3(
                transferId, 
                imageUrl  // ComfyUI URL - backend will download and upload to Supabase
              ) as { success: boolean; style_transfer: any; error?: string };

              if (completionResponse.success && completionResponse.style_transfer?.result_image_url) {
                // Use the Supabase URL for display
                setResultUrl(completionResponse.style_transfer.result_image_url);
                setStatus("✅ Style transfer completed!");
              } else {
                throw new Error(completionResponse.error || 'Failed to upload result to storage');
              }
              
              setIsSubmitting(false);
              return;
            } else {
              throw new Error("ComfyUI completed but no image was found in outputs");
            }
          }

          // Still processing, wait and try again
          setTimeout(pollForResult, 2000);
          
        } catch (pollError: any) {
          if (pollError.message.includes('ComfyUI error') || pollError.message.includes('timeout')) {
            throw pollError;
          }
          // Network error, retry
          setTimeout(pollForResult, 3000);
        }
      };

      await pollForResult();

    } catch (error: any) {
      console.error('Style Transfer Error:', error);
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
      
      // Mark edit as failed if we have an ID
      if (imageId) {
        try {
          await apiClient.failStyleTransfer(imageId, error.message || 'Unknown error');
        } catch (failError) {
          console.error('Failed to update edit status:', failError);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleDownload = () => {
    if (resultUrl) {
      const link = document.createElement('a');
      link.href = resultUrl;
      link.download = `style-transfer-${Date.now()}.png`;
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
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 bg-clip-text text-transparent">
              Style Transfer
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Transfer artistic styles between images using AI. Upload a subject image and a style reference to create unique artistic combinations.
            </p>
            
          </div>

          {/* Image Upload Section */}
          <Section title="Upload Images">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Subject Image */}
              <Field>
                <Label>Subject Image</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSubjectImage(e.target.files?.[0] || null)}
                  className="w-full p-3 border-2 border-dashed border-purple-300 rounded-2xl bg-purple-50 hover:bg-purple-100 transition-colors cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-purple-500 file:to-pink-600 file:text-white file:font-semibold hover:file:from-purple-600 hover:file:to-pink-700 transition-all duration-200"
                />
                {subjectPreview && (
                  <div className="mt-4 p-4 border-2 border-purple-200 rounded-2xl bg-white">
                    <img
                      ref={subjectImgRef}
                      src={subjectPreview}
                      alt="Subject Preview"
                      className="max-w-full max-h-64 mx-auto rounded-xl shadow-lg"
                    />
                    <p className="text-sm text-gray-500 mt-2 text-center">Subject Image</p>
                  </div>
                )}
              </Field>

              {/* Style Image */}
              <Field>
                <Label>Style Reference Image</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setStyleImage(e.target.files?.[0] || null)}
                  className="w-full p-3 border-2 border-dashed border-pink-300 rounded-2xl bg-pink-50 hover:bg-pink-100 transition-colors cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-pink-500 file:to-indigo-600 file:text-white file:font-semibold hover:file:from-pink-600 hover:file:to-indigo-700 transition-all duration-200"
                />
                {stylePreview && (
                  <div className="mt-4 p-4 border-2 border-pink-200 rounded-2xl bg-white">
                    <img
                      ref={styleImgRef}
                      src={stylePreview}
                      alt="Style Preview"
                      className="max-w-full max-h-64 mx-auto rounded-xl shadow-lg"
                    />
                    <p className="text-sm text-gray-500 mt-2 text-center">Style Reference</p>
                  </div>
                )}
              </Field>
            </div>
          </Section>

          {/* Prompt Section */}
          <Section title="Prompt">
            <Field>
              <Label>Describe the desired output</Label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., A high-quality artistic image with transferred style, masterpiece quality, detailed"
                className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none transition-colors min-h-[120px] resize-vertical"
              />
              <p className="text-xs text-gray-500 mt-2">Describe what you want the final image to look like. This helps guide the style transfer process.</p>
            </Field>
          </Section>

          {/* Resolution Section */}
          <Section title="Output Resolution">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>Width</Label>
                <input
                  type="number"
                  value={widthInput}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none transition-colors"
                  step="32"
                  min="512"
                  max="2048"
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
                  min="512"
                  max="2048"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {height}px (auto-adjusted to multiple of 32)</p>
              </Field>
            </div>
            <p className="text-sm text-gray-600 mt-2">
              💡 Resolution will be adjusted automatically based on your subject image aspect ratio
            </p>
          </Section>

          {/* Generation Section */}
          <Section title="Generate Style Transfer">
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
                    <span>🎨</span>
                    Transfer Style
                  </>
                )}
              </button>
              {imageId && <span className="text-xs text-gray-500">Edit ID: {imageId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {resultUrl && (
              <div className="mt-6 space-y-3">
                <div className="p-4 border-2 border-gray-200 rounded-3xl bg-white">
                  <img src={resultUrl} alt="Style Transfer Result" className="w-full rounded-2xl shadow-lg" />
                </div>
                <div>
                  <button 
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" 
                    onClick={handleDownload}
                  >
                    <span>⬇️</span>
                    Download Result
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - ResizableFeed */}
        <ResizableFeedSidebar
          storageKey="style-transfer"
          config={{
            mediaType: 'all',
            pageContext: 'style-transfer',
            showCompletedOnly: false,
            maxItems: 10,
            showFixButton: true,
            showProgress: true
          }}
        />
      </div>
    </div>
  );
}