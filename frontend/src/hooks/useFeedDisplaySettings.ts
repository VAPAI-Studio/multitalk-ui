import { useState, useEffect, useCallback } from 'react'
import type {
  FeedDisplaySettings,
  FeedViewMode,
  ThumbnailSize,
  ColumnCount,
} from '../types/feedDisplay'
import {
  DEFAULT_FEED_DISPLAY_SETTINGS,
  SIDEBAR_CONSTRAINTS,
} from '../types/feedDisplay'

const STORAGE_KEY_PREFIX = 'vapai-feed-display-'

interface UseFeedDisplaySettingsOptions {
  storageKey?: string
  defaults?: Partial<FeedDisplaySettings>
}

interface UseFeedDisplaySettingsReturn {
  settings: FeedDisplaySettings
  setViewMode: (mode: FeedViewMode) => void
  setThumbnailSize: (size: ThumbnailSize) => void
  setColumnCount: (count: ColumnCount) => void
  setSidebarWidth: (width: number) => void
  resetToDefaults: () => void
}

function isValidViewMode(value: unknown): value is FeedViewMode {
  return value === 'list' || value === 'grid'
}

function isValidThumbnailSize(value: unknown): value is ThumbnailSize {
  return value === 'small' || value === 'medium' || value === 'large'
}

function isValidColumnCount(value: unknown): value is ColumnCount {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 'auto'
}

function isValidSidebarWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    value >= SIDEBAR_CONSTRAINTS.minWidth &&
    value <= SIDEBAR_CONSTRAINTS.maxWidth
  )
}

function loadSettings(key: string, defaults: Partial<FeedDisplaySettings>): FeedDisplaySettings {
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        viewMode: isValidViewMode(parsed.viewMode)
          ? parsed.viewMode
          : (defaults.viewMode ?? DEFAULT_FEED_DISPLAY_SETTINGS.viewMode),
        thumbnailSize: isValidThumbnailSize(parsed.thumbnailSize)
          ? parsed.thumbnailSize
          : (defaults.thumbnailSize ?? DEFAULT_FEED_DISPLAY_SETTINGS.thumbnailSize),
        columnCount: isValidColumnCount(parsed.columnCount)
          ? parsed.columnCount
          : (defaults.columnCount ?? DEFAULT_FEED_DISPLAY_SETTINGS.columnCount),
        sidebarWidth: isValidSidebarWidth(parsed.sidebarWidth)
          ? parsed.sidebarWidth
          : (defaults.sidebarWidth ?? DEFAULT_FEED_DISPLAY_SETTINGS.sidebarWidth),
      }
    }
  } catch {
    // Invalid JSON, use defaults
  }

  return {
    ...DEFAULT_FEED_DISPLAY_SETTINGS,
    ...defaults,
  }
}

export function useFeedDisplaySettings(
  options: UseFeedDisplaySettingsOptions = {}
): UseFeedDisplaySettingsReturn {
  const { storageKey = 'default', defaults = {} } = options
  const fullKey = STORAGE_KEY_PREFIX + storageKey

  const [settings, setSettings] = useState<FeedDisplaySettings>(() =>
    loadSettings(fullKey, defaults)
  )

  // Persist to localStorage when settings change
  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(settings))
    } catch {
      // localStorage might be full or disabled
    }
  }, [settings, fullKey])

  const setViewMode = useCallback((mode: FeedViewMode) => {
    setSettings((prev) => ({ ...prev, viewMode: mode }))
  }, [])

  const setThumbnailSize = useCallback((size: ThumbnailSize) => {
    setSettings((prev) => ({ ...prev, thumbnailSize: size }))
  }, [])

  const setColumnCount = useCallback((count: ColumnCount) => {
    setSettings((prev) => ({ ...prev, columnCount: count }))
  }, [])

  const setSidebarWidth = useCallback((width: number) => {
    const clampedWidth = Math.max(
      SIDEBAR_CONSTRAINTS.minWidth,
      Math.min(SIDEBAR_CONSTRAINTS.maxWidth, width)
    )
    setSettings((prev) => ({ ...prev, sidebarWidth: clampedWidth }))
  }, [])

  const resetToDefaults = useCallback(() => {
    setSettings({ ...DEFAULT_FEED_DISPLAY_SETTINGS, ...defaults })
  }, [defaults])

  return {
    settings,
    setViewMode,
    setThumbnailSize,
    setColumnCount,
    setSidebarWidth,
    resetToDefaults,
  }
}
