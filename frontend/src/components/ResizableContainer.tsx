import React from 'react'
import { useResizable } from '../hooks/useResizable'

interface ResizableContainerProps {
  children: React.ReactNode
  width: number
  minWidth?: number
  maxWidth?: number
  onWidthChange: (width: number) => void
  resizePosition?: 'left' | 'right'
  className?: string
}

export default function ResizableContainer({
  children,
  width,
  minWidth = 280,
  maxWidth = 600,
  onWidthChange,
  resizePosition = 'left',
  className = '',
}: ResizableContainerProps) {
  const { width: currentWidth, isDragging, handleMouseDown, handleTouchStart } = useResizable({
    initialWidth: width,
    minWidth,
    maxWidth,
    onWidthChange,
    direction: resizePosition,
  })

  return (
    <div
      className={`relative ${className}`}
      style={{ width: `${currentWidth}px` }}
    >
      {/* Resize handle */}
      <div
        className={`absolute top-0 bottom-0 w-1.5 cursor-ew-resize z-10 group
          ${resizePosition === 'left' ? 'left-0 -ml-0.5' : 'right-0 -mr-0.5'}
        `}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Visual indicator */}
        <div
          className={`absolute inset-y-0 w-1 transition-colors duration-150
            ${resizePosition === 'left' ? 'left-0' : 'right-0'}
            ${isDragging ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-400/50'}
          `}
        />
        {/* Larger touch target */}
        <div className="absolute inset-y-0 -left-2 -right-2" />
      </div>

      {/* Content */}
      <div className="h-full">
        {children}
      </div>
    </div>
  )
}
