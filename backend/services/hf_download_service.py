"""HuggingFace model download service with background job tracking."""
import asyncio
import re
import shutil
import tempfile
import pathlib
import uuid
from typing import Optional

from tqdm.auto import tqdm
from huggingface_hub import hf_hub_download, hf_hub_url, get_hf_file_metadata
from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError, EntryNotFoundError

from core.s3_client import s3_client
from config.settings import settings

# ---- In-memory job store ----
# Schema: { job_id: { status, progress_pct, bytes_done, total_bytes, filename, s3_key, error } }
# Lives for process lifetime. Acceptable for single-admin use case.
_HF_JOBS: dict[str, dict] = {}

CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB — S3 minimum part size

# ---- URL parsing ----

HF_FILE_URL_PATTERN = re.compile(
    r"https://huggingface\.co/"
    r"(?P<repo_id>(?:[^/]+/)?[^/]+(?=/(?:blob|resolve)/|$))"
    r"(?:/(blob|resolve)/[^/]+"
    r"(?P<filename>/.+))?"
)


def parse_hf_url(url: str) -> tuple[str, Optional[str]]:
    """
    Parse a HuggingFace URL into (repo_id, filename_in_repo).
    filename_in_repo is None if URL points to repo root (unsupported in Phase 5).
    Raises ValueError for non-HF URLs.
    """
    m = HF_FILE_URL_PATTERN.match(url.strip())
    if not m:
        raise ValueError(
            f"Not a valid HuggingFace file URL. "
            f"Expected: https://huggingface.co/{{owner}}/{{repo}}/blob/main/{{path/to/file}}"
        )
    repo_id = m.group("repo_id")
    filename = m.group("filename")
    if filename:
        filename = filename.lstrip("/")
    if not filename:
        raise ValueError(
            "URL points to a repository root. Please provide a direct file URL "
            "(e.g. .../blob/main/model.safetensors)."
        )
    return repo_id, filename


# ---- Validation ----

def validate_hf_url(repo_id: str, filename: str, token: Optional[str]) -> dict:
    """
    Validate a HF file URL using get_hf_file_metadata (no download, just a HEAD request).
    Returns {"valid": True, "size": N, "filename": filename}.
    Raises ValueError with user-friendly message on auth/not-found errors.
    """
    try:
        url = hf_hub_url(repo_id=repo_id, filename=filename)
        metadata = get_hf_file_metadata(url=url, token=token or None)
        return {"valid": True, "size": getattr(metadata, "size", None), "filename": filename}
    except GatedRepoError:
        raise ValueError(
            f"Model '{repo_id}' is gated. Provide a HuggingFace access token "
            f"with access to this model."
        )
    except RepositoryNotFoundError:
        raise ValueError(
            f"Repository '{repo_id}' not found or is private. "
            f"Check the URL and provide a token if the repo is private."
        )
    except EntryNotFoundError:
        raise ValueError(
            f"File '{filename}' not found in repository '{repo_id}'."
        )
    except Exception as e:
        raise ValueError(f"Could not validate HuggingFace URL: {str(e)}")


# ---- Job store ----

def new_job(filename: str, s3_key: str) -> str:
    """Create a new job entry. Returns job_id (uuid4 string)."""
    job_id = str(uuid.uuid4())
    _HF_JOBS[job_id] = {
        "status": "pending",
        "progress_pct": 0.0,
        "bytes_done": 0,
        "total_bytes": None,
        "filename": filename,
        "s3_key": s3_key,
        "error": None,
    }
    return job_id


def get_hf_job(job_id: str) -> Optional[dict]:
    """Return current job state dict or None if not found."""
    return _HF_JOBS.get(job_id)


# ---- Progress tracking ----

def make_tqdm_class(job_id: str):
    """Returns a tqdm subclass that writes download progress to _HF_JOBS[job_id]."""
    class ProgressTqdm(tqdm):
        def update(self, n=1):
            super().update(n)
            job = _HF_JOBS.get(job_id)
            if job:
                job["bytes_done"] = self.n
                job["total_bytes"] = self.total
                if self.total and self.total > 0:
                    job["progress_pct"] = round(self.n / self.total * 100, 1)
    return ProgressTqdm


# ---- S3 multipart upload ----

def upload_to_s3_multipart(local_path: str, s3_key: str, job_id: str) -> None:
    """
    Upload local file to S3 using multipart upload.
    Updates job progress in _HF_JOBS during upload phase.
    Calls abort on any failure to prevent orphaned S3 parts.
    """
    import os
    file_size = os.path.getsize(local_path)
    _HF_JOBS[job_id]["status"] = "uploading"
    _HF_JOBS[job_id]["total_bytes"] = file_size
    _HF_JOBS[job_id]["bytes_done"] = 0
    _HF_JOBS[job_id]["progress_pct"] = 0.0

    resp = s3_client.create_multipart_upload(
        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
        Key=s3_key,
    )
    upload_id = resp["UploadId"]
    parts = []
    part_number = 0

    try:
        with open(local_path, "rb") as f:
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                part_number += 1
                part_resp = s3_client.upload_part(
                    Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                    Key=s3_key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_number, "ETag": part_resp["ETag"]})
                _HF_JOBS[job_id]["bytes_done"] += len(chunk)
                _HF_JOBS[job_id]["progress_pct"] = round(
                    _HF_JOBS[job_id]["bytes_done"] / file_size * 100, 1
                )
        s3_client.complete_multipart_upload(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=s3_key,
            UploadId=upload_id,
            MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])},
        )
    except Exception:
        s3_client.abort_multipart_upload(
            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
            Key=s3_key,
            UploadId=upload_id,
        )
        raise


# ---- Background download task ----

def _blocking_hf_download_and_upload(
    job_id: str,
    repo_id: str,
    filename: str,
    s3_key: str,
    hf_token: Optional[str],
) -> None:
    """
    Blocking function — runs in a thread via asyncio.to_thread.
    Phase 1: hf_hub_download to /tmp/hf-{job_id[:8]}/
    Phase 2: boto3 multipart upload to S3
    Always cleans up /tmp in finally block.
    Does NOT persist hf_token anywhere.
    """
    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix=f"hf-{job_id[:8]}-"))
    try:
        # Phase 1: Download from HuggingFace
        _HF_JOBS[job_id]["status"] = "downloading"
        _HF_JOBS[job_id]["progress_pct"] = 0.0
        local_path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            token=hf_token or None,
            local_dir=str(tmp_dir),
            tqdm_class=make_tqdm_class(job_id),
        )

        # Phase 2: Upload to S3
        upload_to_s3_multipart(local_path, s3_key, job_id)

        _HF_JOBS[job_id]["status"] = "done"
        _HF_JOBS[job_id]["progress_pct"] = 100.0

    except GatedRepoError:
        _HF_JOBS[job_id]["status"] = "error"
        _HF_JOBS[job_id]["error"] = (
            f"Model '{repo_id}' is gated. Provide a valid HuggingFace access token."
        )
    except RepositoryNotFoundError:
        _HF_JOBS[job_id]["status"] = "error"
        _HF_JOBS[job_id]["error"] = (
            f"Repository '{repo_id}' not found or private. Check URL and token."
        )
    except EntryNotFoundError:
        _HF_JOBS[job_id]["status"] = "error"
        _HF_JOBS[job_id]["error"] = f"File '{filename}' not found in '{repo_id}'."
    except Exception as e:
        _HF_JOBS[job_id]["status"] = "error"
        _HF_JOBS[job_id]["error"] = str(e)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def start_hf_download_job(
    job_id: str,
    repo_id: str,
    filename: str,
    s3_key: str,
    hf_token: Optional[str],
) -> None:
    """Async wrapper: runs blocking download+upload in a thread without blocking event loop."""
    await asyncio.to_thread(
        _blocking_hf_download_and_upload,
        job_id, repo_id, filename, s3_key, hf_token,
    )
