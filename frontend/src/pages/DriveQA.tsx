import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../config/environment";

// ---------------------------------------------------------------------------
// Types matching backend models
// ---------------------------------------------------------------------------

type ReviewStatus = "pending" | "ok" | "nok";

interface QAScene {
  id: string;
  name: string;
  modified_time?: string | null;
}

interface QAImage {
  id: string;
  name: string;
  mime_type: string;
  size?: number | null;
  modified_time?: string | null;
}

interface QASceneDetail {
  id: string;
  name: string;
  assets: QAImage[];
  results: QAImage[];
}

interface QAReview {
  id: string;
  episode_id: string;
  scene_id: string;
  scene_name: string;
  status: ReviewStatus;
  notes?: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface ViewerTransform {
  scale: number;
  x: number;
  y: number;
}

const INITIAL_TRANSFORM: ViewerTransform = { scale: 1, x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("vapai-auth-token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: { ...authHeaders() },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${config.apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// Build a URL the <img> can hit — needs auth, so we use blob URLs via fetch.
function buildFileUrl(fileId: string, thumbnail = false, size = 1200): string {
  const suffix = thumbnail ? `/thumbnail?size=${size}` : "";
  return `${config.apiBaseUrl}/drive-qa/file/${fileId}${suffix}`;
}

// ---------------------------------------------------------------------------
// Authenticated <img> — fetches the bytes via apiClient auth, returns a blob URL.
// ---------------------------------------------------------------------------

function useBlobUrl(url: string | null): { src: string | null; loading: boolean; error: string | null } {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetch(url, { headers: authHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        const blob = await r.blob();
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(blobUrl);
          setLoading(false);
        } else {
          URL.revokeObjectURL(blobUrl);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  return { src, loading, error };
}

// ---------------------------------------------------------------------------
// Synced viewer pane — image + zoom/pan controlled from a shared transform
// ---------------------------------------------------------------------------

interface ViewerPaneProps {
  title: string;
  emptyLabel: string;
  images: QAImage[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  transform: ViewerTransform;
  onTransformChange: (t: ViewerTransform) => void;
}

function ViewerPane({
  title,
  emptyLabel,
  images,
  selectedIndex,
  onSelect,
  transform,
  onTransformChange,
}: ViewerPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(
    null
  );

  const currentImage = images[selectedIndex] ?? null;
  const imageUrl = currentImage ? buildFileUrl(currentImage.id) : null;
  const { src, loading, error } = useBlobUrl(imageUrl);

  // Zoom on wheel — anchor zoom around the cursor position.
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const zoomFactor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.min(8, Math.max(0.2, transform.scale * zoomFactor));
      const ratio = newScale / transform.scale;

      onTransformChange({
        scale: newScale,
        x: mouseX - (mouseX - transform.x) * ratio,
        y: mouseY - (mouseY - transform.y) * ratio,
      });
    },
    [onTransformChange, transform]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
    },
    [transform]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const { startX, startY, tx, ty } = draggingRef.current;
      onTransformChange({
        ...transform,
        x: tx + (e.clientX - startX),
        y: ty + (e.clientY - startY),
      });
    },
    [onTransformChange, transform]
  );

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <h3 className="font-semibold text-sm text-gray-800">{title}</h3>
        <span className="text-xs text-gray-500">
          {images.length === 0
            ? "—"
            : `${selectedIndex + 1} / ${images.length}`}
        </span>
      </div>

      {/* Main image area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[#1a1a1a] flex items-center justify-center select-none cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {!currentImage && (
          <div className="text-gray-500 text-sm">{emptyLabel}</div>
        )}
        {currentImage && loading && (
          <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
        )}
        {currentImage && error && (
          <div className="text-red-400 text-sm">Error: {error}</div>
        )}
        {src && (
          <img
            src={src}
            alt={currentImage?.name}
            draggable={false}
            className="max-w-none max-h-none pointer-events-none"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: "center center",
              willChange: "transform",
              transition: draggingRef.current
                ? "none"
                : "transform 50ms ease-out",
            }}
          />
        )}
      </div>

      {/* Thumbnails strip */}
      <div className="flex gap-2 overflow-x-auto p-2 bg-gray-50 border-t border-gray-200 min-h-[88px]">
        {images.length === 0 && (
          <div className="text-xs text-gray-400 italic px-2 py-4">No images</div>
        )}
        {images.map((img, i) => (
          <Thumbnail
            key={img.id}
            image={img}
            active={i === selectedIndex}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}

function Thumbnail({
  image,
  active,
  onClick,
}: {
  image: QAImage;
  active: boolean;
  onClick: () => void;
}) {
  const { src, loading } = useBlobUrl(buildFileUrl(image.id, true, 200));
  return (
    <button
      onClick={onClick}
      title={image.name}
      className={`relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
        active
          ? "border-blue-500 ring-2 ring-blue-300"
          : "border-gray-200 hover:border-gray-400"
      }`}
    >
      {loading && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      {src && (
        <img
          src={src}
          alt={image.name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DriveQA() {
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [episodeName, setEpisodeName] = useState<string>("");
  const [scenes, setScenes] = useState<QAScene[]>([]);
  const [scenesLoading, setScenesLoading] = useState(false);
  const [scenesError, setScenesError] = useState<string | null>(null);

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [sceneDetail, setSceneDetail] = useState<QASceneDetail | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);

  const [assetIndex, setAssetIndex] = useState(0);
  const [resultIndex, setResultIndex] = useState(0);

  const [transform, setTransform] = useState<ViewerTransform>(INITIAL_TRANSFORM);
  const [syncedZoom, setSyncedZoom] = useState(true);
  const [assetTransform, setAssetTransform] = useState<ViewerTransform>(INITIAL_TRANSFORM);
  const [resultTransform, setResultTransform] = useState<ViewerTransform>(INITIAL_TRANSFORM);

  const [reviews, setReviews] = useState<Record<string, QAReview>>({});
  const [notes, setNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // Load episode + scenes + reviews on mount
  useEffect(() => {
    setScenesLoading(true);
    Promise.all([
      apiGet<{ id: string; name: string }>("/drive-qa/episode"),
      apiGet<{ success: boolean; scenes: QAScene[]; error?: string }>(
        "/drive-qa/scenes"
      ),
      apiGet<{ success: boolean; reviews: QAReview[]; error?: string }>(
        "/drive-qa/reviews"
      ),
    ])
      .then(([ep, scenesResp, reviewsResp]) => {
        setEpisodeId(ep.id);
        setEpisodeName(ep.name);
        if (scenesResp.success) {
          setScenes(scenesResp.scenes);
          if (scenesResp.scenes.length > 0 && !selectedSceneId) {
            setSelectedSceneId(scenesResp.scenes[0].id);
          }
        } else {
          setScenesError(scenesResp.error || "Failed to load scenes");
        }
        if (reviewsResp.success) {
          const map: Record<string, QAReview> = {};
          for (const r of reviewsResp.reviews) map[r.scene_id] = r;
          setReviews(map);
        }
      })
      .catch((e) => setScenesError(e instanceof Error ? e.message : "Error"))
      .finally(() => setScenesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load scene detail when selection changes
  useEffect(() => {
    if (!selectedSceneId) return;
    setSceneLoading(true);
    setSceneDetail(null);
    setAssetIndex(0);
    setResultIndex(0);
    setTransform(INITIAL_TRANSFORM);
    setAssetTransform(INITIAL_TRANSFORM);
    setResultTransform(INITIAL_TRANSFORM);

    apiGet<{ success: boolean; scene: QASceneDetail | null; error?: string }>(
      `/drive-qa/scenes/${selectedSceneId}`
    )
      .then((resp) => {
        if (resp.success && resp.scene) {
          setSceneDetail(resp.scene);
          setNotes(reviews[selectedSceneId]?.notes ?? "");
        }
      })
      .finally(() => setSceneLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId]);

  // Reset transforms when changing image within a scene
  useEffect(() => {
    setTransform(INITIAL_TRANSFORM);
    setAssetTransform(INITIAL_TRANSFORM);
  }, [assetIndex, selectedSceneId]);

  useEffect(() => {
    setResultTransform(INITIAL_TRANSFORM);
  }, [resultIndex, selectedSceneId]);

  const currentReview = selectedSceneId ? reviews[selectedSceneId] : undefined;
  const currentStatus: ReviewStatus = currentReview?.status ?? "pending";

  const statusCounts = useMemo(() => {
    const counts = { ok: 0, nok: 0, pending: 0 };
    for (const s of scenes) {
      const st = reviews[s.id]?.status ?? "pending";
      counts[st]++;
    }
    return counts;
  }, [scenes, reviews]);

  const handleMarkReview = async (status: ReviewStatus) => {
    if (!selectedSceneId || !episodeId || !sceneDetail) return;
    setSavingReview(true);
    try {
      const resp = await apiPost<{
        success: boolean;
        review: QAReview | null;
        error?: string;
      }>("/drive-qa/reviews", {
        episode_id: episodeId,
        scene_id: selectedSceneId,
        scene_name: sceneDetail.name,
        status,
        notes: notes || null,
      });
      if (resp.success && resp.review) {
        setReviews((prev) => ({ ...prev, [selectedSceneId]: resp.review! }));
      }
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-gray-50">
      {/* Sidebar with scenes */}
      <aside className="w-64 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900 text-sm">QA Viewer</h2>
          <p className="text-xs text-gray-500 mt-1">{episodeName}</p>
          <div className="mt-2 flex gap-2 text-[11px]">
            <span className="text-green-600">✓ {statusCounts.ok}</span>
            <span className="text-red-600">✗ {statusCounts.nok}</span>
            <span className="text-gray-400">· {statusCounts.pending}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {scenesLoading && (
            <div className="p-4 text-xs text-gray-500">Loading scenes…</div>
          )}
          {scenesError && (
            <div className="p-4 text-xs text-red-600">{scenesError}</div>
          )}
          {scenes.map((s) => {
            const status = reviews[s.id]?.status ?? "pending";
            const active = s.id === selectedSceneId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedSceneId(s.id)}
                className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-sm border-l-4 transition-colors ${
                  active
                    ? "bg-blue-50 border-blue-500 text-blue-900 font-semibold"
                    : "border-transparent text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span>{s.name}</span>
                <StatusBadge status={status} />
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main: two viewers side by side */}
      <div className="flex-1 min-w-0 flex flex-col p-4 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {sceneDetail?.name ?? "Select a scene"}
            </h1>
            {sceneLoading && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={syncedZoom}
                onChange={(e) => setSyncedZoom(e.target.checked)}
              />
              Synced zoom / pan
            </label>
            <button
              onClick={() => {
                setTransform(INITIAL_TRANSFORM);
                setAssetTransform(INITIAL_TRANSFORM);
                setResultTransform(INITIAL_TRANSFORM);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100"
            >
              Reset view
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
          <ViewerPane
            title="Assets"
            emptyLabel="No assets in this scene"
            images={sceneDetail?.assets ?? []}
            selectedIndex={assetIndex}
            onSelect={setAssetIndex}
            transform={syncedZoom ? transform : assetTransform}
            onTransformChange={syncedZoom ? setTransform : setAssetTransform}
          />
          <ViewerPane
            title="Results"
            emptyLabel="No result yet for this scene"
            images={sceneDetail?.results ?? []}
            selectedIndex={resultIndex}
            onSelect={setResultIndex}
            transform={syncedZoom ? transform : resultTransform}
            onTransformChange={syncedZoom ? setTransform : setResultTransform}
          />
        </div>

        {/* QA bar */}
        {sceneDetail && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 flex gap-3 items-center">
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkReview("ok")}
                disabled={savingReview}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                  currentStatus === "ok"
                    ? "bg-green-600 text-white shadow"
                    : "bg-gray-100 text-gray-700 hover:bg-green-100"
                }`}
              >
                ✓ OK
              </button>
              <button
                onClick={() => handleMarkReview("nok")}
                disabled={savingReview}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                  currentStatus === "nok"
                    ? "bg-red-600 text-white shadow"
                    : "bg-gray-100 text-gray-700 hover:bg-red-100"
                }`}
              >
                ✗ NOK
              </button>
            </div>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (
                  currentReview &&
                  (notes || "") !== (currentReview.notes ?? "")
                ) {
                  handleMarkReview(currentStatus);
                }
              }}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
            />
            {currentReview && (
              <span className="text-xs text-gray-500">
                Saved {new Date(currentReview.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "ok")
    return (
      <span className="text-green-600 text-xs font-bold" title="Approved">
        ✓
      </span>
    );
  if (status === "nok")
    return (
      <span className="text-red-600 text-xs font-bold" title="Needs rework">
        ✗
      </span>
    );
  return <span className="text-gray-300 text-xs">·</span>;
}
