from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List, Optional
import json

from models.dataset import (
    Dataset,
    DataEntry,
    WorkflowSettings,
    SaveDatasetPayload,
    DatasetResponse,
    DatasetListResponse,
    CreateDatasetPayload,
    ImageWithCaption
)
from services.dataset_service import DatasetService

router = APIRouter(prefix="/datasets", tags=["datasets"])

def get_dataset_service():
    return DatasetService()

@router.post("/", response_model=DatasetResponse)
async def create_dataset(
    name: str = Form(...),
    character_trigger: str = Form(...),
    settings: str = Form(...),  # JSON string
    images: Optional[List[UploadFile]] = File(None),
    captions: Optional[str] = Form(None)  # JSON string of captions array
):
    """Create a new dataset with images and captions"""
    try:
        # Parse settings JSON
        settings_dict = json.loads(settings)
        workflow_settings = WorkflowSettings(**settings_dict)
        
        # Parse captions if provided
        captions_list = []
        if captions:
            captions_list = json.loads(captions)
        
        # Create dataset first
        image_info = []
        if images:
            for i, image in enumerate(images):
                caption = captions_list[i] if i < len(captions_list) else None
                image_info.append(ImageWithCaption(
                    image_name=image.filename,
                    caption=caption
                ))
        
        dataset_service = get_dataset_service()
        success, dataset_id, error = await dataset_service.save_dataset(
            name, character_trigger, workflow_settings, image_info
        )
        
        if not success:
            return DatasetResponse(success=False, error=error)
        
        # Upload images if provided
        if images and dataset_id:
            for image in images:
                if image.filename:
                    content = await image.read()
                    upload_success, public_url, upload_error = await dataset_service.upload_dataset_image(
                        dataset_id, image.filename, content
                    )
                    if not upload_success:
                        print(f"Warning: Failed to upload image {image.filename}: {upload_error}")
        
        # Load and return the created dataset
        dataset, data_entries, load_error = await dataset_service.load_dataset(dataset_id)
        
        return DatasetResponse(
            success=True,
            dataset=dataset,
            data=data_entries,
            error=load_error
        )
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in settings or captions: {e}")
    except Exception as e:
        return DatasetResponse(success=False, error=str(e))

@router.get("/", response_model=DatasetListResponse)
async def get_all_datasets():
    """Get all datasets"""
    dataset_service = get_dataset_service()
    datasets, error = await dataset_service.get_all_datasets()
    return DatasetListResponse(success=error is None, datasets=datasets, error=error)

@router.get("/{dataset_id}", response_model=DatasetResponse)
async def load_dataset(dataset_id: str):
    """Load a dataset by ID"""
    dataset_service = get_dataset_service()
    dataset, data_entries, error = await dataset_service.load_dataset(dataset_id)
    
    return DatasetResponse(
        success=dataset is not None,
        dataset=dataset,
        data=data_entries,
        error=error
    )

@router.post("/{dataset_id}/images")
async def upload_dataset_image(
    dataset_id: str,
    image: UploadFile = File(...),
    caption: Optional[str] = Form(None)
):
    """Upload an individual image to a dataset"""
    try:
        if not image.filename:
            raise HTTPException(status_code=400, detail="Image filename is required")
        
        content = await image.read()
        dataset_service = get_dataset_service()
        success, public_url, error = await dataset_service.upload_dataset_image(
            dataset_id, image.filename, content
        )
        
        return {
            "success": success,
            "public_url": public_url,
            "error": error
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }