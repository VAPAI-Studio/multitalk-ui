import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AudioTrack } from './types'

export interface TimelineProps {
  tracks: AudioTrack[]
  totalDuration: number
  onUpdateTrackTime: (id: string, startTime: number) => void
  onRemoveTrack: (id: string) => void
  onUpdateTotalDuration: (duration: number) => void
}

export function Timeline({ tracks, totalDuration, onUpdateTrackTime, onRemoveTrack, onUpdateTotalDuration }: TimelineProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const rafId = useRef<number | null>(null)
  const playT0 = useRef<number>(0)

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

  const minDuration = useMemo(() => {
    if (!tracks.length) return 5
    return Math.ceil(Math.max(...tracks.map(t => t.startTime + t.duration)))
  }, [tracks])

  useEffect(() => { if (minDuration > totalDuration) onUpdateTotalDuration(minDuration) }, [minDuration])

  useEffect(() => () => { // cleanup
    if (rafId.current) cancelAnimationFrame(rafId.current)
    Object.values(audioEls.current).forEach(a => { a.pause(); URL.revokeObjectURL(a.src) })
  }, [])

  const tick = useCallback(() => {
    const t = (performance.now() - playT0.current) / 1000
    setCurrentTime(t)
    if (t >= totalDuration) {
      setIsPlaying(false)
      Object.values(audioEls.current).forEach(a => { a.pause(); a.currentTime = 0 })
      return
    }
    rafId.current = requestAnimationFrame(tick)
  }, [totalDuration])

  const handlePlay = async () => {
    if (!tracks.length) return
    if (isPlaying) {
      setIsPlaying(false)
      setCurrentTime(0)
      if (rafId.current) cancelAnimationFrame(rafId.current)
      Object.values(audioEls.current).forEach(a => { a.pause(); a.currentTime = 0 })
      return
    }
    // Prepare audio elements
    for (const t of tracks) {
      if (!audioEls.current[t.id]) {
        const el = new Audio()
        el.src = URL.createObjectURL(t.file)
        audioEls.current[t.id] = el
      }
    }
    setIsPlaying(true)
    setCurrentTime(0)
    playT0.current = performance.now()
    // schedule play (rough, good enough for preview)
    tracks.forEach(t => {
      const el = audioEls.current[t.id]
      if (!el) return
      el.onended = null
      setTimeout(() => { el.currentTime = 0; el.play().catch(() => {}) }, t.startTime * 1000)
    })
    rafId.current = requestAnimationFrame(tick)
  }

  // drag handler for rectangles
  const onRectMouseDown = (trackId: string, e: React.MouseEvent<HTMLDivElement>) => {
    const track = tracks.find(t => t.id === trackId); if (!track) return
    const container = (e.currentTarget.parentElement as HTMLDivElement)
    const rect = container.getBoundingClientRect()

    const onMove = (ev: MouseEvent) => {
      const mouseX = ev.clientX - rect.left
      const width = rect.width
      const newStart = (mouseX / width) * totalDuration
      const clamped = Math.max(0, Math.min(totalDuration - track.duration, newStart))
      onUpdateTrackTime(trackId, clamped)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-emerald-200 p-3 bg-emerald-50">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-emerald-800">Duración total</span>
          {!!tracks.length && <span className="text-xs text-emerald-700">Mínimo: {fmt(minDuration)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={minDuration}
            max={600}
            value={totalDuration}
            onChange={(e) => onUpdateTotalDuration(Math.max(minDuration, Number(e.target.value) || minDuration))}
            className="w-20 rounded border border-emerald-300 bg-white px-2 py-1 text-center"
          />
          <span className="text-sm text-emerald-800">seg</span>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow-sm p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Timeline</h3>
          <div className="flex items-center gap-3">
            {isPlaying && <div className="text-sm text-gray-600">{fmt(currentTime)} / {fmt(totalDuration)}</div>}
            <button
              onClick={handlePlay}
              disabled={!tracks.length}
              className={`px-4 py-2 rounded-md text-white font-medium ${!tracks.length ? 'bg-gray-300' : isPlaying ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {isPlaying ? '⏹ Stop' : '▶️ Play mix'}
            </button>
          </div>
        </div>

        {/* scale markers */}
        <div className="mb-1 flex justify-between text-[11px] text-gray-400 px-1">
          {Array.from({ length: Math.min(Math.floor(totalDuration / 5), 12) + 1 }).map((_, i) => (
            <span key={i}>{i * 5}s</span>
          ))}
        </div>

        <div className="relative rounded border border-gray-300 bg-gray-100" style={{ minHeight: Math.max(80, tracks.length * 56 + 16) }}>
          {/* grid */}
          {Array.from({ length: Math.floor(totalDuration / 5) + 1 }).map((_, i) => (
            <div key={i} className="absolute top-0 h-full w-px bg-gray-300" style={{ left: `${(i * 5 / totalDuration) * 100}%` }} />
          ))}

          {/* playhead */}
          {isPlaying && <div className="absolute top-0 h-full w-0.5 bg-red-500" style={{ left: `${(currentTime / totalDuration) * 100}%` }} />}

          {/* rows */}
          {tracks.map((t, i) => {
            const top = i * 56 + 8
            return (
              <div key={t.id} className="absolute left-2 text-[11px] text-gray-600 font-medium" style={{ top: top + 10 }}>Track {i + 1}</div>
            )
          })}

          {tracks.map((t, i) => {
            const left = (t.startTime / totalDuration) * 100
            const width = (t.duration / totalDuration) * 100
            const top = i * 56 + 8
            const colors = [
              'bg-emerald-500 border-emerald-600',
              'bg-blue-500 border-blue-600',
              'bg-purple-500 border-purple-600',
              'bg-pink-500 border-pink-600',
              'bg-orange-500 border-orange-600'
            ]
            const color = colors[i % colors.length]
            return (
              <div
                key={t.id}
                className={`absolute h-9 ${color} border-2 rounded shadow-sm hover:shadow md:transition-shadow cursor-move select-none`}
                style={{ left: `${left}%`, width: `${width}%`, top }}
                onMouseDown={(e) => onRectMouseDown(t.id, e)}
                title={`${t.name} — ${fmt(t.duration)}`}
              >
                <div className="h-full flex items-center justify-center text-white text-[11px] font-medium px-2 truncate">
                  {t.name.length > 16 ? `${t.name.slice(0, 16)}…` : t.name} <span className="opacity-80 ml-1">({fmt(t.duration)})</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveTrack(t.id) }}
                  title="Eliminar"
                  className="absolute -top-2 -right-2 grid h-4 w-4 place-items-center rounded-full bg-red-600 text-white text-[10px]"
                >×</button>
              </div>
            )
          })}

          {!tracks.length && (
            <div className="absolute inset-0 grid place-items-center text-gray-500 text-sm"><div>Arrastra audios aquí</div></div>
          )}
        </div>

        {!!tracks.length && (
          <div className="mt-3 space-y-2">
            {tracks.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded bg-gray-50 p-2 text-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="font-medium truncate max-w-[240px]" title={t.name}>{t.name}</span>
                  {t.assignedMaskId && <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] text-green-700">✓ Mask</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Inicio {fmt(t.startTime)}</span>
                  <span className="text-gray-600">Dur. {fmt(t.duration)}</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, totalDuration - t.duration)}
                    step={0.5}
                    value={Number(t.startTime.toFixed(1))}
                    onChange={(e) => onUpdateTrackTime(t.id, Number(e.target.value))}
                    className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-right"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}