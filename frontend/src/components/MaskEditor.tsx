import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from './DesignSystem'
import { imageDataToBlackWhitePng, blackWhitePngToImageData } from './utils'

export interface MaskEditorProps {
  imageUrl: string
  onMaskUpdate: (maskData: string | null) => void
  maskName: string
  existingMask: string | null
}

export function MaskEditor({ imageUrl, onMaskUpdate, maskName, existingMask }: MaskEditorProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [brush, setBrush] = useState(18)
  const [erase, setErase] = useState(false)
  const drawing = useRef(false)
  const lastPos = useRef<{x: number, y: number} | null>(null)
  const ro = useRef<ResizeObserver | null>(null)

  // Load existing mask if provided
  const loadExistingMask = useCallback(async (base64Png: string, canvas: HTMLCanvasElement) => {
    try {
      const imageData = await blackWhitePngToImageData(base64Png, canvas.width, canvas.height)
      const ctx = canvas.getContext('2d')!
      ctx.putImageData(imageData, 0, 0)
    } catch (error) {
      console.error('Failed to load existing mask:', error)
    }
  }, [])

  const layout = useCallback(() => {
    const overlay = overlayRef.current
    const mask = maskRef.current
    const img = imgRef.current
    if (!overlay || !mask || !img) return
    const { naturalWidth: w, naturalHeight: h } = img
    if (!w || !h) return
    overlay.width = w
    overlay.height = h
    overlay.style.width = '100%'
    overlay.style.height = '100%'
    mask.width = w
    mask.height = h
  }, [])

  const redrawOverlay = useCallback(() => {
    const overlay = overlayRef.current
    const mask = maskRef.current
    if (!overlay || !mask) return
    const ctx = overlay.getContext('2d')!
    
    // Clear the overlay
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    
    // Get the mask data
    const maskImageData = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height)
    const maskData = maskImageData.data
    
    // Create a colored overlay for the mask
    const overlayImageData = ctx.createImageData(overlay.width, overlay.height)
    const overlayData = overlayImageData.data
    
    // Apply blue color with transparency to white pixels in the mask
    for (let i = 0; i < maskData.length; i += 4) {
      const isWhite = maskData[i] > 128 && maskData[i + 1] > 128 && maskData[i + 2] > 128
      if (isWhite) {
        overlayData[i] = 59      // R (blue)
        overlayData[i + 1] = 130 // G
        overlayData[i + 2] = 246 // B
        overlayData[i + 3] = 102 // A (40% opacity: 0.4 * 255 = 102)
      } else {
        overlayData[i] = 0
        overlayData[i + 1] = 0
        overlayData[i + 2] = 0
        overlayData[i + 3] = 0
      }
    }
    
    ctx.putImageData(overlayImageData, 0, 0)
  }, [])

  useEffect(() => {
    const overlay = overlayRef.current
    const mask = maskRef.current
    const img = imgRef.current
    if (!overlay || !mask || !img) return

    const init = async () => {
      layout()
      const mctx = mask.getContext('2d')!
      
      if (existingMask) {
        // Load existing mask first
        await loadExistingMask(existingMask, mask)
      } else {
        // Only clear with black if no existing mask
        mctx.fillStyle = '#000'
        mctx.fillRect(0, 0, mask.width, mask.height)
      }
      
      // Ensure overlay is redrawn after mask is ready
      redrawOverlay()
    }

    if (img.complete) init(); else img.onload = init

    if ('ResizeObserver' in window) {
      ro.current?.disconnect()
      ro.current = new ResizeObserver(() => { layout(); redrawOverlay() })
      ro.current.observe(img)
    }
    return () => ro.current?.disconnect()
  }, [imageUrl, existingMask, layout, redrawOverlay, loadExistingMask])

  const drawBrushStroke = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, brushSize: number = brush) => {
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = erase ? '#000' : '#fff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brushSize * 2
    ctx.strokeStyle = erase ? '#000' : '#fff'
    
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    
    // Add brush caps
    ctx.beginPath()
    ctx.arc(x1, y1, brushSize, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x2, y2, brushSize, 0, Math.PI * 2)
    ctx.fill()
  }, [brush, erase])

  const pointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>, isStart: boolean = false) => {
    const overlay = overlayRef.current
    const mask = maskRef.current
    if (!overlay || !mask) return
    
    const rect = overlay.getBoundingClientRect()
    const sx = overlay.width / rect.width
    const sy = overlay.height / rect.height
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sy
    
    // Scale the brush size to match the coordinate scaling
    const scaledBrush = brush * Math.max(sx, sy)
    
    const ctx = mask.getContext('2d')!
    
    if (isStart || !lastPos.current) {
      // First point - just draw a circle
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = erase ? '#000' : '#fff'
      ctx.beginPath()
      ctx.arc(x, y, scaledBrush, 0, Math.PI * 2)
      ctx.fill()
      lastPos.current = { x, y }
    } else {
      // Draw smooth line from last position to current position
      drawBrushStroke(ctx, lastPos.current.x, lastPos.current.y, x, y, scaledBrush)
      lastPos.current = { x, y }
    }
    
    redrawOverlay()
  }, [brush, erase, redrawOverlay, drawBrushStroke])

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    lastPos.current = null
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    pointer(e, true)
  }
  
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => { 
    if (drawing.current) pointer(e, false) 
  }
  
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = false
    lastPos.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    const mask = maskRef.current
    if (mask) {
      const imageData = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height)
      const blackWhitePng = imageDataToBlackWhitePng(imageData)
      onMaskUpdate(blackWhitePng)
    }
  }
  const clearMask = () => {
    const mask = maskRef.current; if (!mask) return
    const ctx = mask.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mask.width, mask.height)
    redrawOverlay(); onMaskUpdate(null)
  }
  const downloadMask = () => {
    const mask = maskRef.current; if (!mask) return
    const imageData = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height)
    const blackWhitePng = imageDataToBlackWhitePng(imageData)
    const a = document.createElement('a')
    a.download = `${maskName || 'mask'}.png`
    a.href = blackWhitePng
    a.click()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900 text-sm">Editando: {maskName}</h4>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>Brocha</span>
            <Input 
              type="range" 
              min={2} 
              max={100} 
              value={brush} 
              onChange={(e) => setBrush(Number(e.target.value))} 
              className="flex-1"
            />
            <span className="w-8 text-right">{brush}px</span>
          </div>
          <Button 
            variant={erase ? 'danger' : 'primary'} 
            size="sm" 
            onClick={() => setErase(v => !v)}
          >
            {erase ? 'Borrar' : 'Pintar'}
          </Button>
          <Button variant="danger" size="sm" onClick={clearMask}>
            Limpiar
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadMask}>
            Descargar
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white p-2 inline-block">
        <div className="relative">
          <img ref={imgRef} src={imageUrl} alt="base" className="max-w-full h-auto block select-none pointer-events-none" style={{ maxHeight: 260 }} />
          <canvas
            ref={overlayRef}
            className="absolute inset-0"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            style={{ 
              touchAction: 'none',
              cursor: `url("data:image/svg+xml,%3Csvg width='${brush * 2}' height='${brush * 2}' viewBox='0 0 ${brush * 2} ${brush * 2}' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='${brush}' cy='${brush}' r='${brush}' fill='none' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E") ${brush} ${brush}, crosshair`
            }}
          />
          <canvas ref={maskRef} className="hidden" />
        </div>
      </div>
      <p className="text-xs text-gray-500">{erase ? '🧽 Borra áreas de la máscara' : '🖌️ Pinta donde debe aplicarse este audio'}</p>
    </div>
  )
}