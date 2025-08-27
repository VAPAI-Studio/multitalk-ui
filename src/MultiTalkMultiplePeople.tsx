import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
import { downloadVideoFromComfy, uploadVideoToStorage } from "./lib/supabase";
import { Label, Field, Section, Modal } from "./components/UI";
import { Button, Badge } from "./components/DesignSystem";
import { MaskEditor } from "./components/MaskEditor";
import { Timeline } from "./components/Timeline";
import type { Mask, AudioTrack } from "./components/types";
import { fileToBase64, uploadMediaToComfy, joinAudiosForMask, groupAudiosByMask, generateId, startJobMonitoring, checkComfyUIHealth } from "./components/utils";
import JobFeed from "./components/JobFeed";

interface Props {
  comfyUrl: string;
}

export default function MultiTalkMultiplePeople({ comfyUrl }: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [masks, setMasks] = useState<Mask[]>([])
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [imagePreview, setImagePreview] = useState<string>("")
  const [imageAR, setImageAR] = useState<number | null>(null)
  const [totalDuration, setTotalDuration] = useState<number>(10)
  const [width, setWidth] = useState<number>(1280)
  const [height, setHeight] = useState<number>(720)
  const trimToAudio = true
  const [status, setStatus] = useState<string>("")
  const [videoUrl, setVideoUrl] = useState<string>("")
  const [jobId, setJobId] = useState<string>("")
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [isEditingMask, setIsEditingMask] = useState<string | null>(null)
  const [showMaskModal, setShowMaskModal] = useState<boolean>(false)
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null)
  const [customPrompt, setCustomPrompt] = useState<string>('people talking together')

  const fileInputRef = useRef<HTMLInputElement | null>(null)


  // cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup()
      }
    }
  }, [jobMonitorCleanup])

  // image selection -> preview + dims
  useEffect(() => {
    if (!imageFile) { setImagePreview(''); setImageAR(null); return }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    const img = new Image()
    img.onload = () => {
      const ar = img.width / img.height
      setImageAR(ar)
      // Initialize W/H to the nearest multiples of 32 preserving aspect, max width ~ 1280
      const w = Math.max(32, Math.round(Math.min(1280, img.width) / 32) * 32)
      const h = Math.max(32, Math.round((w / ar) / 32) * 32)
      setWidth(w); setHeight(h)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  // maintain image aspect ratio
  useEffect(() => {
    if (imageAR) {
      const h = Math.max(32, Math.round((width / imageAR) / 32) * 32)
      if (h !== height) setHeight(h)
    }
  }, [width, imageAR, height])


  // masks CRUD
  const createMask = () => {
    const m: Mask = { id: generateId(), name: `Mask ${masks.length + 1}`, maskData: null }
    setMasks(v => [...v, m]); setIsEditingMask(m.id); setShowMaskModal(true)
  }
  const deleteMask = (id: string) => {
    setMasks(v => v.filter(m => m.id !== id))
    setAudioTracks(v => v.map(t => (t.assignedMaskId === id ? { ...t, assignedMaskId: null } : t)))
  }
  const updateMask = (id: string, data: string | null) => setMasks(v => v.map(m => (m.id === id ? { ...m, maskData: data } : m)))
  const assignMask = (trackId: string, maskId: string | null) => setAudioTracks(v => v.map(t => (t.id === trackId ? { ...t, assignedMaskId: maskId } : t)))

  // audio tracks
  const addAudioClick = () => fileInputRef.current?.click()
  const onAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      const el = new Audio()
      const url = URL.createObjectURL(file)
      el.addEventListener('loadedmetadata', () => {
        const track: AudioTrack = { id: generateId(), file, startTime: 0, duration: el.duration || 0, name: file.name, assignedMaskId: null }
        setAudioTracks(prev => {
          const next = [...prev, track]
          const req = Math.ceil(Math.max(...next.map(t => t.startTime + t.duration)))
          if (req > totalDuration) setTotalDuration(req)
          return next
        })
        URL.revokeObjectURL(url)
      })
      el.src = url
    })
    if (e.target) e.target.value = ''
  }
  const removeTrack = (id: string) => setAudioTracks(prev => {
    const next = prev.filter(t => t.id !== id)
    if (!next.length) setTotalDuration(10)
    else setTotalDuration(Math.ceil(Math.max(...next.map(t => t.startTime + t.duration))))
    return next
  })
  const updateTrackStart = (id: string, start: number) => setAudioTracks(prev => {
    const next = prev.map(t => (t.id === id ? { ...t, startTime: Math.max(0, start) } : t))
    const pick = next.find(t => t.id === id)
    if (pick) {
      const reqEnd = pick.startTime + pick.duration
      if (reqEnd > totalDuration) setTotalDuration(Math.ceil(reqEnd))
    }
    return next
  })

  // build prompt
  async function buildPromptJSON(base64Image: string, maskAudios: Record<string, string>, audioDuration: number) {
    try {
      const response = await fetch('/workflows/MultiTalkMultiplePeople.json');
      if (!response.ok) {
        throw new Error('Failed to load workflow template');
      }
      const template = await response.json();
      
      // Get masks that have data and audio assigned
      const activeMasks = masks.filter(m => m.maskData && Object.keys(maskAudios).includes(m.id));
      
      if (activeMasks.length === 0) {
        throw new Error('No masks with both data and audio assigned');
      }
      
      if (activeMasks.length > 4) {
        throw new Error('Maximum 4 masks supported');
      }
      
      // Adjust to multiples of 32 for ComfyUI compatibility
      const adjustedWidth = Math.max(32, Math.round(width / 32) * 32)
      const adjustedHeight = Math.max(32, Math.round(height / 32) * 32)
      
      // Remove data URL prefix if present, keep only base64 data like OnePerson
      const cleanBase64Image = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
      
      // Start with the base template
      const prompt = { ...template };
      
      // Update base image
      if (prompt['214']) {
        prompt['214'].inputs.image = cleanBase64Image;
      }
      
      // Update width/height nodes
      if (prompt['223']) {
        prompt['223'].inputs.Number = adjustedWidth.toString();
      }
      if (prompt['224']) {
        prompt['224'].inputs.Number = adjustedHeight.toString();
      }
      
      // Update mask base64 data
      activeMasks.forEach((mask, index) => {
        const maskNum = index + 1;
        const base64Data = mask.maskData?.includes(',') ? mask.maskData.split(',')[1] : mask.maskData;
        
        if (maskNum === 1 && prompt['215']) {
          prompt['215'].inputs.image = base64Data || "";
        } else if (maskNum === 2 && prompt['220']) {
          prompt['220'].inputs.image = base64Data || "";
        }
      });
      
      // Add mask processing nodes for masks 3 and 4 if needed
      if (activeMasks.length >= 3) {
        const cleanBase64Mask3 = activeMasks[2].maskData?.includes(',') ? activeMasks[2].maskData.split(',')[1] : activeMasks[2].maskData;
        
        prompt['300'] = {
          inputs: { image: cleanBase64Mask3 || "" },
          class_type: "ETN_LoadImageBase64",
          _meta: { title: "Load Image (Base64) - Mask3" }
        };
        
        prompt['301'] = {
          inputs: {
            width: ["223", 0],
            height: ["224", 0],
            upscale_method: "lanczos",
            keep_proportion: "crop",
            pad_color: "0, 0, 0",
            crop_position: "center",
            divisible_by: 2,
            device: "cpu",
            image: ["300", 0]
          },
          class_type: "ImageResizeKJv2",
          _meta: { title: "Resize Image v2" }
        };
        
        prompt['302'] = {
          inputs: {
            channel: "red",
            image: ["301", 0]
          },
          class_type: "ImageToMask",
          _meta: { title: "Convert Image to Mask" }
        };
        
        // Add mask batch for 3 masks
        prompt['243'] = {
          inputs: {
            mask1: ["242", 0],
            mask2: ["302", 0]
          },
          class_type: "MaskBatch+",
          _meta: { title: "🎭 Mask Batch 3" }
        };
      }
      
      if (activeMasks.length >= 4) {
        const cleanBase64Mask4 = activeMasks[3].maskData?.includes(',') ? activeMasks[3].maskData.split(',')[1] : activeMasks[3].maskData;
        
        prompt['400'] = {
          inputs: { image: cleanBase64Mask4 || "" },
          class_type: "ETN_LoadImageBase64",
          _meta: { title: "Load Image (Base64) - Mask4" }
        };
        
        prompt['401'] = {
          inputs: {
            width: ["223", 0],
            height: ["224", 0],
            upscale_method: "lanczos",
            keep_proportion: "crop",
            pad_color: "0, 0, 0",
            crop_position: "center",
            divisible_by: 2,
            device: "cpu",
            image: ["400", 0]
          },
          class_type: "ImageResizeKJv2",
          _meta: { title: "Resize Image v2" }
        };
        
        prompt['402'] = {
          inputs: {
            channel: "red",
            image: ["401", 0]
          },
          class_type: "ImageToMask",
          _meta: { title: "Convert Image to Mask" }
        };
        
        // Add mask batch for 4 masks
        prompt['244'] = {
          inputs: {
            mask1: ["243", 0],
            mask2: ["402", 0]
          },
          class_type: "MaskBatch+",
          _meta: { title: "🎭 Mask Batch 4" }
        };
      }
      
      // Add LoadAudio and AudioCrop/AudioSeparation nodes for each mask's audio
      activeMasks.forEach((_, index) => {
        const audioNum = index + 1;
        const mask = activeMasks[index];
        const audioFilename = maskAudios[mask.id];
        if (audioFilename) {
          // LoadAudio node
          prompt[`125_${audioNum}`] = {
            inputs: { audio: audioFilename, audioUI: "" },
            class_type: "LoadAudio",
            _meta: { title: `LoadAudio ${audioNum}` }
          };
          
          // AudioCrop node - use total duration for end_time
          prompt[`196_${audioNum}`] = {
            inputs: {
              start_time: "0:00",
              end_time: audioDuration.toString(),
              audio: [`125_${audioNum}`, 0]
            },
            class_type: "AudioCrop",
            _meta: { title: `AudioCrop ${audioNum}` }
          };
          
          // AudioSeparation node  
          prompt[`197_${audioNum}`] = {
            inputs: {
              chunk_fade_shape: "linear",
              chunk_length: 10,
              chunk_overlap: 0.1,
              audio: [`196_${audioNum}`, 0]
            },
            class_type: "AudioSeparation",
            _meta: { title: `AudioSeparation ${audioNum}` }
          };
        }
      });
      
      // Set the correct mask batch reference based on number of active masks
      let maskBatchRef: [string, number];
      switch (activeMasks.length) {
        case 1:
          maskBatchRef = ["218", 0]; // Single mask, no batching needed
          break;
        case 2:
          maskBatchRef = ["242", 0]; // Batch of 2 masks
          break;
        case 3:
          maskBatchRef = ["243", 0]; // Batch of 3 masks
          break;
        case 4:
          maskBatchRef = ["244", 0]; // Batch of 4 masks
          break;
        default:
          throw new Error('Unexpected number of masks');
      }
      
      // Update MultiTalkWav2VecEmbeds inputs
      const audioInputs: Record<string, any> = {};
      activeMasks.forEach((_, index) => {
        const audioNum = index + 1;
        audioInputs[`audio_${audioNum}`] = [`197_${audioNum}`, 3];
      });
      
      // Clear unused audio inputs
      for (let i = activeMasks.length + 1; i <= 4; i++) {
        audioInputs[`audio_${i}`] = null;
      }
      
      if (prompt["123"]) {
        // Calculate num_frames: fps * (audio_duration + 1)
        const fps = 25;
        const numFrames = fps * (audioDuration + 1);
        
        console.log('MultiTalk duration calculation:', {
          audioDuration,
          fps,
          numFrames,
          formula: `${fps} * (${audioDuration} + 1) = ${numFrames}`
        });
        
        prompt["123"].inputs = {
          normalize_loudness: true,
          num_frames: numFrames,
          fps: fps,
          audio_scale: 1,
          audio_cfg_scale: 2,
          multi_audio_type: "para",
          wav2vec_model: ["137", 0],
          ref_target_masks: maskBatchRef,
          ...audioInputs
        };
      }
      
      // Update custom prompt in the text encoder node (135)
      if (prompt["135"] && prompt["135"].inputs) {
        prompt["135"].inputs.positive_prompt = customPrompt;
      }
      
      return prompt;
    } catch (error) {
      console.error('Error loading workflow template:', error);
      throw new Error('Failed to build prompt JSON');
    }
  }

  async function submit() {
    setStatus('')
    setVideoUrl('')
    setJobId('')
    if (!comfyUrl) return setStatus('Poné la URL de ComfyUI.')
    if (!imageFile) return setStatus('Subí una imagen.')
    if (!audioTracks.length) return setStatus('Agregá al menos un audio.')
    const unassigned = audioTracks.filter(t => !t.assignedMaskId)
    if (unassigned.length) return setStatus(`Todos los audios deben tener una máscara asignada. ${unassigned.length} sin asignar.`)

    // Check that all masks with assigned audio have mask data
    const masksWithAudio = masks.filter(m => audioTracks.some(t => t.assignedMaskId === m.id))
    const masksWithoutData = masksWithAudio.filter(m => !m.maskData)
    if (masksWithoutData.length) {
      return setStatus(`Las máscaras ${masksWithoutData.map(m => m.name).join(', ')} necesitan datos de máscara.`)
    }

    setIsSubmitting(true)
    try {
      // First check ComfyUI health
      setStatus('Verificando ComfyUI...')
      const healthCheck = await checkComfyUIHealth(comfyUrl)
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`)
      }

      setStatus('Convirtiendo imagen a Base64…')
      const base64 = await fileToBase64(imageFile)

      setStatus('Agrupando y combinando audios por máscara…')
      const audiosByMask = groupAudiosByMask(audioTracks)
      const maskAudios: Record<string, string> = {}
      
      // Join audio tracks for each mask and upload
      for (const [maskId, tracks] of Object.entries(audiosByMask)) {
        if (tracks.length > 0) {
          console.log(`Joining audio for mask ${maskId}:`, {
            trackCount: tracks.length,
            totalDuration,
            trackDetails: tracks.map(t => ({ name: t.name, startTime: t.startTime, duration: t.duration }))
          })
          const joinedAudio = await joinAudiosForMask(tracks, totalDuration)
          console.log(`Joined audio for mask ${maskId}:`, {
            filename: joinedAudio.name,
            size: joinedAudio.size,
            type: joinedAudio.type
          })
          const audioFilename = await uploadMediaToComfy(comfyUrl, joinedAudio)
          maskAudios[maskId] = audioFilename
        }
      }

      setStatus('Enviando prompt a ComfyUI…')
      console.log('Sending to ComfyUI with totalDuration:', totalDuration)
      const prompt = await buildPromptJSON(base64, maskAudios, totalDuration)
      
      // Log the final prompt values to verify
      console.log('Final prompt node 123 (MultiTalkWav2VecEmbeds):', prompt["123"])
      console.log('Final prompt node 131 (VHS_VideoCombine):', prompt["131"])
      const payload = { prompt, client_id: `multitalk-multiple-${generateId()}` }
      
      let r: Response;
      try {
        r = await fetch(`${comfyUrl.replace(/\/$/, '')}/prompt`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        })
      } catch (error: any) {
        if (error.name === 'TimeoutError') {
          throw new Error('Timeout al conectar con ComfyUI. Verificá que esté ejecutándose y la URL sea correcta.')
        }
        if (error.name === 'TypeError') {
          throw new Error('No se pudo conectar a ComfyUI. Verificá la URL y que CORS esté habilitado.')
        }
        throw new Error(`Error de red: ${error.message}`)
      }
      
      if (!r.ok) {
        let errorDetail = '';
        try {
          const errorData = await r.json();
          errorDetail = errorData.error || errorData.message || '';
        } catch {
          errorDetail = await r.text().catch(() => '');
        }
        throw new Error(`ComfyUI rechazó el prompt (${r.status}): ${errorDetail || 'Error desconocido'}`);
      }
      
      const resp = await r.json()
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || ''
      if (!id) {
        throw new Error('ComfyUI no devolvió un ID de prompt válido. Respuesta: ' + JSON.stringify(resp))
      }
      setJobId(id)

      await createJob({ job_id: id, comfy_url: comfyUrl, image_filename: imageFile.name, audio_filename: 'multiple_masks_audio', width, height, trim_to_audio: trimToAudio })
      await updateJobToProcessing(id)

      // Start monitoring job status
      setStatus('Procesando en ComfyUI…')
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Procesando en ComfyUI…')
          } else if (jobStatus === 'completed' && videoInfo) {
            // Handle successful completion
            setStatus('Subiendo video a Supabase Storage…')
            let videoStorageUrl: string | null = null
            try {
              const videoBlob = await downloadVideoFromComfy(comfyUrl, videoInfo.filename, videoInfo.subfolder)
              if (videoBlob) {
                videoStorageUrl = await uploadVideoToStorage(videoBlob, videoInfo.filename)
                if (videoStorageUrl) {
                  console.log('Video uploaded to Supabase Storage:', videoStorageUrl)
                  // Set video URL from Supabase
                  setVideoUrl(videoStorageUrl)
                } else {
                  console.warn('Upload to Supabase succeeded but no URL returned')
                  // Fallback to ComfyUI URL if no Supabase URL
                  const fallbackUrl = videoInfo.subfolder
                    ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                    : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`
                  setVideoUrl(fallbackUrl)
                }
              } else {
                console.warn('Failed to download video from ComfyUI')
                // Still try to show ComfyUI URL even if download failed
                const fallbackUrl = videoInfo.subfolder
                  ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                  : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`
                setVideoUrl(fallbackUrl)
              }
            } catch (storageError) {
              console.warn('Failed to upload to Supabase Storage:', storageError)
              // Fallback to ComfyUI URL if Supabase upload fails
              const fallbackUrl = videoInfo.subfolder
                ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`
              setVideoUrl(fallbackUrl)
            }

            await completeJob({ 
              job_id: id, 
              status: 'completed', 
              filename: videoInfo.filename, 
              subfolder: videoInfo.subfolder,
              video_url: videoStorageUrl || undefined
            })
            
            setStatus('Listo ✅')
            setIsSubmitting(false)
            
            // Feed will refresh automatically via JobFeed component
            
          } else if (jobStatus === 'error') {
            // Handle error
            setStatus(`❌ ${message}`)
            setIsSubmitting(false)
            
            try {
              await completeJob({ job_id: id, status: 'error', error_message: message || 'Unknown error' })
            } catch (dbError) {
              console.error('Error updating job status:', dbError)
            }
          }
        }
      )
      
      setJobMonitorCleanup(() => cleanup)
    } catch (e: any) {
      let errorMessage = e?.message || String(e);
      
      // Provide more user-friendly error messages
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'No se pudo conectar a ComfyUI. Verificá la URL y que esté ejecutándose.';
      } else if (errorMessage.includes('NetworkError')) {
        errorMessage = 'Error de red al conectar con ComfyUI. Verificá tu conexión.';
      } else if (errorMessage.includes('JSON.parse')) {
        errorMessage = 'ComfyUI devolvió una respuesta inválida. Puede estar sobrecargado.';
      } else if (errorMessage.includes('workflow template')) {
        errorMessage = 'Error cargando plantilla de workflow. Verificá que el archivo exista.';
      }
      
      console.error('MultiTalk error:', e);
      setStatus(`❌ ${errorMessage}`);
      
      if (jobId) {
        try {
          await completeJob({ job_id: jobId, status: 'error', error_message: errorMessage });
        } catch (dbError) {
          console.error('Error updating job status:', dbError);
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const onDropAudios: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
      /^audio\//.test(f.type) || /\.(wav|mp3|m4a|flac|ogg)$/i.test(f.name)
    );
    if (!files.length) return;
    onAudioSelect({ files } as any);
  };

  const preventDefault: React.DragEventHandler = (e) => e.preventDefault();


  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "multitalk.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              MultiTalk
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-blue-100 to-purple-100 px-4 py-2 rounded-full border border-blue-200/50">
                Múltiples Personas
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Frontend elegante para disparar tu workflow de MultiTalk en ComfyUI con múltiples personas.
            </p>
          </div>

          <Section title="Configuración">
            <Field>
              <Label>Prompt personalizado</Label>
              <textarea
                rows={3}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe la escena que quieres generar..."
              />
              <p className="text-xs text-gray-500 mt-1">Descripción de lo que quieres que hagan las personas en el video</p>
            </Field>
          </Section>

          <Section title="Entrada">
            <div className="grid md:grid-cols-2 gap-6">
              <Field>
                <Label>Imagen</Label>
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                  />
                </div>
                {imagePreview && (
                  <div className="mt-3">
                    <img src={imagePreview} alt="preview" className="w-full rounded-2xl shadow-lg border border-gray-200" />
                  </div>
                )}
              </Field>
              <Field>
                <Label>Resolución de salida</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Ancho (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value) || 32)}
                    />
                  </div>
                  <div>
                    <Label>Alto (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                      value={height}
                      onChange={(e) => setHeight(Number(e.target.value) || 32)}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">Se ajusta a múltiplos de 32 por compatibilidad con el modelo.</p>
              </Field>
            </div>
          </Section>

          <Section title="Máscaras por persona">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Crea una máscara por persona para guiar el lipsync.
                </p>
                <Button
                  variant="accent"
                  size="md"
                  onClick={createMask}
                  disabled={!imagePreview}
                  className={!imagePreview ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  ✨ Nueva máscara
                </Button>
              </div>

              {!masks.length ? (
                <div className="mt-3 rounded bg-gray-100 p-4 text-sm text-gray-600">
                  No hay máscaras aún.
                </div>
              ) : (
                <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {masks.map((m) => (
                    <li key={m.id} className="rounded-lg bg-gradient-to-br from-white to-blue-50 border border-blue-200 p-3 shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {/* Mask preview */}
                          <div className="w-12 h-12 rounded border border-gray-300 bg-gray-100 overflow-hidden flex-shrink-0">
                            {m.maskData ? (
                              <img 
                                src={m.maskData} 
                                alt={`${m.name} preview`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                Empty
                              </div>
                            )}
                          </div>
                          <input
                            value={m.name}
                            onChange={(e) =>
                              setMasks((prev) =>
                                prev.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x))
                              )
                            }
                            className="font-medium outline-none rounded px-1 py-0.5 hover:bg-gray-50"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setIsEditingMask(m.id);
                              setShowMaskModal(true);
                            }}
                            disabled={!imagePreview}
                          >
                            ✏️ Editar
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => deleteMask(m.id)}
                          >
                            🗑️ Eliminar
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {m.maskData ? (
                          <Badge variant="success">✅ Con datos</Badge>
                        ) : (
                          <Badge variant="warning">⚠️ Vacía</Badge>
                        )}
                        <Badge variant="primary">
                          {audioTracks.filter(t => t.assignedMaskId === m.id).length} audio(s)
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

          <Section title="Audio y timeline">
              <div
                onDrop={onDropAudios}
                onDragOver={preventDefault}
                onDragEnter={preventDefault}
                className="mb-4 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-600"
              >
                Arrastrá audios aquí, o
                <button
                  type="button"
                  onClick={addAudioClick}
                  className="ml-2 rounded-md bg-gray-100 px-2 py-1 text-sm hover:bg-gray-200"
                >
                  buscá en tu equipo
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={onAudioSelect}
                />
              </div>

              <Timeline
                tracks={audioTracks}
                totalDuration={totalDuration}
                onUpdateTrackTime={updateTrackStart}
                onRemoveTrack={removeTrack}
                onUpdateTotalDuration={setTotalDuration}
              />

              {/* Track -> Mask assignment */}
              {!!audioTracks.length && (
                <div className="mt-4 space-y-2">
                  {audioTracks.map((t, i) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded bg-gray-50 p-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white text-[10px]">
                          {i + 1}
                        </span>
                        <span className="font-medium truncate max-w-[220px]" title={t.name}>
                          {t.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Máscara</Label>
                        <select
                          value={t.assignedMaskId ?? ''}
                          onChange={(e) => assignMask(t.id, e.target.value || null)}
                          className="rounded px-2 py-1 bg-gray-100"
                        >
                          <option value="">Elegir…</option>
                          {masks.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

          <Section title="Ejecución">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Procesando…
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Generar
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

                {videoUrl && (
                  <div className="mt-6 space-y-3">
                    <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                    <div>
                      <button className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" onClick={handleDownload}>
                        <span>⬇️</span>
                        Descargar MP4
                      </button>
                    </div>
                  </div>
                )}
            </Section>
        </div>

        {/* Right Sidebar - Video Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <JobFeed comfyUrl={comfyUrl} />
          </div>
        </div>
      </div>
    </div>
  )
}
