import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob } from "./lib/jobTracking";
import { startJobMonitoring, checkComfyUIHealth } from "./components/utils";
import VideoFeed from "./components/VideoFeed";
import { useSmartResolution } from "./hooks/useSmartResolution";
import { apiClient } from "./lib/apiClient";

// VAPAI One-Person Frontend for ComfyUI
// - Enter ComfyUI URL
// - Upload Image (used as start frame, sent as Base64 to Base64DecodeNode)
// - Upload Audio (uploaded to ComfyUI, referenced by LoadAudio node)
// - Define output size (defaults to image aspect; optional 16:9 lock)
// - Sends modified workflow JSON to /prompt, polls /history for result, and shows the MP4
//
// Notes / Assumptions
// • Requires ComfyUI to be started with CORS enabled for your frontend origin, e.g. `--enable-cors-header` or proxy.
// • Audio upload uses `POST /upload/audio` which is available in ComfyUI recent builds (VHS / Audio nodes ecosystem). If your build differs,
//   switch to `/upload` or adjust backend to accept `audio` field. Fallback hook included below.
// • The provided workflow saves output via VHS_VideoCombine (mp4). We recommend setting `trim_to_audio: true` so the video matches audio length.
// • Dimensions are set on nodes 171 (Resize Image v2) and 192 (WanVideoImageToVideoMultiTalk). Both are updated consistently.
// • FPS defaults to 25; frames 250 ⇒ ~10s. You can set `trim_to_audio` to true to ignore frames and match audio.
// • If you want *strict* 16:9, toggle the switch; otherwise we preserve the image aspect by default.

// ---------- UI Helpers ----------
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------- Component ----------
interface Props {
  comfyUrl: string;
}

export default function MultiTalkOnePerson({ comfyUrl }: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageAR, setImageAR] = useState<number | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Smart resolution handling with auto-correction to multiples of 32
  const { 
    width, 
    height, 
    widthInput, 
    heightInput, 
    handleWidthChange, 
    handleHeightChange, 
    setWidth, 
    setHeight 
  } = useSmartResolution(640, 360) // defaults from workflow
  const [mode, setMode] = useState<'multitalk' | 'infinitetalk'>('multitalk');
  const [audioScale, setAudioScale] = useState<number>(1);
  const [customPrompt, setCustomPrompt] = useState<string>('a woman is talking');

  const trimToAudio = true;
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);


  useEffect(() => {
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setImageAR(ar);
      // Initialize W/H to the nearest multiples of 32 preserving aspect, max width ~ 640
      const targetW = Math.max(32, Math.round(Math.min(640, img.width) / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
      setWidth(targetW);
      setHeight(targetH);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (!imageAR) return;
    // Preserve image aspect ratio: H = W / AR, both multiples of 32
    const targetH = Math.max(32, Math.round((width / imageAR) / 32) * 32);
    if (targetH !== height) setHeight(targetH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, imageAR]);

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        // Remove data URL prefix if present
        const base64 = res.includes(",") ? res.split(",")[1] : res;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }



  async function submit() {
    setStatus("");
    setVideoUrl("");
    setJobId("");

    if (!comfyUrl) {
      setStatus("Poné la URL de ComfyUI.");
      return;
    }
    if (!imageFile) {
      setStatus("Subí una imagen.");
      return;
    }
    if (!audioFile) {
      setStatus("Subí un audio.");
      return;
    }

    setIsSubmitting(true);
    try {
      // First check ComfyUI health
      setStatus("Verificando ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus("Convirtiendo imagen a Base64…");
      const base64Image = await fileToBase64(imageFile);

      setStatus("Subiendo audio a ComfyUI…");
      // Use the new backend audio upload
      const audioUploadResponse = await apiClient.uploadAudioForMultiTalk(audioFile, comfyUrl) as { 
        success: boolean; 
        audio_filename?: string; 
        error?: string 
      };
      
      if (!audioUploadResponse.success) {
        throw new Error(audioUploadResponse.error || 'Failed to upload audio');
      }
      
      const audioFilename = audioUploadResponse.audio_filename;
      if (!audioFilename) {
        throw new Error('No audio filename received from upload');
      }

      setStatus("Enviando prompt a ComfyUI…");
      
      // Convert File to data URL for backend
      const imageDataUrl = `data:${imageFile.type};base64,${base64Image}`;
      
      // Use the new backend template-based approach
      const response = await apiClient.submitMultiTalkWithTemplate({
        image_data: imageDataUrl,
        audio_filename: audioFilename,
        width: width,
        height: height,
        mode: mode,
        audio_scale: audioScale,
        custom_prompt: customPrompt,
        trim_to_audio: trimToAudio,
        audio_end_time: mode === 'infinitetalk' ? audioDuration + 1 : undefined,
        comfy_url: comfyUrl
      }) as { success: boolean; prompt_id?: string; error?: string };
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to submit to ComfyUI');
      }
      
      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      // Create job record in Supabase
      await createJob({
        job_id: id,
        comfy_url: comfyUrl,
        image_filename: imageFile?.name,
        audio_filename: audioFilename,
        width,
        height,
        trim_to_audio: trimToAudio
      });

      // Update job to processing status
      await updateJobToProcessing(id);

      // Start monitoring job status
      setStatus("Procesando en ComfyUI…");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Procesando en ComfyUI…');
          } else if (jobStatus === 'completed' && videoInfo) {
            // Handle successful completion
            setStatus('Procesamiento completado');
            // Set ComfyUI URL as fallback - the job monitoring will handle Supabase upload
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
              : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
            setVideoUrl(fallbackUrl);
                        
            setStatus("Listo ✅");
            setIsSubmitting(false);
            
          } else if (jobStatus === 'error') {
            // Handle error
            setStatus(`❌ ${message}`);
            setIsSubmitting(false);
            
            try {
              await completeJob({
                job_id: id,
                status: 'error',
                error_message: message || 'Unknown error'
              });
            } catch (dbError) {
              console.error('Error updating job status:', dbError);
            }
          }
        }
      );
      
      setJobMonitorCleanup(() => cleanup);
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
      
      console.error('VAPAI OnePerson error:', e);
      setStatus(`❌ ${errorMessage}`);
      
      // Complete job with error status if we have a job ID
      if (jobId) {
        try {
          await completeJob({
            job_id: jobId,
            status: 'error',
            error_message: errorMessage
          });
        } catch (dbError) {
          console.error('Error updating job status:', dbError);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }


  function handleDownload() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "multitalk.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
        <div className="text-center space-y-4 py-8">
          <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            Lipsync 1 Person
          </h1>
          <div className="text-lg md:text-xl font-medium text-gray-700">
            <span className={`px-4 py-2 rounded-full border ${mode === 'multitalk' ? 'bg-gradient-to-r from-blue-100 to-purple-100 border-blue-200/50' : 'bg-gradient-to-r from-purple-100 to-pink-100 border-purple-200/50'}`}>
              {mode === 'multitalk' ? 'MultiTalk' : 'InfiniteTalk'}
            </span>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Frontend elegante para disparar tu workflow de {mode === 'multitalk' ? 'MultiTalk' : 'InfiniteTalk'} en ComfyUI con estilo.
          </p>
        </div>


      <Section title="Modo">
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="multitalk"
              checked={mode === 'multitalk'}
              onChange={(e) => setMode(e.target.value as 'multitalk' | 'infinitetalk')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Lipsync 1 Person</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="infinitetalk"
              checked={mode === 'infinitetalk'}
              onChange={(e) => setMode(e.target.value as 'multitalk' | 'infinitetalk')}
              className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
            />
            <span className="text-sm font-medium text-gray-700">InfiniteTalk</span>
          </label>
        </div>
        {mode === 'infinitetalk' && (
          <div className="mt-4">
            <Field>
              <Label>Audio Scale</Label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="2.0"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                value={audioScale}
                onChange={(e) => setAudioScale(Number(e.target.value))}
              />
              <p className="text-xs text-gray-500 mt-1">Escala del audio para InfiniteTalk (0.1 - 2.0)</p>
            </Field>
          </div>
        )}
        
        <div className="mt-4">
          <Field>
            <Label>Prompt personalizado</Label>
            <textarea
              rows={3}
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Describe la acción que quieres generar..."
            />
            <p className="text-xs text-gray-500 mt-1">Descripción de lo que quieres que haga la persona en el video</p>
          </Field>
        </div>
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
                <img ref={imgRef} src={imagePreview} alt="preview" className="w-full rounded-2xl shadow-lg border border-gray-200" />
              </div>
            )}
          </Field>
          <Field>
            <Label>Audio</Label>
            <div className="relative">
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setAudioFile(file);
                  if (file) {
                    const audio = new Audio();
                    const url = URL.createObjectURL(file);
                    audio.addEventListener('loadedmetadata', () => {
                      setAudioDuration(audio.duration);
                      URL.revokeObjectURL(url);
                    });
                    audio.src = url;
                  } else {
                    setAudioDuration(0);
                  }
                }}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-teal-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-teal-700 transition-all duration-200 bg-gray-50/50"
              />
            </div>
            {audioDuration > 0 && (
              <p className="text-xs text-green-600 mt-1">Duración: {audioDuration.toFixed(1)}s</p>
            )}
            <p className="text-xs text-gray-500 mt-1">Se sube al servidor de ComfyUI y se referencia en el nodo LoadAudio.</p>
          </Field>
        </div>
      </Section>

      <Section title="Resolución de salida">
        <div className="grid md:grid-cols-2 gap-4 items-end">
          <Field>
            <Label>Ancho (px)</Label>
            <input
              type="number"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
              value={widthInput}
              onChange={(e) => handleWidthChange(e.target.value)}
            />
          </Field>
          <Field>
            <Label>Alto (px)</Label>
            <input
              type="number"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
              value={heightInput}
              onChange={(e) => handleHeightChange(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-gray-500 mt-3">Se corrige automáticamente a múltiplos de 32 después de 2 segundos sin cambios.</p>
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
            <VideoFeed 
              comfyUrl={comfyUrl} 
              config={{
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                pageContext: 'lipsync-one'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
