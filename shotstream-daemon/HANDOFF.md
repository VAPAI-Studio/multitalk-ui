# ShotStream — Handoff

Retomá desde acá cuando cambies a Claude Code corriendo en tu PC con GPU.

## Estado actual

Branch: **`claude/implement-shotstream-feature-dsfFv`** (ya pusheada).

Dos commits, ambos mergeables como están:

| Commit | Qué agrega |
|---|---|
| `a34a030` | Scaffolding UI + backend proxy en multitalk-ui (página, router `/api/shotstream/*`, settings, changelog) |
| `d954459` | `shotstream-daemon/` — FastAPI + Dockerfile + docker-compose + scripts de descarga + README |

Nada corre todavía. El daemon nunca se buildeó ni se probó con GPU real. La UI apunta a `http://127.0.0.1:9100` pero ese puerto está vacío hasta que levantes el daemon.

## Qué falta (en orden)

1. **Preflight** — verificar que está el stack:
   ```powershell
   nvidia-smi                                         # debe listar tu GPU
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi  # GPU visible a Docker
   git --version; git-lfs --version                   # para bajar pesos
   ```

2. **Descargar pesos** (~15 GB a `D:\shotstream`):
   ```powershell
   cd shotstream-daemon\scripts
   .\download_models.ps1
   ```
   Cuando termine, revisá qué archivos quedaron:
   ```powershell
   dir D:\shotstream\ckpts
   ```
   Si el nombre del checkpoint no es exactamente `shotstream_merged.pt`, ajustá `SHOTSTREAM_CKPT` en `docker-compose.yml` (o renombrá el archivo).

3. **Build + run del daemon**:
   ```powershell
   cd shotstream-daemon
   Copy-Item .env.example .env
   docker compose up --build
   ```
   Primer build: 10–20 min por flash-attn. Los siguientes son instant.

4. **Smoke test**:
   ```powershell
   curl http://127.0.0.1:9100/health
   ```
   Debe devolver `status:"ok"` y tu GPU en `device`.

5. **Activar en el backend multitalk-ui** (`backend/.env`):
   ```
   ENABLE_SHOTSTREAM=true
   SHOTSTREAM_SERVICE_URL=http://127.0.0.1:9100
   ```
   Reiniciá el backend. Entrá a Video Studio → ShotStream, el banner debe ponerse verde.

## Errores esperables (por probabilidad)

### Durante el build del Docker

- **`could not select device driver "" with capabilities: [[gpu]]`** → falta NVIDIA Container Toolkit. En WSL2: `sudo apt install nvidia-container-toolkit && sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`.
- **flash-attn compile falla con `nvcc not found`** → cambié `-devel` por `-runtime` sin querer. Verificá que la base en el Dockerfile sea `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04`.
- **flash-attn falla por versión incompatible** → probá sacar el `==2.7.4.post1` pin y dejar solo `pip install flash-attn --no-build-isolation`.
- **Build se queda sin RAM** → bajá `MAX_JOBS=4` a `MAX_JOBS=2` en el Dockerfile.

### Al primer request

- **`ModuleNotFoundError: No module named 'dataset.multishots_frameconcat_dataset'`** → el import path real del dataset en el repo upstream es otro. Buscalo con:
  ```powershell
  docker compose exec shotstream grep -r "class MultiShots_FrameConcat_Dataset" /workspace/ShotStream
  ```
  Ajustá los dos imports en `app/pipeline_runner.py` (tienen fallback, pero si ambos fallan, agregá el path correcto).
- **`Config not found at /workspace/ckpts/shotstream.yaml`** → los archivos en el HF repo tienen otro nombre. Ver `dir D:\shotstream\ckpts` y ajustar env vars.
- **KeyError en `batch['shots_captions']`** → la shape del batch cambió. Poné un `print(batch.keys())` en `pipeline_runner.py:run()` antes del `pipeline.inference(...)` para ver qué viene.
- **OOM en VRAM** → pará ComfyUI mientras generás, o subí la GPU (1.3B + ShotStream necesita ~16 GB cómodo).

### En la UI

- **Banner dice "Local daemon unreachable"** → `curl http://127.0.0.1:9100/health` desde el host del backend. Si el backend corre en WSL y el daemon en Windows Docker Desktop, quizás necesites `http://host.docker.internal:9100` o la IP de WSL.
- **Video no reproduce** → `output_url` apunta a `127.0.0.1:9100`; tiene que ser el browser el que lo acceda. Si accedés la UI remotamente, hay que proxear por el backend (TODO futuro).

## Archivos clave para revisar

| Archivo | Para qué |
|---|---|
| `shotstream-daemon/README.md` | Setup full, troubleshooting |
| `shotstream-daemon/app/pipeline_runner.py` | **Punto de dolor más probable.** Wrapping del `CausalInferenceArPipeline`. Si algo falla en runtime es casi seguro acá. |
| `shotstream-daemon/app/main.py` | Endpoints HTTP |
| `shotstream-daemon/Dockerfile` | Build del contenedor |
| `backend/services/shotstream_service.py` | Proxy desde multitalk-ui — define el contrato HTTP |
| `frontend/src/pages/ShotStream.tsx` | UI de la página |

## Contrato HTTP (referencia rápida)

```
POST /generate
  { "shots": [{"prompt": "...", "duration_sec": 3.0}, ...],
    "width": 480, "height": 832, "seed": null, "fps": 16 }
  → { "job_id": "<uuid>" }

GET  /jobs/{id}
  → { "status": "queued|running|completed|failed|cancelled",
      "progress": 0.0..1.0,
      "output_url": "http://127.0.0.1:9100/outputs/<id>.mp4",
      "error": null }

POST /jobs/{id}/cancel
  → { "cancelled": true }

GET  /health
  → { "status": "ok", "device": "cuda:0 (...)",
      "pipeline_loaded": bool, "config_path": "...", "ckpt_path": "..." }

GET  /outputs/{id}.mp4    # StaticFiles
```

## Prompt inicial sugerido para Claude Code local

> Retomo el trabajo de ShotStream. Branch `claude/implement-shotstream-feature-dsfFv`. Leé `shotstream-daemon/HANDOFF.md` para el estado. Vamos a ejecutar los pasos 1–5 del handoff de forma interactiva: yo te voy corriendo los comandos y vos diagnosticás los errores que aparezcan. Arrancá confirmándome que el preflight del paso 1 pasa en mi máquina.

## Cosas que dejé pendientes a propósito

- **Persistir jobs en `video_jobs`** (Supabase). Hoy el daemon y la UI hablan en memoria; los jobs no aparecen en History. Cuando el daemon corra bien, PR separado para integrarlo.
- **Proxy de `/outputs` por el backend** — para que videos funcionen si accedés la UI desde otra máquina.
- **Cancelación "real"** — hoy solo cancela jobs en cola, no mata la inferencia en GPU. Nontrivial con CUDA.
- **Tests del daemon** — agregar un modo mock (sin PyTorch) para smoke tests rápidos en CI.
