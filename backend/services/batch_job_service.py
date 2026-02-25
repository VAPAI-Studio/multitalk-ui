"""Service for managing Auto Content batch operations."""

from typing import Tuple, Optional, List, Dict, Any
from datetime import datetime
import logging
import asyncio

from core.supabase import get_supabase
from services.google_drive_service import GoogleDriveService
from services.job_queue_service import JobQueueService
from models.auto_content import (
    ProjectFolder,
    BatchJob,
    BatchJobItem,
    BatchJobStatus,
    BatchItemStatus
)

logger = logging.getLogger(__name__)


class BatchJobService:
    """Service for managing Auto Content batch job operations."""

    def __init__(self):
        self.supabase = get_supabase()
        self.drive_service = GoogleDriveService()

    async def create_batch_job(
        self,
        user_id: str,
        project_folder_id: str,
        comfy_url: str
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create batch job and validate project structure.

        Steps:
        1. Validate Drive folder structure
        2. Cache folder IDs in project_folders table
        3. Create batch_jobs record

        Returns: (success, batch_job_id, error)
        """
        try:
            # Validate project structure
            success, project_folder, error = await self.validate_project_structure(
                project_folder_id,
                user_id
            )

            if not success:
                return False, None, error

            # Get project name from Drive
            success_folder, folder_info, error_folder = await self.drive_service.get_folder(
                project_folder_id
            )

            project_name = folder_info.name if success_folder and folder_info else "Unknown Project"

            # Get the most recent script file
            script_filename = None
            if project_folder and project_folder.script_folder_id:
                success_scripts, script_files, _, _ = await self.drive_service.list_files(
                    folder_id=project_folder.script_folder_id
                )
                if success_scripts and script_files:
                    # Sort by modified_time descending, take the most recent
                    script_files_sorted = sorted(
                        script_files,
                        key=lambda f: f.modified_time if hasattr(f, 'modified_time') and f.modified_time else '',
                        reverse=True
                    )
                    script_filename = script_files_sorted[0].name
                    logger.info(f"Selected script for batch job: {script_filename}")

            # Create batch_jobs record
            batch_job_data = {
                'user_id': user_id,
                'project_folder_id': project_folder_id,
                'project_name': project_name,
                'status': 'pending',
                'comfy_url': comfy_url,
                'master_frame_variations': 3,
                'total_master_frames': 0,
                'completed_master_frames': 0,
                'total_jobs': 0,
                'completed_jobs': 0,
                'failed_jobs': 0,
                'script_filename': script_filename
            }

            response = self.supabase.table('batch_jobs').insert(batch_job_data).execute()

            if not response.data:
                return False, None, "Failed to create batch job record"

            batch_job_id = response.data[0]['id']

            logger.info(f"Created batch job {batch_job_id} for user {user_id}")

            return True, batch_job_id, None

        except Exception as e:
            logger.error(f"Error creating batch job: {str(e)}")
            return False, None, str(e)

    async def validate_project_structure(
        self,
        project_folder_id: str,
        user_id: str
    ) -> Tuple[bool, Optional[ProjectFolder], Optional[str]]:
        """
        Validate project has required folder structure:
        - GENERAL_ASSETS/
          - Script/ (at least one file)
          - Master_Frames/ (images)
          - Characters/ (images)
          - Props/ (images)
          - Settings/ (images)

        Returns: (success, project_folder_data, error)
        """
        try:
            # Check if we have a cached project_folder
            cached = self.supabase.table('project_folders').select('*').eq(
                'project_folder_id', project_folder_id
            ).execute()

            # If cached and recently validated (within 1 hour), use cache
            if cached.data and len(cached.data) > 0:
                cached_folder = cached.data[0]
                last_validated = cached_folder.get('last_validated_at')

                if last_validated:
                    last_validated_dt = datetime.fromisoformat(last_validated.replace('Z', '+00:00'))
                    age_minutes = (datetime.now().astimezone() - last_validated_dt).total_seconds() / 60

                    if age_minutes < 60 and cached_folder.get('structure_valid'):
                        logger.info(f"Using cached project structure for {project_folder_id}")
                        return True, ProjectFolder(**cached_folder), None

            # List contents of project folder
            success, files, _, error = await self.drive_service.list_files(
                folder_id=project_folder_id
            )

            if not success:
                return False, None, f"Failed to list project folder: {error}"

            # Find GENERAL_ASSETS folder
            general_assets = next(
                (f for f in files if f.name == 'GENERAL_ASSETS' and f.is_folder),
                None
            )

            if not general_assets:
                error_msg = "Project must contain 'GENERAL_ASSETS' folder"
                await self._cache_project_folder(
                    project_folder_id,
                    user_id,
                    False,
                    error_msg
                )
                return False, None, error_msg

            # List contents of GENERAL_ASSETS
            success, assets_contents, _, error = await self.drive_service.list_files(
                folder_id=general_assets.id
            )

            if not success:
                return False, None, f"Failed to list GENERAL_ASSETS: {error}"

            # Find folders (only Script is required, others are optional)
            folders = {
                'Script': None,
                'Master_Frames': None,
                'Characters': None,
                'Props': None,
                'Settings': None
            }

            for file in assets_contents:
                if file.is_folder and file.name in folders:
                    folders[file.name] = file.id

            # Check for Script folder (required)
            if folders['Script'] is None:
                error_msg = "Missing required folder in GENERAL_ASSETS: Script"
                await self._cache_project_folder(
                    project_folder_id,
                    user_id,
                    False,
                    error_msg,
                    general_assets_folder_id=general_assets.id
                )
                return False, None, error_msg

            # Verify Script folder has at least one file
            success, script_files, _, error = await self.drive_service.list_files(
                folder_id=folders['Script']
            )

            if not success or not script_files:
                error_msg = "Script folder must contain at least one file (.pdf, .doc, .docx, or .gdoc)"
                await self._cache_project_folder(
                    project_folder_id,
                    user_id,
                    False,
                    error_msg,
                    general_assets_folder_id=general_assets.id,
                    **{f"{k.lower()}_folder_id": v for k, v in folders.items()}
                )
                return False, None, error_msg

            # Filter for valid script file types
            valid_extensions = {'.pdf', '.doc', '.docx', '.gdoc'}
            valid_mime_types = {
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.google-apps.document'
            }

            valid_scripts = []
            for file in script_files:
                # Check by extension
                file_ext = None
                if '.' in file.name:
                    file_ext = '.' + file.name.rsplit('.', 1)[1].lower()

                # Check by mime type or extension
                is_valid = (
                    (file_ext and file_ext in valid_extensions) or
                    (hasattr(file, 'mime_type') and file.mime_type and file.mime_type in valid_mime_types)
                )

                if is_valid:
                    valid_scripts.append(file)

            if not valid_scripts:
                error_msg = (
                    f"Script folder contains {len(script_files)} file(s) but none are valid script formats. "
                    f"Please use .pdf, .doc, .docx, or Google Docs files."
                )
                await self._cache_project_folder(
                    project_folder_id,
                    user_id,
                    False,
                    error_msg,
                    general_assets_folder_id=general_assets.id,
                    **{f"{k.lower()}_folder_id": v for k, v in folders.items()}
                )
                return False, None, error_msg

            # Select the most recent valid script file
            # Sort by modified_time descending, take the first one
            valid_scripts_sorted = sorted(
                valid_scripts,
                key=lambda f: f.modified_time if hasattr(f, 'modified_time') and f.modified_time else '',
                reverse=True
            )
            selected_script = valid_scripts_sorted[0]
            selected_script_name = selected_script.name
            selected_script_id = selected_script.id

            logger.info(
                f"Selected script file: {selected_script_name} "
                f"(from {len(valid_scripts)} valid script(s) in Script/ folder)"
            )

            # Note: Master_Frames, Characters, Props, and Settings are now optional
            # They will be used when available but not required for initial validation

            # Get or create output folders (txtAI, imagesAI, imagesAI/starred)
            txtai_folder_id = await self._ensure_output_folder(project_folder_id, 'txtAI')
            imagesai_folder_id = await self._ensure_output_folder(project_folder_id, 'imagesAI')

            # Create starred subfolder
            imagesai_starred_id = None
            if imagesai_folder_id:
                success_starred, starred_id, _ = await self.drive_service.get_or_create_folder(
                    imagesai_folder_id,
                    'starred'
                )
                if success_starred:
                    imagesai_starred_id = starred_id

            # Cache validated structure
            project_folder_data = await self._cache_project_folder(
                project_folder_id,
                user_id,
                True,
                None,
                general_assets_folder_id=general_assets.id,
                script_folder_id=folders['Script'],
                master_frames_folder_id=folders['Master_Frames'],
                characters_folder_id=folders['Characters'],
                props_folder_id=folders['Props'],
                settings_folder_id=folders['Settings'],
                txtai_folder_id=txtai_folder_id,
                imagesai_folder_id=imagesai_folder_id,
                imagesai_starred_folder_id=imagesai_starred_id
            )

            logger.info(f"Project structure validated for {project_folder_id}")

            return True, project_folder_data, None

        except Exception as e:
            logger.error(f"Error validating project structure: {str(e)}")
            return False, None, str(e)

    async def _ensure_output_folder(
        self,
        parent_folder_id: str,
        folder_name: str
    ) -> Optional[str]:
        """Get or create an output folder in the project root."""
        try:
            success, folder_id, error = await self.drive_service.get_or_create_folder(
                parent_folder_id,
                folder_name
            )
            if success:
                return folder_id
            else:
                logger.warning(f"Failed to create {folder_name} folder: {error}")
                return None
        except Exception as e:
            logger.error(f"Error ensuring output folder {folder_name}: {str(e)}")
            return None

    async def _cache_project_folder(
        self,
        project_folder_id: str,
        user_id: str,
        structure_valid: bool,
        validation_error: Optional[str],
        **folder_ids
    ) -> Optional[ProjectFolder]:
        """Cache or update project folder structure in database."""
        try:
            # Get project name
            success, folder_info, _ = await self.drive_service.get_folder(project_folder_id)
            project_name = folder_info.name if success and folder_info else "Unknown Project"

            data = {
                'project_folder_id': project_folder_id,
                'user_id': user_id,
                'project_name': project_name,
                'structure_valid': structure_valid,
                'validation_error': validation_error,
                'last_validated_at': datetime.now().isoformat(),
                **folder_ids
            }

            # Upsert (insert or update)
            response = self.supabase.table('project_folders').upsert(
                data,
                on_conflict='project_folder_id'
            ).execute()

            if response.data and len(response.data) > 0:
                return ProjectFolder(**response.data[0])

            return None

        except Exception as e:
            logger.error(f"Error caching project folder: {str(e)}")
            return None

    async def get_batch_job(self, batch_job_id: str) -> Optional[BatchJob]:
        """Get batch job by ID."""
        try:
            response = self.supabase.table('batch_jobs').select('*').eq(
                'id', batch_job_id
            ).execute()

            if response.data and len(response.data) > 0:
                return BatchJob(**response.data[0])

            return None

        except Exception as e:
            logger.error(f"Error getting batch job: {str(e)}")
            return None

    async def get_batch_job_with_items(
        self,
        batch_job_id: str
    ) -> Tuple[bool, Optional[BatchJob], List[BatchJobItem], Optional[str]]:
        """Get batch job with all its items."""
        try:
            # Get batch job
            batch_job = await self.get_batch_job(batch_job_id)

            if not batch_job:
                return False, None, [], "Batch job not found"

            # Get batch items
            response = self.supabase.table('batch_job_items').select('*').eq(
                'batch_job_id', batch_job_id
            ).order('created_at', desc=True).execute()

            items = [BatchJobItem(**item) for item in response.data] if response.data else []

            return True, batch_job, items, None

        except Exception as e:
            logger.error(f"Error getting batch job with items: {str(e)}")
            return False, None, [], str(e)

    async def get_batch_items(
        self,
        batch_job_id: str,
        starred_only: bool = False,
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[bool, List[BatchJobItem], int, Optional[str]]:
        """Get paginated batch items with optional filtering."""
        try:
            query = self.supabase.table('batch_job_items').select(
                '*',
                count='exact'
            ).eq('batch_job_id', batch_job_id).eq('deleted', False)

            if starred_only:
                query = query.eq('starred', True)

            query = query.order('created_at', desc=True).range(offset, offset + limit - 1)

            response = query.execute()

            items = [BatchJobItem(**item) for item in response.data] if response.data else []
            total_count = response.count if response.count is not None else 0

            return True, items, total_count, None

        except Exception as e:
            logger.error(f"Error getting batch items: {str(e)}")
            return False, [], 0, str(e)

    async def update_batch_job(
        self,
        batch_job_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """Update batch job fields."""
        try:
            updates['updated_at'] = datetime.now().isoformat()

            self.supabase.table('batch_jobs').update(updates).eq(
                'id', batch_job_id
            ).execute()

            return True

        except Exception as e:
            logger.error(f"Error updating batch job: {str(e)}")
            return False

    async def update_batch_item(
        self,
        batch_item_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """Update batch item fields."""
        try:
            self.supabase.table('batch_job_items').update(updates).eq(
                'id', batch_item_id
            ).execute()

            return True

        except Exception as e:
            logger.error(f"Error updating batch item: {str(e)}")
            return False

    async def update_project_folder(
        self,
        project_folder_id: str,
        updates: Dict[str, Any]
    ) -> bool:
        """Update project folder cache fields."""
        try:
            self.supabase.table('project_folders').update(updates).eq(
                'project_folder_id', project_folder_id
            ).execute()

            return True

        except Exception as e:
            logger.error(f"Error updating project folder: {str(e)}")
            return False

    # Phase 3: Master Frame Generation
    async def start_master_frame_generation(
        self,
        batch_job_id: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Start master frame generation.

        For each image in Master_Frames/:
        - Create N batch_job_items (N = master_frame_variations)
        - Submit ImageGrid workflow to ComfyUI with rate limiting
        - Use different seeds for each variation

        Returns: (success, error)
        """
        try:
            # Get batch job
            batch_job = await self.get_batch_job(batch_job_id)
            if not batch_job:
                return False, "Batch job not found"

            # Get project folder cache
            project_folder = await self.get_project_folder(batch_job.project_folder_id)
            if not project_folder or not project_folder.master_frames_folder_id:
                return False, "Master_Frames folder not found. Please add Master_Frames/ to your project."

            # List images in Master_Frames/
            success, master_frames, _, error = await self.drive_service.list_files(
                folder_id=project_folder.master_frames_folder_id
            )

            if not success:
                return False, f"Failed to list Master_Frames: {error}"

            # Filter for images only
            image_frames = [
                f for f in master_frames
                if f.mime_type and f.mime_type.startswith('image/')
            ]

            if not image_frames:
                return False, "No images found in Master_Frames folder. Please add at least one image."

            logger.info(f"Found {len(image_frames)} master frame(s) for batch job {batch_job_id}")

            # Update batch_job with totals
            total_jobs = len(image_frames) * batch_job.master_frame_variations
            await self.update_batch_job(batch_job_id, {
                'total_master_frames': len(image_frames),
                'total_jobs': total_jobs,
                'status': 'generating_master'
            })

            # Create batch_job_items for each variation
            import random
            items_to_process = []
            for idx, frame in enumerate(image_frames, 1):
                for variation in range(1, batch_job.master_frame_variations + 1):
                    # Create batch_job_item record
                    item_data = {
                        'batch_job_id': batch_job_id,
                        'item_type': 'master_frame',
                        'source_index': idx,
                        'variation_number': variation,
                        'status': 'pending'
                    }

                    response = self.supabase.table('batch_job_items').insert(item_data).execute()
                    if response.data and len(response.data) > 0:
                        item_id = response.data[0]['id']

                        # Generate unique seeds for this variation
                        seed_1 = random.randint(0, 2**32 - 1)
                        seed_2 = random.randint(0, 2**32 - 1)

                        items_to_process.append({
                            'item_id': item_id,
                            'frame_file_id': frame.id,
                            'frame_name': frame.name,
                            'source_index': idx,
                            'variation_number': variation,
                            'seed_1': seed_1,
                            'seed_2': seed_2,
                            'prompt_prefix': ''  # Empty for now, can be customized later
                        })

            logger.info(f"Created {len(items_to_process)} batch_job_items for processing")

            # Start async processing in background
            import asyncio
            asyncio.create_task(
                self._process_master_frame_batch(batch_job_id, items_to_process, batch_job.comfy_url)
            )

            return True, None

        except Exception as e:
            logger.error(f"Error starting master frame generation: {str(e)}")
            await self.update_batch_job(batch_job_id, {
                'status': 'failed',
                'error_message': str(e)
            })
            return False, str(e)

    async def _process_master_frame_batch(
        self,
        batch_job_id: str,
        items_to_process: List[Dict],
        comfy_url: str
    ):
        """
        Background task to process master frame batch items.

        For each item:
        1. Download image from Google Drive
        2. Upload to ComfyUI
        3. Build ImageGrid workflow with parameters
        4. Submit with rate limiting
        5. Update item status
        """
        job_queue = JobQueueService(max_concurrent=5, delay_between_jobs=1.5)

        for item_data in items_to_process:
            try:
                # Download image from Drive
                logger.info(f"Downloading frame {item_data['frame_name']} from Drive...")
                frame_content = await self.drive_service.download_file(
                    item_data['frame_file_id']
                )

                # Upload to ComfyUI
                logger.info(f"Uploading to ComfyUI: {item_data['frame_name']}...")
                uploaded_filename = await self._upload_to_comfyui(
                    comfy_url,
                    frame_content,
                    item_data['frame_name']
                )

                # Build workflow JSON
                logger.info(f"Building ImageGrid workflow for {item_data['frame_name']}...")
                workflow_json = await self._build_imagegrid_workflow(
                    image_filename=uploaded_filename,
                    seed_1=item_data['seed_1'],
                    seed_2=item_data['seed_2'],
                    prompt_prefix=item_data['prompt_prefix']
                )

                # Submit to ComfyUI with rate limiting
                client_id = f"batch-{batch_job_id}-item-{item_data['item_id']}"

                await job_queue.submit_job_with_limit(
                    self._submit_to_comfyui,
                    comfy_url=comfy_url,
                    workflow_json=workflow_json,
                    client_id=client_id,
                    batch_item_id=item_data['item_id']
                )

                # Update item status to queued
                await self.update_batch_item(item_data['item_id'], {
                    'status': 'queued'
                })

                logger.info(f"Successfully queued item {item_data['item_id']}")

            except Exception as e:
                logger.error(f"Failed to process item {item_data['item_id']}: {str(e)}")

                # Update item status to failed
                await self.update_batch_item(item_data['item_id'], {
                    'status': 'failed',
                    'error_message': str(e)
                })

                # Update batch job failed count
                try:
                    batch_job = await self.get_batch_job(batch_job_id)
                    if batch_job:
                        await self.update_batch_job(batch_job_id, {
                            'failed_jobs': batch_job.failed_jobs + 1
                        })
                except Exception as update_error:
                    logger.error(f"Failed to update batch job failed count: {str(update_error)}")

    async def _upload_to_comfyui(
        self,
        comfy_url: str,
        file_content: bytes,
        filename: str
    ) -> str:
        """Upload file to ComfyUI and return the uploaded filename."""
        import aiohttp

        # Ensure comfy_url doesn't end with slash
        base_url = comfy_url.rstrip('/')

        # Create form data
        form = aiohttp.FormData()
        form.add_field('image', file_content, filename=filename, content_type='image/png')

        async with aiohttp.ClientSession() as session:
            async with session.post(f"{base_url}/upload/image", data=form) as response:
                if response.status != 200:
                    raise Exception(f"ComfyUI upload failed with status {response.status}")

                result = await response.json()

                # ComfyUI returns either 'name' or 'files' array
                if 'name' in result:
                    return result['name']
                elif 'files' in result and len(result['files']) > 0:
                    return result['files'][0]
                else:
                    raise Exception("ComfyUI upload response missing filename")

    async def _build_imagegrid_workflow(
        self,
        image_filename: str,
        seed_1: int,
        seed_2: int,
        prompt_prefix: str
    ) -> dict:
        """Build ImageGrid workflow JSON with parameters."""
        import json
        import os

        # Load workflow template
        workflow_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            'workflows',
            'ImageGrid.json'
        )

        if not os.path.exists(workflow_path):
            raise Exception(f"Workflow template not found: {workflow_path}")

        with open(workflow_path, 'r') as f:
            template = json.load(f)

        # Replace placeholders
        workflow_str = json.dumps(template)
        workflow_str = workflow_str.replace('{{IMAGE_FILENAME}}', image_filename)
        workflow_str = workflow_str.replace('{{SEED_1}}', str(seed_1))
        workflow_str = workflow_str.replace('{{SEED_2}}', str(seed_2))
        workflow_str = workflow_str.replace('{{SUBJECT_PROMPT_PREFIX}}', prompt_prefix)

        return json.loads(workflow_str)

    async def _submit_to_comfyui(
        self,
        comfy_url: str,
        workflow_json: dict,
        client_id: str,
        batch_item_id: str
    ) -> str:
        """Submit workflow to ComfyUI and return prompt_id."""
        import aiohttp

        base_url = comfy_url.rstrip('/')

        payload = {
            'prompt': workflow_json,
            'client_id': client_id
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{base_url}/prompt",
                json=payload
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"ComfyUI submission failed: {error_text}")

                result = await response.json()

                if 'prompt_id' not in result:
                    raise Exception("ComfyUI response missing prompt_id")

                prompt_id = result['prompt_id']

                # Create image_job record (linking to existing image_jobs table)
                try:
                    image_job_response = self.supabase.table('image_jobs').insert({
                        'comfy_job_id': prompt_id,
                        'comfy_url': comfy_url,
                        'workflow_name': 'image-grid',
                        'batch_item_id': batch_item_id,
                        'status': 'processing'
                    }).execute()

                    # Update batch_item with image_job_id
                    if image_job_response.data and len(image_job_response.data) > 0:
                        image_job_id = image_job_response.data[0]['id']
                        await self.update_batch_item(batch_item_id, {
                            'image_job_id': image_job_id
                        })
                except Exception as e:
                    logger.warning(f"Failed to create/link image_job record: {str(e)}")

                return prompt_id

    async def on_image_job_completed(
        self,
        image_job_id: str,
        prompt_id: str,
        comfy_url: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Callback when an image job completes.

        1. Fetch output from ComfyUI history
        2. Upload to Supabase Storage
        3. Upload to Drive (async/best-effort)
        4. Update batch_job_items with URLs
        5. Update batch_jobs progress
        """
        try:
            # Get batch_item linked to this image_job
            batch_item = await self._get_batch_item_by_image_job(image_job_id)

            if not batch_item:
                logger.warning(f"No batch_item found for image_job {image_job_id}")
                return False, "Batch item not found"

            # Fetch output from ComfyUI
            logger.info(f"Fetching outputs for prompt {prompt_id}...")
            output_files = await self._fetch_comfyui_outputs(comfy_url, prompt_id)

            if not output_files:
                raise Exception("No output files found in ComfyUI history")

            # Upload to Supabase Storage
            logger.info(f"Uploading {len(output_files)} files to Supabase Storage...")
            supabase_urls = await self._upload_to_supabase_storage(
                batch_item.batch_job_id,
                batch_item.id,
                output_files
            )

            # Update batch_item with Supabase URLs
            await self.update_batch_item(batch_item.id, {
                'output_urls': supabase_urls,
                'status': 'completed',
                'completed_at': datetime.utcnow().isoformat()
            })

            # Upload to Drive (async/best-effort)
            asyncio.create_task(
                self._upload_batch_item_to_drive(
                    batch_item.id,
                    batch_item.batch_job_id,
                    supabase_urls
                )
            )

            # Update batch_job progress
            await self._update_batch_job_progress(batch_item.batch_job_id)

            logger.info(f"Successfully completed batch item {batch_item.id}")
            return True, None

        except Exception as e:
            logger.error(f"Failed to handle job completion: {str(e)}")

            # Update item as failed if we found it
            if batch_item:
                await self.update_batch_item(batch_item.id, {
                    'status': 'failed',
                    'error_message': str(e)
                })

                # Update batch job failed count
                await self._update_batch_job_progress(batch_item.batch_job_id, failed=True)

            return False, str(e)

    async def _get_batch_item_by_image_job(self, image_job_id: str) -> Optional[BatchJobItem]:
        """Get batch item by image_job_id."""
        try:
            response = self.supabase.table('batch_job_items').select('*').eq(
                'image_job_id', image_job_id
            ).execute()

            if response.data and len(response.data) > 0:
                return BatchJobItem(**response.data[0])

            return None

        except Exception as e:
            logger.error(f"Error getting batch item by image job: {str(e)}")
            return None

    async def _fetch_comfyui_outputs(
        self,
        comfy_url: str,
        prompt_id: str
    ) -> List[Dict[str, Any]]:
        """Fetch output files from ComfyUI history."""
        import aiohttp

        base_url = comfy_url.rstrip('/')

        async with aiohttp.ClientSession() as session:
            # Get history for this prompt
            async with session.get(f"{base_url}/history/{prompt_id}") as response:
                if response.status != 200:
                    raise Exception(f"Failed to fetch ComfyUI history: {response.status}")

                history = await response.json()

                if prompt_id not in history:
                    raise Exception(f"Prompt {prompt_id} not found in history")

                outputs = history[prompt_id].get('outputs', {})

                # Extract all images from outputs
                files = []
                for node_id, node_output in outputs.items():
                    if 'images' in node_output:
                        for img in node_output['images']:
                            files.append({
                                'filename': img['filename'],
                                'subfolder': img.get('subfolder', ''),
                                'type': img.get('type', 'output')
                            })

                return files

    async def _upload_to_supabase_storage(
        self,
        batch_job_id: str,
        batch_item_id: str,
        output_files: List[Dict[str, Any]]
    ) -> List[str]:
        """
        Upload files to Supabase Storage.

        Returns list of public URLs.
        """
        import aiohttp

        supabase_urls = []

        for idx, file_info in enumerate(output_files):
            try:
                # Download from ComfyUI
                # We'll need the comfy_url from the batch_job
                batch_job = await self.get_batch_job(batch_job_id)
                if not batch_job:
                    raise Exception("Batch job not found")

                base_url = batch_job.comfy_url.rstrip('/')

                # Build ComfyUI view URL
                params = {
                    'filename': file_info['filename'],
                    'subfolder': file_info.get('subfolder', ''),
                    'type': file_info.get('type', 'output')
                }

                async with aiohttp.ClientSession() as session:
                    query_string = '&'.join([f"{k}={v}" for k, v in params.items() if v])
                    url = f"{base_url}/view?{query_string}"

                    async with session.get(url) as response:
                        if response.status != 200:
                            raise Exception(f"Failed to download from ComfyUI: {response.status}")

                        file_bytes = await response.read()

                # Upload to Supabase Storage
                # Path: auto-content/{batch_job_id}/items/{batch_item_id}/{filename}
                storage_path = f"auto-content/{batch_job_id}/items/{batch_item_id}/{file_info['filename']}"

                upload_response = self.supabase.storage.from_('generated-images').upload(
                    storage_path,
                    file_bytes,
                    {
                        'content-type': 'image/png',
                        'upsert': 'true'
                    }
                )

                # Get public URL
                public_url = self.supabase.storage.from_('generated-images').get_public_url(
                    storage_path
                )

                supabase_urls.append(public_url)

            except Exception as e:
                logger.error(f"Failed to upload file {file_info['filename']}: {str(e)}")
                # Continue with other files

        return supabase_urls

    async def _upload_batch_item_to_drive(
        self,
        batch_item_id: str,
        batch_job_id: str,
        supabase_urls: List[str]
    ):
        """Background task to upload images to Drive."""
        try:
            batch_item = await self.get_batch_item(batch_item_id)
            batch_job = await self.get_batch_job(batch_job_id)
            project_folder = await self.get_project_folder(batch_job.project_folder_id)

            # Ensure imagesAI folder exists
            imagesai_folder_id = project_folder.imagesai_folder_id
            if not imagesai_folder_id:
                success, folder_id, _ = await self.drive_service.get_or_create_folder(
                    batch_job.project_folder_id,
                    'imagesAI'
                )
                if success:
                    imagesai_folder_id = folder_id

                    # Update cached folder structure
                    await self.update_project_folder(project_folder.project_folder_id, {
                        'imagesai_folder_id': folder_id
                    })

            if not imagesai_folder_id:
                raise Exception("Failed to get/create imagesAI folder")

            drive_file_ids = []
            import aiohttp

            # Upload each image
            for idx, supabase_url in enumerate(supabase_urls):
                try:
                    # Download from Supabase
                    async with aiohttp.ClientSession() as session:
                        async with session.get(supabase_url) as response:
                            if response.status != 200:
                                raise Exception(f"Failed to download from Supabase: {response.status}")

                            content = await response.read()

                    # Generate filename
                    if idx == 0:
                        filename = f"MF{batch_item.source_index:03d}_v{batch_item.variation_number}_grid.png"
                    else:
                        filename = f"MF{batch_item.source_index:03d}_v{batch_item.variation_number}_{idx:03d}.png"

                    # Upload to Drive
                    success, file_id, error = await self.drive_service.upload_file(
                        file_content=content,
                        filename=filename,
                        folder_id=imagesai_folder_id,
                        mime_type='image/png'
                    )

                    if success and file_id:
                        drive_file_ids.append(file_id)
                    else:
                        logger.warning(f"Drive upload failed for {filename}: {error}")

                except Exception as e:
                    logger.error(f"Failed to process file {idx}: {str(e)}")

            # Update batch_item with Drive file IDs
            if drive_file_ids:
                await self.update_batch_item(batch_item_id, {
                    'drive_file_ids': drive_file_ids
                })

            logger.info(f"Successfully uploaded {len(drive_file_ids)} files to Drive")

        except Exception as e:
            logger.error(f"Failed to upload to Drive: {str(e)}")
            # Don't fail - images still in Supabase

    async def _update_batch_job_progress(
        self,
        batch_job_id: str,
        failed: bool = False
    ):
        """Update batch job progress counters."""
        try:
            batch_job = await self.get_batch_job(batch_job_id)
            if not batch_job:
                return

            updates = {}

            if failed:
                updates['failed_jobs'] = batch_job.failed_jobs + 1
            else:
                updates['completed_jobs'] = batch_job.completed_jobs + 1

                # Count completed master frames (distinct source_index)
                response = self.supabase.table('batch_job_items').select('source_index').eq(
                    'batch_job_id', batch_job_id
                ).eq(
                    'status', 'completed'
                ).execute()

                if response.data:
                    unique_frames = set(item['source_index'] for item in response.data)
                    updates['completed_master_frames'] = len(unique_frames)

            # Check if batch is complete
            total_completed = (batch_job.completed_jobs + (1 if not failed else 0))
            if total_completed >= batch_job.total_jobs:
                updates['status'] = 'completed'
                updates['completed_at'] = datetime.utcnow().isoformat()

            await self.update_batch_job(batch_job_id, updates)

        except Exception as e:
            logger.error(f"Failed to update batch job progress: {str(e)}")

    async def star_item(
        self,
        batch_item_id: str,
        user_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Star item and move to starred folder (Phase 4 implementation)."""
        # TODO: Implement in Phase 4
        return False, "Not implemented yet - Phase 4"

    async def delete_item(
        self,
        batch_item_id: str,
        user_id: str
    ) -> Tuple[bool, Optional[str]]:
        """Soft delete and remove from storage (Phase 4 implementation)."""
        # TODO: Implement in Phase 4
        return False, "Not implemented yet - Phase 4"

    async def get_project_folder(
        self,
        project_folder_id: str
    ) -> Optional[ProjectFolder]:
        """Get cached project folder by Drive folder ID."""
        try:
            response = self.supabase.table('project_folders').select('*').eq(
                'project_folder_id', project_folder_id
            ).execute()

            if response.data and len(response.data) > 0:
                return ProjectFolder(**response.data[0])

            return None

        except Exception as e:
            logger.error(f"Error getting project folder: {str(e)}")
            return None

    async def get_batch_item(self, batch_item_id: str) -> Optional[BatchJobItem]:
        """Get batch item by ID."""
        try:
            response = self.supabase.table('batch_job_items').select('*').eq(
                'id', batch_item_id
            ).execute()

            if response.data and len(response.data) > 0:
                return BatchJobItem(**response.data[0])

            return None

        except Exception as e:
            logger.error(f"Error getting batch item: {str(e)}")
            return None
