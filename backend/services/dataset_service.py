from typing import List, Optional, Tuple
import asyncio
from datetime import datetime

from core.supabase import get_supabase
from models.dataset import Dataset, DataEntry, WorkflowSettings, SaveDatasetPayload, ImageWithCaption

class DatasetService:
    def __init__(self):
        self.supabase = get_supabase()
    
    async def save_dataset(
        self,
        name: str,
        character_trigger: str,
        settings: WorkflowSettings,
        images: List[ImageWithCaption]
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """Create a new dataset with images and captions"""
        try:
            # Create dataset record
            dataset_data = {
                "name": name,
                "character_trigger": character_trigger,
                "settings": settings.dict(),
            }
            
            dataset_response = await asyncio.to_thread(
                lambda: self.supabase.table('datasets')
                .insert(dataset_data)
                .execute()
            )
            
            if dataset_response.error or not dataset_response.data:
                raise Exception(f"Failed to create dataset: {dataset_response.error}")
            
            dataset = dataset_response.data[0]
            dataset_id = dataset['id']
            
            # Create data entries for images
            data_entries = []
            for i, image in enumerate(images):
                file_number = i + 1
                
                # For now, we'll store the image_name and caption
                # The actual file upload should be handled separately via multipart form data
                data_entries.append({
                    "dataset_id": dataset_id,
                    "image_url": "",  # Will be updated after file upload
                    "image_name": image.image_name,
                    "caption": image.caption or ""
                })
            
            # Insert all data entries
            if data_entries:
                data_response = await asyncio.to_thread(
                    lambda: self.supabase.table('data')
                    .insert(data_entries)
                    .execute()
                )
                
                if data_response.error:
                    print(f"Warning: Failed to insert some data entries: {data_response.error}")
                    # Don't throw here, as we want to keep the dataset even if some images fail
            
            return True, dataset_id, None
            
        except Exception as error:
            print(f"Error saving dataset: {error}")
            return False, None, str(error)
    
    async def load_dataset(self, dataset_id: str) -> Tuple[Optional[Dataset], List[DataEntry], Optional[str]]:
        """Load a dataset by ID"""
        try:
            # Get dataset info
            dataset_response = await asyncio.to_thread(
                lambda: self.supabase.table('datasets')
                .select('*')
                .eq('id', dataset_id)
                .single()
                .execute()
            )
            
            if dataset_response.error or not dataset_response.data:
                raise Exception(f"Failed to load dataset: {dataset_response.error}")
            
            dataset_data = dataset_response.data
            dataset = Dataset(**dataset_data)
            
            # Get all data entries for this dataset
            data_response = await asyncio.to_thread(
                lambda: self.supabase.table('data')
                .select('*')
                .eq('dataset_id', dataset_id)
                .order('created_at', desc=False)
                .execute()
            )
            
            if data_response.error:
                raise Exception(f"Failed to load data entries: {data_response.error}")
            
            data_entries = [DataEntry(**entry) for entry in (data_response.data or [])]
            
            return dataset, data_entries, None
            
        except Exception as error:
            print(f"Error loading dataset: {error}")
            return None, [], str(error)
    
    async def get_all_datasets(self) -> Tuple[List[Dataset], Optional[str]]:
        """Get all datasets (for selection)"""
        try:
            response = await asyncio.to_thread(
                lambda: self.supabase.table('datasets')
                .select('*')
                .order('updated_at', desc=True)
                .execute()
            )
            
            # Check if response has error attribute and if it contains an error
            if hasattr(response, 'error') and response.error:
                raise Exception(f"Failed to load datasets: {response.error}")
            
            datasets = [Dataset(**dataset) for dataset in (response.data or [])]
            return datasets, None
            
        except Exception as error:
            print(f"Error loading datasets: {error}")
            return [], str(error)
    
    async def upload_dataset_image(self, dataset_id: str, image_name: str, image_content: bytes) -> Tuple[bool, Optional[str], Optional[str]]:
        """Upload an image file to storage for a dataset"""
        try:
            # Create unique filename for storage
            storage_file_name = f"{dataset_id}/{image_name}"
            
            # Upload to Supabase storage
            upload_response = await asyncio.to_thread(
                lambda: self.supabase.storage
                .from_('images')
                .upload(
                    storage_file_name,
                    image_content,
                    {
                        'content-type': 'image/jpeg',  # Adjust based on actual content type
                        'upsert': False
                    }
                )
            )
            
            if upload_response.error:
                raise Exception(f"Failed to upload image: {upload_response.error}")
            
            # Get public URL for the uploaded image
            public_url_response = self.supabase.storage.from_('images').get_public_url(storage_file_name)
            
            if not public_url_response.data:
                raise Exception("Failed to get public URL for uploaded image")
            
            public_url = public_url_response.data['publicUrl']
            
            # Update the data entry with the image URL
            update_response = await asyncio.to_thread(
                lambda: self.supabase.table('data')
                .update({'image_url': public_url})
                .eq('dataset_id', dataset_id)
                .eq('image_name', image_name)
                .execute()
            )
            
            if update_response.error:
                print(f"Warning: Failed to update data entry with image URL: {update_response.error}")
            
            return True, public_url, None
            
        except Exception as error:
            print(f"Error uploading dataset image: {error}")
            return False, None, str(error)