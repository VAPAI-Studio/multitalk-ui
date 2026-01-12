import GenerationFeed from './GenerationFeed'
import type { GenerationFeedConfig } from './GenerationFeed'
import ResizableContainer from './ResizableContainer'
import { useFeedDisplaySettings } from '../hooks/useFeedDisplaySettings'
import { SIDEBAR_CONSTRAINTS } from '../types/feedDisplay'

interface ResizableFeedSidebarProps {
  config: GenerationFeedConfig
  storageKey?: string
  onUpscaleComplete?: () => void
}

export default function ResizableFeedSidebar({
  config,
  storageKey,
  onUpscaleComplete,
}: ResizableFeedSidebarProps) {
  // Handle pageContext being string or string[] for storage key
  const effectiveStorageKey = storageKey
    || (Array.isArray(config.pageContext) ? config.pageContext[0] : config.pageContext)
    || 'default'

  const { settings, setSidebarWidth } = useFeedDisplaySettings({
    storageKey: effectiveStorageKey,
    defaults: config.displaySettings,
  })

  return (
    <ResizableContainer
      width={settings.sidebarWidth}
      minWidth={SIDEBAR_CONSTRAINTS.minWidth}
      maxWidth={SIDEBAR_CONSTRAINTS.maxWidth}
      onWidthChange={setSidebarWidth}
      resizePosition="left"
      className="flex-shrink-0"
    >
      <div className="sticky top-6 h-[calc(100vh-3rem)]">
        <GenerationFeed
          config={{
            ...config,
            // Pass display settings from the same storage key
            displaySettings: settings,
          }}
          onUpscaleComplete={onUpscaleComplete}
        />
      </div>
    </ResizableContainer>
  )
}
