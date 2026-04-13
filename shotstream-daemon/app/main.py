"""
ShotStream HTTP Daemon.

Exposes the minimal contract expected by multitalk-ui's backend
(services/shotstream_service.py):

  POST /generate          -> {"job_id": "<uuid>"}
  GET  /jobs/{job_id}     -> {"status","progress","output_url","error"}
  POST /jobs/{id}/cancel  -> {"cancelled": true}
  GET  /health            -> {"status","device"}

Plus static serving of finished MP4s under /outputs/<job_id>.mp4.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .jobs import JobStore, Worker
from .pipeline_runner import PipelineRunner, RunnerConfig
from .schemas import (
    CancelResponse,
    GenerateRequest,
    GenerateResponse,
    HealthResponse,
    JobStatus,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("shotstream-daemon")


def _cfg_from_env() -> RunnerConfig:
    return RunnerConfig(
        shotstream_repo=Path(os.getenv("SHOTSTREAM_REPO", "/workspace/ShotStream")),
        config_path=Path(os.getenv("SHOTSTREAM_CONFIG", "/workspace/ckpts/shotstream.yaml")),
        ckpt_path=Path(os.getenv("SHOTSTREAM_CKPT", "/workspace/ckpts/shotstream_merged.pt")),
        output_root=Path(os.getenv("SHOTSTREAM_OUTPUT_ROOT", "/workspace/outputs")),
        work_root=Path(os.getenv("SHOTSTREAM_WORK_ROOT", "/workspace/work")),
        public_base_url=os.getenv("SHOTSTREAM_PUBLIC_URL", "http://127.0.0.1:9100"),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = _cfg_from_env()
    runner = PipelineRunner(cfg)
    store = JobStore()
    worker = Worker(store=store, run_fn=runner.run)
    worker.start()

    app.state.cfg = cfg
    app.state.runner = runner
    app.state.store = store
    app.state.worker = worker

    # Pre-load on startup if requested (slow first request otherwise).
    if os.getenv("SHOTSTREAM_PRELOAD", "false").lower() in ("1", "true", "yes"):
        try:
            log.info("Pre-loading pipeline at startup…")
            runner.ensure_loaded()
        except Exception as e:  # noqa: BLE001
            log.warning("Pre-load failed (will retry on first request): %s", e)

    try:
        yield
    finally:
        await worker.stop()


app = FastAPI(title="ShotStream Daemon", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve finished videos.
_output_root = Path(os.getenv("SHOTSTREAM_OUTPUT_ROOT", "/workspace/outputs"))
_output_root.mkdir(parents=True, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=str(_output_root)), name="outputs")


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    store: JobStore = app.state.store
    worker: Worker = app.state.worker
    job = await store.create(req)
    await worker.enqueue(job.id)
    return GenerateResponse(job_id=job.id)


@app.get("/jobs/{job_id}", response_model=JobStatus)
async def job_status(job_id: str):
    store: JobStore = app.state.store
    job = await store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatus(
        status=job.status,
        progress=job.progress,
        output_url=job.output_url,
        error=job.error,
    )


@app.post("/jobs/{job_id}/cancel", response_model=CancelResponse)
async def cancel_job(job_id: str):
    store: JobStore = app.state.store
    ok = await store.mark_cancelled(job_id)
    return CancelResponse(cancelled=ok)


@app.get("/health", response_model=HealthResponse)
async def health():
    runner: PipelineRunner = app.state.runner
    cfg: RunnerConfig = app.state.cfg
    return HealthResponse(
        status="ok",
        device=runner.device_info(),
        pipeline_loaded=runner.loaded,
        config_path=str(cfg.config_path) if cfg.config_path.exists() else None,
        ckpt_path=str(cfg.ckpt_path) if cfg.ckpt_path.exists() else None,
    )
