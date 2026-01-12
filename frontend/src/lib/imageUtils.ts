/**
 * Image utility functions for thumbnail generation and optimization.
 * Uses Supabase Image Transformation API for on-the-fly thumbnail generation.
 */

// Supabase URL pattern: https://xxx.supabase.co/storage/v1/object/public/bucket/path
const SUPABASE_STORAGE_PATTERN = /^(https:\/\/[^/]+\.supabase\.co)\/storage\/v1\/object\/public\/(.+)$/

/**
 * Converts a Supabase Storage public URL to a thumbnail URL using Image Transformation API.
 * Falls back to original URL for non-Supabase URLs or if transformation isn't available.
 *
 * @param url - The original image URL
 * @param options - Thumbnail options
 * @returns Transformed URL for thumbnails, or original URL if not a Supabase URL
 *
 * @example
 * // Basic usage - creates a 200x200 thumbnail
 * getThumbnailUrl('https://xxx.supabase.co/storage/v1/object/public/images/photo.jpg')
 * // Returns: https://xxx.supabase.co/storage/v1/render/image/public/images/photo.jpg?width=200&height=200&resize=cover
 *
 * @example
 * // Custom size
 * getThumbnailUrl(url, { width: 400, height: 300 })
 *
 * @example
 * // With quality setting
 * getThumbnailUrl(url, { width: 200, height: 200, quality: 75 })
 */
export function getThumbnailUrl(
  url: string | null | undefined,
  options: {
    width?: number
    height?: number
    resize?: 'cover' | 'contain' | 'fill'
    quality?: number
  } = {}
): string {
  // Return empty string for null/undefined URLs
  if (!url) {
    return ''
  }

  // Default options for feed thumbnails
  // Note: WebP format not available on all Supabase plans, so we skip format conversion
  const {
    width = 200,
    height = 200,
    resize = 'cover',
    quality = 80
  } = options

  // Check if this is a Supabase Storage URL
  const match = url.match(SUPABASE_STORAGE_PATTERN)
  if (!match) {
    // Not a Supabase URL, return original
    // This handles ComfyUI URLs and other external URLs
    return url
  }

  const [, baseUrl, path] = match

  // Build transformation URL
  // Format: /storage/v1/render/image/public/{path}?width=X&height=Y&resize=mode
  const params = new URLSearchParams()
  params.append('width', width.toString())
  params.append('height', height.toString())
  params.append('resize', resize)

  if (quality && quality < 100) {
    params.append('quality', quality.toString())
  }

  // Note: format parameter (webp) not available on all Supabase plans
  // Images will be served in their original format but resized

  return `${baseUrl}/storage/v1/render/image/public/${path}?${params.toString()}`
}

/**
 * Check if a URL is a Supabase Storage URL
 */
export function isSupabaseStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return SUPABASE_STORAGE_PATTERN.test(url)
}

/**
 * Check if a URL is a ComfyUI/local URL (not Supabase)
 */
export function isComfyUIUrl(url: string | null | undefined): boolean {
  if (!url) return false
  // ComfyUI URLs typically contain /view? or are from localhost/comfy domains
  return url.includes('/view?') ||
         url.includes('localhost:') ||
         url.includes('127.0.0.1:') ||
         url.includes('comfy.')
}

/**
 * Get a small thumbnail for feed grid display (96px)
 */
export function getFeedThumbnailUrl(url: string | null | undefined): string {
  return getThumbnailUrl(url, {
    width: 192, // 2x for retina displays
    height: 192,
    resize: 'cover',
    quality: 75
  })
}

/**
 * Get a medium thumbnail for preview/hover (400px)
 */
export function getPreviewThumbnailUrl(url: string | null | undefined): string {
  return getThumbnailUrl(url, {
    width: 400,
    height: 400,
    resize: 'contain',
    quality: 80
  })
}

/**
 * Get a large thumbnail for modal display (800px)
 */
export function getModalThumbnailUrl(url: string | null | undefined): string {
  return getThumbnailUrl(url, {
    width: 800,
    height: 800,
    resize: 'contain',
    quality: 85
  })
}
