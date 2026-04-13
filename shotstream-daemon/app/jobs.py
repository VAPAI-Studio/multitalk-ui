"""
In-memory job store + single-worker queue.

Why a single worker: ShotStream + Wan2.1 share one GPU. Running two inferences
concurrently OOMs or thrashes. Requests are serialized through an asyncio.Queue
and executed one at a time by a background task.

Jobs live in memory only. If the daemon restarts, in-flight and queued jobs
are lost — that's fine for a local dev tool. Completed MP4s persist on disk.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from .schemas import GenerateRequest

log = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    request: GenerateRequest
    status: str = "queued"  # queued | running | completed | failed | cancelled
    progress: Optional[float] = None
    output_url: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None


class JobStore:
    """Thread-safe (within asyncio) job registry."""

    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create(self, request: GenerateRequest) -> Job:
        job = Job(id=str(uuid.uuid4()), request=request)
        async with self._lock:
            self._jobs[job.id] = job
        return job

    async def get(self, job_id: str) -> Optional[Job]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def update(self, job_id: str, **fields) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for k, v in fields.items():
                setattr(job, k, v)

    async def mark_cancelled(self, job_id: str) -> bool:
        """Return True if the job was still queued (we can actually cancel)."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            if job.status == "queued":
                job.status = "cancelled"
                job.finished_at = time.time()
                return True
            # Running / completed: cannot cancel a CUDA kernel mid-flight cleanly.
            return False


class Worker:
    """
    Background task that pulls job IDs from a queue and runs them sequentially.

    The actual inference function is injected so this module stays decoupled
    from PyTorch / the ShotStream pipeline (handy for tests).
    """

    def __init__(self, store: JobStore, run_fn) -> None:
        self.store = store
        self.run_fn = run_fn  # (job: Job) -> str (output path)
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: Optional[asyncio.Task] = None

    async def enqueue(self, job_id: str) -> None:
        await self.queue.put(job_id)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run_forever(), name="shotstream-worker")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run_forever(self) -> None:
        while True:
            job_id = await self.queue.get()
            job = await self.store.get(job_id)
            if job is None or job.status == "cancelled":
                self.queue.task_done()
                continue

            await self.store.update(job_id, status="running", started_at=time.time(), progress=0.0)
            try:
                # Run blocking inference in a thread so we don't starve the event loop.
                output_url = await asyncio.to_thread(self.run_fn, job)
                await self.store.update(
                    job_id,
                    status="completed",
                    progress=1.0,
                    output_url=output_url,
                    finished_at=time.time(),
                )
            except Exception as e:  # noqa: BLE001
                log.exception("Job %s failed", job_id)
                await self.store.update(
                    job_id,
                    status="failed",
                    error=str(e),
                    finished_at=time.time(),
                )
            finally:
                self.queue.task_done()
