import { useState, useCallback, useRef, useEffect } from 'react'

interface UseResizableOptions {
  initialWidth: number
  minWidth?: number
  maxWidth?: number
  onWidthChange?: (width: number) => void
  direction?: 'left' | 'right'
}

interface UseResizableReturn {
  width: number
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
  handleTouchStart: (e: React.TouchEvent) => void
}

export function useResizable(options: UseResizableOptions): UseResizableReturn {
  const {
    initialWidth,
    minWidth = 200,
    maxWidth = 800,
    onWidthChange,
    direction = 'left',
  } = options

  const [width, setWidth] = useState(initialWidth)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(initialWidth)

  // Sync with external width changes
  useEffect(() => {
    setWidth(initialWidth)
  }, [initialWidth])

  const handleMove = useCallback(
    (clientX: number) => {
      const deltaX = clientX - startXRef.current
      // For left-edge dragging, moving left increases width
      const multiplier = direction === 'left' ? -1 : 1
      const newWidth = startWidthRef.current + deltaX * multiplier
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))

      setWidth(clampedWidth)
    },
    [direction, minWidth, maxWidth]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      e.preventDefault()
      requestAnimationFrame(() => handleMove(e.clientX))
    },
    [isDragging, handleMove]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging) return
      e.preventDefault()
      const touch = e.touches[0]
      if (touch) {
        requestAnimationFrame(() => handleMove(touch.clientX))
      }
    },
    [isDragging, handleMove]
  )

  const handleEnd = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      onWidthChange?.(width)
    }
  }, [isDragging, width, onWidthChange])

  // Add/remove global listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleEnd)
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleEnd)

      // Prevent text selection during drag
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ew-resize'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleEnd)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, handleMouseMove, handleTouchMove, handleEnd])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startXRef.current = e.clientX
      startWidthRef.current = width
      setIsDragging(true)
    },
    [width]
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (touch) {
        startXRef.current = touch.clientX
        startWidthRef.current = width
        setIsDragging(true)
      }
    },
    [width]
  )

  return {
    width,
    isDragging,
    handleMouseDown,
    handleTouchStart,
  }
}
