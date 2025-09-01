import type { AudioTrack, VideoResult } from './types'
import { uploadVideoToSupabaseStorage } from '../lib/storageUtils'
import { completeJob } from '../lib/jobTracking'
import { apiClient } from '../lib/apiClient'

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export async function uploadMediaToComfy(baseUrl: string, file: File): Promise<string> {
  const form = new FormData()
  // La clave estándar es "image" aunque sea audio; ComfyUI lo guarda igual
  form.append("image", file, file.name)

  try {
    const r = await fetch(`${baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      credentials: "omit", // importantísimo para evitar preflight
    })
    
    if (!r.ok) {
      throw new Error(`Upload falló: HTTP ${r.status}`)
    }

    // Respuestas típicas de ComfyUI
    let data: any = null
    try { 
      data = await r.json() 
    } catch { 
      // Puede ser texto plano
    }
    
    if (data?.name) return data.name as string
    
    if (Array.isArray(data?.files) && data.files[0]) return data.files[0] as string
    
    const text = typeof data === "string" ? data : await r.text().catch(() => "")
    if (text.trim()) return text.trim()
    
    throw new Error("Respuesta inesperada del servidor")
    
  } catch (e: any) {
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      throw new Error('No se pudo conectar a ComfyUI. Verificá que la URL sea correcta y que ComfyUI esté ejecutándose.')
    }
    if (e.name === 'TimeoutError') {
      throw new Error('Timeout al subir archivo a ComfyUI. El archivo puede ser muy grande o ComfyUI está sobrecargado.')
    }
    throw new Error(`No se pudo subir el archivo a ComfyUI: ${e.message}`)
  }
}

export async function mixAudioTracksToWav(tracks: AudioTrack[], totalDuration: number): Promise<File> {
  if (!tracks.length) throw new Error('No audio tracks')
  // Decode with a real AudioContext (required by some browsers), then render with OfflineAudioContext
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const live = new AC()
  const decoded = await Promise.all(tracks.map(async (t) => {
    const buf = await t.file.arrayBuffer()
    const audio = await live.decodeAudioData(buf.slice(0))
    return { t, audio }
  }))
  const sampleRate = 48000
  const length = Math.ceil(totalDuration * sampleRate)
  const offline = new (window as any).OfflineAudioContext(2, length, sampleRate)
  decoded.forEach(({ t, audio }) => {
    const src = offline.createBufferSource()
    // Upmix/Downmix to 2 channels
    let buffer = audio
    if (audio.numberOfChannels !== 2) {
      const tmp = offline.createBuffer(2, audio.length, audio.sampleRate)
      const ch0 = audio.getChannelData(0)
      const L = tmp.getChannelData(0)
      const R = tmp.getChannelData(1)
      if (audio.numberOfChannels === 1) {
        for (let i = 0; i < ch0.length; i++) { L[i] = ch0[i]; R[i] = ch0[i] }
      } else {
        // more than 2 channels, just copy first two
        tmp.copyToChannel(audio.getChannelData(0), 0)
        tmp.copyToChannel(audio.getChannelData(1), 1)
      }
      buffer = tmp
    }
    src.buffer = buffer
    const gain = offline.createGain()
    gain.gain.value = 1 // simple sum; can expose per-track later
    src.connect(gain).connect(offline.destination)
    src.start(t.startTime)
  })
  const rendered = await offline.startRendering()
  live.close()
  const wavBlob = audioBufferToWavBlob(rendered)
  return new File([wavBlob], 'mix.wav', { type: 'audio/wav' })
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels
  const length = buffer.length * numOfChan * 2 + 44
  const ab = new ArrayBuffer(length)
  const view = new DataView(ab)
  // RIFF/WAVE header
  writeUTFBytes(view, 0, 'RIFF')
  view.setUint32(4, length - 8, true)
  writeUTFBytes(view, 8, 'WAVE')
  writeUTFBytes(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // length
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numOfChan, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * numOfChan * 2, true)
  view.setUint16(32, numOfChan * 2, true)
  view.setUint16(34, 16, true)
  writeUTFBytes(view, 36, 'data')
  view.setUint32(40, length - 44, true)
  // write PCM
  let offset = 44
  const channels: Float32Array[] = []
  for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i))
  const interleaved = interleave(channels)
  const volume = 0x7fff
  for (let i = 0; i < interleaved.length; i++, offset += 2) {
    view.setInt16(offset, Math.max(-1, Math.min(1, interleaved[i])) * volume, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

function writeUTFBytes(view: DataView, offset: number, str: string) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }

function interleave(channels: Float32Array[]): Float32Array {
  const length = channels[0].length
  const result = new Float32Array(length * channels.length)
  let idx = 0
  for (let i = 0; i < length; i++) for (let c = 0; c < channels.length; c++) result[idx++] = channels[c][i]
  return result
}

export async function pollForResult(promptId: string, baseUrl: string, intervalMs: number, maxSeconds: number, jobId?: string) {
  const start = Date.now();
  while (Date.now() - start < maxSeconds * 1000) {
    try {
      await new Promise((r) => setTimeout(r, intervalMs));
      const response = await apiClient.getComfyUIHistory(baseUrl, promptId) as { success: boolean; history?: any; error?: string };
      if (!response.success) {
        throw new Error(response.error || 'Failed to get ComfyUI history');
      }
      const data = response.history;
      
      // Check for ComfyUI errors in the response
      const historyEntry = data?.[promptId];
      if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
        const errorMsg = historyEntry.status?.error?.message || 
                        historyEntry.status?.error || 
                        "Error desconocido en ComfyUI";
        throw new Error(`Error en ComfyUI: ${errorMsg}`);
      }

      const found = findVideoFromHistory(data);
      if (found) {
        // Upload video to Supabase Storage if we have a jobId
        if (jobId && found.filename) {
          // Video found, uploading to Supabase Storage
          try {
            const uploadResult = await uploadVideoToSupabaseStorage(
              baseUrl,
              found.filename,
              found.subfolder || '',
              jobId
            );
            
            if (uploadResult.success && uploadResult.publicUrl) {
              // Update job with Supabase Storage URL
              // Video upload successful
              await completeJob({
                job_id: jobId,
                status: 'completed',
                filename: found.filename,
                subfolder: found.subfolder || undefined,
                video_url: uploadResult.publicUrl
              });
              // Job completed with Supabase URL
            } else {
              console.error('❌ Failed to upload video to Supabase Storage:', uploadResult.error);
              // Completing job without Supabase URL - video will fallback to ComfyUI
              // Still complete the job with ComfyUI info
              await completeJob({
                job_id: jobId,
                status: 'completed',
                filename: found.filename,
                subfolder: found.subfolder || undefined
              });
            }
          } catch (uploadError) {
            console.error('❌ Error during video upload:', uploadError);
            // Completing job without Supabase URL due to upload error
            // Still complete the job with ComfyUI info
            await completeJob({
              job_id: jobId,
              status: 'completed',
              filename: found.filename,
              subfolder: found.subfolder || undefined
            });
          }
        }
        return data;
      }
      
      // Check if processing is complete but no video found
      if (historyEntry?.status?.status_str === "success" || historyEntry?.status?.completed) {
        throw new Error("ComfyUI completó el procesamiento pero no se encontró video de salida");
      }
      
    } catch (error: any) {
      // If it's a ComfyUI error, throw it immediately
      if (error.message.includes('ComfyUI') || error.message.includes('Error en ComfyUI')) {
        throw error;
      }
      // For network errors, continue retrying
      // Network error during polling, retrying
    }
  }
  throw new Error(`Timeout: ComfyUI no completó el procesamiento en ${maxSeconds} segundos`);
}

export function findVideoFromHistory(historyJson: any): VideoResult | null {
  if (!historyJson) return null;

  const tryScanOutputs = (outputs: any): VideoResult | null => {
    if (!outputs || typeof outputs !== 'object') return null;
    for (const k of Object.keys(outputs)) {
      const out = outputs[k];
      const arrays = ['videos', 'gifs', 'images', 'items', 'files'];
      for (const arrName of arrays) {
        const arr = out?.[arrName];
        if (Array.isArray(arr)) {
          const mp4 = arr.find((x: any) => typeof x?.filename === 'string' && /\.mp4$/i.test(x.filename));
          if (mp4) return { filename: mp4.filename, subfolder: mp4.subfolder ?? null, type: mp4.type ?? null };
        }
      }
      if (out && typeof out === 'object') {
        const nested: VideoResult | null = tryScanOutputs(out);
        if (nested) return nested;
      }
    }
    return null;
  };

  if (historyJson.outputs) {
    const hit = tryScanOutputs(historyJson.outputs);
    if (hit) return hit;
  }

  for (const key of Object.keys(historyJson)) {
    const maybe = historyJson[key];
    if (maybe?.outputs) {
      const hit = tryScanOutputs(maybe.outputs);
      if (hit) return hit;
    }
  }

  return null;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// Monitor job status periodically after submission
export function startJobMonitoring(
  jobId: string,
  baseUrl: string,
  onStatusUpdate: (status: 'processing' | 'completed' | 'error', message?: string, videoInfo?: any) => void,
  maxMinutes: number = 30
) {
  const startTime = Date.now();
  const maxTime = maxMinutes * 60 * 1000;
  
  const checkStatus = async () => {
    try {
      const response = await apiClient.getComfyUIHistory(baseUrl, jobId) as { success: boolean; history?: any; error?: string };
      if (!response.success) {
        throw new Error(response.error || 'Failed to get ComfyUI history');
      }
      const data = response.history;
      const historyEntry = data?.[jobId];
      
      if (!historyEntry) {
        // Job not found yet, continue polling
        return;
      }
      
      // Check for errors
      if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
        const errorMsg = historyEntry.status?.error?.message || 
                        historyEntry.status?.error || 
                        "Error desconocido en ComfyUI";
        onStatusUpdate('error', `Error en ComfyUI: ${errorMsg}`);
        return 'stop';
      }
      
      // Check if completed
      if (historyEntry?.status?.status_str === "success" || historyEntry?.status?.completed) {
        const videoInfo = findVideoFromHistory(data);
        if (videoInfo) {
          // Upload video to Supabase Storage
          console.log('Video completed, uploading to Supabase Storage...');
          try {
            const uploadResult = await uploadVideoToSupabaseStorage(
              baseUrl,
              videoInfo.filename,
              videoInfo.subfolder || '',
              jobId
            );
            
            if (uploadResult.success && uploadResult.publicUrl) {
              // Update job with Supabase Storage URL
              // Video upload successful
              await completeJob({
                job_id: jobId,
                status: 'completed',
                filename: videoInfo.filename,
                subfolder: videoInfo.subfolder || undefined,
                video_url: uploadResult.publicUrl
              });
              // Job completed with Supabase URL
              onStatusUpdate('completed', 'Video guardado y completado', { ...videoInfo, video_url: uploadResult.publicUrl });
            } else {
              console.error('❌ Failed to upload video to Supabase Storage:', uploadResult.error);
              // Completing job without Supabase URL - video will fallback to ComfyUI
              // Still complete the job with ComfyUI info
              await completeJob({
                job_id: jobId,
                status: 'completed',
                filename: videoInfo.filename,
                subfolder: videoInfo.subfolder || undefined
              });
              onStatusUpdate('completed', 'Procesamiento completado (sin subir a storage)', videoInfo);
            }
          } catch (uploadError) {
            console.error('❌ Error during video upload:', uploadError);
            // Completing job without Supabase URL due to upload error
            // Still complete the job with ComfyUI info
            await completeJob({
              job_id: jobId,
              status: 'completed',
              filename: videoInfo.filename,
              subfolder: videoInfo.subfolder || undefined
            });
            onStatusUpdate('completed', 'Procesamiento completado (error subiendo)', videoInfo);
          }
        } else {
          onStatusUpdate('error', 'ComfyUI completó pero no se encontró video de salida');
        }
        return 'stop';
      }
      
      // Still processing
      onStatusUpdate('processing', 'Procesando en ComfyUI…');
      
    } catch (error: any) {
      console.warn('Error checking job status:', error.message);
      // Don't stop monitoring on network errors, just continue
    }
  };
  
  const intervalId = setInterval(async () => {
    // Check if we've exceeded max time
    if (Date.now() - startTime > maxTime) {
      clearInterval(intervalId);
      onStatusUpdate('error', `Timeout: Job no completó en ${maxMinutes} minutos`);
      return;
    }
    
    const result = await checkStatus();
    if (result === 'stop') {
      clearInterval(intervalId);
    }
  }, 3000); // Check every 3 seconds
  
  // Return cleanup function
  return () => clearInterval(intervalId);
}

// Check if ComfyUI is available and properly configured
export async function checkComfyUIHealth(baseUrl: string): Promise<{ 
  available: boolean; 
  error?: string; 
  details?: string 
}> {
  try {
    // First check if the server responds at all
    const healthResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/system_stats`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000), // 10 second timeout
      cache: 'no-store'
    });
    
    if (!healthResponse.ok) {
      return {
        available: false,
        error: `ComfyUI no responde correctamente (Status: ${healthResponse.status})`,
        details: 'El servidor está ejecutándose pero devuelve errores. Puede estar inicializando o tener problemas de configuración.'
      };
    }

    // Try to get the queue status to ensure ComfyUI core is working
    const queueResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/queue`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store'
    });

    if (!queueResponse.ok) {
      return {
        available: false,
        error: 'ComfyUI está ejecutándose pero la API de queue no responde',
        details: 'El servidor básico funciona pero ComfyUI puede no estar completamente inicializado.'
      };
    }

    // Check if we can get object info (indicates nodes are loaded)
    const objectInfoResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/object_info`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store'
    });

    if (!objectInfoResponse.ok) {
      return {
        available: false,
        error: 'ComfyUI está inicializando',
        details: 'El servidor está ejecutándose pero aún no ha cargado todos los nodos. Esperá unos momentos.'
      };
    }

    const objectInfo = await objectInfoResponse.json();
    
    // Check for essential nodes we need
    const requiredNodes = ['MultiTalkModelLoader', 'WanVideoSampler', 'Base64DecodeNode'];
    const missingNodes = requiredNodes.filter(node => !objectInfo[node]);
    
    if (missingNodes.length > 0) {
      return {
        available: false,
        error: 'Nodos requeridos no encontrados',
        details: `Faltan los nodos: ${missingNodes.join(', ')}. Asegurate de tener instalados MultiTalk y WanVideo extensions.`
      };
    }

    return { available: true };

  } catch (error: any) {
    if (error.name === 'TimeoutError') {
      return {
        available: false,
        error: 'Timeout al conectar con ComfyUI',
        details: 'ComfyUI no responde. Verificá que esté ejecutándose y la URL sea correcta.'
      };
    }
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return {
        available: false,
        error: 'No se puede conectar a ComfyUI',
        details: 'Verificá que ComfyUI esté ejecutándose en la URL proporcionada y que CORS esté habilitado.'
      };
    }

    return {
      available: false,
      error: 'Error verificando ComfyUI',
      details: error.message || 'Error desconocido al verificar el estado de ComfyUI.'
    };
  }
}

// Join audio tracks assigned to the same mask into a single audio file
export async function joinAudiosForMask(tracks: AudioTrack[], totalDuration: number): Promise<File> {
  if (!tracks.length) throw new Error('No audio tracks provided')
  
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const live = new AC()
  
  // Decode all tracks
  const decoded = await Promise.all(tracks.map(async (t) => {
    const buf = await t.file.arrayBuffer()
    const audio = await live.decodeAudioData(buf.slice(0))
    return { t, audio }
  }))
  
  const sampleRate = 48000
  const length = Math.ceil(totalDuration * sampleRate)
  const offline = new (window as any).OfflineAudioContext(2, length, sampleRate)
  
  // Audio mixing setup complete
  
  // Add each track at its specific time with silence padding
  decoded.forEach(({ t, audio }) => {
    const src = offline.createBufferSource()
    
    // Ensure stereo output
    let buffer = audio
    if (audio.numberOfChannels !== 2) {
      const tmp = offline.createBuffer(2, audio.length, audio.sampleRate)
      const ch0 = audio.getChannelData(0)
      const L = tmp.getChannelData(0)
      const R = tmp.getChannelData(1)
      if (audio.numberOfChannels === 1) {
        for (let i = 0; i < ch0.length; i++) { L[i] = ch0[i]; R[i] = ch0[i] }
      } else {
        tmp.copyToChannel(audio.getChannelData(0), 0)
        tmp.copyToChannel(audio.getChannelData(1), 1)
      }
      buffer = tmp
    }
    
    src.buffer = buffer
    src.connect(offline.destination)
    src.start(t.startTime)
  })
  
  const rendered = await offline.startRendering()
  live.close()
  
  const wavBlob = audioBufferToWavBlob(rendered)
  return new File([wavBlob], `mask_audio_${generateId()}.wav`, { type: 'audio/wav' })
}

// Group audio tracks by their assigned mask
export function groupAudiosByMask(tracks: AudioTrack[]): Record<string, AudioTrack[]> {
  return tracks.reduce((groups, track) => {
    if (!track.assignedMaskId) return groups
    if (!groups[track.assignedMaskId]) groups[track.assignedMaskId] = []
    groups[track.assignedMaskId].push(track)
    return groups
  }, {} as Record<string, AudioTrack[]>)
}

// Convert canvas ImageData to black/white PNG as base64
export function imageDataToBlackWhitePng(imageData: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')!
  
  // Create black/white version
  const blackWhiteData = new ImageData(imageData.width, imageData.height)
  const src = imageData.data
  const dst = blackWhiteData.data
  
  for (let i = 0; i < src.length; i += 4) {
    // Check if pixel has any color content (not transparent black)
    const hasContent = src[i + 3] > 0 && (src[i] + src[i + 1] + src[i + 2] > 0)
    
    if (hasContent) {
      // White pixel (painted area)
      dst[i] = 255     // R
      dst[i + 1] = 255 // G  
      dst[i + 2] = 255 // B
      dst[i + 3] = 255 // A
    } else {
      // Black pixel (background)
      dst[i] = 0       // R
      dst[i + 1] = 0   // G
      dst[i + 2] = 0   // B  
      dst[i + 3] = 255 // A
    }
  }
  
  ctx.putImageData(blackWhiteData, 0, 0)
  return canvas.toDataURL('image/png')
}

// Convert base64 PNG back to ImageData for editing
export function blackWhitePngToImageData(base64Png: string, width: number, height: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      
      // Draw the image scaled to match canvas dimensions
      ctx.drawImage(img, 0, 0, width, height)
      const imageData = ctx.getImageData(0, 0, width, height)
      resolve(imageData)
    }
    img.onerror = () => reject(new Error('Failed to load mask image'))
    img.src = base64Png
  })
}

// Create an empty black mask
export function createEmptyBlackMask(width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  
  // Fill with black
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)
  
  return canvas.toDataURL('image/png')
}

// Convert base64 PNG to File for upload
export function base64PngToFile(base64Png: string, filename: string): File {
  // Convert base64 to blob
  const byteCharacters = atob(base64Png.split(',')[1])
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: 'image/png' })
  
  return new File([blob], filename, { type: 'image/png' })
}