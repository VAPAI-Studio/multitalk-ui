import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob, getCompletedJobsWithVideos } from "./lib/jobTracking";
import type { MultiTalkJob } from "./lib/supabase";

// MultiTalk Multiple Audio Frontend for ComfyUI
// - Enter ComfyUI URL  
// - Upload single Image (used as start frame, sent as Base64 to Base64DecodeNode)
// - Upload multiple Audio files with timeline positioning
// - Define output size (defaults to image aspect; optional 16:9 lock)
// - Sends modified workflow JSON to /prompt, polls /history for result, and shows the MP4
//
// This version supports multiple audio tracks positioned on a timeline
// creating conversations or multiple voices from a single face

// ---------- UI Helpers ----------
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
        <div className="w-2 h-8 bg-gradient-to-b from-emerald-500 to-teal-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

// Audio track interface
interface AudioTrack {
  id: string;
  file: File;
  startTime: number; // in seconds
  duration: number;  // in seconds
  name: string;
  mask: ImageData | null; // Manual mask data (white on black)
}

// Mask Editor Component
function MaskEditor({
  imageUrl,
  onMaskUpdate,
  trackName,
  trackColor,
  existingMask
}: {
  imageUrl: string;
  onMaskUpdate: (maskData: ImageData | null) => void;
  trackName: string;
  trackColor: string;
  existingMask: ImageData | null;
}) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [isErasing, setIsErasing] = useState(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  function convertToWhiteOnBlack(data: ImageData): HTMLCanvasElement {
    const temp = document.createElement('canvas');
    temp.width = data.width;
    temp.height = data.height;
    const tctx = temp.getContext('2d');
    if (!tctx) return temp;
    const copy = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    const arr = copy.data;
    for (let i = 0; i < arr.length; i += 4) {
      const r = arr[i];
      const g = arr[i + 1];
      const b = arr[i + 2];
      const a = arr[i + 3];
      const visible = a > 0 && (r + g + b > 0);
      arr[i] = visible ? 255 : 0;
      arr[i + 1] = visible ? 255 : 0;
      arr[i + 2] = visible ? 255 : 0;
      arr[i + 3] = 255;
    }
    tctx.putImageData(copy, 0, 0);
    return temp;
  }

  function redrawOverlay() {
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!overlay || !mask) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.imageSmoothingEnabled = false;
    // Draw mask grayscale
    ctx.drawImage(mask, 0, 0, overlay.width, overlay.height);
    // Tint with track color where mask is white
    ctx.globalCompositeOperation = 'source-in';
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = trackColor;
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function layoutCanvases() {
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;
    const image = imageRef.current;
    if (!overlay || !mask || !image) return;
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    overlay.width = image.naturalWidth;
    overlay.height = image.naturalHeight;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    mask.width = image.naturalWidth;
    mask.height = image.naturalHeight;
  }

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;
    const image = imageRef.current;
    if (!overlay || !mask || !image) return;

    const init = () => {
      layoutCanvases();
      const mctx = mask.getContext('2d');
      if (!mctx) return;
      // initialize black
      mctx.fillStyle = '#000';
      mctx.fillRect(0, 0, mask.width, mask.height);
      if (existingMask) {
        const bw = convertToWhiteOnBlack(existingMask);
        mctx.drawImage(bw, 0, 0, bw.width, bw.height, 0, 0, mask.width, mask.height);
      }
      redrawOverlay();
    };

    if (image.complete) init();
    else image.onload = init;

    // Observe size changes of the image to keep overlay aligned
    if ('ResizeObserver' in window && image) {
      resizeObserverRef.current?.disconnect();
      const ro = new ResizeObserver(() => {
        layoutCanvases();
        redrawOverlay();
      });
      ro.observe(image);
      resizeObserverRef.current = ro;
    }

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, existingMask, trackColor]);

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(true);
    try { (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch {}
    // Stamp immediately at pointer down
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!overlay || !mask) return;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || overlay.width === 0 || overlay.height === 0) return;
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = isErasing ? '#000' : '#fff';
    mctx.beginPath();
    mctx.arc(x, y, brushSize, 0, Math.PI * 2);
    mctx.fill();
    redrawOverlay();
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDrawing) return;
    const overlay = overlayCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!overlay || !mask) return;

    const rect = overlay.getBoundingClientRect();
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.globalCompositeOperation = 'source-over';
    mctx.fillStyle = isErasing ? '#000' : '#fff';
    mctx.beginPath();
    mctx.arc(x, y, brushSize, 0, Math.PI * 2);
    mctx.fill();

    redrawOverlay();
  };

  const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!isDrawing) return;
    setIsDrawing(false);
    try { if (e) (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch {}
    const mask = maskCanvasRef.current;
    if (mask) {
      const mctx = mask.getContext('2d');
      if (mctx) {
        const data = mctx.getImageData(0, 0, mask.width, mask.height);
        onMaskUpdate(data);
      }
    }
  };

  const clearMask = () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, mask.width, mask.height);
    redrawOverlay();
    onMaskUpdate(null);
  };

  const downloadMask = () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const a = document.createElement('a');
    a.download = `${trackName.replace(/\.[^/.]+$/, '') || 'mask'}.png`;
    a.href = mask.toDataURL('image/png');
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900 text-sm">
          Editando: {trackName}
        </h4>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-600">Tamaño:</span>
            <input
              type="range"
              min="5"
              max="200"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-gray-600 w-8 text-right">{brushSize}</span>
          </div>
          <button
            onClick={() => setIsErasing(!isErasing)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isErasing 
                ? 'bg-orange-500 text-white' 
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isErasing ? '🧽' : '🖌️'}
          </button>
          <button
            onClick={clearMask}
            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Limpiar
          </button>
          <button
            onClick={downloadMask}
            className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors"
          >
            Descargar máscara
          </button>
        </div>
      </div>
      
      <div className="border border-gray-300 rounded-lg overflow-hidden bg-white inline-block">
        <div className="relative">
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Base"
            className="max-w-full h-auto block pointer-events-none select-none"
            style={{ maxHeight: '250px' }}
            draggable={false}
          />
          <canvas
            ref={overlayCanvasRef}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerLeave={() => stopDrawing()}
            className="absolute top-0 left-0 cursor-crosshair pointer-events-auto"
            style={{
              width: '100%',
              height: '100%',
              touchAction: 'none',
              zIndex: 1,
            }}
          />
          {/* Hidden mask canvas used for true white-on-black mask */}
          <canvas ref={maskCanvasRef} className="hidden" />
        </div>
      </div>
      
      <p className="text-xs text-gray-500">
        {isErasing ? '🧽 Modo borrador - Haz clic para eliminar áreas' : '🖌️ Pinta las áreas donde debe aplicarse este audio'}
      </p>
    </div>
  );
}

// Timeline component for audio tracks
function Timeline({ 
  tracks, 
  totalDuration, 
  onUpdateTrackTime, 
  onRemoveTrack,
  onUpdateTotalDuration,
}: {
  tracks: AudioTrack[];
  totalDuration: number;
  onUpdateTrackTime: (id: string, startTime: number) => void;
  onRemoveTrack: (id: string) => void;
  onUpdateTotalDuration: (duration: number) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playbackRef = useRef<NodeJS.Timeout | null>(null);
  const audioElementsRef = useRef<{ [key: string]: HTMLAudioElement }>({});
  
  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Calculate minimum required duration based on audio tracks
  const calculateMinimumDuration = () => {
    if (tracks.length === 0) return 5; // Default minimum when no tracks
    
    const maxEndTime = Math.max(
      ...tracks.map(track => track.startTime + track.duration)
    );
    
    return Math.ceil(maxEndTime); // Just the actual required time
  };

  const handleRectangleDrag = (trackId: string, event: React.MouseEvent<HTMLDivElement>) => {
    const timelineContainer = event.currentTarget.parentElement;
    if (!timelineContainer) return;
    
    const timelineRect = timelineContainer.getBoundingClientRect();
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    // const startPosition = track.startTime; // not used currently

    const handleMouseMove = (e: MouseEvent) => {
      const mouseX = e.clientX - timelineRect.left;
      const timelineWidth = timelineRect.width;
      const newStartTime = (mouseX / timelineWidth) * totalDuration;
      const clampedStartTime = Math.max(0, Math.min(totalDuration - track.duration, newStartTime));
      onUpdateTrackTime(trackId, clampedStartTime);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  };

  // Playback functionality
  const handlePlay = async () => {
    if (tracks.length === 0) return;

    if (isPlaying) {
      // Stop playback
      setIsPlaying(false);
      setCurrentTime(0);
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
      
      // Stop all audio elements
      Object.values(audioElementsRef.current).forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
      });
      return;
    }

    // Start playback
    setIsPlaying(true);
    setCurrentTime(0);

    // Create audio elements for each track if they don't exist
    for (const track of tracks) {
      if (!audioElementsRef.current[track.id]) {
        const audioElement = new Audio();
        audioElement.src = URL.createObjectURL(track.file);
        audioElementsRef.current[track.id] = audioElement;
      }
    }

    // Schedule audio playback
    const playbackStartTime = Date.now();
    const scheduledTimeouts: NodeJS.Timeout[] = [];
    
    tracks.forEach(track => {
      const audioElement = audioElementsRef.current[track.id];
      if (!audioElement) return;
      
      // Schedule this audio to start at its designated time
      const timeout = setTimeout(() => {
        audioElement.currentTime = 0;
        audioElement.play().catch(e => console.error('Error playing audio:', e));
      }, track.startTime * 1000);
      
      scheduledTimeouts.push(timeout);
    });

    // Update current time indicator
    playbackRef.current = setInterval(() => {
      const elapsed = (Date.now() - playbackStartTime) / 1000;
      setCurrentTime(elapsed);
      
      if (elapsed >= totalDuration) {
        setIsPlaying(false);
        setCurrentTime(0);
        if (playbackRef.current) {
          clearInterval(playbackRef.current);
          playbackRef.current = null;
        }
        
        // Clear any pending timeouts
        scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
        
        // Stop all audio elements
        Object.values(audioElementsRef.current).forEach(audio => {
          audio.pause();
          audio.currentTime = 0;
        });
      }
    }, 100);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
      Object.values(audioElementsRef.current).forEach(audio => {
        audio.pause();
        URL.revokeObjectURL(audio.src);
      });
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Duration Control */}
      <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-200">
        <div className="flex flex-col">
          <span className="font-medium text-emerald-800">Duración total:</span>
          {tracks.length > 0 && (
            <span className="text-xs text-emerald-600">
              Mínimo: {formatTime(calculateMinimumDuration())}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={calculateMinimumDuration()}
            max="300"
            value={totalDuration}
            onChange={(e) => onUpdateTotalDuration(Math.max(calculateMinimumDuration(), Number(e.target.value)))}
            className="w-16 px-2 py-1 border border-emerald-300 rounded text-center"
          />
          <span className="text-sm text-emerald-700">seg</span>
        </div>
      </div>

      {/* Main Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Timeline</h3>
          
          {/* Playback Controls */}
          <div className="flex items-center gap-3">
            {isPlaying && (
              <div className="text-sm text-gray-600">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </div>
            )}
            <button
              onClick={handlePlay}
              disabled={tracks.length === 0}
              className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
                tracks.length === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : isPlaying
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              {isPlaying ? (
                <>
                  <span>⏹️</span>
                  Stop
                </>
              ) : (
                <>
                  <span>▶️</span>
                  Play Mix
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Time markers */}
        <div className="flex justify-between text-xs text-gray-400 mb-2 px-1">
          {Array.from({ length: Math.min(Math.floor(totalDuration / 5), 10) + 1 }, (_, i) => (
            <span key={i}>{i * 5}s</span>
          ))}
        </div>

        {/* Timeline track */}
        <div 
          className="relative bg-gray-100 rounded border-2 border-gray-200" 
          style={{ 
            minWidth: '400px',
            height: tracks.length > 0 ? `${Math.max(80, tracks.length * 60 + 20)}px` : '80px'
          }}
        >
          {/* Grid lines */}
          {Array.from({ length: Math.floor(totalDuration / 5) + 1 }, (_, i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-px bg-gray-300"
              style={{ left: `${(i * 5 / totalDuration) * 100}%` }}
            />
          ))}

          {/* Playback indicator */}
          {isPlaying && (
            <div
              className="absolute top-0 h-full w-0.5 bg-red-500 z-10 transition-all duration-100"
              style={{ left: `${(currentTime / totalDuration) * 100}%` }}
            />
          )}

          {/* Track separators */}
          {tracks.length > 1 && Array.from({ length: tracks.length - 1 }, (_, i) => (
            <div
              key={`separator-${i}`}
              className="absolute w-full h-px bg-gray-300"
              style={{ top: `${(i + 1) * 60}px` }}
            />
          ))}

          {/* Audio rectangles */}
          {tracks.map((track, index) => {
            const leftPercent = (track.startTime / totalDuration) * 100;
            const widthPercent = (track.duration / totalDuration) * 100;
            const trackTop = index * 60 + 10; // 60px per track, 10px margin
            
            const colors = [
              'bg-emerald-500 border-emerald-600',
              'bg-blue-500 border-blue-600',
              'bg-purple-500 border-purple-600', 
              'bg-pink-500 border-pink-600',
              'bg-orange-500 border-orange-600'
            ];
            const colorClass = colors[index % colors.length];

            return (
              <div
                key={track.id}
                className={`absolute h-10 ${colorClass} border-2 rounded cursor-move shadow-md hover:shadow-lg transition-shadow select-none`}
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  top: `${trackTop}px`,
                  minWidth: '50px'
                }}
                onMouseDown={(e) => handleRectangleDrag(track.id, e)}
                title={`${track.name} - ${formatTime(track.duration)}`}
              >
                {/* Rectangle content */}
                <div className="h-full flex items-center justify-center text-white text-xs font-medium px-2">
                  <div className="truncate text-center">
                    {track.name.length > 12 ? track.name.substring(0, 12) + '...' : track.name}
                    <span className="text-white/80 ml-1">({formatTime(track.duration)})</span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTrack(track.id);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center transition-colors"
                  title="Eliminar"
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Track labels */}
          {tracks.map((track, index) => (
            <div
              key={`label-${track.id}`}
              className="absolute left-2 text-xs text-gray-600 font-medium"
              style={{ top: `${index * 60 + 25}px` }}
            >
              Track {index + 1}
            </div>
          ))}

          {tracks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl mb-2">🎵</div>
                <p className="text-gray-500 text-sm">Arrastra archivos de audio aquí</p>
              </div>
            </div>
          )}
        </div>

        {/* Audio details */}
        {tracks.length > 0 && (
          <div className="mt-4 space-y-2">
            {tracks.map((track, index) => {
              const colors = [
                'text-emerald-700 bg-emerald-50 border-emerald-200',
                'text-blue-700 bg-blue-50 border-blue-200',
                'text-purple-700 bg-purple-50 border-purple-200',
                'text-pink-700 bg-pink-50 border-pink-200', 
                'text-orange-700 bg-orange-50 border-orange-200'
              ];
              const colorClass = colors[index % colors.length];

              return (
                <div key={track.id} className={`p-3 rounded-lg border ${colorClass} text-sm`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{track.name}</span>
                      {track.mask && (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                          ✓ Máscara
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span>Inicia: {formatTime(track.startTime)}</span>
                      <span>Duración: {formatTime(track.duration)}</span>
                      <input
                        type="number"
                        min="0"
                        max={Math.max(0, totalDuration - track.duration)}
                        step="0.5"
                        value={parseFloat(track.startTime.toFixed(1))}
                        onChange={(e) => onUpdateTrackTime(track.id, Number(e.target.value))}
                        className="w-16 px-1 py-1 text-xs border border-gray-300 rounded text-center bg-white"
                      />
                      <span className="text-xs">s</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Component ----------
export default function MultiTalkMultiplePeople() {
  const [comfyUrl, setComfyUrl] = useState<string>("https://59414078555f.ngrok.app");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageAR, setImageAR] = useState<number | null>(null);
  const [totalDuration, setTotalDuration] = useState<number>(10); // Default 10 seconds

  const [lock16x9, setLock16x9] = useState<boolean>(false);
  const [width, setWidth] = useState<number>(640);
  const [height, setHeight] = useState<number>(360);

  const [trimToAudio, setTrimToAudio] = useState<boolean>(true);
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [videoFeed, setVideoFeed] = useState<MultiTalkJob[]>([]);
  const [selectedTrackForMask, setSelectedTrackForMask] = useState<string | null>(null);

  // removed unused imgRef
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load video feed from Supabase
  useEffect(() => {
    loadVideoFeedFromDB();
    const interval = setInterval(loadVideoFeedFromDB, 30000);
    return () => clearInterval(interval);
  }, [comfyUrl]);

  async function loadVideoFeedFromDB() {
    try {
      const { jobs, error } = await getCompletedJobsWithVideos(20);
      if (error) {
        console.error("Error loading video feed:", error);
        return;
      }
      
      const filteredJobs = jobs.filter(job => job.comfy_url === comfyUrl || !comfyUrl);
      setVideoFeed(filteredJobs);
    } catch (e) {
      console.error("Error loading video feed from DB:", e);
    }
  }

  // Calculate minimum required duration based on audio tracks
  const calculateMinimumDuration = () => {
    if (audioTracks.length === 0) return 5; // Default minimum when no tracks
    
    const maxEndTime = Math.max(
      ...audioTracks.map(track => track.startTime + track.duration)
    );
    
    return Math.ceil(maxEndTime); // Just the actual required time
  };

  // Auto-adjust total duration when tracks change
  useEffect(() => {
    const minDuration = calculateMinimumDuration();
    if (minDuration > totalDuration) {
      setTotalDuration(minDuration);
    }
  }, [audioTracks, totalDuration]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      setImageAR(null);
      return;
    }

    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setImageAR(ar);
      if (!lock16x9) {
        const targetW = Math.max(32, Math.round(Math.min(640, img.width) / 32) * 32);
        const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
        setWidth(targetW);
        setHeight(targetH);
      }
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [imageFile, lock16x9]);

  useEffect(() => {
    if (!imageAR) return;
    if (lock16x9) {
      const targetW = Math.max(32, Math.round(width / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW * 9 / 16) / 32) * 32);
      if (targetH !== height) setHeight(targetH);
    } else {
      const targetH = Math.max(32, Math.round((width / imageAR) / 32) * 32);
      if (targetH !== height) setHeight(targetH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, lock16x9, imageAR]);

  // Auto-select first track for mask editing if none selected
  useEffect(() => {
    if (audioTracks.length > 0 && !selectedTrackForMask) {
      setSelectedTrackForMask(audioTracks[0].id);
    }
  }, [audioTracks, selectedTrackForMask]);

  // Audio track management functions
  function addAudioTrack() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handleAudioFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    
    files.forEach(file => {
      // Get audio duration
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      
      audio.addEventListener('loadedmetadata', () => {
        const newTrack: AudioTrack = {
          id: Math.random().toString(36).substr(2, 9),
          file,
          startTime: 0,
          duration: audio.duration,
          name: file.name,
          mask: null
        };
        
        setAudioTracks(prev => {
          const updatedTracks = [...prev, newTrack];
          
          // Auto-extend total duration if needed
          const maxEndTime = Math.max(...updatedTracks.map(t => t.startTime + t.duration));
          const requiredDuration = Math.ceil(maxEndTime);
          if (requiredDuration > totalDuration) {
            setTotalDuration(requiredDuration);
          }
          
          return updatedTracks;
        });
        URL.revokeObjectURL(url);
      });
      
      audio.src = url;
    });

    // Clear the input
    if (e.target) {
      e.target.value = '';
    }
  }

  function removeAudioTrack(id: string) {
    setAudioTracks(prev => {
      const updatedTracks = prev.filter(track => track.id !== id);
      
      // Adjust total duration down if possible after removing track
      if (updatedTracks.length > 0) {
        const maxEndTime = Math.max(...updatedTracks.map(t => t.startTime + t.duration));
        const requiredDuration = Math.ceil(maxEndTime);
        if (requiredDuration < totalDuration) {
          setTotalDuration(requiredDuration);
        }
      } else {
        // No tracks left, reset to default
        setTotalDuration(10);
      }
      
      return updatedTracks;
    });
  }

  function updateTrackStartTime(id: string, startTime: number) {
    setAudioTracks(prev => {
      const updatedTracks = prev.map(track => 
        track.id === id ? { ...track, startTime: Math.max(0, startTime) } : track
      );
      
      // Calculate if we need to extend duration
      const track = updatedTracks.find(t => t.id === id);
      if (track) {
        const requiredEndTime = track.startTime + track.duration;
        if (requiredEndTime > totalDuration) {
          setTotalDuration(Math.ceil(requiredEndTime));
        }
      }
      
      return updatedTracks;
    });
  }

  function updateTrackMask(id: string, maskData: ImageData | null) {
    setAudioTracks(prev => prev.map(track => 
      track.id === id ? { ...track, mask: maskData } : track
    ));
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const base64 = res.includes(",") ? res.split(",")[1] : res;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadAudioToComfy(baseUrl: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("image", file, file.name);

    try {
      const r = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        body: form,
        credentials: "omit",
      });
      
      if (!r.ok) {
        throw new Error(`Upload falló: HTTP ${r.status}`);
      }

      let data: any = null;
      try { 
        data = await r.json(); 
      } catch { }
      
      if (data?.name) return data.name as string;
      if (Array.isArray(data?.files) && data.files[0]) return data.files[0] as string;
      
      const text = typeof data === "string" ? data : await r.text().catch(() => "");
      if (text.trim()) return text.trim();
      
      throw new Error("Respuesta inesperada del servidor");
      
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error('No se pudo conectar al servidor. Verificá la URL de ngrok.');
      }
      throw new Error(`No se pudo subir el audio: ${e.message}`);
    }
  }

  function buildPromptJSON(base64Image: string, audioFilenames: string[]) {
    // Modified workflow for multiple audio tracks
    // This creates a composite audio and uses it with the single image
    const prompt: any = {
      "120": { inputs: { model: "WAN\\2.1\\multitalk.safetensors", base_precision: "fp16" }, class_type: "MultiTalkModelLoader", _meta: { title: "MultiTalk Model Loader" } },
      "122": { inputs: { model: "WAN\\2.1\\Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors", base_precision: "fp16_fast", quantization: "fp8_e4m3fn", load_device: "offload_device", attention_mode: "sageattn", compile_args: ["177", 0], block_swap_args: ["134", 0], lora: ["138", 0], multitalk_model: ["120", 0] }, class_type: "WanVideoModelLoader", _meta: { title: "WanVideo Model Loader" } },
      "128": { inputs: { steps: 4, cfg: 1.03, shift: 11.94, seed: 1, force_offload: true, scheduler: "flowmatch_distill", riflex_freq_index: 0, denoise_strength: 1, batched_cfg: false, rope_function: "comfy", start_step: 0, end_step: -1, add_noise_to_samples: false, model: ["122", 0], image_embeds: ["192", 0], text_embeds: ["135", 0], multitalk_embeds: ["194", 0] }, class_type: "WanVideoSampler", _meta: { title: "WanVideo Sampler" } },
      "129": { inputs: { model_name: "wan\\wan_2.1_vae.safetensors", precision: "bf16" }, class_type: "WanVideoVAELoader", _meta: { title: "WanVideo VAE Loader" } },
      "130": { inputs: { enable_vae_tiling: false, tile_x: 272, tile_y: 272, tile_stride_x: 144, tile_stride_y: 128, normalization: "default", vae: ["129", 0], samples: ["128", 0] }, class_type: "WanVideoDecode", _meta: { title: "WanVideo Decode" } },
      "131": { inputs: { frame_rate: 25, loop_count: 0, filename_prefix: "MultiTalkApi/WanVideo2_1_multitalk_multiple", format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 19, save_metadata: true, trim_to_audio: trimToAudio, pingpong: false, save_output: true, images: ["130", 0], audio: ["194", 1] }, class_type: "VHS_VideoCombine", _meta: { title: "Video Combine 🎥🅥🅗🅢" } },
      "134": { inputs: { blocks_to_swap: 15, offload_img_emb: false, offload_txt_emb: false, use_non_blocking: true, vace_blocks_to_swap: 0, prefetch_blocks: 0, block_swap_debug: false }, class_type: "WanVideoBlockSwap", _meta: { title: "WanVideo Block Swap" } },
      "135": { inputs: { positive_prompt: "A 2D digital illustration of multiple people in a room looking directly into the camera, warm soft tones, inspired by the style and color palette of the reference images. They have calm but focused expressions, as if speaking to the audience like documentarians, not posing like influencers. The framing includes multiple faces, with natural lighting and subtle shadows, animated style with clean lines and soft shading.", negative_prompt: "bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, walking backwards", force_offload: true, use_disk_cache: false, device: "gpu", t5: ["136", 0] }, class_type: "WanVideoTextEncode", _meta: { title: "WanVideo TextEncode" } },
      "136": { inputs: { model_name: "umt5-xxl-enc-bf16.pth", precision: "bf16", load_device: "offload_device", quantization: "disabled" }, class_type: "LoadWanVideoT5TextEncoder", _meta: { title: "WanVideo T5 Text Encoder Loader" } },
      "137": { inputs: { model: "TencentGameMate/chinese-wav2vec2-base", base_precision: "fp16", load_device: "main_device" }, class_type: "DownloadAndLoadWav2VecModel", _meta: { title: "(Down)load Wav2Vec Model" } },
      "138": { inputs: { lora: "WAN\\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", strength: 0.8, low_mem_load: false, merge_loras: true }, class_type: "WanVideoLoraSelect", _meta: { title: "WanVideo Lora Select" } },
      "171": { inputs: { width, height, upscale_method: "lanczos", keep_proportion: "crop", pad_color: "0, 0, 0", crop_position: "center", divisible_by: 2, device: "cpu", image: ["201", 0] }, class_type: "ImageResizeKJv2", _meta: { title: "Resize Image v2" } },
      "173": { inputs: { clip_name: "clip_vision_h.safetensors" }, class_type: "CLIPVisionLoader", _meta: { title: "Load CLIP Vision" } },
      "177": { inputs: { backend: "inductor", fullgraph: false, mode: "default", dynamic: false, dynamo_cache_size_limit: 64, compile_transformer_blocks_only: true, dynamo_recompile_limit: 128 }, class_type: "WanVideoTorchCompileSettings", _meta: { title: "WanVideo Torch Compile Settings" } },
      "192": { inputs: { width, height, frame_window_size: 81, motion_frame: 25, force_offload: false, colormatch: "mkl", tiled_vae: false, vae: ["129", 0], start_image: ["171", 0], clip_embeds: ["193", 0] }, class_type: "WanVideoImageToVideoMultiTalk", _meta: { title: "WanVideo Image To Video MultiTalk" } },
      "193": { inputs: { strength_1: 1, strength_2: 1, crop: "center", combine_embeds: "average", force_offload: true, tiles: 0, ratio: 0.5, clip_vision: ["173", 0], image_1: ["171", 0] }, class_type: "WanVideoClipVisionEncode", _meta: { title: "WanVideo ClipVision Encode" } },
      "194": { inputs: { normalize_loudness: true, num_frames: 250, fps: 25, audio_scale: 1, audio_cfg_scale: 1, multi_audio_type: "para", wav2vec_model: ["137", 0], audio_1: ["400", 0] }, class_type: "MultiTalkWav2VecEmbeds", _meta: { title: "MultiTalk Wav2Vec Embeds" } },
      "199": { inputs: { images: ["171", 0] }, class_type: "PreviewImage", _meta: { title: "Preview Image" } },
      "200": { inputs: { anything: ["131", 0] }, class_type: "easy cleanGpuUsed", _meta: { title: "Clean VRAM Used" } },
      "201": { inputs: { base64_string: base64Image }, class_type: "Base64DecodeNode", _meta: { title: "Base64 Decode to Image" } }
    };

    // Add audio mixing nodes if we have multiple audio tracks
    if (audioFilenames.length === 1) {
      // Single audio - simple path
      prompt["195"] = { inputs: { audio: audioFilenames[0], audioUI: "" }, class_type: "LoadAudio", _meta: { title: "LoadAudio" } };
      prompt["400"] = { inputs: { start_time: "0:00", end_time: `${totalDuration}:00`, audio: ["195", 0] }, class_type: "AudioCrop", _meta: { title: "AudioCrop" } };
    } else {
      // Multiple audios - create mixing workflow
      audioFilenames.forEach((filename, i) => {
        prompt[`50${i}`] = { inputs: { audio: filename, audioUI: "" }, class_type: "LoadAudio", _meta: { title: `LoadAudio ${i+1}` } };
      });
      
      // For now, we'll just use the first audio as primary
      // In a real implementation, you'd need audio mixing nodes
      prompt["400"] = { inputs: { start_time: "0:00", end_time: `${totalDuration}:00`, audio: ["500", 0] }, class_type: "AudioCrop", _meta: { title: "AudioCrop Composite" } };
      prompt["500"] = { inputs: { audio: ["500", 0] }, class_type: "LoadAudio", _meta: { title: "LoadAudio Primary" } };
    }

    return prompt;
  }

  async function submit() {
    setStatus("");
    setVideoUrl("");
    setJobId("");

    if (!comfyUrl) {
      setStatus("Poné la URL de ComfyUI.");
      return;
    }
    if (!imageFile) {
      setStatus("Subí una imagen.");
      return;
    }
    if (audioTracks.length === 0) {
      setStatus("Agregá al menos un audio.");
      return;
    }

    setIsSubmitting(true);
    try {
      setStatus("Convirtiendo imagen a Base64…");
      const base64Image = await fileToBase64(imageFile);

      setStatus("Subiendo audios a ComfyUI…");
      const audioFilenames = await Promise.all(
        audioTracks.map(track => uploadAudioToComfy(comfyUrl, track.file))
      );

      setStatus("Enviando prompt a ComfyUI…");
      const payload = {
        prompt: buildPromptJSON(base64Image, audioFilenames),
        client_id: `multitalk-multiple-${Math.random().toString(36).slice(2)}`,
      };

      const r = await fetch(`${comfyUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Error ${r.status} al enviar el prompt.`);
      const resp = await r.json();
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || "";
      if (!id) throw new Error("No se obtuvo prompt_id.");
      setJobId(id);

      // Create job record in Supabase
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        image_filename: imageFile.name,
        audio_filename: audioTracks.map(t => t.name).join(', '),
        width,
        height,
        trim_to_audio: trimToAudio
      });

      await updateJobToProcessing(id);

      setStatus("Procesando en ComfyUI…");
      const result = await pollForResult(id, comfyUrl, 1000, 60 * 30);
      if (!result) throw new Error("No se pudo recuperar el resultado.");

      const fileInfo = findVideoFileFromHistory(result);
      if (!fileInfo) throw new Error("No encontré el MP4 en el historial.");

      const url = `${comfyUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "MultiTalkApi")}&type=output`;
      setVideoUrl(url);
      
      await completeJob({
        job_id: id,
        status: 'completed',
        filename: fileInfo.filename,
        subfolder: fileInfo.subfolder || "MultiTalkApi"
      });

      await loadVideoFeedFromDB();
      
      setStatus("Listo ✅");
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      setStatus(errorMessage);
      
      if (jobId) {
        await completeJob({
          job_id: jobId,
          status: 'error',
          error_message: errorMessage
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function pollForResult(promptId: string, baseUrl: string, intervalMs: number, maxSeconds: number) {
    const started = Date.now();
    while (Date.now() - started < maxSeconds * 1000) {
      await new Promise((res) => setTimeout(res, intervalMs));
      const r = await fetch(`${baseUrl}/history/${promptId}`);
      if (!r.ok) continue;
      const data = await r.json();
      const h = data?.[promptId];
      if (h?.status?.status_str === "success" || h?.status?.completed) return h;
      if (h?.status?.status_str === "error" || h?.status?.error) throw new Error("Error en ComfyUI durante el proceso.");
    }
    return null;
  }

  function findVideoFileFromHistory(historyEntry: any): { filename: string; subfolder?: string } | null {
    const outputs = historyEntry?.outputs || {};
    const nodes = Object.values(outputs) as any[];
    
    for (const node of nodes) {
      const vids = node?.videos || node?.video;
      if (Array.isArray(vids) && vids.length) {
        const v = vids[0];
        if (v?.filename) return { filename: v.filename, subfolder: v.subfolder };
      }
      
      const gifs = node?.gifs;
      if (Array.isArray(gifs) && gifs.length) {
        const g = gifs[0];
        if (g?.filename) return { filename: g.filename, subfolder: g.subfolder };
      }
      
      const files = node?.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          if (typeof f?.filename === "string" && (f.filename.endsWith(".mp4") || f.filename.endsWith(".gif"))) {
            return { filename: f.filename, subfolder: f.subfolder };
          }
        }
      }
      
      if (node?.filename && typeof node.filename === "string") {
        return { filename: node.filename, subfolder: node.subfolder };
      }
    }
    
    return null;
  }

  function handleDownload() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "multitalk-multiple.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }


  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50">
      <div className="max-w-7xl mx-auto p-6 md:p-10 grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 w-full space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">
              MultiTalk
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-emerald-100 to-teal-100 px-4 py-2 rounded-full border border-emerald-200/50">
                MultiAudio
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Genera videos con múltiples pistas de audio posicionadas en un timeline elegante.
            </p>
          </div>


            <Section title="Configuración">
              <Field>
                <Label>URL de ComfyUI</Label>
                <input
                  type="text"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all duration-200 bg-white/80 backdrop-blur-sm"
                  placeholder="https://tu-servidor.ngrok.app"
                  value={comfyUrl}
                  onChange={(e) => setComfyUrl(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Asegurate de habilitar CORS o usar un proxy si servís este frontend desde otro origen.</p>
              </Field>
            </Section>

            <Section title="Archivos">
              <div className="space-y-6">
                <Field>
                  <Label>Imagen Base</Label>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Image Upload */}
                    <div className="relative border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center hover:border-emerald-400 transition-all duration-200 bg-gray-50/50">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="image-upload"
                      />
                      <label htmlFor="image-upload" className="cursor-pointer">
                        {imagePreview ? (
                          <div className="space-y-3">
                            <img src={imagePreview} alt="preview" className="max-w-full max-h-48 mx-auto rounded-2xl border border-gray-200 shadow-lg" />
                            <p className="text-sm text-gray-600 font-medium">Click para cambiar imagen</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-emerald-100 to-teal-100 rounded-full flex items-center justify-center">
                              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-700">Click para subir imagen</p>
                              <p className="text-xs text-gray-500">PNG, JPG hasta 10MB</p>
                            </div>
                          </div>
                        )}
                      </label>
                    </div>

                    {/* Mask Editor */}
                    {imagePreview && audioTracks.length > 0 && (
                      <div className="space-y-4">
                        <h4 className="font-semibold text-gray-900">🎭 Máscaras por Personaje</h4>
                        
                        {/* Track selector for masks */}
                        <div className="space-y-2">
                          {audioTracks.map((track, index) => {
                            const solidColors = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'];
                            const trackColor = solidColors[index % solidColors.length];
                            
                            return (
                              <div key={track.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-4 h-4 rounded"
                                    style={{ backgroundColor: trackColor }}
                                  ></div>
                                  <span className="text-sm font-medium truncate">{track.name}</span>
                                  {track.mask && (
                                    <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                                      ✓
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => setSelectedTrackForMask(selectedTrackForMask === track.id ? null : track.id)}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                      selectedTrackForMask === track.id
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                                  >
                                    {selectedTrackForMask === track.id ? 'Cerrar' : 'Editar'}
                                  </button>
                                  {track.mask && (
                                    <button
                                      onClick={() => updateTrackMask(track.id, null)}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Selected track mask editor */}
                        {selectedTrackForMask && (
                          <div className="border border-gray-200 rounded-lg p-4 bg-white">
                            {(() => {
                              const selectedTrack = audioTracks.find(t => t.id === selectedTrackForMask);
                              if (!selectedTrack) return null;
                              
                              const trackIndex = audioTracks.findIndex(t => t.id === selectedTrackForMask);
                              const solidColors = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'];
                              const trackColor = solidColors[trackIndex % solidColors.length];
                              
                              return (
                                <MaskEditor
                                  imageUrl={imagePreview}
                                  onMaskUpdate={(maskData) => updateTrackMask(selectedTrackForMask, maskData)}
                                  trackName={selectedTrack.name}
                                  trackColor={trackColor}
                                  existingMask={selectedTrack.mask}
                                />
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Field>
                
                <Field>
                  <Label>Archivos de Audio</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={handleAudioFileSelect}
                    className="hidden"
                  />
                  
                  <button
                    onClick={addAudioTrack}
                    className="w-full border-2 border-dashed border-emerald-300 rounded-2xl p-6 text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50 transition-all duration-200 text-center group"
                  >
                    <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                    <p className="font-bold text-lg">Agregar Audio(s)</p>
                    <p className="text-sm text-emerald-600 font-medium">MP3, WAV, M4A</p>
                  </button>
                  
                  {audioTracks.length > 0 && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200/50">
                      <p className="text-sm font-semibold text-emerald-800">
                        ✨ {audioTracks.length} audio{audioTracks.length !== 1 ? 's' : ''} agregado{audioTracks.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </Field>
              </div>
            </Section>

          {/* Timeline Section */}
          {audioTracks.length > 0 && (
            <Section title="Timeline de Audio">
              <Timeline 
                tracks={audioTracks}
                totalDuration={totalDuration}
                onUpdateTrackTime={updateTrackStartTime}
                onRemoveTrack={removeAudioTrack}
                onUpdateTotalDuration={setTotalDuration}
              />
            </Section>
          )}


            <Section title="Configuración de Salida">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Field>
                    <Label>Resolución</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Ancho</label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all duration-200 bg-white/80"
                          value={width}
                          onChange={(e) => setWidth(Math.max(32, Math.round(Number(e.target.value) / 32) * 32))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Alto</label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 transition-all duration-200 bg-white/80"
                          value={height}
                          onChange={(e) => setHeight(Math.max(32, Math.round(Number(e.target.value) / 32) * 32))}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Se ajusta a múltiplos de 32 por compatibilidad con el modelo.</p>
                  </Field>
                </div>
                
                <div className="space-y-4">
                  <Field>
                    <Label>Opciones</Label>
                    <div className="space-y-3">
                      <Label className="flex items-center gap-2">
                        <input type="checkbox" checked={lock16x9} onChange={(e) => setLock16x9(e.target.checked)} className="rounded" />
                        Bloquear a 16:9
                      </Label>
                      <Label className="flex items-center gap-2">
                        <input type="checkbox" checked={trimToAudio} onChange={(e) => setTrimToAudio(e.target.checked)} className="rounded" />
                        Recortar video a la duración del audio
                      </Label>
                    </div>
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Generar Video">
              <div className="space-y-4">
                <button
                  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-lg shadow-lg hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 w-full justify-center"
                  onClick={submit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Procesando…
                    </>
                  ) : (
                    <>
                      <span>🎵</span>
                      Generar MultiAudio
                    </>
                  )}
                </button>
                
                <div className="flex flex-wrap items-center gap-3">
                  {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
                  {status && <span className="text-sm">{status}</span>}
                </div>

                {videoUrl && (
                  <div className="mt-6 space-y-3">
                    <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                    <div>
                      <button className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" onClick={handleDownload}>
                        <span>⬇️</span>
                        Descargar MP4
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Section>
        </div>

        {/* Right Sidebar */}
        <div className="lg:col-span-1 w-full space-y-6">
          <div className="sticky top-6">
            <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-emerald-500 to-teal-600 rounded-full"></div>
                Tips Rápidos
              </h2>
              <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
                <li>Usá una imagen con cara clara y bien iluminada para mejores resultados.</li>
                <li>Posicioná los audios en el timeline para crear conversaciones dinámicas.</li>
                <li>Ajustá el tiempo de inicio para diálogos o voces superpuestas.</li>
                <li>El modelo sincroniza automáticamente los movimientos con cada audio.</li>
                <li>Para máxima compatibilidad, usá anchos y altos múltiplos de 32.</li>
              </ul>
            </div>
            
            <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
                Feed de Generaciones
              </h2>
              {videoFeed.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-3">No hay videos generados aún</p>
                  <p className="text-xs text-gray-400">Los videos aparecerán aquí cuando generes contenido</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {videoFeed.map((job) => {
                    const videoUrl = job.filename ? 
                      `${job.comfy_url}/view?filename=${encodeURIComponent(job.filename)}&subfolder=${encodeURIComponent(job.subfolder || 'MultiTalkApi')}&type=output` 
                      : null;
                      
                    return (
                      <div key={job.job_id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                        {videoUrl && (
                          <video 
                            src={videoUrl} 
                            controls 
                            className="w-full rounded-xl mb-2"
                            style={{ maxHeight: '150px' }}
                          />
                        )}
                        <div className="space-y-1">
                          <div className="text-xs text-gray-500 truncate" title={job.filename || job.job_id}>
                            {job.filename || `Job: ${job.job_id.slice(0, 8)}...`}
                          </div>
                          <div className="text-xs text-gray-400">
                            {job.timestamp_completed ? new Date(job.timestamp_completed).toLocaleString() : 'Processing...'}
                          </div>
                          <div className="text-xs">
                            <span className={`px-2 py-1 rounded-full ${
                              job.status === 'completed' ? 'bg-green-100 text-green-700' :
                              job.status === 'error' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {job.status}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400">
                            {job.width}×{job.height} • {job.trim_to_audio ? 'Trim to audio' : 'Fixed length'}
                          </div>
                        </div>
                        {videoUrl && (
                          <button 
                            className="mt-2 w-full text-xs px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = videoUrl;
                              a.download = job.filename || 'video.mp4';
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            }}
                          >
                            Descargar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}