import { useState, useEffect, useCallback } from 'react'

/**
 * Custom hook for smart resolution input handling
 * Allows free input but auto-corrects to nearest multiple of 32 after 2 seconds of inactivity
 */
export function useSmartResolution(initialWidth: number = 1280, initialHeight: number = 720) {
  const [width, setWidthInternal] = useState(initialWidth)
  const [height, setHeightInternal] = useState(initialHeight)
  const [widthInput, setWidthInput] = useState(initialWidth.toString())
  const [heightInput, setHeightInput] = useState(initialHeight.toString())

  // Helper function to round to nearest multiple of 32
  const roundToNearestMultiple32 = useCallback((value: number) => {
    return Math.max(32, Math.round(value / 32) * 32)
  }, [])

  // Auto-correct width after 2 seconds of inactivity
  useEffect(() => {
    const timeout = setTimeout(() => {
      const numericValue = parseInt(widthInput) || 32
      const correctedValue = roundToNearestMultiple32(numericValue)
      
      if (correctedValue !== width) {
        setWidthInternal(correctedValue)
        setWidthInput(correctedValue.toString())
      }
    }, 2000)

    return () => clearTimeout(timeout)
  }, [widthInput, width, roundToNearestMultiple32])

  // Auto-correct height after 2 seconds of inactivity
  useEffect(() => {
    const timeout = setTimeout(() => {
      const numericValue = parseInt(heightInput) || 32
      const correctedValue = roundToNearestMultiple32(numericValue)
      
      if (correctedValue !== height) {
        setHeightInternal(correctedValue)
        setHeightInput(correctedValue.toString())
      }
    }, 2000)

    return () => clearTimeout(timeout)
  }, [heightInput, height, roundToNearestMultiple32])

  // Handlers for input changes (immediate, no correction)
  const handleWidthChange = useCallback((value: string) => {
    setWidthInput(value)
    // Immediately update the numeric value for real-time feedback
    const numericValue = parseInt(value) || 32
    setWidthInternal(numericValue)
  }, [])

  const handleHeightChange = useCallback((value: string) => {
    setHeightInput(value)
    // Immediately update the numeric value for real-time feedback
    const numericValue = parseInt(value) || 32
    setHeightInternal(numericValue)
  }, [])

  // External setters for programmatic updates (e.g., aspect ratio calculations)
  const setWidth = useCallback((value: number) => {
    const correctedValue = roundToNearestMultiple32(value)
    setWidthInternal(correctedValue)
    setWidthInput(correctedValue.toString())
  }, [roundToNearestMultiple32])

  const setHeight = useCallback((value: number) => {
    const correctedValue = roundToNearestMultiple32(value)
    setHeightInternal(correctedValue)
    setHeightInput(correctedValue.toString())
  }, [roundToNearestMultiple32])

  return {
    // Current values (always multiples of 32)
    width,
    height,
    // Input display values (can be any number temporarily)
    widthInput,
    heightInput,
    // Change handlers for inputs
    handleWidthChange,
    handleHeightChange,
    // Programmatic setters
    setWidth,
    setHeight,
    // Utility
    roundToNearestMultiple32
  }
}