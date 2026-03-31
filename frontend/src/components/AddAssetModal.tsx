import React, { useState } from "react";
import { apiClient } from "../lib/apiClient";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAssetGenerated: (assetUrl: string) => void;
  comfyUrl: string;
}

export default function AddAssetModal({ isOpen, onClose, onAssetGenerated, comfyUrl }: Props) {
  const [imageFront, setImageFront] = useState<File | null>(null);
  const [imageBack, setImageBack] = useState<File | null>(null);
  const [assetName, setAssetName] = useState<string>("3D Object");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);

  if (!isOpen) return null;

  // Convert file to base64 data URL
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Poll ComfyUI history to check if job is done
  const pollComfyUIHistory = async (promptId: string): Promise<any> => {
    const maxAttempts = 120; // 10 minutes max (5s interval)
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      try {
        const historyResponse = await fetch(`${comfyUrl}/history/${promptId}`);
        if (!historyResponse.ok) continue;

        const historyData = await historyResponse.json();
        const jobData = historyData[promptId];

        if (!jobData) continue;

        // Update progress
        const progressPercent = Math.min(95, (attempt / maxAttempts) * 100);
        setProgress(progressPercent);

        // Check if outputs exist
        if (jobData.outputs && Object.keys(jobData.outputs).length > 0) {
          return jobData;
        }

        // Check status
        const status = jobData.status?.status_str || "";
        if (status === "error") {
          throw new Error("ComfyUI processing failed");
        }

        setStatus(`Processing... (${Math.round(progressPercent)}%)`);
      } catch (error) {
        console.error("Polling error:", error);
      }
    }

    throw new Error("Timeout waiting for 3D model generation");
  };

  // Extract GLB info from ComfyUI history
  const extractGLBFromHistory = (historyData: any): { filename: string; subfolder: string } | null => {
    try {
      // Based on the workflow, node "43" contains the GLB output
      const outputs = historyData.outputs;
      if (!outputs || !outputs["43"]) {
        console.error("No outputs found in node 43");
        return null;
      }

      const node43 = outputs["43"];
      if (!node43["3d"] || node43["3d"].length === 0) {
        console.error("No 3d output found in node 43");
        return null;
      }

      const glbInfo = node43["3d"][0];
      return {
        filename: glbInfo.filename,
        subfolder: glbInfo.subfolder || "3d",
      };
    } catch (error) {
      console.error("Error extracting GLB from history:", error);
      return null;
    }
  };

  // Upload GLB from ComfyUI to Supabase
  const uploadGLBToSupabase = async (filename: string, subfolder: string, jobId: string): Promise<string> => {
    const data: any = await apiClient.request("/virtual-set/upload-glb", {
      method: "POST",
      body: JSON.stringify({
        comfy_url: comfyUrl,
        filename,
        subfolder,
        job_id: jobId,
      }),
    });

    if (!data.success || !data.glb_url) {
      throw new Error(data.error || "Failed to get GLB URL");
    }

    return data.glb_url;
  };

  const handleGenerate = async () => {
    if (!imageFront) {
      setStatus("❌ Please upload at least a front image");
      return;
    }

    if (!comfyUrl) {
      setStatus("❌ ComfyUI URL is not configured");
      return;
    }

    setIsGenerating(true);
    setStatus("Preparing images...");
    setProgress(5);

    try {
      // Convert images to data URLs
      const frontDataUrl = await fileToDataUrl(imageFront);
      const backDataUrl = imageBack ? await fileToDataUrl(imageBack) : null;

      setStatus("Submitting to ComfyUI...");
      setProgress(10);

      // Call backend endpoint using apiClient
      const data: any = await apiClient.request("/virtual-set/generate-asset", {
        method: "POST",
        body: JSON.stringify({
          image_front: frontDataUrl,
          image_back: backDataUrl,
          asset_name: assetName,
          comfy_url: comfyUrl,
          client_id: `asset-modal-${Date.now()}`,
        }),
      });

      if (!data.success || !data.prompt_id) {
        throw new Error(data.error || "Failed to submit to ComfyUI");
      }

      const promptId = data.prompt_id;
      const jobId = data.job_id || promptId;

      setStatus("Generating 3D model...");
      setProgress(15);

      // Poll ComfyUI until complete
      const historyData = await pollComfyUIHistory(promptId);

      setStatus("Downloading 3D model...");
      setProgress(95);

      // Extract GLB info
      const glbInfo = extractGLBFromHistory(historyData);
      if (!glbInfo) {
        throw new Error("Failed to extract GLB file information from ComfyUI");
      }

      // Upload GLB to Supabase
      const glbUrl = await uploadGLBToSupabase(glbInfo.filename, glbInfo.subfolder, jobId);

      setStatus("✅ 3D model generated successfully!");
      setProgress(100);

      // Wait a moment to show success
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Pass the GLB URL to parent component
      onAssetGenerated(glbUrl);

      // Reset and close
      setImageFront(null);
      setImageBack(null);
      setAssetName("3D Object");
      setStatus("");
      setProgress(0);
      setIsGenerating(false);
      onClose();
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message}`);
      setProgress(0);
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-3xl">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Add 3D Object</h2>
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors disabled:opacity-50"
            >
              ✕
            </button>
          </div>
          <p className="text-blue-100 mt-2">Generate a 3D model from one or two images using Tripo AI</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Asset Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Object Name
            </label>
            <input
              type="text"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200"
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
              placeholder="e.g., Character, Building, Vehicle..."
              disabled={isGenerating}
            />
          </div>

          {/* Front Image */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Front View Image <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFront(e.target.files?.[0] || null)}
              className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50 disabled:opacity-50"
              disabled={isGenerating}
            />
            {imageFront && (
              <p className="text-sm text-gray-600 mt-2">✓ {imageFront.name}</p>
            )}
          </div>

          {/* Back Image (Optional) */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">
              Back View Image <span className="text-gray-400">(Optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageBack(e.target.files?.[0] || null)}
              className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50 disabled:opacity-50"
              disabled={isGenerating}
            />
            {imageBack && (
              <p className="text-sm text-gray-600 mt-2">✓ {imageBack.name}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              If not provided, the front image will be used for both views
            </p>
          </div>

          {/* Progress */}
          {isGenerating && (
            <div className="space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-600 h-full transition-all duration-500 rounded-full"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              {status && (
                <p className="text-sm text-gray-600 text-center">{status}</p>
              )}
            </div>
          )}

          {/* Status Message (when not generating) */}
          {!isGenerating && status && (
            <p className="text-sm text-gray-700 text-center p-3 bg-gray-100 rounded-xl">
              {status}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={isGenerating}
              className="flex-1 px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!imageFront || isGenerating}
              className="flex-1 px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Generating...
                </>
              ) : (
                <>
                  <span>✨</span>
                  Generate 3D Model
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
