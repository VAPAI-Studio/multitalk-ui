import { useRef, useEffect, useState, useCallback } from 'react';
import type { AnimationPreviewProps, PathPoint } from './types';

export default function AnimationPreview({
  paths,
  canvasSize,
  imageUrl,
}: AnimationPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 1
  const [speed, setSpeed] = useState(1); // playback speed multiplier
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Duration in milliseconds
  const duration = 3000 / speed;

  // Load image
  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Interpolate position along a path based on progress (0-1)
  const getPositionOnPath = useCallback((points: PathPoint[], t: number): PathPoint => {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];

    // t is normalized 0-1, we need to find which segment
    const totalSegments = points.length - 1;
    const segmentProgress = t * totalSegments;
    const segmentIndex = Math.min(Math.floor(segmentProgress), totalSegments - 1);
    const localT = segmentProgress - segmentIndex;

    const p1 = points[segmentIndex];
    const p2 = points[segmentIndex + 1];

    // Linear interpolation
    return {
      x: p1.x + (p2.x - p1.x) * localT,
      y: p1.y + (p2.y - p1.y) * localT,
    };
  }, []);

  // Draw frame
  const drawFrame = useCallback((currentProgress: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !imageRef.current) return;

    // Clear and draw background image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

    // Draw each path
    paths.forEach((path) => {
      // Check if path is visible at this time
      const pathVisible =
        currentProgress >= path.startTime && currentProgress <= path.endTime;

      if (!pathVisible && path.visibilityMode === 'pop') return;

      // Calculate path-local progress
      let pathProgress = 0;
      if (pathVisible) {
        const pathDuration = path.endTime - path.startTime;
        pathProgress = pathDuration > 0
          ? (currentProgress - path.startTime) / pathDuration
          : 1;
      }

      // Get position
      let position: PathPoint;
      if (path.isSinglePoint) {
        position = path.points[0];
      } else {
        position = getPositionOnPath(path.points, pathProgress);
      }

      // Calculate opacity for fade mode
      let opacity = 1;
      if (path.visibilityMode === 'fade' && !pathVisible) {
        opacity = 0.3;
      }

      // Draw the shape at current position
      ctx.globalAlpha = opacity;
      ctx.fillStyle = path.color;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;

      // Draw circle
      const radius = path.isSinglePoint ? 10 : 12;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw trail for motion paths
      if (!path.isSinglePoint && pathProgress > 0.05) {
        ctx.globalAlpha = opacity * 0.3;
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw partial path up to current position
        const trailPoints = Math.floor(pathProgress * (path.points.length - 1));
        if (trailPoints > 0) {
          ctx.beginPath();
          ctx.moveTo(path.points[0].x, path.points[0].y);
          for (let i = 1; i <= trailPoints && i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
          }
          ctx.lineTo(position.x, position.y);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    });
  }, [paths, getPositionOnPath]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || !imageLoaded) return;

    const startTime = performance.now() - progress * duration;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const newProgress = (elapsed % duration) / duration;

      setProgress(newProgress);
      drawFrame(newProgress);

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, duration, imageLoaded, drawFrame]);

  // Draw initial frame when not playing
  useEffect(() => {
    if (!isPlaying && imageLoaded) {
      drawFrame(progress);
    }
  }, [isPlaying, imageLoaded, progress, drawFrame]);

  // Reset on paths change
  useEffect(() => {
    setProgress(0);
    if (imageLoaded) {
      drawFrame(0);
    }
  }, [paths, imageLoaded, drawFrame]);

  const togglePlay = () => {
    if (paths.length === 0) return;
    setIsPlaying(!isPlaying);
  };

  const resetAnimation = () => {
    setIsPlaying(false);
    setProgress(0);
    if (imageLoaded) {
      drawFrame(0);
    }
  };

  if (!imageUrl || canvasSize.width === 0) {
    return (
      <div className="flex items-center justify-center h-32 bg-gray-100 rounded-2xl border-2 border-dashed border-gray-300">
        <p className="text-gray-500 text-sm">Upload an image to preview animation</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Preview Canvas */}
      <div className="relative inline-block rounded-2xl overflow-hidden shadow-lg border border-gray-200">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="block"
          style={{
            maxWidth: '100%',
            height: 'auto',
          }}
        />

        {/* Progress overlay */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
          <div
            className="h-full bg-cyan-500 transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={togglePlay}
          disabled={paths.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
            isPlaying
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-cyan-500 text-white hover:bg-cyan-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isPlaying ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </>
          )}
        </button>

        <button
          onClick={resetAnimation}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset
        </button>

        <div className="flex items-center gap-2 ml-4">
          <span className="text-sm text-gray-600">Speed:</span>
          <input
            type="range"
            min="0.25"
            max="3"
            step="0.25"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-sm font-medium text-gray-700 w-12">{speed}x</span>
        </div>
      </div>

      {paths.length === 0 && (
        <p className="text-sm text-gray-500">
          Draw some paths on the image above to see the animation preview.
        </p>
      )}
    </div>
  );
}
