"""
Wraps KlingAIResearch/ShotStream's `CausalInferenceArPipeline` so we can call
inference on a request-by-request basis from the FastAPI daemon.

The upstream `Inference_Causal.py` reads a CSV that points to a JSON per row
(each JSON has `global_caption`, `shot1`..`shotN`). We keep that exact flow
intact — for each HTTP request we write a tiny CSV+JSON pair to disk, build
the dataloader, run ONE batch, then move the resulting MP4 to a stable path.

The pipeline + model weights are loaded ONCE on first use (not per request).

All upstream-specific imports happen lazily inside methods so the daemon can
still boot (and report health) when the ShotStream repo or checkpoints are
missing — the error will surface at generation time with a useful message.
"""

from __future__ import annotations

import csv
import glob
import json
import logging
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .jobs import Job

log = logging.getLogger(__name__)


@dataclass
class RunnerConfig:
    shotstream_repo: Path   # /workspace/ShotStream (cloned upstream)
    config_path: Path       # ckpts/shotstream.yaml
    ckpt_path: Path         # ckpts/shotstream_merged.pt
    output_root: Path       # where finished MP4s are stored & served
    work_root: Path         # per-job scratch (CSV/JSON inputs, temp outputs)
    public_base_url: str    # e.g. http://127.0.0.1:9100
    device: str = "cuda:0"


class PipelineRunner:
    """Lazy-loaded wrapper around CausalInferenceArPipeline."""

    def __init__(self, cfg: RunnerConfig) -> None:
        self.cfg = cfg
        self._pipeline = None
        self._config = None
        self.cfg.output_root.mkdir(parents=True, exist_ok=True)
        self.cfg.work_root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    @property
    def loaded(self) -> bool:
        return self._pipeline is not None

    def ensure_loaded(self) -> None:
        if self._pipeline is not None:
            return

        if not self.cfg.shotstream_repo.exists():
            raise RuntimeError(
                f"ShotStream repo not found at {self.cfg.shotstream_repo}. "
                f"Clone https://github.com/KlingAIResearch/ShotStream into it."
            )
        if not self.cfg.config_path.exists():
            raise RuntimeError(
                f"Config not found at {self.cfg.config_path}. Run download_models to fetch ckpts."
            )
        if not self.cfg.ckpt_path.exists():
            raise RuntimeError(
                f"Checkpoint not found at {self.cfg.ckpt_path}. Run download_models to fetch ckpts."
            )

        # Make upstream modules importable.
        sys.path.insert(0, str(self.cfg.shotstream_repo))

        from omegaconf import OmegaConf  # type: ignore
        from pipeline import CausalInferenceArPipeline  # type: ignore

        log.info("Loading ShotStream pipeline from %s", self.cfg.config_path)
        config = OmegaConf.load(str(self.cfg.config_path))
        # These fields are read downstream when building the dataset/dataloader.
        config.resume_ckpt = str(self.cfg.ckpt_path)
        config.resume_lora_ckpt = None
        config.multi_caption = True
        config.use_wo_rope_cache = False

        self._config = config
        self._pipeline = CausalInferenceArPipeline(config)
        log.info("ShotStream pipeline ready on %s", self.cfg.device)

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------
    def run(self, job: Job) -> str:
        """Run inference for one job. Returns a URL to the resulting MP4."""
        self.ensure_loaded()

        from torch.utils.data import DataLoader  # type: ignore
        import torch  # type: ignore
        from einops import rearrange  # type: ignore
        from torchvision.io import write_video  # type: ignore

        # Upstream dataset class lives in the ShotStream repo.
        # Import path inferred from Inference_Causal.py's usage.
        try:
            from dataset.multishots_frameconcat_dataset import (  # type: ignore
                MultiShots_FrameConcat_Dataset,
            )
        except ImportError:  # fallback: some forks expose it at dataset top-level
            from dataset import MultiShots_FrameConcat_Dataset  # type: ignore

        shots = job.request.shots
        job_work_dir = self.cfg.work_root / job.id
        job_work_dir.mkdir(parents=True, exist_ok=True)
        job_output_dir = job_work_dir / "output"
        job_output_dir.mkdir(parents=True, exist_ok=True)

        # 1) Write per-job JSON (global_caption + shotN fields).
        json_path = job_work_dir / "shots.json"
        global_caption = " ".join(s.prompt.strip() for s in shots)
        json_body = {"video_path": "", "global_caption": global_caption}
        for i, s in enumerate(shots, start=1):
            json_body[f"shot{i}"] = s.prompt
        json_path.write_text(json.dumps(json_body, ensure_ascii=False), encoding="utf-8")

        # 2) Write per-job CSV — one row.
        csv_path = job_work_dir / "input.csv"
        frames_per_shot = [max(8, int(round(s.duration_sec * job.request.fps))) for s in shots]
        # upstream frame_number is a list of [start,end] windows, cumulative.
        windows, cursor = [], 0
        for n in frames_per_shot:
            windows.append([cursor, cursor + n])
            cursor += n
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["shot_num_from_caption", "json_path", "video_path", "frame_number"])
            w.writerow([len(shots), str(json_path), "", json.dumps(windows)])

        # 3) Mutate config for this run and build dataloader.
        self._config.data_path = str(csv_path)
        self._config.output_folder = str(job_output_dir)
        if job.request.seed is not None:
            self._config.seed = int(job.request.seed)
        # Width/height overrides — upstream keys vary; set commonly-seen ones.
        for key in ("width", "gen_width", "sample_width"):
            if key in self._config:
                self._config[key] = job.request.width
        for key in ("height", "gen_height", "sample_height"):
            if key in self._config:
                self._config[key] = job.request.height

        dataset = MultiShots_FrameConcat_Dataset(csv_path=str(csv_path))
        loader = DataLoader(dataset, batch_size=1, shuffle=False, num_workers=0)

        # 4) Run a single batch.
        for batch_data in loader:
            batch = batch_data if isinstance(batch_data, dict) else batch_data[0]
            with torch.inference_mode():
                video = self._pipeline.inference(
                    batch=batch,
                    use_wo_rope_cache=self._config.use_wo_rope_cache,
                )
            video = rearrange(video, "b t c h w -> b t h w c").cpu()
            video = (255.0 * video).clamp(0, 255).to(torch.uint8)

            caption = batch["shots_captions"][0][-1][0][0]
            safe_caption = _safe_slug(caption)[:50]
            upstream_name = f"000_{safe_caption}.mp4"
            upstream_path = job_output_dir / upstream_name

            write_video(str(upstream_path), video[0], fps=job.request.fps)
            try:
                self._pipeline.vae.model.clear_cache()
            except AttributeError:
                pass
            break  # only one batch

        # 5) Move result to stable path and return URL.
        final_path = self.cfg.output_root / f"{job.id}.mp4"
        _move_first_mp4(job_output_dir, final_path)
        # Clean per-job scratch (keep only the final MP4).
        shutil.rmtree(job_work_dir, ignore_errors=True)

        return f"{self.cfg.public_base_url.rstrip('/')}/outputs/{job.id}.mp4"

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------
    def device_info(self) -> Optional[str]:
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                idx = torch.cuda.current_device()
                return f"cuda:{idx} ({torch.cuda.get_device_name(idx)})"
            return "cpu"
        except Exception:  # noqa: BLE001
            return None


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _safe_slug(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_ " else "_" for c in text).strip().replace(" ", "_")


def _move_first_mp4(search_dir: Path, dest: Path) -> None:
    """Upstream writes `{i:03d}_{caption[:50]}.mp4`; with batch size 1 there's only one."""
    matches = sorted(glob.glob(str(search_dir / "*.mp4")))
    if not matches:
        raise RuntimeError(f"No MP4 produced in {search_dir}")
    if dest.exists():
        dest.unlink()
    os.replace(matches[0], dest)
