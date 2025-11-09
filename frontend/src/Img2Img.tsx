import React, { useEffect, useState } from "react";
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
import { startJobMonitoring } from "./components/utils";
import UnifiedFeed from "./components/UnifiedFeed";
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

interface Props {
  comfyUrl: string;
}

export default function Img2Img({ comfyUrl }: Props) {
  const [inputImage, setInputImage] = useState<File | null>(null);
  const [prompt, setPrompt] = useState<string>("photograph of victorian woman with wings, sky clouds, meadow grass");

  // Job tracking state
  const [status, setStatus] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  async function submit() {
    setStatus("");
    setResultUrl("");
    setJobId("");

    // Validation
    if (!comfyUrl) {
      setStatus("Please enter a ComfyUI URL.");
      return;
    }
    if (!inputImage) {
      setStatus("Please upload an image.");
      return;
    }
    if (!prompt.trim()) {
      setStatus("Please enter a prompt.");
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload image to ComfyUI via backend
      setStatus("Uploading image...");
      console.log('Uploading image:', inputImage.name, 'to ComfyUI:', comfyUrl);

      const uploadResponse = await apiClient.uploadImageToComfyUI(comfyUrl, inputImage);
      console.log('Upload response:', uploadResponse);

      if (!uploadResponse.success) {
        throw new Error(uploadResponse.error || 'Failed to upload image');
      }

      const imageFilename = uploadResponse.filename;
      console.log('Image uploaded successfully:', imageFilename);

      // Submit workflow
      setStatus("Sending workflow to ComfyUI...");
      const clientId = `img2img-ui-${Math.random().toString(36).slice(2)}`;

      const response = await apiClient.submitWorkflow(
        'img2img',
        {
          IMAGE_FILENAME: imageFilename,
          PROMPT: prompt
        },
        comfyUrl,
        clientId
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit workflow to ComfyUI');
      }

      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      // Create job record
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        image_filename: inputImage.name,
        audio_filename: undefined,
        width: 512,  // Default width for img2img
        height: 512, // Default height for img2img
        trim_to_audio: false
      });

      await updateJobToProcessing(id);

      // Start monitoring
      setStatus("Processing in ComfyUI…");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, outputInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI…');
          } else if (jobStatus === 'completed' && outputInfo) {
            // Construct result URL from output info
            const filename = outputInfo.filename;
            const subfolder = outputInfo.subfolder || '';
            const type = outputInfo.type || 'output';

            let url = `${comfyUrl}/view?filename=${encodeURIComponent(filename)}`;
            if (subfolder) {
              url += `&subfolder=${encodeURIComponent(subfolder)}`;
            }
            url += `&type=${type}`;

            setResultUrl(url);
            setStatus("✅ Image generation completed!");
            setIsSubmitting(false);

            // Complete job in database
            await completeJob({
              job_id: id,
              status: 'completed',
              result_url: url
            }).catch(() => { });
          } else if (jobStatus === 'error') {
            setStatus(`❌ ${message}`);
            setIsSubmitting(false);

            await completeJob({
              job_id: id,
              status: 'error',
              error_message: message || 'Unknown error'
            }).catch(() => { });
          }
        }
      );

      setJobMonitorCleanup(() => cleanup);

    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
      if (jobId) {
        await completeJob({
          job_id: jobId,
          status: 'error',
          error_message: error.message || 'Unknown error'
        }).catch(() => { });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 bg-clip-text text-transparent">
              Image to Image
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Transform your images with AI-powered modifications. Upload an image and describe the changes you want.
            </p>
          </div>

          {/* Input Section */}
          <Section title="Upload Image">
            <Field>
              <Label>Source Image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setInputImage(e.target.files?.[0] || null)}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-purple-500 file:to-pink-600 file:text-white file:font-semibold hover:file:from-purple-600 hover:file:to-pink-700 transition-all duration-200 bg-gray-50/50"
              />
              {inputImage && (
                <p className="text-xs text-gray-500 mt-2">Selected: {inputImage.name}</p>
              )}
            </Field>
          </Section>

          {/* Prompt Section */}
          <Section title="Describe Changes">
            <Field>
              <Label>Prompt</Label>
              <textarea
                rows={4}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe how you want to transform the image..."
              />
              <p className="text-xs text-gray-500 mt-2">
                Example: "photograph of victorian woman with wings, sky clouds, meadow grass"
              </p>
            </Field>
          </Section>

          {/* Generation Section */}
          <Section title="Generate">
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
                    <span>✨</span>
                    Transform Image
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {/* Result Display */}
            {resultUrl && (
              <div className="mt-6 space-y-3">
                <img src={resultUrl} alt="Result" className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <div>
                  <button
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = resultUrl;
                      a.download = "img2img-result.png";
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
        </div>

        {/* Right Sidebar - UnifiedFeed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <UnifiedFeed
              comfyUrl={comfyUrl}
              config={{
                type: 'image',
                title: 'Image to Image',
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                pageContext: 'img2img'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
