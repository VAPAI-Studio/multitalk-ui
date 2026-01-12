// Feed display configuration types

// View mode options
export type FeedViewMode = 'list' | 'grid';

// Thumbnail size presets
export type ThumbnailSize = 'small' | 'medium' | 'large';

// Column count options (for grid view)
export type ColumnCount = 1 | 2 | 3 | 4 | 'auto';

// Display settings interface
export interface FeedDisplaySettings {
  viewMode: FeedViewMode;
  thumbnailSize: ThumbnailSize;
  columnCount: ColumnCount;
  sidebarWidth: number;
}

// Default values
export const DEFAULT_FEED_DISPLAY_SETTINGS: FeedDisplaySettings = {
  viewMode: 'list',
  thumbnailSize: 'medium',
  columnCount: 2,
  sidebarWidth: 384, // Tailwind w-96
};

// Sidebar constraints
export const SIDEBAR_CONSTRAINTS = {
  minWidth: 280,
  maxWidth: 600,
  defaultWidth: 384,
};

// Thumbnail size dimension mappings (height in pixels for aspect ratio)
export const THUMBNAIL_HEIGHTS: Record<ThumbnailSize, number> = {
  small: 64,   // h-16
  medium: 128, // h-32
  large: 192,  // h-48
};

// Tailwind classes for thumbnail heights
export const THUMBNAIL_HEIGHT_CLASSES: Record<ThumbnailSize, string> = {
  small: 'h-16',
  medium: 'h-32',
  large: 'h-48',
};

// Grid minimum item width for auto columns
export const GRID_MIN_ITEM_WIDTH: Record<ThumbnailSize, number> = {
  small: 80,
  medium: 120,
  large: 160,
};
