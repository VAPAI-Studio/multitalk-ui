import { useState, useRef, useEffect } from 'react'
import type { ThumbnailSize } from '../types/feedDisplay'
import { THUMBNAIL_HEIGHT_CLASSES } from '../types/feedDisplay'
import { getFeedThumbnailUrl } from '../lib/imageUtils'

// Lazy loading image component
function LazyImage({
  src,
  alt,
  className = '',
  placeholderIcon = '🖼️'
}: {
  src: string
  alt: string
  className?: string
  placeholderIcon?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <div className="relative w-full h-full">
      <div className={`absolute inset-0 flex items-center justify-center bg-gray-100 ${loaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}>
        <span className="text-2xl">{error ? '⚠️' : placeholderIcon}</span>
      </div>
      {!error && (
        <img
          src={src}
          alt={alt}
          className={`absolute inset-0 ${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setError(true)
            setLoaded(false)
          }}
        />
      )}
    </div>
  )
}

// Lazy Video Component
const LazyVideo = ({
  resultUrl,
  thumbnailUrl,
}: {
  resultUrl: string
  thumbnailUrl?: string
}) => {
  const [shouldLoad, setShouldLoad] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          setTimeout(() => setShouldLoad(true), 100)
        } else {
          setShouldLoad(false)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // If thumbnail is available, show it with play overlay
  if (thumbnailUrl) {
    return (
      <a
        href={resultUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative w-full aspect-video rounded-xl overflow-hidden shadow-lg group"
      >
        <LazyImage
          src={thumbnailUrl}
          alt="Video thumbnail"
          className="w-full h-full object-cover"
          placeholderIcon="🎬"
        />
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
            <span className="text-2xl ml-1">▶</span>
          </div>
        </div>
      </a>
    )
  }

  // Fallback: show video directly with lazy loading
  return (
    <div ref={containerRef} className="w-full">
      <a
        href={resultUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative w-full aspect-video rounded-xl overflow-hidden shadow-lg group bg-gray-100"
      >
        {shouldLoad ? (
          <video
            src={resultUrl}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl">🎬</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
            <span className="text-2xl ml-1">▶</span>
          </div>
        </div>
      </a>
    </div>
  )
}

export interface GenerationItem {
  id: string
  type: 'video' | 'image'
  created_at: string
  title: string
  status: string
  preview_url?: string
  result_url?: string
  processing_time?: number
  progress?: {
    completed_nodes: number
    total_nodes: number
    current_node?: string
  }
  thumbnail_url?: string
  all_result_urls?: string[]
  source_image_url?: string
  prompt?: string
  workflow_name?: string
  model_used?: string
  metadata: any
}

interface FeedListItemProps {
  item: GenerationItem
  thumbnailSize: ThumbnailSize
  comfyUrl?: string
  showProgress?: boolean
  showFixButton?: boolean
  fixingJobs: Set<string>
  onFix?: (jobId: string) => void
  onImageClick?: () => void
  progressValue?: number
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-700'
    case 'processing': return 'bg-blue-100 text-blue-700'
    case 'submitted': return 'bg-blue-100 text-blue-700'
    case 'error': return 'bg-red-100 text-red-700'
    case 'failed': return 'bg-yellow-100 text-yellow-700'
    case 'pending': return 'bg-gray-100 text-gray-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'completed': return 'Done'
    case 'processing': return 'Processing'
    case 'submitted': return 'Queued'
    case 'failed': return 'Failed'
    case 'pending': return 'Pending'
    case 'error': return 'Error'
    default: return status
  }
}

function getShortJobId(jobId: string): string {
  return jobId.slice(-8)
}

export default function FeedListItem({
  item,
  thumbnailSize,
  comfyUrl,
  showProgress,
  showFixButton,
  fixingJobs,
  onFix,
  onImageClick,
  progressValue,
}: FeedListItemProps) {
  const heightClass = THUMBNAIL_HEIGHT_CLASSES[thumbnailSize]

  // Compact view for failed/error items
  if (item.status === 'failed' || item.status === 'error') {
    return (
      <div className="border border-yellow-200 rounded-lg p-2 bg-yellow-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">{item.type === 'video' ? '🎬' : '🖼️'}</span>
            <span className="text-xs font-mono text-gray-600">
              {getShortJobId(item.id)}
            </span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(item.status)}`}>
            {getStatusText(item.status)}
          </span>
        </div>
      </div>
    )
  }

  // Video item
  if (item.type === 'video') {
    return (
      <div className="border border-gray-200 rounded-xl p-3 bg-white">
        {item.result_url && item.status === 'completed' ? (
          <LazyVideo
            resultUrl={item.result_url}
            thumbnailUrl={item.thumbnail_url}
          />
        ) : item.status === 'processing' || item.status === 'submitted' ? (
          <div className={`w-full ${heightClass} min-h-[64px] bg-blue-50 rounded-lg flex items-center justify-center`}>
            <div className="flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
              <span className="text-blue-600 text-sm">
                {showProgress && progressValue !== undefined
                  ? `${progressValue}%`
                  : 'Processing...'}
              </span>
              {showFixButton && comfyUrl && onFix && (
                <button
                  onClick={() => onFix(item.id)}
                  disabled={fixingJobs.has(item.id)}
                  className="px-2 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded border border-orange-300 disabled:opacity-50"
                >
                  {fixingJobs.has(item.id) ? '...' : 'Fix'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className={`w-full ${heightClass} min-h-[64px] bg-gray-100 rounded-lg flex items-center justify-center`}>
            <span className="text-2xl">🎬</span>
          </div>
        )}

        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900 text-sm truncate flex-1">{item.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ml-2 ${getStatusColor(item.status)}`}>
              {getStatusText(item.status)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{new Date(item.created_at).toLocaleDateString()}</span>
            {item.workflow_name && (
              <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                {item.workflow_name}
              </span>
            )}
          </div>
          {item.status === 'completed' && item.result_url && (
            <a
              href={item.result_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-blue-600 text-white text-center py-1.5 rounded-lg hover:bg-blue-700 text-sm mt-2"
            >
              View Video
            </a>
          )}
        </div>
      </div>
    )
  }

  // Image item
  const hasMultipleImages = item.all_result_urls && item.all_result_urls.length > 1

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white">
      {/* Multi-image grid */}
      {hasMultipleImages && item.status === 'completed' ? (
        <div className="mb-2">
          <div className="grid grid-cols-3 gap-1 relative">
            <div className="absolute top-1 right-1 z-10">
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                {getStatusText(item.status)}
              </span>
            </div>
            {item.all_result_urls!.slice(1, 10).map((url, index) => (
              <div
                key={index}
                className="aspect-square rounded-lg relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                onClick={onImageClick}
              >
                <LazyImage
                  src={getFeedThumbnailUrl(url)}
                  alt={`Image ${index + 1}`}
                  className="w-full h-full object-cover"
                  placeholderIcon="🖼️"
                />
                <div className="absolute bottom-0.5 left-0.5 bg-black/70 text-white text-[10px] px-1 rounded z-10">
                  {index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Single image display */
        <div
          className={`aspect-video rounded-lg mb-2 relative overflow-hidden cursor-pointer hover:opacity-90 transition-opacity ${heightClass}`}
          onClick={onImageClick}
        >
          {item.preview_url ? (
            <LazyImage
              src={getFeedThumbnailUrl(item.preview_url)}
              alt={item.title}
              className="w-full h-full object-cover"
              placeholderIcon="🖼️"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
              <span className="text-3xl">🖼️</span>
            </div>
          )}
          <div className="absolute top-1 right-1">
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
              {getStatusText(item.status)}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h3 className="font-medium text-gray-900 text-sm truncate">{item.title}</h3>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{new Date(item.created_at).toLocaleDateString()}</span>
          {item.workflow_name && (
            <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
              {item.workflow_name}
            </span>
          )}
        </div>
        {item.status === 'completed' && item.result_url && (
          <a
            href={item.result_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-purple-600 text-white text-center py-1.5 rounded-lg hover:bg-purple-700 text-sm mt-2"
          >
            View Result
          </a>
        )}
      </div>
    </div>
  )
}
