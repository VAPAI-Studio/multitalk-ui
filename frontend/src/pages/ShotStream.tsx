import { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { useSmartResolution } from "../hooks/useSmartResolution";

// --- UI primitives (same style as other pages) ---------------------------------
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={className || "block text-sm font-semibold text-gray-800 dark:text-dark-text-primary mb-2"}>
      {children}
    </label>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 dark:border-dark-border-primary p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 dark:from-dark-surface-primary dark:to-dark-surface-primary backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-dark-text-primary mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-indigo-500 to-pink-500 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

// --- Types ---------------------------------------------------------------------
interface Shot {
  prompt: string;
  duration_sec: number;
}

interface HealthInfo {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  service_url?: string | null;
  device?: string | null;
  error?: string | null;
}

// --- Constants -----------------------------------------------------------------
const DEFAULT_SHOTS: Shot[] = [
  { prompt: "a lone traveler walks across a windswept dune at golden hour", duration_sec: 3 },
  { prompt: "the camera pans to reveal ancient stone ruins half-buried in sand", duration_sec: 3 },
];
const POLL_INTERVAL_MS = 2000;
const MAX_SHOTS = 8;

// --- Page ----------------------------------------------------------------------
// NOTE: ShotStream runs as a local daemon (not ComfyUI), so this page does NOT
// use `comfyUrl`. Keeping the prop signature consistent with StudioPage's
// generic component mapping — the prop is simply ignored.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ShotStream(_: { comfyUrl: string }) {
  const [shots, setShots] = useState<Shot[]>(DEFAULT_SHOTS);
  const [seed, setSeed] = useState<string>("");
  const [fps, setFps] = useState<number>(16);
  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
  } = useSmartResolution(480, 832);

  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  const pollRef = useRef<number | null>(null);

  // --- health check on mount ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getShotStreamHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch((e) => {
        if (!cancelled) {
          setHealth({
            enabled: false,
            configured: false,
            reachable: false,
            error: e instanceof Error ? e.message : "Health check failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- stop polling on unmount -------------------------------------------------
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // --- shot list helpers -------------------------------------------------------
  const addShot = () =>
    setShots((s) => (s.length >= MAX_SHOTS ? s : [...s, { prompt: "", duration_sec: 3 }]));

  const removeShot = (idx: number) =>
    setShots((s) => (s.length <= 1 ? s : s.filter((_, i) => i !== idx)));

  const updateShot = (idx: number, patch: Partial<Shot>) =>
    setShots((s) => s.map((shot, i) => (i === idx ? { ...shot, ...patch } : shot)));

  // --- polling -----------------------------------------------------------------
  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await apiClient.getShotStreamStatus(id);
        if (typeof res.progress === "number") setProgress(res.progress);

        if (res.status === "running") {
          setStatus(
            res.progress != null
              ? `Generating… ${(res.progress * 100).toFixed(0)}%`
              : "Generating…"
          );
        } else if (res.status === "queued") {
          setStatus("Queued on local GPU…");
        } else if (res.status === "completed") {
          stopPolling();
          setProgress(1);
          setStatus("✅ Generation completed");
          setIsSubmitting(false);
          if (res.output_url) setVideoUrl(res.output_url);
        } else if (res.status === "failed") {
          stopPolling();
          setStatus(`❌ ${res.error || "Generation failed"}`);
          setIsSubmitting(false);
        } else if (res.status === "cancelled") {
          stopPolling();
          setStatus("Cancelled");
          setIsSubmitting(false);
        }
      } catch (e: unknown) {
        // Transient error; keep polling but surface last message.
        const msg = e instanceof Error ? e.message : "Status check failed";
        setStatus(`⚠️ ${msg}`);
      }
    }, POLL_INTERVAL_MS);
  }

  // --- submit ------------------------------------------------------------------
  async function submit() {
    setStatus("");
    setVideoUrl("");
    setJobId("");
    setProgress(null);

    if (!health?.enabled) {
      setStatus("❌ ShotStream is disabled. Set ENABLE_SHOTSTREAM=true on the backend.");
      return;
    }
    if (!health.reachable) {
      setStatus(`❌ Local ShotStream daemon unreachable${health.error ? `: ${health.error}` : ""}`);
      return;
    }
    if (shots.some((s) => !s.prompt.trim())) {
      setStatus("❌ All shots must have a prompt.");
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedSeed = seed.trim() === "" ? null : Number(seed);
      if (parsedSeed !== null && !Number.isFinite(parsedSeed)) {
        throw new Error("Seed must be a number or empty");
      }

      const res = await apiClient.submitShotStream({
        shots,
        width,
        height,
        seed: parsedSeed,
        fps,
      });

      if (!res.success || !res.job_id) {
        throw new Error(res.error || "Failed to submit ShotStream job");
      }

      setJobId(res.job_id);
      setStatus("Submitted. Waiting for GPU…");
      startPolling(res.job_id);
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Unknown error"}`);
      setIsSubmitting(false);
    }
  }

  async function cancel() {
    if (!jobId) return;
    try {
      await apiClient.cancelShotStream(jobId);
      setStatus("Cancelling…");
    } catch (e: unknown) {
      setStatus(`⚠️ Cancel failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // --- render ------------------------------------------------------------------
  const banner = !health
    ? null
    : !health.enabled
    ? { tone: "warn", text: "ShotStream is disabled on the backend (ENABLE_SHOTSTREAM=false)." }
    : !health.configured
    ? { tone: "warn", text: "Set SHOTSTREAM_SERVICE_URL to the local daemon (e.g. http://127.0.0.1:9100)." }
    : !health.reachable
    ? { tone: "error", text: `Local daemon unreachable${health.error ? `: ${health.error}` : ""}` }
    : { tone: "ok", text: `Local daemon ready${health.device ? ` (${health.device})` : ""}` };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="flex gap-6 p-6 md:p-10">
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              ShotStream
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Streaming multi-shot video generation. Describe each shot, and the local
              ShotStream daemon stitches them into a continuous video.
            </p>
          </div>

          {/* Health banner */}
          {banner && (
            <div
              className={`rounded-2xl px-4 py-3 text-sm border-2 ${
                banner.tone === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                  : banner.tone === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
              }`}
            >
              {banner.text}
            </div>
          )}

          {/* Shots */}
          <Section title="Shots">
            <div className="space-y-4">
              {shots.map((shot, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary p-4 bg-white/80 dark:bg-dark-surface-secondary"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                      Shot {idx + 1}
                    </span>
                    <button
                      onClick={() => removeShot(idx)}
                      disabled={shots.length <= 1}
                      className="text-xs px-3 py-1 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>

                  <Field>
                    <Label>Prompt</Label>
                    <textarea
                      value={shot.prompt}
                      onChange={(e) => updateShot(idx, { prompt: e.target.value })}
                      placeholder="Describe what happens in this shot…"
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-indigo-500 focus:outline-none transition-colors min-h-[80px] resize-vertical"
                    />
                  </Field>

                  <Field>
                    <Label>Duration: {shot.duration_sec.toFixed(1)}s</Label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={0.5}
                      value={shot.duration_sec}
                      onChange={(e) =>
                        updateShot(idx, { duration_sec: parseFloat(e.target.value) })
                      }
                      className="w-full"
                    />
                  </Field>
                </div>
              ))}
            </div>

            <button
              onClick={addShot}
              disabled={shots.length >= MAX_SHOTS}
              className="mt-4 px-4 py-2 rounded-xl border-2 border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add shot {shots.length >= MAX_SHOTS && `(max ${MAX_SHOTS})`}
            </button>
          </Section>

          {/* Settings */}
          <Section title="Video Settings">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label>Width</Label>
                <input
                  type="number"
                  value={widthInput}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  step={32}
                  min={64}
                  max={1024}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {width}px (multiple of 32)</p>
              </Field>
              <Field>
                <Label>Height</Label>
                <input
                  type="number"
                  value={heightInput}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  step={32}
                  min={64}
                  max={1024}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">Actual: {height}px (multiple of 32)</p>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
              <Field>
                <Label>FPS</Label>
                <input
                  type="number"
                  value={fps}
                  min={8}
                  max={30}
                  onChange={(e) => setFps(parseInt(e.target.value) || 16)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-indigo-500 focus:outline-none"
                />
              </Field>
              <Field>
                <Label>Seed (optional)</Label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="random"
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary dark:bg-dark-surface-secondary dark:text-dark-text-primary focus:border-indigo-500 focus:outline-none"
                />
              </Field>
            </div>
          </Section>

          {/* Generate */}
          <Section title="Generate">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={submit}
                disabled={isSubmitting || !health?.reachable}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:from-indigo-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>🎬</span>
                    Generate
                  </>
                )}
              </button>

              {isSubmitting && jobId && (
                <button
                  onClick={cancel}
                  className="px-4 py-3 rounded-2xl border-2 border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 font-semibold"
                >
                  Cancel
                </button>
              )}

              {jobId && <span className="text-xs text-gray-500">Job: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {progress != null && progress > 0 && progress < 1 && (
              <div className="mt-4 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            )}

            {videoUrl && (
              <div className="mt-6 space-y-3">
                <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <a
                  href={videoUrl}
                  download={`shotstream-${Date.now()}.mp4`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 items-center gap-2"
                >
                  <span>⬇️</span>
                  Download MP4
                </a>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
