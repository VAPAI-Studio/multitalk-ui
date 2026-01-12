import { useState, memo } from 'react'
import type { ThumbnailSize } from '../types/feedDisplay'
import { THUMBNAIL_HEIGHTS } from '../types/feedDisplay'
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
        <span className="text-lg">{error ? '⚠️' : placeholderIcon}</span>
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

export interface GenerationItem {
  id: string
  type: 'video' | 'image'
  created_at: string
  title: string
  status: string
  preview_url?: string
  result_url?: string
  thumbnail_url?: string
  all_result_urls?: string[]
  workflow_name?: string
  metadata: any
}

interface FeedGridItemProps {
  item: GenerationItem
  thumbnailSize: ThumbnailSize
  onClick?: () => void
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-500'
    case 'processing': return 'bg-blue-500 animate-pulse'
    case 'submitted': return 'bg-blue-400'
    case 'error': return 'bg-red-500'
    case 'failed': return 'bg-yellow-500'
    default: return 'bg-gray-400'
  }
}

function FeedGridItemComponent({ item, thumbnailSize, onClick }: FeedGridItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const height = THUMBNAIL_HEIGHTS[thumbnailSize]

  // Get thumbnail URL based on item type
  const thumbnailUrl = item.type === 'video'
    ? item.thumbnail_url
    : item.preview_url || (item.all_result_urls && item.all_result_urls[0])

  const isProcessing = item.status === 'processing' || item.status === 'submitted'
  const isCompleted = item.status === 'completed'

  // Check if this is a multi-image item (like from Image Grid)
  const hasMultipleImages = item.type === 'image' && item.all_result_urls && item.all_result_urls.length > 1
  // Get up to 9 images for the 3x3 grid (skip first one which is the source/preview)
  const gridImages = hasMultipleImages ? item.all_result_urls!.slice(1, 10) : []

  return (
    <div
      className="relative rounded-lg overflow-hidden cursor-pointer group bg-gray-100 border border-gray-200"
      style={{ height: `${height}px` }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Multi-image 3x3 Grid Display */}
      {hasMultipleImages && isCompleted && gridImages.length > 0 ? (
        <div className="w-full h-full grid grid-cols-3 gap-0.5 p-0.5 bg-gray-200">
          {gridImages.map((url, index) => (
            <div key={index} className="relative overflow-hidden bg-gray-100">
              <LazyImage
                src={getFeedThumbnailUrl(url)}
                alt={`${item.title} ${index + 1}`}
                className="w-full h-full object-cover"
                placeholderIcon="🖼️"
              />
            </div>
          ))}
          {/* Fill empty slots if less than 9 images */}
          {gridImages.length < 9 && Array.from({ length: 9 - gridImages.length }).map((_, index) => (
            <div key={`empty-${index}`} className="bg-gray-100" />
          ))}
        </div>
      ) : thumbnailUrl && isCompleted ? (
        /* Single Thumbnail */
        <LazyImage
          src={getFeedThumbnailUrl(thumbnailUrl)}
          alt={item.title}
          className="w-full h-full object-cover"
          placeholderIcon={item.type === 'video' ? '🎬' : '🖼️'}
        />
      ) : isProcessing ? (
        <div className="w-full h-full flex items-center justify-center bg-blue-50">
          <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full"></div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-2xl">{item.type === 'video' ? '🎬' : '🖼️'}</span>
        </div>
      )}

      {/* Type icon (video/image) - show grid icon for multi-image */}
      <div className="absolute top-1 left-1">
        <span className="text-xs bg-black/60 text-white px-1 py-0.5 rounded">
          {item.type === 'video' ? '🎬' : hasMultipleImages ? '🔲' : '🖼️'}
        </span>
      </div>

      {/* Status indicator dot */}
      <div className="absolute top-1 right-1">
        <div className={`w-2 h-2 rounded-full ${getStatusColor(item.status)}`} />
      </div>

      {/* Play button overlay for videos */}
      {item.type === 'video' && isCompleted && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-xl ml-0.5">▶</span>
          </div>
        </div>
      )}

      {/* Hover overlay with details */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 transition-opacity duration-200 ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <p className="text-white text-xs font-medium truncate">{item.title}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-white/70 text-[10px]">
            {new Date(item.created_at).toLocaleDateString()}
          </span>
          {hasMultipleImages ? (
            <span className="text-white/70 text-[10px]">
              {item.all_result_urls!.length - 1} images
            </span>
          ) : item.workflow_name && (
            <span className="text-white/70 text-[10px] truncate max-w-[60%]">
              {item.workflow_name}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Memoize for performance with large lists
export default memo(FeedGridItemComponent)
