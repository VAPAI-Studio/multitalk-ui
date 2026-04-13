# ShotStream Daemon

Local HTTP service that wraps
[KlingAIResearch/ShotStream](https://github.com/KlingAIResearch/ShotStream)
so the multitalk-ui backend can submit multi-shot video generation jobs to it.

```
┌──────────────┐   POST /api/shotstream/submit   ┌──────────────────────┐
│   Frontend   │ ──────────────────────────────▶ │  multitalk-ui backend │
└──────────────┘                                 └──────────┬───────────┘
                                                            │ HTTP
                                                            ▼
                         ┌────────────────────────────────────────────┐
                         │  THIS daemon (FastAPI + PyTorch, GPU)       │
                         │  :9100  /generate /jobs/{id} /outputs/...   │
                         └────────────────────────────────────────────┘
```

Runs on the **same machine as ComfyUI** (same GPU, different port).

---

## 0. Hardware & prerequisites

- **NVIDIA GPU** with ≥16 GB VRAM (tested path; may work with less).
  Keep in mind it shares the GPU with ComfyUI if both run simultaneously.
- **Windows 10/11 + WSL2 + Docker Desktop + NVIDIA Container Toolkit**,
  OR Linux with Docker + `nvidia-container-toolkit`.
- **Disk**: ~20 GB free on wherever you put the weights (default `D:\shotstream`).

To verify GPU is visible to Docker:

```powershell
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

You should see your GPU listed.

---

## 1. Download the weights

Weights live on the host filesystem (not baked into the Docker image) so
rebuilds are cheap. Default location: `D:\shotstream` (override with
`SHOTSTREAM_MODELS_DIR`).

### Windows (PowerShell)

```powershell
cd shotstream-daemon\scripts
.\download_models.ps1
```

This clones:

```
D:\shotstream\
├── ckpts\                 # KlingTeam/ShotStream  (≈ 8–10 GB)
│   ├── shotstream.yaml
│   └── shotstream_merged.pt
├── wan_models\            # Wan-AI/Wan2.1-T2V-1.3B  (≈ 6 GB)
├── outputs\               # finished MP4s land here
└── hf_cache\              # HuggingFace cache
```

### Linux

```bash
SHOTSTREAM_MODELS_DIR=/mnt/data/shotstream ./scripts/download_models.sh
```

---

## 2. Configure docker-compose

```powershell
cd shotstream-daemon
Copy-Item .env.example .env
# edit .env only if your weights are NOT at D:\shotstream
```

---

## 3. Build & run

```powershell
docker compose up --build
```

First build takes **10–20 minutes** (flash-attn compiles from source — that's
normal). Subsequent runs are instant.

When you see

```
Uvicorn running on http://0.0.0.0:9100
```

the daemon is up. Smoke-test it:

```powershell
curl http://127.0.0.1:9100/health
```

Expected:

```json
{
  "status":"ok",
  "device":"cuda:0 (NVIDIA GeForce RTX ...)",
  "pipeline_loaded":false,
  "config_path":"/workspace/ckpts/shotstream.yaml",
  "ckpt_path":"/workspace/ckpts/shotstream_merged.pt"
}
```

`pipeline_loaded:false` is expected — the model loads lazily on the first
`/generate` call (~30 s). Set `SHOTSTREAM_PRELOAD=true` in `.env` to load
on container startup instead.

---

## 4. Wire multitalk-ui's backend to it

In `backend/.env`:

```bash
ENABLE_SHOTSTREAM=true
SHOTSTREAM_SERVICE_URL=http://127.0.0.1:9100
SHOTSTREAM_TIMEOUT=900
```

Restart the multitalk-ui backend. The **Video Studio → ShotStream** page
will now show a green health banner and accept generation requests.

---

## 5. Try it from the CLI (bypassing the UI)

```bash
curl -X POST http://127.0.0.1:9100/generate \
  -H "Content-Type: application/json" \
  -d '{
    "shots": [
      {"prompt": "a lone traveler walks across a windswept dune at golden hour", "duration_sec": 3},
      {"prompt": "the camera pans to reveal ancient stone ruins in the sand",    "duration_sec": 3}
    ],
    "width": 480,
    "height": 832,
    "fps": 16
  }'
# -> {"job_id":"..."}

curl http://127.0.0.1:9100/jobs/<job_id>
# -> {"status":"running","progress":...}
# ... eventually:
# -> {"status":"completed","output_url":"http://127.0.0.1:9100/outputs/<id>.mp4"}
```

---

## HTTP contract

| Method | Path                      | Body / Query              | Returns                                   |
|--------|---------------------------|---------------------------|-------------------------------------------|
| POST   | `/generate`               | `GenerateRequest` (JSON)  | `{"job_id": str}`                         |
| GET    | `/jobs/{job_id}`          | —                         | `{status, progress, output_url, error}`   |
| POST   | `/jobs/{job_id}/cancel`   | —                         | `{"cancelled": bool}`                     |
| GET    | `/health`                 | —                         | health info                               |
| GET    | `/outputs/{job_id}.mp4`   | —                         | MP4 bytes (StaticFiles)                   |

`GenerateRequest`:

```jsonc
{
  "shots": [ {"prompt": "…", "duration_sec": 3.0}, ... ],  // 1..8 shots
  "width":  480,     // multiple of 32 (64..1024)
  "height": 832,     // multiple of 32 (64..1024)
  "seed":   42,      // optional, null = random
  "fps":    16
}
```

`/jobs/{id}` status values: `queued | running | completed | failed | cancelled`.
Cancellation is best-effort: only jobs still in the queue can be cancelled —
a request already running on the GPU will finish.

---

## Operational notes

- **Single worker.** Requests are serialized so we never run two inferences
  on the same GPU concurrently. Check status polls are fine while a job is
  running.
- **Pipeline is loaded once** in the daemon's memory and reused across
  requests.
- **Outputs persist on disk** (`D:\shotstream\outputs\<job_id>.mp4`). Clean
  up manually if you care about disk space.
- **Sharing GPU with ComfyUI:** both will fight for VRAM. Pause ComfyUI jobs
  (or run on a second GPU via `CUDA_VISIBLE_DEVICES`) for best throughput.

---

## Troubleshooting

### `docker compose up` fails with `could not select device driver "" with capabilities: [[gpu]]`

NVIDIA Container Toolkit isn't installed / configured.
On Windows: Docker Desktop → Settings → Resources → WSL integration;
ensure your distro is checked. Then inside WSL:

```bash
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### `flash-attn` build fails

Usually a mismatch between CUDA in the image and the PyTorch wheel. The
Dockerfile pins `nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04` + torch 2.8
(CUDA 12.8 wheels). If you change either, pin a compatible `flash-attn`.

### `Config not found at /workspace/ckpts/shotstream.yaml`

Weights weren't downloaded, or the volume isn't mounted. Check:

```powershell
dir D:\shotstream\ckpts
# should contain shotstream.yaml and shotstream_merged.pt
```

If the filenames on HuggingFace differ from those expected paths, set
`SHOTSTREAM_CONFIG` / `SHOTSTREAM_CKPT` env vars in `docker-compose.yml`.

### First request is very slow

That's the lazy load of Wan2.1 + ShotStream (~30 s on a warm SSD).
Set `SHOTSTREAM_PRELOAD=true` in `.env` to amortize it at container startup.

### Videos in the UI don't play

The `output_url` returned is `http://127.0.0.1:9100/outputs/<id>.mp4`.
Your browser must be on the same machine as the daemon. If you access the
UI from another device, you'll need to either proxy the outputs through
the multitalk-ui backend or expose the daemon on the LAN and set
`SHOTSTREAM_PUBLIC_URL` accordingly.

---

## Running without Docker (advanced)

If Docker isn't an option, follow upstream `tools/setup/env.sh` to build
a conda env with CUDA 12.4.1 + torch 2.8 + flash-attn, then:

```bash
export SHOTSTREAM_REPO=/path/to/ShotStream
export SHOTSTREAM_CONFIG=/path/to/ckpts/shotstream.yaml
export SHOTSTREAM_CKPT=/path/to/ckpts/shotstream_merged.pt
export SHOTSTREAM_OUTPUT_ROOT=/path/to/outputs
export PYTHONPATH=$(pwd)
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 9100
```

Docker is strongly recommended because flash-attn + CUDA pinning is
finicky.
