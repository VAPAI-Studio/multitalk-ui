export interface Mask {
  id: string
  name: string
  maskData: string | null // Base64 encoded black/white PNG image
}

export interface AudioTrack {
  id: string
  file: File
  startTime: number // seconds
  duration: number // seconds
  name: string
  assignedMaskId: string | null
}

export interface VideoResult {
  filename: string
  subfolder?: string | null
  type?: string | null
}