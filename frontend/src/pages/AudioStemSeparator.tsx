import { useEffect, useState } from "react";
import JSZip from "jszip";
import { apiClient } from "../lib/apiClient";
import { createJob, updateJobToProcessing, completeJob } from "../lib/jobTracking";
import { uploadMediaToComfy, checkComfyUIHealth } from "../components/utils";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
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
        <div className="w-2 h-8 bg-gradient-to-b from-green-500 to-emerald-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

interface Props {
  comfyUrl: string;
}

interface AudioStems {
  drums?: string;
  vocals?: string;
  bass?: string;
  instruments?: string;
}

export default function AudioStemSeparator({ comfyUrl }: Props) {
  const { selectedProject } = useProject();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string>("");
  const [originalFilename, setOriginalFilename] = useState<string>("");

  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string>("");
  const [stems, setStems] = useState<AudioStems>({});

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioPreview) {
        URL.revokeObjectURL(audioPreview);
      }
    };
  }, [audioPreview]);

  // Handle audio file upload
  useEffect(() => {
    if (!audioFile) {
      setAudioPreview("");
      setOriginalFilename("");
      return;
    }

    const url = URL.createObjectURL(audioFile);
    setAudioPreview(url);

    // Extract filename without extension
    const name = audioFile.name.replace(/\.[^/.]+$/, "");
    setOriginalFilename(name);

    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Find audio outputs from ComfyUI history
  function findAudioStemsFromHistory(historyJson: any, promptId: string): AudioStems | null {
    if (!historyJson) return null;

    const historyEntry = historyJson[promptId];
    if (!historyEntry?.outputs) return null;

    const outputs = historyEntry.outputs;
    const stems: AudioStems = {};

    // Node mapping from workflow:
    // Node 5 = Drums (output index 1)
    // Node 6 = Vocals (output index 2)
    // Node 7 = Bass (output index 3)
    // Node 8 = Instruments (output index 4)
    const nodeMapping: Record<string, keyof AudioStems> = {
      "5": "drums",
      "6": "vocals",
      "7": "bass",
      "8": "instruments"
    };

    for (const nodeId of Object.keys(nodeMapping)) {
      const nodeOutput = outputs[nodeId];
      if (nodeOutput?.audio && Array.isArray(nodeOutput.audio) && nodeOutput.audio.length > 0) {
        const audioInfo = nodeOutput.audio[0];
        if (audioInfo?.filename) {
          const stemType = nodeMapping[nodeId];
          const subfolder = audioInfo.subfolder || "";
          const type = audioInfo.type || "output";
          stems[stemType] = `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(audioInfo.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
        }
      }
    }

    return Object.keys(stems).length > 0 ? stems : null;
  }

  async function submit() {
    setStatus("");
    setStems({});
    setJobId("");

    if (!comfyUrl) {
      setStatus("Please enter a ComfyUI URL in the header.");
      return;
    }
    if (!audioFile) {
      setStatus("Please upload an audio file.");
      return;
    }

    setIsSubmitting(true);
    let currentJobId = "";

    try {
      // Health check
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      // Upload audio to ComfyUI
      setStatus("Uploading audio to ComfyUI...");
      const audioFilename = await uploadMediaToComfy(comfyUrl, audioFile);

      // Submit workflow
      setStatus("Sending workflow to ComfyUI...");
      const clientId = `audio-stem-separator-${Math.random().toString(36).slice(2)}`;

      const response = await apiClient.submitWorkflow(
        'AudioStemSeparator',
        { AUDIO_FILENAME: audioFilename },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit workflow to ComfyUI');
      }

      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }

      currentJobId = id;
      setJobId(id);

      // Create job record
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        audio_filename: audioFile.name,
        width: 0,
        height: 0,
        trim_to_audio: false,
        project_id: selectedProject?.id
      });

      await updateJobToProcessing(id);

      // Poll for completion
      setStatus("Processing audio... This may take a few minutes.");

      const startTime = Date.now();
      const maxWaitTime = 600000; // 10 minutes

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          throw new Error('Processing timeout after 10 minutes');
        }

        try {
          const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, currentJobId) as {
            success: boolean;
            history?: any;
            error?: string
          };

          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history');
          }

          const history = historyResponse.history;
          const historyEntry = history?.[currentJobId];

          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message ||
                            historyEntry.status?.error ||
                            "Unknown error in ComfyUI";
            throw new Error(`ComfyUI error: ${errorMsg}`);
          }

          // Check if completed
          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            const foundStems = findAudioStemsFromHistory(history, currentJobId);

            if (foundStems && Object.keys(foundStems).length > 0) {
              setStems(foundStems);
              setStatus("Audio separation completed!");

              await completeJob({
                job_id: currentJobId,
                status: 'completed'
              });

              setIsSubmitting(false);
              return;
            } else {
              throw new Error("ComfyUI completed but no audio stems were found in outputs");
            }
          }

          // Still processing, wait and try again
          setTimeout(pollForResult, 3000);

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
      console.error('Audio Stem Separator Error:', error);
      setStatus(`Error: ${error.message || 'Unknown error'}`);

      if (currentJobId) {
        await completeJob({
          job_id: currentJobId,
          status: 'error',
          error_message: error.message || 'Unknown error'
        }).catch(() => {});
      }
      setIsSubmitting(false);
    }
  }

  // Download individual stem
  const downloadStem = async (stemType: keyof AudioStems, url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${originalFilename}_${stemType}.flac`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error(`Error downloading ${stemType}:`, error);
      setStatus(`Error downloading ${stemType}`);
    }
  };

  // Download all stems as separate files
  const downloadAllSeparate = async () => {
    setStatus("Downloading all stems...");

    for (const [stemType, url] of Object.entries(stems)) {
      if (url) {
        await downloadStem(stemType as keyof AudioStems, url);
        await new Promise(r => setTimeout(r, 500)); // Small delay between downloads
      }
    }

    setStatus("All stems downloaded!");
  };

  // Download all stems as ZIP
  const downloadAllZip = async () => {
    setStatus("Creating ZIP file...");

    try {
      const zip = new JSZip();

      for (const [stemType, url] of Object.entries(stems)) {
        if (url) {
          const response = await fetch(url);
          const blob = await response.blob();
          zip.file(`${originalFilename}_${stemType}.flac`, blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${originalFilename}_stems.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatus("ZIP downloaded!");
    } catch (error) {
      console.error("Error creating ZIP:", error);
      setStatus("Error creating ZIP file");
    }
  };

  const stemLabels: Record<keyof AudioStems, { label: string; icon: string; color: string }> = {
    vocals: { label: "Vocals", icon: "🎤", color: "from-pink-500 to-rose-600" },
    drums: { label: "Drums", icon: "🥁", color: "from-orange-500 to-amber-600" },
    bass: { label: "Bass", icon: "🎸", color: "from-purple-500 to-indigo-600" },
    instruments: { label: "Other Instruments", icon: "🎹", color: "from-blue-500 to-cyan-600" }
  };

  const hasStems = Object.keys(stems).length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Audio Stem Separator
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Separate any audio track into individual stems: vocals, drums, bass, and other instruments using AI-powered audio separation.
            </p>
          </div>

          {/* Upload Section */}
          <Section title="Upload Audio">
            <Field>
              <Label>Audio File</Label>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                className="w-full p-3 border-2 border-dashed border-green-300 rounded-2xl bg-green-50 hover:bg-green-100 transition-colors cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-emerald-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-emerald-700"
              />
              {audioPreview && (
                <div className="mt-4 p-4 border-2 border-green-200 rounded-2xl bg-white">
                  <audio
                    src={audioPreview}
                    controls
                    className="w-full"
                  />
                  <p className="text-sm text-gray-500 mt-2 text-center">Original: {audioFile?.name}</p>
                </div>
              )}
            </Field>
          </Section>

          {/* Process Section */}
          <Section title="Separate Stems">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting || !audioFile}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <span>🎵</span>
                    Separate Audio
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
            </div>
            {status && (
              <p className={`mt-4 text-sm ${status.includes('Error') ? 'text-red-600' : status.includes('completed') || status.includes('downloaded') ? 'text-green-600' : 'text-gray-600'}`}>
                {status}
              </p>
            )}
          </Section>

          {/* Results Section */}
          {hasStems && (
            <Section title="Separated Stems">
              <div className="space-y-6">
                {/* Individual stems */}
                <div className="grid gap-4">
                  {(["vocals", "drums", "bass", "instruments"] as const).map((stemType) => {
                    const url = stems[stemType];
                    if (!url) return null;

                    const { label, icon, color } = stemLabels[stemType];

                    return (
                      <div key={stemType} className="p-4 border-2 border-gray-200 rounded-2xl bg-white">
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-r ${color} flex items-center justify-center text-xl`}>
                            {icon}
                          </div>
                          <h3 className="font-bold text-gray-900">{label}</h3>
                          <button
                            onClick={() => downloadStem(stemType, url)}
                            className="ml-auto px-4 py-2 rounded-xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium text-sm flex items-center gap-2 transition-colors"
                          >
                            <span>⬇️</span>
                            Download
                          </button>
                        </div>
                        <audio src={url} controls className="w-full" />
                      </div>
                    );
                  })}
                </div>

                {/* Download all buttons */}
                <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
                  <button
                    onClick={downloadAllSeparate}
                    className="px-6 py-3 rounded-2xl border-2 border-green-300 bg-green-50 hover:bg-green-100 text-green-700 font-semibold flex items-center gap-2 transition-colors"
                  >
                    <span>⬇️</span>
                    Download All (Separate Files)
                  </button>
                  <button
                    onClick={downloadAllZip}
                    className="px-6 py-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold flex items-center gap-2 transition-colors"
                  >
                    <span>📦</span>
                    Download All (ZIP)
                  </button>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Right Sidebar - Feed */}
        <ResizableFeedSidebar
          storageKey="audio-stem-separator"
          config={{
            mediaType: 'all',
            pageContext: 'audio-stem-separator',
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
