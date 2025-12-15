"""API endpoints for Flux LoRA training."""

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile, Form, status
from typing import List, Optional, Any
from pydantic import ValidationError

from core.auth import get_current_user
from models.training_job import (
    TrainingJobCreate,
    TrainingJobResponse,
    TrainingJobList,
    TrainingJobUpdate,
    TrainingStatus
)
from services.flux_trainer_service import FluxTrainerService

router = APIRouter(prefix="/flux-trainer", tags=["flux-trainer"])


def get_trainer_service():
    """Dependency to get FluxTrainerService instance."""
    return FluxTrainerService()


@router.post("/jobs", response_model=TrainingJobResponse, status_code=status.HTTP_201_CREATED)
async def create_training_job(
    job_data: TrainingJobCreate,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """
    Create a new Flux LoRA training job.

    This creates the job entry in the database. Use the upload endpoint
    to add training images.
    """
    try:
        success, job_id, error = await service.create_training_job(
            user_id=current_user.id,
            job_data=job_data.model_dump()
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to create training job"
            )

        # Get the created job
        success, jobs, error = await service.get_training_jobs(
            user_id=current_user.id,
            limit=1,
            offset=0
        )

        if not success or not jobs:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Job created but not found"
            )

        # Filter to find the job we just created
        created_job = next((job for job in jobs if job['id'] == job_id), None)
        if not created_job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Job created but not found"
            )

        return TrainingJobResponse(**created_job)

    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/jobs/{job_id}/upload-images")
async def upload_training_images(
    job_id: str,
    images: List[UploadFile] = File(..., description="Training images (20-100 recommended)"),
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """
    Upload training images for a job.

    Images should be:
    - 20-100 images recommended
    - 1024x1024 pixels ideal
    - Clear, well-lit photos of the subject
    - Multiple angles and expressions
    """
    try:
        # Validate image count
        if len(images) < 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Minimum 5 images required for training"
            )

        if len(images) > 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum 200 images allowed"
            )

        # Prepare dataset
        success, dataset_folder, error = await service.prepare_training_dataset(
            job_id=job_id,
            images=images,
            user_id=current_user.id
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to prepare dataset"
            )

        return {
            "success": True,
            "job_id": job_id,
            "num_images": len(images),
            "dataset_folder": dataset_folder,
            "message": "Images uploaded successfully. Ready to start training."
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/jobs/{job_id}/start")
async def start_training(
    job_id: str,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """
    Start training for a prepared job.

    The job must have images uploaded before starting training.
    """
    try:
        # Get job details
        success, jobs, error = await service.get_training_jobs(
            user_id=current_user.id,
            limit=1000
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to get job details"
            )

        # Find the job
        job = next((j for j in jobs if j['id'] == job_id), None)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Training job not found"
            )

        # Check if job has dataset
        if not job.get('dataset_folder'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No training images uploaded. Upload images first."
            )

        # Check if job is in correct status
        if job['status'] not in [TrainingStatus.PENDING.value, TrainingStatus.PREPARING.value]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot start training from status: {job['status']}"
            )

        # Generate config file
        success, config_path, error = service.generate_training_config(
            job_id=job_id,
            job_data=job,
            dataset_dir=job['dataset_folder']
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to generate training configuration"
            )

        # Start training
        success, error = await service.start_training(
            job_id=job_id,
            config_path=config_path
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to start training"
            )

        return {
            "success": True,
            "job_id": job_id,
            "status": TrainingStatus.TRAINING.value,
            "message": "Training started successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/jobs", response_model=TrainingJobList)
async def list_training_jobs(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """
    Get list of training jobs for the current user.

    Filter by status if provided.
    """
    try:
        success, jobs, error = await service.get_training_jobs(
            user_id=current_user.id,
            status=status,
            limit=limit,
            offset=offset
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to retrieve training jobs"
            )

        # Convert to response models
        job_responses = [TrainingJobResponse(**job) for job in jobs]

        return TrainingJobList(
            jobs=job_responses,
            total=len(jobs),
            page=offset // limit + 1,
            page_size=limit
        )

    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("/jobs/{job_id}", response_model=TrainingJobResponse)
async def get_training_job(
    job_id: str,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """Get details of a specific training job."""
    try:
        success, jobs, error = await service.get_training_jobs(
            user_id=current_user.id,
            limit=1000
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to get job details"
            )

        # Find the job
        job = next((j for j in jobs if j['id'] == job_id), None)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Training job not found"
            )

        return TrainingJobResponse(**job)

    except HTTPException:
        raise
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post("/jobs/{job_id}/cancel")
async def cancel_training_job(
    job_id: str,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """Cancel a running training job."""
    try:
        success, error = await service.cancel_training(job_id)

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to cancel training job"
            )

        return {
            "success": True,
            "job_id": job_id,
            "status": TrainingStatus.CANCELLED.value,
            "message": "Training job cancelled"
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.delete("/jobs/{job_id}")
async def delete_training_job(
    job_id: str,
    current_user: Any = Depends(get_current_user),
    service: FluxTrainerService = Depends(get_trainer_service)
):
    """Delete a training job and its associated files."""
    try:
        success, error = await service.delete_training_job(
            job_id=job_id,
            user_id=current_user.id
        )

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=error or "Failed to delete training job"
            )

        return {
            "success": True,
            "job_id": job_id,
            "message": "Training job deleted successfully"
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
