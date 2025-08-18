import React, { useState } from "react";

// UI Helpers - copied from MultiTalkOnePerson for consistency
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
        <div className="w-2 h-8 bg-gradient-to-b from-green-500 to-teal-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function AudioTest() {
  const [comfyUrl, setComfyUrl] = useState<string>("https://59414078555f.ngrok.app");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioFilename, setAudioFilename] = useState<string>("Solo Parte Que Me Importa.wav");
  const [useUpload, setUseUpload] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<string>("0:00");
  const [endTime, setEndTime] = useState<string>("4:00");
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"info" | "success" | "error">("info");
  const [result, setResult] = useState<any>(null);
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

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
      
      if (data?.name) {
        setStatus(`✅ Audio subido como: ${data.name}`);
        setStatusType("success");
        return data.name;
      }
      
      if (Array.isArray(data?.files) && data.files[0]) {
        setStatus(`✅ Audio subido como: ${data.files[0]}`);
        setStatusType("success");
        return data.files[0];
      }
      
      const text = typeof data === "string" ? data : await r.text().catch(() => "");
      if (text.trim()) {
        setStatus(`✅ Audio subido como: ${text.trim()}`);
        setStatusType("success");
        return text.trim();
      }
      
      throw new Error("Respuesta inesperada del servidor");
      
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error('No se pudo conectar al servidor. Verificá la URL de ngrok.');
      }
      throw new Error(`Error subiendo audio: ${e.message}`);
    }
  }

  function buildWorkflowJSON(audioFilename: string) {
    return {
      "1": {
        inputs: {
          audio: audioFilename,
          audioUI: ""
        },
        class_type: "LoadAudio",
        _meta: {
          title: "LoadAudio"
        }
      },
      "2": {
        inputs: {
          start_time: startTime,
          end_time: endTime,
          audio: ["1", 0]
        },
        class_type: "AudioCrop",
        _meta: {
          title: "AudioCrop"
        }
      },
      "3": {
        inputs: {
          anything: ["2", 0]
        },
        class_type: "easy showAnything",
        _meta: {
          title: "Show Any"
        }
      }
    };
  }

  async function pollForResult(promptId: string, baseUrl: string, intervalMs: number, maxSeconds: number) {
    const started = Date.now();
    let attempts = 0;
    
    while (Date.now() - started < maxSeconds * 1000) {
      attempts++;
      await new Promise((res) => setTimeout(res, intervalMs));
      
      try {
        const r = await fetch(`${baseUrl}/history/${promptId}`);
        if (!r.ok) {
          setStatus(`⏳ Verificando progreso... (intento ${attempts})`);
          setStatusType("info");
          continue;
        }
        
        const data = await r.json();
        const h = data?.[promptId];
        
        if (h?.status?.status_str === "success" || h?.status?.completed) {
          setStatus(`✅ Procesamiento completado exitosamente`);
          setStatusType("success");
          return h;
        }
        
        if (h?.status?.status_str === "error" || h?.status?.error) {
          const errorMsg = h?.status?.messages?.join(', ') || 'Error desconocido';
          throw new Error(`Error en ComfyUI: ${errorMsg}`);
        }
        
        // Still processing
        setStatus(`⏳ Procesando en ComfyUI... (${Math.round((Date.now() - started) / 1000)}s)`);
        setStatusType("info");
        
      } catch (e: any) {
        if (attempts % 5 === 0) { // Show connection errors every 5 attempts
          setStatus(`⚠️ Problema conectando al servidor (intento ${attempts})`);
          setStatusType("error");
        }
      }
    }
    
    throw new Error(`Timeout: El procesamiento tardó más de ${maxSeconds} segundos`);
  }

  async function submit() {
    setStatus("");
    setStatusType("info");
    setResult(null);
    setJobId("");

    // Validation
    if (!comfyUrl) {
      setStatus("❌ Poné la URL de ComfyUI.");
      setStatusType("error");
      return;
    }
    if (useUpload && !audioFile) {
      setStatus("❌ Subí un archivo de audio o usá el modo sin subida.");
      setStatusType("error");
      return;
    }
    if (!useUpload && !audioFilename) {
      setStatus("❌ Especificá el nombre del archivo de audio en el servidor.");
      setStatusType("error");
      return;
    }
    if (!startTime || !endTime) {
      setStatus("❌ Configurá los tiempos de inicio y fin.");
      setStatusType("error");
      return;
    }

    setIsSubmitting(true);
    try {
      let finalAudioFilename: string;
      
      if (useUpload) {
        // Step 1: Upload audio
        setStatus("📤 Subiendo audio a ComfyUI…");
        setStatusType("info");
        finalAudioFilename = await uploadAudioToComfy(comfyUrl, audioFile!);
      } else {
        // Skip upload, use hardcoded filename
        setStatus("✅ Usando archivo existente en el servidor");
        setStatusType("success");
        finalAudioFilename = audioFilename;
      }

      // Step 2: Send workflow
      setStatus("📋 Enviando workflow a ComfyUI…");
      setStatusType("info");
      const payload = {
        prompt: buildWorkflowJSON(finalAudioFilename),
        client_id: `audio-test-${Math.random().toString(36).slice(2)}`,
      };

      const r = await fetch(`${comfyUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!r.ok) {
        let errorMsg = `HTTP ${r.status}`;
        try {
          const errorData = await r.text();
          if (errorData) errorMsg += `: ${errorData}`;
        } catch {}
        throw new Error(`Error enviando workflow - ${errorMsg}`);
      }
      
      const resp = await r.json();
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || "";
      if (!id) throw new Error("No se obtuvo prompt_id del servidor.");
      
      setJobId(id);
      setStatus(`✅ Workflow enviado. Job ID: ${id}`);
      setStatusType("success");

      // Step 3: Poll for results
      setStatus("⏳ Procesando en ComfyUI…");
      setStatusType("info");
      const result = await pollForResult(id, comfyUrl, 1000, 60 * 5); // 5 min timeout
      
      if (!result) {
        throw new Error("No se pudo recuperar el resultado.");
      }

      setResult(result);
      setStatus("🎉 ¡Procesamiento completado exitosamente!");
      setStatusType("success");
      
    } catch (e: any) {
      setStatus(`❌ ${e?.message || String(e)}`);
      setStatusType("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-teal-50">
      <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
        <div className="text-center space-y-4 py-8">
          <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-green-600 via-teal-600 to-emerald-600 bg-clip-text text-transparent">
            Audio Test
          </h1>
          <div className="text-lg md:text-xl font-medium text-gray-700">
            <span className="bg-gradient-to-r from-green-100 to-teal-100 px-4 py-2 rounded-full border border-green-200/50">
              Workflow Simple
            </span>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Prueba el workflow básico de audio: cargar, recortar y mostrar información.
          </p>
        </div>

        <Section title="Conexión">
          <Field>
            <Label>URL de ComfyUI</Label>
            <input
              type="text"
              className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 placeholder-gray-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all duration-200 bg-white/80 backdrop-blur-sm"
              placeholder="https://59414078555f.ngrok.app"
              value={comfyUrl}
              onChange={(e) => setComfyUrl(e.target.value)}
            />
          </Field>
        </Section>

        <Section title="Audio">
          <Field>
            <Label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={useUpload} 
                onChange={(e) => setUseUpload(e.target.checked)}
                className="rounded"
              />
              Subir archivo nuevo (si no está marcado, usar archivo existente)
            </Label>
          </Field>
          
          {useUpload ? (
            <Field>
              <Label>Archivo de Audio para Subir</Label>
              <div className="relative">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-teal-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-teal-700 transition-all duration-200 bg-gray-50/50"
                />
              </div>
              <p className="text-xs text-red-500 mt-1">⚠️ Requiere CORS habilitado en ComfyUI</p>
            </Field>
          ) : (
            <Field>
              <Label>Nombre del Archivo en el Servidor</Label>
              <input
                type="text"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all duration-200 bg-white/80"
                placeholder="ejemplo.wav"
                value={audioFilename}
                onChange={(e) => setAudioFilename(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Archivo que ya existe en la carpeta input de ComfyUI</p>
            </Field>
          )}
        </Section>

        <Section title="Configuración de Recorte">
          <div className="grid md:grid-cols-2 gap-6">
            <Field>
              <Label>Tiempo de Inicio</Label>
              <input
                type="text"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all duration-200 bg-white/80"
                placeholder="0:00"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Formato: M:SS o MM:SS</p>
            </Field>
            <Field>
              <Label>Tiempo de Fin</Label>
              <input
                type="text"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-teal-500 focus:ring-4 focus:ring-teal-100 transition-all duration-200 bg-white/80"
                placeholder="4:00"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Formato: M:SS o MM:SS</p>
            </Field>
          </div>
        </Section>

        <Section title="Ejecución">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-teal-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
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
                  <span>🎵</span>
                  Procesar Audio
                </>
              )}
            </button>
            {jobId && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">Job ID: {jobId}</span>}
            {status && (
              <div className={`text-sm px-3 py-2 rounded-lg border ${
                statusType === "success" ? "bg-green-50 text-green-700 border-green-200" :
                statusType === "error" ? "bg-red-50 text-red-700 border-red-200" :
                "bg-blue-50 text-blue-700 border-blue-200"
              }`}>
                {status}
              </div>
            )}
          </div>

          {result && (
            <div className="mt-6 space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Resultado:</h3>
              <pre className="bg-gray-100 rounded-2xl p-4 overflow-auto text-sm">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}