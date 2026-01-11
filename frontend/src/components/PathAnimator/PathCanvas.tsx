import { useRef, useEffect, useState, useCallback } from 'react';
import type { PathCanvasProps, Path, PathPoint } from './types';
import { generatePathId, getNextPathName } from './types';

export default function PathCanvas({
  imageUrl,
  paths,
  onPathsChange,
  selectedPathId,
  onSelectPath,
  tool,
  currentColor,
  canvasSize,
  onCanvasSizeChange,
}: PathCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<PathPoint[]>([]);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Load image and set canvas size
  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);

      // Calculate display size (max 800px width while maintaining aspect ratio)
      const maxWidth = 800;
      const maxHeight = 600;
      let displayWidth = img.width;
      let displayHeight = img.height;

      if (displayWidth > maxWidth) {
        const ratio = maxWidth / displayWidth;
        displayWidth = maxWidth;
        displayHeight = img.height * ratio;
      }
      if (displayHeight > maxHeight) {
        const ratio = maxHeight / displayHeight;
        displayHeight = maxHeight;
        displayWidth = displayWidth * ratio;
      }

      onCanvasSizeChange({
        width: Math.round(displayWidth),
        height: Math.round(displayHeight),
      });
    };
    img.src = imageUrl;
  }, [imageUrl, onCanvasSizeChange]);

  // Draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !imageRef.current) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

    // Draw existing paths
    paths.forEach((path) => {
      const isSelected = path.id === selectedPathId;

      ctx.strokeStyle = path.color;
      ctx.fillStyle = path.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (path.isSinglePoint && path.points.length === 1) {
        // Draw static point as a filled circle with border
        const p = path.points[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, isSelected ? 10 : 8, 0, Math.PI * 2);
        ctx.fill();

        // White border for visibility
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Outer ring if selected
        if (isSelected) {
          ctx.strokeStyle = path.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (path.points.length > 1) {
        // Draw motion path
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);

        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }

        ctx.stroke();

        // Draw start point (larger)
        ctx.fillStyle = path.color;
        ctx.beginPath();
        ctx.arc(path.points[0].x, path.points[0].y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw end point (arrow-like or smaller circle)
        const lastPoint = path.points[path.points.length - 1];
        ctx.fillStyle = path.color;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw current path being drawn
    if (currentPath.length > 0) {
      ctx.strokeStyle = currentColor;
      ctx.fillStyle = currentColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (tool === 'point') {
        // Preview static point
        const p = currentPath[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Preview motion path
        ctx.beginPath();
        ctx.moveTo(currentPath[0].x, currentPath[0].y);

        for (let i = 1; i < currentPath.length; i++) {
          ctx.lineTo(currentPath[i].x, currentPath[i].y);
        }

        ctx.stroke();

        // Draw start point
        ctx.fillStyle = currentColor;
        ctx.beginPath();
        ctx.arc(currentPath[0].x, currentPath[0].y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [paths, currentPath, selectedPathId, currentColor, tool]);

  // Redraw when dependencies change
  useEffect(() => {
    if (imageLoaded) {
      draw();
    }
  }, [imageLoaded, draw]);

  // Get mouse position relative to canvas
  const getCanvasPoint = useCallback((e: React.MouseEvent): PathPoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  // Check if click is near an existing path/point
  const findPathAtPoint = useCallback((point: PathPoint): string | null => {
    const threshold = 15;

    for (const path of [...paths].reverse()) { // Check from top to bottom
      if (path.isSinglePoint && path.points.length === 1) {
        const p = path.points[0];
        const dist = Math.sqrt((point.x - p.x) ** 2 + (point.y - p.y) ** 2);
        if (dist < threshold) return path.id;
      } else {
        // Check if near any point on the path
        for (const p of path.points) {
          const dist = Math.sqrt((point.x - p.x) ** 2 + (point.y - p.y) ** 2);
          if (dist < threshold) return path.id;
        }
      }
    }
    return null;
  }, [paths]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const point = getCanvasPoint(e);

    // Check if clicking on existing path
    const clickedPath = findPathAtPoint(point);
    if (clickedPath) {
      onSelectPath(clickedPath);
      return;
    }

    // Deselect and start new path
    onSelectPath(null);

    if (tool === 'point') {
      // Immediately create static point
      const newPath: Path = {
        id: generatePathId(),
        name: getNextPathName(paths, true),
        points: [point],
        color: currentColor,
        closed: false,
        isSinglePoint: true,
        startTime: 0,
        endTime: 1,
        interpolation: 'linear',
        visibilityMode: 'pop',
      };
      onPathsChange([...paths, newPath]);
    } else {
      // Start drawing motion path
      setIsDrawing(true);
      setCurrentPath([point]);
    }
  }, [getCanvasPoint, findPathAtPoint, tool, currentColor, paths, onPathsChange, onSelectPath]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || tool === 'point') return;

    const point = getCanvasPoint(e);

    // Sample points at intervals to avoid too many points
    if (currentPath.length > 0) {
      const lastPoint = currentPath[currentPath.length - 1];
      const dist = Math.sqrt((point.x - lastPoint.x) ** 2 + (point.y - lastPoint.y) ** 2);
      if (dist < 5) return; // Minimum distance between points
    }

    setCurrentPath(prev => [...prev, point]);
  }, [isDrawing, tool, getCanvasPoint, currentPath]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;

    setIsDrawing(false);

    if (currentPath.length > 1) {
      // Create motion path
      const newPath: Path = {
        id: generatePathId(),
        name: getNextPathName(paths, false),
        points: currentPath,
        color: currentColor,
        closed: false,
        isSinglePoint: false,
        startTime: 0,
        endTime: 1,
        interpolation: 'linear',
        visibilityMode: 'pop',
      };
      onPathsChange([...paths, newPath]);
    }

    setCurrentPath([]);
  }, [isDrawing, currentPath, currentColor, paths, onPathsChange]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing && currentPath.length > 1) {
      // Save path if mouse leaves canvas while drawing
      handleMouseUp();
    }
    setIsDrawing(false);
    setCurrentPath([]);
  }, [isDrawing, currentPath, handleMouseUp]);

  if (!imageUrl) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-2xl border-2 border-dashed border-gray-300">
        <p className="text-gray-500">Upload an image to start drawing paths</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block rounded-2xl overflow-hidden shadow-lg border border-gray-200"
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={`block ${tool === 'draw' ? 'cursor-crosshair' : 'cursor-cell'}`}
        style={{
          maxWidth: '100%',
          height: 'auto',
        }}
      />

      {/* Path count indicator */}
      <div className="absolute bottom-2 left-2 px-3 py-1 bg-black/60 text-white text-xs rounded-full">
        {paths.length} path{paths.length !== 1 ? 's' : ''} ({paths.filter(p => p.isSinglePoint).length} static, {paths.filter(p => !p.isSinglePoint).length} motion)
      </div>
    </div>
  );
}
