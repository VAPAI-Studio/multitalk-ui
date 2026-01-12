import type { PathControlsProps } from './types';
import { PATH_COLORS } from './types';

export default function PathControls({
  paths,
  onPathsChange,
  selectedPathId,
  onSelectPath,
  tool,
  onToolChange,
  currentColor,
  onColorChange,
  onClearAll,
  onUndo,
  canUndo,
}: PathControlsProps) {
  const handleDeletePath = (pathId: string) => {
    onPathsChange(paths.filter(p => p.id !== pathId));
    if (selectedPathId === pathId) {
      onSelectPath(null);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedPathId) {
      handleDeletePath(selectedPathId);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drawing Tools */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 w-16">Tool:</span>
        <div className="flex gap-2">
          <button
            onClick={() => onToolChange('draw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tool === 'draw'
                ? 'bg-cyan-500 text-white shadow-lg'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Draw motion path (click and drag)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Motion Path
          </button>
          <button
            onClick={() => onToolChange('point')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tool === 'point'
                ? 'bg-cyan-500 text-white shadow-lg'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Add static anchor point (single click)"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" />
            </svg>
            Static Point
          </button>
        </div>
      </div>

      {/* Color Picker */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 w-16">Color:</span>
        <div className="flex gap-2 flex-wrap">
          {PATH_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onColorChange(color)}
              className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                currentColor === color
                  ? 'border-gray-800 ring-2 ring-offset-2 ring-gray-400'
                  : 'border-white shadow'
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 w-16">Actions:</span>
        <div className="flex gap-2">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title="Undo last path"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Undo
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={!selectedPathId}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title="Delete selected path"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
          <button
            onClick={onClearAll}
            disabled={paths.length === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title="Clear all paths"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear All
          </button>
        </div>
      </div>

      {/* Path List */}
      {paths.length > 0 && (
        <div className="mt-4">
          <span className="text-sm font-medium text-gray-700 block mb-2">Paths ({paths.length}):</span>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
            {paths.map((path) => (
              <div
                key={path.id}
                onClick={() => onSelectPath(path.id === selectedPathId ? null : path.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all ${
                  path.id === selectedPathId
                    ? 'bg-cyan-100 border-2 border-cyan-400'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: path.color }}
                  />
                  <span className="text-sm font-medium text-gray-700">{path.name}</span>
                  <span className="text-xs text-gray-500">
                    {path.isSinglePoint ? '(static)' : `(${path.points.length} pts)`}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePath(path.id);
                  }}
                  className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                  title="Delete path"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 mt-4">
        <p className="font-medium mb-1">How to use:</p>
        <ul className="space-y-1">
          <li><span className="font-medium">Motion Path:</span> Click and drag to draw a path for objects to follow</li>
          <li><span className="font-medium">Static Point:</span> Click to add anchor points that stay fixed (for stabilization)</li>
          <li><span className="font-medium">Select:</span> Click on existing paths to select them</li>
          <li><span className="font-medium">Delete:</span> Select a path and click Delete, or use the X button</li>
        </ul>
      </div>
    </div>
  );
}
