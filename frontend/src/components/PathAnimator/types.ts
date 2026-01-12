// Types for the Path Animator component used in WAN Move feature

export interface PathPoint {
  x: number;
  y: number;
}

export interface Path {
  id: string;
  name: string;
  points: PathPoint[];
  color: string;
  closed: boolean;
  isSinglePoint: boolean;  // true = static anchor, false = motion path
  startTime: number;       // 0-1 normalized
  endTime: number;         // 0-1 normalized
  interpolation: "linear" | "bezier";
  visibilityMode: "pop" | "fade";
}

export interface PathsData {
  paths: Path[];
  canvas_size: {
    width: number;
    height: number;
  };
}

export type DrawingTool = "draw" | "point";

export interface PathCanvasProps {
  imageUrl: string;
  paths: Path[];
  onPathsChange: (paths: Path[]) => void;
  selectedPathId: string | null;
  onSelectPath: (id: string | null) => void;
  tool: DrawingTool;
  currentColor: string;
  canvasSize: { width: number; height: number };
  onCanvasSizeChange: (size: { width: number; height: number }) => void;
}

export interface PathControlsProps {
  paths: Path[];
  onPathsChange: (paths: Path[]) => void;
  selectedPathId: string | null;
  onSelectPath: (id: string | null) => void;
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  currentColor: string;
  onColorChange: (color: string) => void;
  onClearAll: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export interface AnimationPreviewProps {
  paths: Path[];
  canvasSize: { width: number; height: number };
  imageUrl: string;
}

// Color palette for paths
export const PATH_COLORS = [
  "#BB8FCE", // Purple
  "#FF6B6B", // Red
  "#45B7D1", // Cyan
  "#98D8C8", // Mint
  "#85C1E2", // Light Blue
  "#F7DC6F", // Yellow
  "#82E0AA", // Green
  "#F8B500", // Orange
];

// Helper to generate unique path IDs
export function generatePathId(): string {
  return `path_${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

// Helper to get next path name
export function getNextPathName(paths: Path[], isSinglePoint: boolean): string {
  const prefix = isSinglePoint ? "Static" : "Path";
  const existingNumbers = paths
    .filter(p => p.name.startsWith(prefix))
    .map(p => {
      const match = p.name.match(/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix} ${nextNumber}`;
}

// Helper to get next color from palette
export function getNextColor(paths: Path[]): string {
  const usedColors = paths.map(p => p.color);
  const availableColor = PATH_COLORS.find(c => !usedColors.includes(c));
  return availableColor || PATH_COLORS[paths.length % PATH_COLORS.length];
}

// Convert paths to the format expected by FL_PathAnimator
export function pathsToWorkflowFormat(paths: Path[], canvasSize: { width: number; height: number }): string {
  const data: PathsData = {
    paths: paths.map(p => ({
      id: p.id,
      name: p.name,
      points: p.points,
      color: p.color,
      closed: p.closed,
      isSinglePoint: p.isSinglePoint,
      startTime: p.startTime,
      endTime: p.endTime,
      interpolation: p.interpolation,
      visibilityMode: p.visibilityMode,
    })),
    canvas_size: canvasSize,
  };
  return JSON.stringify(data);
}
