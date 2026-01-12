import type { FeedViewMode, ThumbnailSize, ColumnCount } from '../types/feedDisplay'

interface DisplaySettingsControlsProps {
  viewMode: FeedViewMode
  thumbnailSize: ThumbnailSize
  columnCount: ColumnCount
  onViewModeChange: (mode: FeedViewMode) => void
  onThumbnailSizeChange: (size: ThumbnailSize) => void
  onColumnCountChange: (count: ColumnCount) => void
  compact?: boolean // For sidebar mode (smaller controls)
}

// View mode icons
const ListIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

const GridIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
)

export default function DisplaySettingsControls({
  viewMode,
  thumbnailSize,
  columnCount,
  onViewModeChange,
  onThumbnailSizeChange,
  onColumnCountChange,
  compact = false,
}: DisplaySettingsControlsProps) {
  const buttonBase = compact
    ? 'px-1.5 py-1 text-xs'
    : 'px-2 py-1.5 text-xs'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* View Mode Toggle */}
      <div className="flex rounded-lg border border-gray-300 overflow-hidden">
        <button
          onClick={() => onViewModeChange('list')}
          className={`${buttonBase} transition-colors flex items-center justify-center ${
            viewMode === 'list'
              ? 'bg-gray-700 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
          title="List view"
        >
          <ListIcon />
        </button>
        <button
          onClick={() => onViewModeChange('grid')}
          className={`${buttonBase} border-l border-gray-300 transition-colors flex items-center justify-center ${
            viewMode === 'grid'
              ? 'bg-gray-700 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
          title="Grid view"
        >
          <GridIcon />
        </button>
      </div>

      {/* Thumbnail Size */}
      <div className="flex rounded-lg border border-gray-300 overflow-hidden">
        {(['small', 'medium', 'large'] as ThumbnailSize[]).map((size, index) => (
          <button
            key={size}
            onClick={() => onThumbnailSizeChange(size)}
            className={`${buttonBase} ${index > 0 ? 'border-l border-gray-300' : ''} transition-colors ${
              thumbnailSize === size
                ? 'bg-gray-700 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            title={`${size.charAt(0).toUpperCase() + size.slice(1)} thumbnails`}
          >
            {size.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>

      {/* Column Count - only visible in grid mode */}
      {viewMode === 'grid' && (
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {([1, 2, 3, 4, 'auto'] as ColumnCount[]).map((count, index) => (
            <button
              key={count}
              onClick={() => onColumnCountChange(count)}
              className={`${buttonBase} ${index > 0 ? 'border-l border-gray-300' : ''} transition-colors ${
                columnCount === count
                  ? 'bg-gray-700 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              title={count === 'auto' ? 'Auto-fit columns' : `${count} column${count > 1 ? 's' : ''}`}
            >
              {count === 'auto' ? 'A' : count}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
