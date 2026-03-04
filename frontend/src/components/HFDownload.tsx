import { useState, useEffect, useRef } from "react";
import { apiClient } from "../lib/apiClient";

interface HFJob {
  job_id: string;
  status: "pending" | "downloading" | "uploading" | "done" | "error";
  progress_pct: number;
  bytes_done: number;
  total_bytes: number | null;
  filename: string;
  s3_key: string;
  error: string | null;
}

interface Props {
  targetPath: string;     // Current directory in the file browser (pre-fills target)
  onComplete: () => void; // Called when download finishes — triggers file tree refresh
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getStatusLabel(job: HFJob): string {
  switch (job.status) {
    case "pending":
      return "Preparing download...";
    case "downloading":
      return `Downloading from HuggingFace... ${job.progress_pct.toFixed(1)}%`;
    case "uploading":
      return `Uploading to volume... ${job.progress_pct.toFixed(1)}%`;
    case "done":
      return `Download complete! Saved to: ${job.s3_key}`;
    case "error":
      return `Error: ${job.error}`;
    default:
      return "Unknown status";
  }
}

export function HFDownload({ targetPath, onComplete }: Props) {
  const [url, setUrl] = useState("");
  const [hfToken, setHfToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [targetDir, setTargetDir] = useState(targetPath || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<HFJob | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync targetDir with current path from file browser
  useEffect(() => {
    setTargetDir(targetPath || "");
  }, [targetPath]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  function validateUrlClientSide(inputUrl: string): string | null {
    if (!inputUrl.trim()) return "Please enter a HuggingFace URL.";
    if (!inputUrl.startsWith("https://huggingface.co/")) {
      return "URL must start with https://huggingface.co/";
    }
    if (!inputUrl.includes("/blob/") && !inputUrl.includes("/resolve/")) {
      return "URL must point to a specific file (include /blob/ or /resolve/ in the URL).";
    }
    return null;
  }

  function startPolling(jobId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const job = await apiClient.getHFDownloadStatus(jobId);
        setActiveJob(job);

        if (job.status === "done") {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setIsSubmitting(false);
          onComplete(); // Refresh the file tree
        } else if (job.status === "error") {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setIsSubmitting(false);
        }
      } catch {
        // 404 = job expired (server restart); stop polling
        clearInterval(pollIntervalRef.current!);
        pollIntervalRef.current = null;
        setIsSubmitting(false);
        setError("Job status lost (server may have restarted). Please try again.");
      }
    }, 3000); // Poll every 3 seconds
  }

  async function handleSubmit() {
    setError(null);

    const clientError = validateUrlClientSide(url);
    if (clientError) {
      setError(clientError);
      return;
    }

    setIsSubmitting(true);
    setActiveJob(null);

    try {
      const result = await apiClient.startHFDownload(
        url.trim(),
        targetDir.trim(),
        hfToken.trim() || undefined
      );

      // Create initial job state for immediate UI feedback
      setActiveJob({
        job_id: result.job_id,
        status: "pending",
        progress_pct: 0,
        bytes_done: 0,
        total_bytes: null,
        filename: result.filename,
        s3_key: result.s3_key,
        error: null,
      });

      startPolling(result.job_id);
    } catch (err: unknown) {
      setIsSubmitting(false);
      // Extract backend error message from API error
      const msg = (err instanceof Error ? err.message : null) || "Failed to start download";
      // FastAPI 400 errors have detail in the message
      setError(msg.replace("API request failed: 400 Bad Request", "").trim() || msg);
    }
  }

  const isActive = activeJob && (activeJob.status === "pending" || activeJob.status === "downloading" || activeJob.status === "uploading");

  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <span>HF</span>
        HuggingFace Download
      </h2>
      <p className="text-sm text-gray-500 mb-5">
        Download a model directly from HuggingFace to the RunPod network volume.
        Paste a file URL (not a repo root URL).
      </p>

      <div className="space-y-4">
        {/* HuggingFace URL input */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            HuggingFace File URL
          </label>
          <input
            type="url"
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80"
            placeholder="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/sd_xl_base_1.0.safetensors"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {/* Target directory */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            Target Directory on Volume
          </label>
          <input
            type="text"
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80"
            placeholder="models/checkpoints"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            disabled={isSubmitting}
          />
          <p className="text-xs text-gray-400 mt-1">
            Current browser path pre-filled. Edit to change destination.
          </p>
        </div>

        {/* HuggingFace token (collapsible) */}
        <div>
          <button
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            onClick={() => setShowToken(!showToken)}
          >
            <span>{showToken ? "v" : ">"}</span>
            HuggingFace Token (for gated models)
          </button>
          {showToken && (
            <div className="mt-2">
              <input
                type="password"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80"
                placeholder="hf_..."
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                disabled={isSubmitting}
              />
              <p className="text-xs text-gray-400 mt-1">
                Required for gated models (e.g. Llama, Gemma). Token is sent to backend only — never stored.
              </p>
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          className="px-8 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-2"
          onClick={handleSubmit}
          disabled={isSubmitting || !url.trim()}
        >
          {isSubmitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Downloading...
            </>
          ) : (
            <>
              <span>v</span>
              Download to Volume
            </>
          )}
        </button>

        {/* Error display */}
        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Active job progress */}
        {activeJob && (
          <div className="rounded-2xl border border-blue-200/60 bg-blue-50/50 px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">
                {activeJob.filename}
              </span>
              {activeJob.status === "done" && (
                <span className="text-green-600 text-sm font-bold">Done</span>
              )}
              {activeJob.status === "error" && (
                <span className="text-red-600 text-sm font-bold">Failed</span>
              )}
            </div>

            {/* Progress bar — shown during active phases */}
            {isActive && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${activeJob.progress_pct}%` }}
                />
              </div>
            )}

            {/* Status label */}
            <p className={`text-sm ${activeJob.status === "error" ? "text-red-600" : activeJob.status === "done" ? "text-green-700" : "text-gray-600"}`}>
              {getStatusLabel(activeJob)}
            </p>

            {/* Byte counter */}
            {isActive && activeJob.total_bytes && (
              <p className="text-xs text-gray-400">
                {formatBytes(activeJob.bytes_done)} / {formatBytes(activeJob.total_bytes)}
              </p>
            )}

            {/* Size warning for large files */}
            {activeJob.status === "pending" && (
              <p className="text-xs text-amber-600">
                Note: Files larger than ~400MB may exceed Heroku disk limits. For large models, deploy the backend with adequate ephemeral storage.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
