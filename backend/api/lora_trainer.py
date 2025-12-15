"""API endpoints for QWEN LoRA training via Musubi Tuner."""

from fastapi import APIRouter, HTTPException, Depends, status
from typing import List, Optional, Any
from pydantic import BaseModel
import aiohttp

from core.auth import get_current_user

router = APIRouter(prefix="/lora-trainer", tags=["lora-trainer"])


class TrainingImage(BaseModel):
    """Training image with caption."""
    filename: str
    data: str  # base64 encoded
    caption: str


class StartTrainingRequest(BaseModel):
    """Request to start LoRA training."""
    images: List[TrainingImage]
    output_name: str
    network_dim: Optional[int] = 16
    network_alpha: Optional[float] = 1.0
    learning_rate: Optional[float] = 0.00005
    max_train_epochs: Optional[int] = 16
    max_train_steps: Optional[int] = None
    seed: Optional[int] = 42
    resolution: Optional[List[int]] = [1024, 1024]


class TrainingStatusResponse(BaseModel):
    """Training job status response."""
    success: bool
    job: Optional[dict] = None
    error: Optional[str] = None


class TrainingJobsResponse(BaseModel):
    """List of training jobs response."""
    success: bool
    jobs: List[dict] = []


@router.post("/train", status_code=status.HTTP_201_CREATED)
async def start_training(
    request: StartTrainingRequest,
    current_user: Any = Depends(get_current_user)
):
    """
    Start a new QWEN LoRA training job via Musubi Tuner API.

    This endpoint forwards the training request to the Musubi Tuner API
    and returns the job ID for status tracking.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        print(f"🚀 Starting LoRA training request")
        print(f"   Output name: {request.output_name}")
        print(f"   Number of images: {len(request.images)}")

        async with aiohttp.ClientSession() as session:
            # Prepare the payload for Musubi API
            payload = {
                "images": [img.model_dump() for img in request.images],
                "output_name": request.output_name,
                "network_dim": request.network_dim,
                "network_alpha": request.network_alpha,
                "learning_rate": request.learning_rate,
                "max_train_epochs": request.max_train_epochs,
                "seed": request.seed,
                "resolution": request.resolution
            }

            if request.max_train_steps:
                payload["max_train_steps"] = request.max_train_steps

            print(f"📤 Sending request to Musubi: {musubi_url}/train")

            async with session.post(
                f"{musubi_url}/train",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300)  # 5 minutes for initial response
            ) as response:
                print(f"📥 Received response from Musubi: status={response.status}")
                if response.status != 200:
                    error_text = await response.text()
                    raise HTTPException(
                        status_code=response.status,
                        detail=f"Musubi API error: {error_text}"
                    )

                data = await response.json()
                return {
                    "success": True,
                    "job_id": data.get("job_id"),
                    "status": data.get("status"),
                    "message": data.get("message"),
                    "dataset_id": data.get("dataset_id")
                }

    except aiohttp.ClientError as e:
        print(f"❌ Musubi API connection error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Musubi Tuner API: {str(e)}"
        )
    except Exception as e:
        print(f"❌ Training request failed: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Training request failed: {str(e)}"
        )


@router.get("/status/{job_id}", response_model=TrainingStatusResponse)
async def get_training_status(
    job_id: str,
    current_user: Any = Depends(get_current_user)
):
    """
    Get the status of a training job.

    Polls the Musubi Tuner API for the current status of the training job.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{musubi_url}/train/status/{job_id}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status != 200:
                    return TrainingStatusResponse(
                        success=False,
                        error=f"Failed to get status: {response.status}"
                    )

                data = await response.json()
                return TrainingStatusResponse(
                    success=True,
                    job=data
                )

    except Exception as e:
        return TrainingStatusResponse(
            success=False,
            error=str(e)
        )


@router.get("/jobs", response_model=TrainingJobsResponse)
async def get_training_jobs(
    current_user: Any = Depends(get_current_user)
):
    """
    Get list of all training jobs.

    Retrieves all training jobs from the Musubi Tuner API.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{musubi_url}/train/jobs",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status != 200:
                    return TrainingJobsResponse(
                        success=False,
                        jobs=[]
                    )

                data = await response.json()
                return TrainingJobsResponse(
                    success=True,
                    jobs=data if isinstance(data, list) else []
                )

    except Exception as e:
        return TrainingJobsResponse(
            success=False,
            jobs=[]
        )


@router.post("/cancel/{job_id}")
async def cancel_training(
    job_id: str,
    current_user: Any = Depends(get_current_user)
):
    """
    Cancel a running training job.

    Sends a cancel request to the Musubi Tuner API.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{musubi_url}/train/cancel/{job_id}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise HTTPException(
                        status_code=response.status,
                        detail=f"Failed to cancel training: {error_text}"
                    )

                data = await response.json()
                return {
                    "success": True,
                    "message": "Training cancelled",
                    "data": data
                }

    except aiohttp.ClientError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Musubi Tuner API: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cancel request failed: {str(e)}"
        )


@router.get("/logs/{job_id}")
async def get_training_logs(
    job_id: str,
    current_user: Any = Depends(get_current_user)
):
    """
    Get training logs for a job.

    Retrieves the training logs from the Musubi Tuner API.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{musubi_url}/train/logs/{job_id}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status != 200:
                    raise HTTPException(
                        status_code=response.status,
                        detail="Failed to get training logs"
                    )

                data = await response.json()
                return {
                    "success": True,
                    "logs": data
                }

    except aiohttp.ClientError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Musubi Tuner API: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get logs: {str(e)}"
        )


@router.get("/health")
async def check_musubi_health():
    """
    Check if the Musubi Tuner API is available.
    """

    musubi_url = "https://musubi.vapai.studio"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{musubi_url}/health",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                return {
                    "success": response.status == 200,
                    "status": response.status,
                    "message": "Musubi Tuner API is available" if response.status == 200 else "Musubi Tuner API is unavailable"
                }
    except Exception as e:
        return {
            "success": False,
            "status": 503,
            "message": f"Musubi Tuner API is unavailable: {str(e)}"
        }
