"""HuggingFace model download service with background job tracking."""
import asyncio
import os
import re
import uuid
from typing import Optional

import requests as _requests

# Disable XET storage backend (huggingface_hub>=1.0 uses XET for some repos,
# but hf_xet package is not installed). Fall back to standard HTTP downloads.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from huggingface_hub import hf_hub_url, get_hf_file_metadata
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


# ---- Background streaming task ----

def _blocking_hf_stream_to_s3(
    job_id: str,
    repo_id: str,
    filename: str,
    s3_key: str,
    hf_token: Optional[str],
) -> None:
    """
    Stream file from HuggingFace CDN directly into S3 multipart upload.
    No temporary files written to disk — works for files of any size.
    Progress tracks bytes received (download and upload happen simultaneously).
    Does NOT persist hf_token anywhere.
    """
    try:
        # Build the resolved CDN URL and optional auth header
        cdn_url = hf_hub_url(repo_id=repo_id, filename=filename)
        headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

        _HF_JOBS[job_id]["status"] = "downloading"
        _HF_JOBS[job_id]["progress_pct"] = 0.0

        with _requests.get(
            cdn_url, headers=headers, stream=True, allow_redirects=True, timeout=60
        ) as resp:
            if resp.status_code == 401:
                raise GatedRepoError(repo_id)
            if resp.status_code == 404:
                raise EntryNotFoundError(filename, repo_id, None)
            resp.raise_for_status()

            total_bytes = int(resp.headers.get("content-length", 0)) or None
            _HF_JOBS[job_id]["total_bytes"] = total_bytes

            # Initiate S3 multipart upload
            mpu = s3_client.create_multipart_upload(
                Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                Key=s3_key,
            )
            upload_id = mpu["UploadId"]
            parts = []
            part_number = 0
            buffer = bytearray()
            bytes_done = 0

            try:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):  # 1 MB read chunks
                    if not chunk:
                        continue
                    buffer.extend(chunk)
                    bytes_done += len(chunk)
                    _HF_JOBS[job_id]["bytes_done"] = bytes_done
                    if total_bytes:
                        _HF_JOBS[job_id]["progress_pct"] = round(
                            bytes_done / total_bytes * 100, 1
                        )

                    # Flush to S3 every 5 MB (S3 minimum part size)
                    while len(buffer) >= CHUNK_SIZE:
                        part_number += 1
                        part_data = bytes(buffer[:CHUNK_SIZE])
                        del buffer[:CHUNK_SIZE]
                        part_resp = s3_client.upload_part(
                            Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                            Key=s3_key,
                            UploadId=upload_id,
                            PartNumber=part_number,
                            Body=part_data,
                        )
                        parts.append({"PartNumber": part_number, "ETag": part_resp["ETag"]})

                # Upload remaining buffered bytes as the final part
                if buffer:
                    part_number += 1
                    part_resp = s3_client.upload_part(
                        Bucket=settings.RUNPOD_NETWORK_VOLUME_ID,
                        Key=s3_key,
                        UploadId=upload_id,
                        PartNumber=part_number,
                        Body=bytes(buffer),
                    )
                    parts.append({"PartNumber": part_number, "ETag": part_resp["ETag"]})

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
    # No finally/cleanup — no tmp files written


async def start_hf_download_job(
    job_id: str,
    repo_id: str,
    filename: str,
    s3_key: str,
    hf_token: Optional[str],
) -> None:
    """Async wrapper: runs blocking stream-to-S3 in a thread without blocking event loop."""
    await asyncio.to_thread(
        _blocking_hf_stream_to_s3,
        job_id, repo_id, filename, s3_key, hf_token,
    )
