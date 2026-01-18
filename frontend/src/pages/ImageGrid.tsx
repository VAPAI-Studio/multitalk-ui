import React, { useState } from "react";
import { Label, Field, Section } from "../components/UI";
import { apiClient } from "../lib/apiClient";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";

const SUBJECT_OPTIONS = [
  { value: "person", label: "Person" },
  { value: "2 person", label: "2 Person" },
  { value: "product", label: "Product" },
  { value: "animal", label: "Animal" },
  { value: "landscape", label: "Landscape" },
  { value: "", label: "Other" }
];

interface Props {
  comfyUrl: string;
}

export default function ImageGrid({ comfyUrl }: Props) {
  // State
  const [inputImage, setInputImage] = useState<File | null>(null);
  const [inputImagePreview, setInputImagePreview] = useState<string>("");
  const [subjectCategory, setSubjectCategory] = useState<string>("person");
  const [status, setStatus] = useState<string>("");
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Image upload handler
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatus("Please select a valid image file");
      return;
    }

    setInputImage(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setInputImagePreview(result);
      setStatus("");
    };
    reader.readAsDataURL(file);
  };

  // Submit handler
  const handleSubmit = async () => {
    if (!inputImage) {
      setStatus("Please upload an image");
      return;
    }

    if (!comfyUrl) {
      setStatus("ComfyUI URL is not configured");
      return;
    }

    setIsSubmitting(true);
    setStatus("Uploading image to ComfyUI...");
    setResultUrls([]);
    setJobId("");

    let databaseJobId: string | null = null;

    try {
      // 1. Upload image to ComfyUI
      const uploadFormData = new FormData();
      uploadFormData.append('image', inputImage);
      const uploadResponse = await fetch(`${comfyUrl}/upload/image`, {
        method: 'POST',
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image to ComfyUI: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      const uploadedFilename = uploadData.name || inputImage.name;

      setStatus("Building workflow...");

      // 2. Build subject prompt prefix
      const subjectPromptPrefix = subjectCategory
        ? `Broad category chosen by user: ${subjectCategory}. `
        : "";

      // 3. Submit workflow using backend template
      const clientId = `image-grid-${Math.random().toString(36).slice(2)}`;

      // Generate random seeds for each generation
      const seed1 = Math.floor(Math.random() * 1000000000000);
      const seed2 = Math.floor(Math.random() * 1000000000000);

      const workflowResponse = await apiClient.submitWorkflow(
        'ImageGrid',
        {
          IMAGE_FILENAME: uploadedFilename,
          SUBJECT_PROMPT_PREFIX: subjectPromptPrefix,
          SEED_1: seed1,
          SEED_2: seed2
        },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!workflowResponse.success || !workflowResponse.prompt_id) {
        throw new Error(workflowResponse.error || 'Failed to submit workflow to ComfyUI');
      }

      const promptId = workflowResponse.prompt_id;
      setJobId(promptId);

      setStatus("Creating job record...");

      // 4. Create image job in database
      const jobCreationResponse = await apiClient.createImageJob({
        comfy_job_id: promptId,
        workflow_name: 'image-grid',
        comfy_url: comfyUrl,
        input_image_urls: [inputImagePreview],
        parameters: {
          subject_category: subjectCategory || 'other'
        }
      }) as any;

      if (!jobCreationResponse.success || !jobCreationResponse.image_job?.id) {
        throw new Error('Failed to create job record in database');
      }

      databaseJobId = jobCreationResponse.image_job.id;

      setStatus("Processing in ComfyUI... This may take a few minutes.");

      // 5. Poll for completion
      const startTime = Date.now();
      const maxWaitTime = 600000; // 10 minutes for grid generation

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          throw new Error('Processing timeout after 10 minutes');
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

            // Extract all 10 images from output nodes
            // Node mapping: 59-67 (images 1-9), 68 (stitched)
            const imageNodes = ['59', '60', '61', '62', '64', '63', '65', '66', '67', '68'];
            const allImageUrls: string[] = [];

            for (const nodeId of imageNodes) {
              const nodeOutputs = outputs[nodeId];
              if (nodeOutputs?.images && nodeOutputs.images.length > 0) {
                const imageInfo = nodeOutputs.images[0];
                const comfyImageUrl = imageInfo.subfolder
                  ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
                  : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`;
                allImageUrls.push(comfyImageUrl);
              }
            }

            if (allImageUrls.length === 0) {
              throw new Error('No images found in ComfyUI output');
            }

            setStatus(`Found ${allImageUrls.length} images. Saving to storage...`);

            // Reorder to put stitched image first (for feed preview)
            // Current order: [1-9, stitched] -> [stitched, 1-9]
            const reorderedUrls = allImageUrls.length === 10
              ? [allImageUrls[9], ...allImageUrls.slice(0, 9)]
              : allImageUrls;

            // 6. Complete job with all URLs
            if (!databaseJobId) {
              throw new Error('Database job ID is missing');
            }

            const completionResult = await apiClient.completeImageJob(databaseJobId, {
              job_id: databaseJobId,
              status: 'completed',
              output_image_urls: reorderedUrls
            }) as any;

            if (!completionResult.success || !completionResult.image_job?.output_image_urls) {
              throw new Error('Failed to save images to storage');
            }

            const storedUrls = completionResult.image_job.output_image_urls;
            setResultUrls(storedUrls);
            setStatus(`Grid generation completed! ${storedUrls.length} images saved.`);
            setIsSubmitting(false);
            return;
          }

          // Still processing, poll again
          const elapsedSeconds = Math.floor(elapsed / 1000);
          setStatus(`Processing in ComfyUI... (${elapsedSeconds}s)`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          return pollForResult();

        } catch (pollError: any) {
          if (pollError.message.includes('timeout') || pollError.message.includes('save images')) {
            throw pollError;
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
          return pollForResult();
        }
      };

      await pollForResult();

    } catch (err: any) {
      setStatus(`Error: ${err.message || "Unknown error"}`);
      if (databaseJobId) {
        await apiClient.completeImageJob(databaseJobId, {
          job_id: databaseJobId,
          status: 'error',
          error_message: err.message || 'Unknown error'
        }).catch(() => {});
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadAll = () => {
    resultUrls.forEach((url, index) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = index === 0 ? `grid-stitched.png` : `grid-image-${index}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 bg-clip-text text-transparent">
              Image Grid
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-teal-100 to-cyan-100 px-4 py-2 rounded-full border border-teal-200/50">
                AI-Powered Grid Generation
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Upload a reference image and generate a 3×3 grid of unique variations with different angles and perspectives.
            </p>
          </div>

          {/* Input Section */}
          <Section title="Input Image">
            <Field>
              <Label>Upload Reference Image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-teal-500 file:to-cyan-600 file:text-white file:font-semibold hover:file:from-teal-600 hover:file:to-cyan-700 transition-all duration-200 bg-gray-50/50"
              />
              {inputImagePreview && (
                <div className="mt-4">
                  <img
                    src={inputImagePreview}
                    alt="Input preview"
                    className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-teal-200"
                  />
                  <p className="text-sm text-teal-600 text-center mt-2">Reference image loaded</p>
                </div>
              )}
            </Field>
          </Section>

          {/* Subject Selection */}
          <Section title="Subject Category">
            <Field>
              <Label>Select Subject Type</Label>
              <select
                value={subjectCategory}
                onChange={(e) => setSubjectCategory(e.target.value)}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all duration-200 bg-white/80"
              >
                {SUBJECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                This helps the AI understand the context for generating appropriate variations.
                Select "Other" to let the AI decide based on the image.
              </p>
            </Field>
          </Section>

          {/* Generate Section */}
          <Section title="Generate">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-bold text-lg shadow-lg hover:from-teal-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={handleSubmit}
                disabled={isSubmitting || !inputImage}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>🖼️</span>
                    Generate Grid
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
            </div>
            {status && (
              <div className={`mt-4 p-4 rounded-xl ${
                status.includes('Error')
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : status.includes('completed')
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-blue-50 border border-blue-200 text-blue-700'
              }`}>
                {status}
              </div>
            )}
          </Section>

          {/* Results Section */}
          {resultUrls.length > 0 && (
            <Section title="Generated Images">
              <div className="space-y-6">
                {/* Download All Button */}
                <div className="flex justify-end">
                  <button
                    onClick={handleDownloadAll}
                    className="px-4 py-2 rounded-xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                  >
                    <span>⬇️</span>
                    Download All ({resultUrls.length})
                  </button>
                </div>

                {/* Stitched Full Grid */}
                {resultUrls.length >= 1 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                      <span>🎨</span>
                      Full Grid
                    </h3>
                    <div className="relative group">
                      <img
                        src={resultUrls[0]}
                        alt="Full stitched grid"
                        className="w-full rounded-xl shadow-lg border border-gray-200"
                      />
                      <button
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = resultUrls[0];
                          a.download = "grid-stitched.png";
                          a.click();
                        }}
                        className="absolute top-2 right-2 px-3 py-2 rounded-lg bg-black/70 text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1"
                      >
                        <span>⬇️</span>
                        Download
                      </button>
                    </div>
                  </div>
                )}

                {/* Individual Images 3×3 Grid */}
                {resultUrls.length > 1 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                      <span>📷</span>
                      Individual Images
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      {resultUrls.slice(1, 10).map((url, index) => (
                        <div key={index} className="aspect-square relative group">
                          <img
                            src={url}
                            alt={`Grid image ${index + 1}`}
                            className="w-full h-full object-cover rounded-lg shadow-md border border-gray-200"
                          />
                          <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
                            {index + 1}
                          </div>
                          <button
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `grid-image-${index + 1}.png`;
                              a.click();
                            }}
                            className="absolute top-1 right-1 w-8 h-8 rounded-lg bg-black/70 text-white text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          >
                            ⬇️
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}
        </div>

        {/* Right Sidebar - Resizable Feed */}
        <ResizableFeedSidebar
          storageKey="image-grid"
          config={{
            mediaType: 'all',
            pageContext: 'image-grid',
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
