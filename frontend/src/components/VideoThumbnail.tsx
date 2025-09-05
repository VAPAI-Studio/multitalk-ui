import { useState, useRef } from 'react'
import { useVideoThumbnail } from '../hooks/useVideoThumbnail'

interface VideoThumbnailProps {
  videoUrl: string
  className?: string
  style?: React.CSSProperties
  onError?: (error: any) => void
  onPlay?: () => void
  showPlayButton?: boolean
}

export default function VideoThumbnail({ 
  videoUrl, 
  className = '', 
  style = {},
  onError,
  onPlay,
  showPlayButton = true
}: VideoThumbnailProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [showThumbnail, setShowThumbnail] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  
  const { thumbnailUrl, isLoading, error } = useVideoThumbnail({ 
    videoUrl, 
    shouldLoad: showThumbnail && !isPlaying 
  })

  const handlePlay = () => {
    setIsPlaying(true)
    setShowThumbnail(false)
    onPlay?.()
  }

  const handleVideoError = (error: any) => {
    console.error('Video error:', error)
    onError?.(error)
  }

  const handleVideoEnded = () => {
    setIsPlaying(false)
    setShowThumbnail(true)
  }

  // If we're playing the video, show the actual video element
  if (isPlaying) {
    return (
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className={className}
        style={style}
        onError={handleVideoError}
        onEnded={handleVideoEnded}
        autoPlay
      />
    )
  }

  // Show thumbnail or loading state
  return (
    <div className={`relative ${className}`} style={style}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <div className="text-center text-gray-500">
            <div className="text-2xl mb-2">⚠️</div>
            <div className="text-sm">Failed to load thumbnail</div>
          </div>
        </div>
      )}
      
      {thumbnailUrl && !isLoading && !error && (
        <>
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="w-full h-full object-cover rounded-xl"
            style={{ maxHeight: '200px' }}
          />
          {showPlayButton && (
            <button
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 hover:bg-opacity-50 transition-all duration-200 rounded-xl group"
            >
              <div className="bg-white bg-opacity-90 rounded-full p-4 group-hover:bg-opacity-100 transition-all duration-200">
                <svg 
                  className="w-8 h-8 text-gray-800 ml-1" 
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </button>
          )}
        </>
      )}
      
      {!thumbnailUrl && !isLoading && !error && (
        <div className="w-full h-full bg-gray-200 rounded-xl flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-2xl mb-2">🎥</div>
            <div className="text-sm">Loading video...</div>
          </div>
        </div>
      )}
    </div>
  )
}
