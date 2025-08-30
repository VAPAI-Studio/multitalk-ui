import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../lib/apiClient'

interface ComfyUIStatusProps {
  baseUrl: string
}

interface QueueStatus {
  queue_running: any[]
  queue_pending: any[]
}

interface SystemStats {
  system?: {
    python_version?: string
    torch_version?: string
  }
  devices?: Array<{
    name: string
    type: string
    vram_total?: number
    vram_free?: number
  }>
}

interface StatusState {
  connected: boolean
  queue: QueueStatus | null
  systemStats: SystemStats | null
  error: string | null
  lastUpdate: Date | null
}


export default function ComfyUIStatus({ baseUrl }: ComfyUIStatusProps) {
  const [status, setStatus] = useState<StatusState>({
    connected: false,
    queue: null,
    systemStats: null,
    error: null,
    lastUpdate: null
  })


  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchComfyUIStatus = async () => {
    if (!baseUrl) return { connected: false, queue: null, systemStats: null, error: 'No URL provided' }

    try {
      const response = await apiClient.getComfyUIStatus(baseUrl)
      
      if (response.success && response.status) {
        return {
          connected: response.status.connected,
          queue: response.status.queue,
          systemStats: response.status.system_stats,
          error: response.status.error
        }
      } else {
        return {
          connected: false,
          queue: null,
          systemStats: null,
          error: response.error || 'Failed to get ComfyUI status'
        }
      }

    } catch (error: any) {
      return {
        connected: false,
        queue: null,
        systemStats: null,
        error: error.message?.includes('fetch') 
          ? 'Cannot connect to backend API' 
          : error.message || 'Connection failed'
      }
    }
  }

  useEffect(() => {
    const fetchStatus = async () => {
      if (!baseUrl || !baseUrl.trim()) {
        setStatus(prev => ({
          ...prev,
          connected: false,
          error: 'No ComfyUI URL provided',
          lastUpdate: new Date()
        }))
        return
      }

      const comfyStatus = await fetchComfyUIStatus()
      setStatus(prev => ({
        ...prev,
        ...comfyStatus,
        lastUpdate: new Date()
      }))
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    
    return () => clearInterval(interval)
  }, [baseUrl])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  const getStatusColor = () => {
    if (!status.connected) return 'bg-red-500'
    if (status.queue?.queue_running?.length && status.queue.queue_running.length > 0) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getStatusText = () => {
    if (!status.connected) return 'Offline'
    if (status.queue?.queue_running?.length && status.queue.queue_running.length > 0) return 'Processing'
    return 'Ready'
  }



  const formatVRAM = (bytes?: number) => {
    if (!bytes) return 'Unknown'
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(1)} GB`
  }


  return (
    <div className="relative" ref={containerRef}>
      <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-2xl shadow-lg">
        <div 
          className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-700/50 rounded-2xl transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className={`w-3 h-3 rounded-full ${getStatusColor()} animate-pulse`} />
          <span className="font-semibold text-gray-900 dark:text-gray-100">ComfyUI Status</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">{getStatusText()}</span>
          
          <div className="flex items-center gap-2 ml-auto">
            {status.connected && status.queue && status.queue.queue_running.length > 0 && (
              <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full font-medium">
                Running: {status.queue.queue_running.length}
              </span>
            )}
            {status.connected && status.queue && status.queue.queue_pending.length > 0 && (
              <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium">
                Queue: {status.queue.queue_pending.length}
              </span>
            )}
          </div>
          
          <svg 
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-2xl shadow-xl z-50 p-4 space-y-3">
          {status.error && !status.connected && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-red-800 text-sm font-medium">Connection Error</p>
              <p className="text-red-600 text-xs mt-1">{status.error}</p>
            </div>
          )}

          {status.connected && status.queue && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-2">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Queue Status</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white dark:bg-gray-600 rounded-lg p-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300">Running</p>
                  <p className="text-lg font-bold text-yellow-600">{status.queue.queue_running.length}</p>
                </div>
                <div className="bg-white dark:bg-gray-600 rounded-lg p-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300">Pending</p>
                  <p className="text-lg font-bold text-blue-600">{status.queue.queue_pending.length}</p>
                </div>
              </div>
            </div>
          )}

          {status.systemStats && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-2">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">System Info</h4>
              
              {status.systemStats.system && (
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  {status.systemStats.system.python_version && (
                    <p>Python: {status.systemStats.system.python_version.split(' ')[0]}</p>
                  )}
                </div>
              )}
              
              {status.systemStats.devices && status.systemStats.devices.length > 0 && (
                <div className="space-y-1">
                  {status.systemStats.devices.map((device, idx) => {
                    // Clean up device type - remove "cuda" prefix and "cudaMallocAsync" text
                    const cleanDeviceType = device.type.replace(/^cuda/, '').replace(/cudaMallocAsync/, '').trim()
                    const deviceId = cleanDeviceType ? `${cleanDeviceType}:${idx}` : `cuda:${idx}`
                    
                    return (
                      <div key={idx} className="text-xs text-gray-600 dark:text-gray-400">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {deviceId} {device.name}
                        </p>
                        {device.vram_total && (
                          <p className="text-gray-500 dark:text-gray-400">
                            VRAM: {formatVRAM(device.vram_free)} / {formatVRAM(device.vram_total)} free
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {status.lastUpdate && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              ComfyUI updated: {status.lastUpdate.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}