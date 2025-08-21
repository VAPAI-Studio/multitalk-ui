import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob, getCompletedJobsWithVideos } from "./lib/jobTracking";
import type { MultiTalkJob } from "./lib/supabase";
import { downloadVideoFromComfy, uploadVideoToStorage } from "./lib/supabase";
import { startJobMonitoring, checkComfyUIHealth } from "./components/utils";

// MultiTalk One-Person Frontend for ComfyUI
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

  const [width, setWidth] = useState<number>(640); // defaults from workflow
  const [height, setHeight] = useState<number>(360);

  const trimToAudio = true;
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [videoFeed, setVideoFeed] = useState<MultiTalkJob[]>([]);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load video feed from Supabase
  useEffect(() => {
    loadVideoFeedFromDB();
    const interval = setInterval(loadVideoFeedFromDB, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [comfyUrl]);

  // cleanup job monitor on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
    };
  }, [jobMonitorCleanup]);

  async function loadVideoFeedFromDB() {
    try {
      const { jobs, error } = await getCompletedJobsWithVideos(20);
      if (error) {
        console.error("Error loading video feed:", error);
        return;
      }
      
      // Filter jobs that match current comfy URL or show all if no specific URL
      const filteredJobs = jobs.filter(job => job.comfy_url === comfyUrl || !comfyUrl);
      setVideoFeed(filteredJobs);
    } catch (e) {
      console.error("Error loading video feed from DB:", e);
    }
  }


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

  async function uploadAudioToComfy(baseUrl: string, file: File): Promise<string> {
    const form = new FormData();
    // La clave estándar es "image" aunque sea audio; ComfyUI lo guarda igual
    form.append("image", file, file.name);

    try {
      const r = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        body: form,
        credentials: "omit", // importantísimo para evitar preflight
      });
      
      if (!r.ok) {
        throw new Error(`Upload falló: HTTP ${r.status}`);
      }

      // Respuestas típicas de ComfyUI
      let data: any = null;
      try { 
        data = await r.json(); 
      } catch { 
        // Puede ser texto plano
      }
      
      if (data?.name) return data.name as string;
      
      if (Array.isArray(data?.files) && data.files[0]) return data.files[0] as string;
      
      const text = typeof data === "string" ? data : await r.text().catch(() => "");
      if (text.trim()) return text.trim();
      
      throw new Error("Respuesta inesperada del servidor");
      
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error('No se pudo conectar al servidor. Verificá la URL de ngrok.');
      }
      throw new Error(`No se pudo subir el audio: ${e.message}`);
    }
  }

  async function buildPromptJSON(base64Image: string, audioFilename: string) {
    try {
      const response = await fetch('/workflows/MultiTalkOnePerson.json');
      if (!response.ok) {
        throw new Error('Failed to load workflow template');
      }
      const template = await response.json();
      
      const promptString = JSON.stringify(template)
        .replace(/"\{\{BASE64_IMAGE\}\}"/g, `"${base64Image}"`)
        .replace(/"\{\{AUDIO_FILENAME\}\}"/g, `"${audioFilename}"`)
        .replace(/"\{\{WIDTH\}\}"/g, width.toString())
        .replace(/"\{\{HEIGHT\}\}"/g, height.toString())
        .replace(/"\{\{TRIM_TO_AUDIO\}\}"/g, trimToAudio.toString());
      
      return JSON.parse(promptString);
    } catch (error) {
      console.error('Error loading workflow template:', error);
      throw new Error('Failed to build prompt JSON');
    }
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
      const audioFilename = await uploadAudioToComfy(comfyUrl, audioFile);

      setStatus("Enviando prompt a ComfyUI…");
      const payload = {
        prompt: await buildPromptJSON(base64Image, audioFilename),
        client_id: `multitalk-ui-${Math.random().toString(36).slice(2)}`,
      };

      let r: Response;
      try {
        r = await fetch(`${comfyUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
      } catch (error: any) {
        if (error.name === 'TimeoutError') {
          throw new Error('Timeout al conectar con ComfyUI. Verificá que esté ejecutándose y la URL sea correcta.');
        }
        if (error.name === 'TypeError') {
          throw new Error('No se pudo conectar a ComfyUI. Verificá la URL y que CORS esté habilitado.');
        }
        throw new Error(`Error de red: ${error.message}`);
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
      
      const resp = await r.json();
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || "";
      if (!id) {
        throw new Error('ComfyUI no devolvió un ID de prompt válido. Respuesta: ' + JSON.stringify(resp));
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
            setStatus('Subiendo video a Supabase Storage…');
            let videoStorageUrl: string | null = null;
            try {
              const videoBlob = await downloadVideoFromComfy(comfyUrl, videoInfo.filename, videoInfo.subfolder);
              if (videoBlob) {
                videoStorageUrl = await uploadVideoToStorage(videoBlob, videoInfo.filename);
                if (videoStorageUrl) {
                  console.log('Video uploaded to Supabase Storage:', videoStorageUrl);
                  // Set video URL from Supabase
                  setVideoUrl(videoStorageUrl);
                } else {
                  console.warn('Upload to Supabase succeeded but no URL returned');
                  // Fallback to ComfyUI URL if no Supabase URL
                  const fallbackUrl = videoInfo.subfolder
                    ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                    : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`;
                  setVideoUrl(fallbackUrl);
                }
              } else {
                console.warn('Failed to download video from ComfyUI');
                // Still try to show ComfyUI URL even if download failed
                const fallbackUrl = videoInfo.subfolder
                  ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                  : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`;
                setVideoUrl(fallbackUrl);
              }
            } catch (storageError) {
              console.warn('Failed to upload to Supabase Storage:', storageError);
              // Fallback to ComfyUI URL if Supabase upload fails
              const fallbackUrl = videoInfo.subfolder
                ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=output`
                : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=output`;
              setVideoUrl(fallbackUrl);
            }
            
            // Complete job in Supabase
            await completeJob({
              job_id: id,
              status: 'completed',
              filename: videoInfo.filename,
              subfolder: videoInfo.subfolder,
              video_url: videoStorageUrl || undefined
            });

            // Refresh feed to show new job
            await loadVideoFeedFromDB();
            
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
      
      console.error('MultiTalk OnePerson error:', e);
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
            MultiTalk
          </h1>
          <div className="text-lg md:text-xl font-medium text-gray-700">
            <span className="bg-gradient-to-r from-blue-100 to-purple-100 px-4 py-2 rounded-full border border-blue-200/50">
              1 Persona
            </span>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Frontend elegante para disparar tu workflow de MultiTalk en ComfyUI con estilo.
          </p>
        </div>


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
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-teal-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-teal-700 transition-all duration-200 bg-gray-50/50"
              />
            </div>
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
              value={width}
              onChange={(e) => setWidth(Math.max(32, Math.round(Number(e.target.value) / 32) * 32))}
            />
          </Field>
          <Field>
            <Label>Alto (px)</Label>
            <input
              type="number"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
              value={height}
              onChange={(e) => setHeight(Math.max(32, Math.round(Number(e.target.value) / 32) * 32))}
            />
          </Field>
        </div>
        <p className="text-xs text-gray-500 mt-3">Se ajusta a múltiplos de 32 por compatibilidad con el modelo.</p>
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
            <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm h-full flex flex-col">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
                Feed de Generaciones
              </h2>
              
              {videoFeed.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-3">No hay videos generados aún</p>
                  <p className="text-xs text-gray-400">Los videos aparecerán aquí cuando generes contenido</p>
                </div>
              ) : (
                <div className="space-y-4 flex-1 overflow-y-auto">
                  {videoFeed.map((job) => {
                    // Prefer Supabase video_url, fallback to ComfyUI if not available
                    const videoUrl = job.video_url || 
                      (job.filename ? 
                        (job.subfolder 
                          ? `${job.comfy_url}/view?filename=${encodeURIComponent(job.filename)}&subfolder=${encodeURIComponent(job.subfolder)}&type=output`
                          : `${job.comfy_url}/view?filename=${encodeURIComponent(job.filename)}&type=output`)
                        : null);
                      
                    return (
                      <div key={job.job_id} className="border border-gray-200 rounded-2xl p-3 bg-white">
                        {videoUrl && (
                          <video 
                            src={videoUrl} 
                            controls 
                            className="w-full rounded-xl mb-2"
                            style={{ maxHeight: '150px' }}
                          />
                        )}
                        <div className="space-y-1">
                          <div className="text-xs text-gray-500 truncate" title={job.filename || job.job_id}>
                            {job.filename || `Job: ${job.job_id.slice(0, 8)}...`}
                          </div>
                          <div className="text-xs text-gray-400">
                            {job.timestamp_completed ? new Date(job.timestamp_completed).toLocaleString() : 'Processing...'}
                          </div>
                          <div className="text-xs">
                            <span className={`px-2 py-1 rounded-full ${
                              job.status === 'completed' ? 'bg-green-100 text-green-700' :
                              job.status === 'error' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {job.status}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400">
                            {job.width}×{job.height} • {job.trim_to_audio ? 'Trim to audio' : 'Fixed length'}
                          </div>
                        </div>
                        {videoUrl && (
                          <button 
                            className="mt-2 w-full text-xs px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = videoUrl;
                              a.download = job.filename || 'video.mp4';
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            }}
                          >
                            Descargar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
