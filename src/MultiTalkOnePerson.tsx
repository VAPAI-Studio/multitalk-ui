import React, { useEffect, useRef, useState } from "react";
import { createJob, updateJobToProcessing, completeJob, getCompletedJobsWithVideos } from "./lib/jobTracking";
import type { MultiTalkJob } from "./lib/supabase";

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
export default function MultiTalkOnePerson() {
  const [comfyUrl, setComfyUrl] = useState<string>("https://59414078555f.ngrok.app");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageAR, setImageAR] = useState<number | null>(null);

  const [lock16x9, setLock16x9] = useState<boolean>(false);
  const [width, setWidth] = useState<number>(640); // defaults from workflow
  const [height, setHeight] = useState<number>(360);

  const [trimToAudio, setTrimToAudio] = useState<boolean>(true);
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [videoFeed, setVideoFeed] = useState<MultiTalkJob[]>([]);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load video feed from Supabase
  useEffect(() => {
    loadVideoFeedFromDB();
    const interval = setInterval(loadVideoFeedFromDB, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [comfyUrl]);

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
      // If not forcing 16:9, initialize W/H to the nearest multiples of 32 preserving aspect, max width ~ 640
      if (!lock16x9) {
        const targetW = Math.max(32, Math.round(Math.min(640, img.width) / 32) * 32);
        const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
        setWidth(targetW);
        setHeight(targetH);
      }
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  useEffect(() => {
    if (!imageAR) return;
    if (lock16x9) {
      // Lock to 16:9 while keeping width multiple of 32
      const targetW = Math.max(32, Math.round(width / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW * 9 / 16) / 32) * 32);
      if (targetH !== height) setHeight(targetH);
    } else {
      // Preserve image aspect ratio: H = W / AR, both multiples of 32
      const targetH = Math.max(32, Math.round((width / imageAR) / 32) * 32);
      if (targetH !== height) setHeight(targetH);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, lock16x9, imageAR]);

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

  function buildPromptJSON(base64Image: string, audioFilename: string) {
    // Clone of provided workflow JSON with mutations: image (201), audio (195), sizes (171 & 192), trim_to_audio (131)
    const prompt: any = {
      "120": { inputs: { model: "WAN\\2.1\\multitalk.safetensors", base_precision: "fp16" }, class_type: "MultiTalkModelLoader", _meta: { title: "MultiTalk Model Loader" } },
      "122": { inputs: { model: "WAN\\2.1\\Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors", base_precision: "fp16_fast", quantization: "fp8_e4m3fn", load_device: "offload_device", attention_mode: "sageattn", compile_args: ["177", 0], block_swap_args: ["134", 0], lora: ["138", 0], multitalk_model: ["120", 0] }, class_type: "WanVideoModelLoader", _meta: { title: "WanVideo Model Loader" } },
      "128": { inputs: { steps: 4, cfg: 1.03, shift: 11.94, seed: 1, force_offload: true, scheduler: "flowmatch_distill", riflex_freq_index: 0, denoise_strength: 1, batched_cfg: false, rope_function: "comfy", start_step: 0, end_step: -1, add_noise_to_samples: false, model: ["122", 0], image_embeds: ["192", 0], text_embeds: ["135", 0], multitalk_embeds: ["194", 0] }, class_type: "WanVideoSampler", _meta: { title: "WanVideo Sampler" } },
      "129": { inputs: { model_name: "wan\\wan_2.1_vae.safetensors", precision: "bf16" }, class_type: "WanVideoVAELoader", _meta: { title: "WanVideo VAE Loader" } },
      "130": { inputs: { enable_vae_tiling: false, tile_x: 272, tile_y: 272, tile_stride_x: 144, tile_stride_y: 128, normalization: "default", vae: ["129", 0], samples: ["128", 0] }, class_type: "WanVideoDecode", _meta: { title: "WanVideo Decode" } },
      "131": { inputs: { frame_rate: 25, loop_count: 0, filename_prefix: "MultiTalkApi/WanVideo2_1_multitalk", format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 19, save_metadata: true, trim_to_audio: trimToAudio, pingpong: false, save_output: true, images: ["130", 0], audio: ["194", 1] }, class_type: "VHS_VideoCombine", _meta: { title: "Video Combine 🎥🅥🅗🅢" } },
      "134": { inputs: { blocks_to_swap: 15, offload_img_emb: false, offload_txt_emb: false, use_non_blocking: true, vace_blocks_to_swap: 0, prefetch_blocks: 0, block_swap_debug: false }, class_type: "WanVideoBlockSwap", _meta: { title: "WanVideo Block Swap" } },
      "135": { inputs: { positive_prompt: "A 2D digital illustration of a teenage girl on her room looking directly into the camera, warm soft tones, inspired by the style and color palette of the reference image. She has a calm but focused expression, as if speaking to the audience like a documentarian, not posing like an influencer. The framing is close-up from the shoulders up, with natural lighting and subtle shadows, minimal background detail to keep focus on her face, animated style with clean lines and soft shading.", negative_prompt: "bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards", force_offload: true, use_disk_cache: false, device: "gpu", t5: ["136", 0] }, class_type: "WanVideoTextEncode", _meta: { title: "WanVideo TextEncode" } },
      "136": { inputs: { model_name: "umt5-xxl-enc-bf16.pth", precision: "bf16", load_device: "offload_device", quantization: "disabled" }, class_type: "LoadWanVideoT5TextEncoder", _meta: { title: "WanVideo T5 Text Encoder Loader" } },
      "137": { inputs: { model: "TencentGameMate/chinese-wav2vec2-base", base_precision: "fp16", load_device: "main_device" }, class_type: "DownloadAndLoadWav2VecModel", _meta: { title: "(Down)load Wav2Vec Model" } },
      "138": { inputs: { lora: "WAN\\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", strength: 0.8, low_mem_load: false, merge_loras: true }, class_type: "WanVideoLoraSelect", _meta: { title: "WanVideo Lora Select" } },
      "171": { inputs: { width, height, upscale_method: "lanczos", keep_proportion: "crop", pad_color: "0, 0, 0", crop_position: "center", divisible_by: 2, device: "cpu", image: ["201", 0] }, class_type: "ImageResizeKJv2", _meta: { title: "Resize Image v2" } },
      "173": { inputs: { clip_name: "clip_vision_h.safetensors" }, class_type: "CLIPVisionLoader", _meta: { title: "Load CLIP Vision" } },
      "177": { inputs: { backend: "inductor", fullgraph: false, mode: "default", dynamic: false, dynamo_cache_size_limit: 64, compile_transformer_blocks_only: true, dynamo_recompile_limit: 128 }, class_type: "WanVideoTorchCompileSettings", _meta: { title: "WanVideo Torch Compile Settings" } },
      "192": { inputs: { width, height, frame_window_size: 81, motion_frame: 25, force_offload: false, colormatch: "mkl", tiled_vae: false, vae: ["129", 0], start_image: ["171", 0], clip_embeds: ["193", 0] }, class_type: "WanVideoImageToVideoMultiTalk", _meta: { title: "WanVideo Image To Video MultiTalk" } },
      "193": { inputs: { strength_1: 1, strength_2: 1, crop: "center", combine_embeds: "average", force_offload: true, tiles: 0, ratio: 0.5, clip_vision: ["173", 0], image_1: ["171", 0] }, class_type: "WanVideoClipVisionEncode", _meta: { title: "WanVideo ClipVision Encode" } },
      "194": { inputs: { normalize_loudness: true, num_frames: 250, fps: 25, audio_scale: 1, audio_cfg_scale: 1, multi_audio_type: "para", wav2vec_model: ["137", 0], audio_1: ["196", 0] }, class_type: "MultiTalkWav2VecEmbeds", _meta: { title: "MultiTalk Wav2Vec Embeds" } },
      "195": { inputs: { audio: audioFilename, audioUI: "" }, class_type: "LoadAudio", _meta: { title: "LoadAudio" } },
      "196": { inputs: { start_time: "0:00", end_time: "4:00", audio: ["195", 0] }, class_type: "AudioCrop", _meta: { title: "AudioCrop" } },
      "199": { inputs: { images: ["171", 0] }, class_type: "PreviewImage", _meta: { title: "Preview Image" } },
      "200": { inputs: { anything: ["131", 0] }, class_type: "easy cleanGpuUsed", _meta: { title: "Clean VRAM Used" } },
      "201": { inputs: { base64_string: base64Image }, class_type: "Base64DecodeNode", _meta: { title: "Base64 Decode to Image" } }
    };

    return prompt;
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
      setStatus("Convirtiendo imagen a Base64…");
      const base64Image = await fileToBase64(imageFile);

      setStatus("Subiendo audio a ComfyUI…");
      const audioFilename = await uploadAudioToComfy(comfyUrl, audioFile);

      setStatus("Enviando prompt a ComfyUI…");
      const payload = {
        prompt: buildPromptJSON(base64Image, audioFilename),
        client_id: `multitalk-ui-${Math.random().toString(36).slice(2)}`,
      };

      const r = await fetch(`${comfyUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Error ${r.status} al enviar el prompt.`);
      const resp = await r.json();
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || "";
      if (!id) throw new Error("No se obtuvo prompt_id.");
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

      // Poll history
      setStatus("Procesando en ComfyUI…");
      const result = await pollForResult(id, comfyUrl, 1000, 60 * 30); // up to 30 min
      if (!result) throw new Error("No se pudo recuperar el resultado.");

      const fileInfo = findVideoFileFromHistory(result);
      if (!fileInfo) throw new Error("No encontré el MP4 en el historial.");

      const url = `${comfyUrl}/view?filename=${encodeURIComponent(fileInfo.filename)}&subfolder=${encodeURIComponent(fileInfo.subfolder || "MultiTalkApi")}&type=output`;
      setVideoUrl(url);
      
      // Complete job in Supabase
      await completeJob({
        job_id: id,
        status: 'completed',
        filename: fileInfo.filename,
        subfolder: fileInfo.subfolder || "MultiTalkApi"
      });

      // Refresh feed to show new job
      await loadVideoFeedFromDB();
      
      setStatus("Listo ✅");
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      setStatus(errorMessage);
      
      // Complete job with error status if we have a job ID
      if (jobId) {
        await completeJob({
          job_id: jobId,
          status: 'error',
          error_message: errorMessage
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function pollForResult(promptId: string, baseUrl: string, intervalMs: number, maxSeconds: number) {
    const started = Date.now();
    while (Date.now() - started < maxSeconds * 1000) {
      await new Promise((res) => setTimeout(res, intervalMs));
      const r = await fetch(`${baseUrl}/history/${promptId}`);
      if (!r.ok) continue;
      const data = await r.json();
      const h = data?.[promptId];
      if (h?.status?.status_str === "success" || h?.status?.completed) return h;
      if (h?.status?.status_str === "error" || h?.status?.error) throw new Error("Error en ComfyUI durante el proceso.");
    }
    return null;
  }

  function findVideoFileFromHistory(historyEntry: any): { filename: string; subfolder?: string } | null {
    const outputs = historyEntry?.outputs || {};
    const nodes = Object.values(outputs) as any[];
    
    console.log("Looking for video in outputs:", outputs);
    
    for (const node of nodes) {
      console.log("Checking node:", node);
      
      // Check for videos array (VHS format)
      const vids = node?.videos || node?.video;
      if (Array.isArray(vids) && vids.length) {
        const v = vids[0];
        console.log("Found video:", v);
        if (v?.filename) return { filename: v.filename, subfolder: v.subfolder };
      }
      
      // Check for gifs array (sometimes VHS uses this)
      const gifs = node?.gifs;
      if (Array.isArray(gifs) && gifs.length) {
        const g = gifs[0];
        console.log("Found gif:", g);
        if (g?.filename) return { filename: g.filename, subfolder: g.subfolder };
      }
      
      // VHS sometimes attaches files under 'files'
      const files = node?.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          console.log("Found file:", f);
          if (typeof f?.filename === "string" && (f.filename.endsWith(".mp4") || f.filename.endsWith(".gif"))) {
            return { filename: f.filename, subfolder: f.subfolder };
          }
        }
      }
      
      // Check if the node has direct filename references
      if (node?.filename && typeof node.filename === "string") {
        console.log("Found direct filename:", node.filename);
        return { filename: node.filename, subfolder: node.subfolder };
      }
    }
    
    console.log("No video found in outputs");
    return null;
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

      <Section title="Conexión">
        <Field>
          <Label>URL de ComfyUI</Label>
          <input
            type="text"
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 backdrop-blur-sm"
            placeholder="https://59414078555f.ngrok.app"
            value={comfyUrl}
            onChange={(e) => setComfyUrl(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">Asegurate de habilitar CORS o usar un proxy si servís este frontend desde otro origen.</p>
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
        <div className="grid md:grid-cols-3 gap-4 items-end">
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
            <p className="text-xs text-gray-500 mt-1">Se ajusta a múltiplos de 32 por compatibilidad con el modelo.</p>
          </Field>
          <Field>
            <Label className="flex items-center gap-2">
              <input type="checkbox" checked={lock16x9} onChange={(e) => setLock16x9(e.target.checked)} />
              Bloquear a 16:9
            </Label>
            <div className="text-xs text-gray-500">Si está desactivado, se mantiene el aspecto de la imagen.</div>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={trimToAudio} onChange={(e) => setTrimToAudio(e.target.checked)} />
            Recortar video a la duración del audio
          </label>
        </div>
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

        <Section title="Tips Rápidos">
          <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
            <li>Para máxima compatibilidad, usá anchos y altos múltiplos de 32.</li>
            <li>Si querés que todo sea 16:9 (p. ej., 1280×720, 1920×1080), activá el switch y seteá el ancho.</li>
            <li>Si tu ComfyUI no tiene <code>/upload/audio</code>, probá actualizar extensiones VHS/Audio o ajustá el endpoint en el código.</li>
            <li>El prompt de texto (nodo 135) está hardcodeado como en tu workflow; lo podemos exponer en UI si querés.</li>
          </ul>
        </Section>
        </div>

        {/* Right Sidebar - Video Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6">
            <div className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
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
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {videoFeed.map((job) => {
                    const videoUrl = job.filename ? 
                      `${job.comfy_url}/view?filename=${encodeURIComponent(job.filename)}&subfolder=${encodeURIComponent(job.subfolder || 'MultiTalkApi')}&type=output` 
                      : null;
                      
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
