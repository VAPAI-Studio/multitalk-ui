import { useState, useEffect } from 'react'

interface UseVideoThumbnailOptions {
  videoUrl: string
  shouldLoad?: boolean
}

export function useVideoThumbnail({ videoUrl, shouldLoad = true }: UseVideoThumbnailOptions) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!shouldLoad || !videoUrl) {
      setThumbnailUrl(null)
      return
    }

    const generateThumbnail = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Create video element
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.preload = 'metadata'
        
        // Create canvas for thumbnail
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          throw new Error('Could not get canvas context')
        }

        // Set up video event handlers
        const handleLoadedMetadata = () => {
          // Set canvas dimensions to match video
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          
          // Seek to first frame (0.1 seconds to ensure we get a frame)
          video.currentTime = 0.1
        }

        const handleSeeked = () => {
          // Draw the current frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          
          // Convert canvas to blob URL
          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob)
              setThumbnailUrl(url)
              setIsLoading(false)
            } else {
              setError('Failed to generate thumbnail')
              setIsLoading(false)
            }
          }, 'image/jpeg', 0.8)
        }

        const handleError = () => {
          setError('Failed to load video for thumbnail')
          setIsLoading(false)
        }

        // Add event listeners
        video.addEventListener('loadedmetadata', handleLoadedMetadata)
        video.addEventListener('seeked', handleSeeked)
        video.addEventListener('error', handleError)

        // Start loading
        video.src = videoUrl

        // Cleanup function
        return () => {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          video.removeEventListener('seeked', handleSeeked)
          video.removeEventListener('error', handleError)
          video.src = ''
        }

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setIsLoading(false)
      }
    }

    generateThumbnail()
  }, [videoUrl, shouldLoad])

  // Cleanup thumbnail URL when component unmounts or URL changes
  useEffect(() => {
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl)
      }
    }
  }, [thumbnailUrl])

  return {
    thumbnailUrl,
    isLoading,
    error
  }
}
