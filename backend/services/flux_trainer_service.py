"""Service for managing Flux LoRA training jobs using kohya_ss."""

import os
import asyncio
import subprocess
import shutil
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from datetime import datetime
import uuid
import re

from models.training_job import TrainingConfigTOML, TrainingStatus
from services.storage_service import StorageService
from core.supabase import get_supabase_client


class FluxTrainerService:
    """Service for Flux LoRA training operations."""

    def __init__(self):
        self.supabase = get_supabase_client()
        self.storage_service = StorageService()

        # Training workspace directory
        self.workspace_dir = Path(os.getenv("TRAINING_WORKSPACE_DIR", "./training_workspace"))
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        # Kohya_ss installation path (configure via environment)
        self.kohya_path = Path(os.getenv("KOHYA_SS_PATH", "/opt/kohya_ss"))
        self.kohya_venv_python = self.kohya_path / "venv" / "bin" / "python"

    async def create_training_job(
        self,
        user_id: str,
        job_data: Dict[str, Any]
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create a new training job in the database.

        Returns:
            (success, job_id, error_message)
        """
        try:
            # Insert job into database
            response = self.supabase.table('training_jobs').insert({
                'user_id': user_id,
                'job_name': job_data['job_name'],
                'instance_prompt': job_data['instance_prompt'],
                'class_prompt': job_data['class_prompt'],
                'num_epochs': job_data.get('num_epochs', 20),
                'learning_rate': job_data.get('learning_rate', 0.0001),
                'network_rank': job_data.get('network_rank', 16),
                'network_alpha': job_data.get('network_alpha', 8),
                'repeats': job_data.get('repeats', 5),
                'config_params': job_data.get('config_params', {}),
                'status': TrainingStatus.PENDING.value
            }).execute()

            if not response.data:
                return False, None, "Failed to create training job"

            job_id = response.data[0]['id']
            return True, job_id, None

        except Exception as e:
            return False, None, str(e)

    async def prepare_training_dataset(
        self,
        job_id: str,
        images: list,
        user_id: str
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Prepare training dataset from uploaded images.

        Args:
            job_id: Training job ID
            images: List of image files
            user_id: User ID for storage

        Returns:
            (success, dataset_folder, error_message)
        """
        try:
            # Create job-specific directory
            job_dir = self.workspace_dir / job_id
            dataset_dir = job_dir / "dataset"
            dataset_dir.mkdir(parents=True, exist_ok=True)

            # Get job details for folder naming
            job_response = self.supabase.table('training_jobs').select('*').eq('id', job_id).single().execute()
            if not job_response.data:
                return False, None, "Job not found"

            job = job_response.data
            repeats = job['repeats']
            instance_prompt = job['instance_prompt']

            # Create folder with repeat count (kohya format: {repeats}_{name})
            train_folder = dataset_dir / f"{repeats}_{instance_prompt}"
            train_folder.mkdir(parents=True, exist_ok=True)

            # Save images
            num_images = 0
            for idx, image in enumerate(images):
                # Read image data
                image_data = await image.read()

                # Save to disk
                image_filename = f"{instance_prompt}_{idx + 1:04d}{Path(image.filename).suffix}"
                image_path = train_folder / image_filename
                with open(image_path, 'wb') as f:
                    f.write(image_data)

                num_images += 1

            # Update job with dataset info
            self.supabase.table('training_jobs').update({
                'dataset_folder': str(dataset_dir),
                'num_images': num_images,
                'status': TrainingStatus.PREPARING.value
            }).eq('id', job_id).execute()

            return True, str(dataset_dir), None

        except Exception as e:
            return False, None, str(e)

    def generate_training_config(
        self,
        job_id: str,
        job_data: Dict[str, Any],
        dataset_dir: str
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Generate TOML configuration file for training.

        Returns:
            (success, config_path, error_message)
        """
        try:
            job_dir = self.workspace_dir / job_id
            output_dir = job_dir / "output"
            output_dir.mkdir(parents=True, exist_ok=True)

            config_path = job_dir / "training_config.toml"

            # Build configuration
            config = TrainingConfigTOML(
                train_data_dir=dataset_dir,
                output_dir=str(output_dir),
                output_name=job_data['job_name'].replace(' ', '_'),
                max_train_epochs=job_data['num_epochs'],
                learning_rate=job_data['learning_rate'],
                network_dim=job_data['network_rank'],
                network_alpha=job_data['network_alpha']
            )

            # Write TOML file
            with open(config_path, 'w') as f:
                f.write(config.to_toml_string())

            return True, str(config_path), None

        except Exception as e:
            return False, None, str(e)

    async def start_training(
        self,
        job_id: str,
        config_path: str
    ) -> Tuple[bool, Optional[str]]:
        """
        Start the training process.

        Returns:
            (success, error_message)
        """
        try:
            # Update job status
            self.supabase.table('training_jobs').update({
                'status': TrainingStatus.TRAINING.value,
                'started_at': datetime.utcnow().isoformat()
            }).eq('id', job_id).execute()

            # Prepare command
            # accelerate launch --mixed_precision bf16 flux_train_network.py --config_file config.toml
            command = [
                str(self.kohya_venv_python),
                "-m", "accelerate.commands.launch",
                "--mixed_precision", "bf16",
                "--num_processes", "1",
                str(self.kohya_path / "sd-scripts" / "flux_train_network.py"),
                "--config_file", config_path
            ]

            # Run training in background
            # In production, use a proper job queue (Celery, etc.)
            asyncio.create_task(self._run_training_subprocess(job_id, command))

            return True, None

        except Exception as e:
            await self._mark_job_failed(job_id, str(e))
            return False, str(e)

    async def _run_training_subprocess(self, job_id: str, command: list):
        """
        Run training subprocess and monitor progress.

        This runs in the background and updates job status.
        """
        try:
            log_file = self.workspace_dir / job_id / "training.log"

            with open(log_file, 'w') as log_f:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT
                )

                # Monitor output
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break

                    line_str = line.decode('utf-8').strip()
                    log_f.write(line_str + '\n')
                    log_f.flush()

                    # Parse progress from log
                    await self._parse_and_update_progress(job_id, line_str)

                # Wait for completion
                await process.wait()

                if process.returncode == 0:
                    await self._mark_job_completed(job_id)
                else:
                    await self._mark_job_failed(job_id, f"Training failed with exit code {process.returncode}")

        except Exception as e:
            await self._mark_job_failed(job_id, str(e))

    async def _parse_and_update_progress(self, job_id: str, log_line: str):
        """
        Parse training log line and update job progress.

        Typical log format from kohya_ss:
        "epoch 5/20, step 100/500, loss: 0.0123"
        """
        try:
            # Parse epoch
            epoch_match = re.search(r'epoch (\d+)/(\d+)', log_line, re.IGNORECASE)
            # Parse step
            step_match = re.search(r'step (\d+)/(\d+)', log_line, re.IGNORECASE)
            # Parse loss
            loss_match = re.search(r'loss[:\s]+([0-9.]+)', log_line, re.IGNORECASE)

            update_data = {}

            if epoch_match:
                current_epoch = int(epoch_match.group(1))
                total_epochs = int(epoch_match.group(2))
                update_data['current_epoch'] = current_epoch

            if step_match:
                current_step = int(step_match.group(1))
                total_steps = int(step_match.group(2))
                update_data['current_step'] = current_step
                update_data['total_steps'] = total_steps

                # Calculate progress percentage
                progress = int((current_step / total_steps) * 100) if total_steps > 0 else 0
                update_data['progress_percentage'] = min(progress, 99)  # Reserve 100 for completion

            if loss_match:
                update_data['loss'] = float(loss_match.group(1))

            # Update database if we have data
            if update_data:
                self.supabase.table('training_jobs').update(update_data).eq('id', job_id).execute()

        except Exception as e:
            print(f"Error parsing progress: {e}")

    async def _mark_job_completed(self, job_id: str):
        """Mark training job as completed and upload result."""
        try:
            # Find output .safetensors file
            job_dir = self.workspace_dir / job_id
            output_dir = job_dir / "output"

            lora_files = list(output_dir.glob("*.safetensors"))
            if not lora_files:
                await self._mark_job_failed(job_id, "No output .safetensors file found")
                return

            # Use the last epoch file
            lora_file = sorted(lora_files)[-1]
            file_size_mb = lora_file.stat().st_size / (1024 * 1024)

            # Upload to Supabase Storage
            with open(lora_file, 'rb') as f:
                lora_data = f.read()

            # Get job details for user_id
            job_response = self.supabase.table('training_jobs').select('user_id').eq('id', job_id).single().execute()
            user_id = job_response.data['user_id']

            storage_path = f"{user_id}/trained_loras/{lora_file.name}"
            success, url, error = await self.storage_service.upload_file(
                file_data=lora_data,
                file_name=lora_file.name,
                bucket_name="training-outputs",
                path=storage_path
            )

            if not success:
                await self._mark_job_failed(job_id, f"Upload failed: {error}")
                return

            # Update job as completed
            self.supabase.table('training_jobs').update({
                'status': TrainingStatus.COMPLETED.value,
                'progress_percentage': 100,
                'output_lora_path': str(lora_file),
                'output_lora_url': url,
                'model_size_mb': round(file_size_mb, 2),
                'completed_at': datetime.utcnow().isoformat()
            }).eq('id', job_id).execute()

        except Exception as e:
            await self._mark_job_failed(job_id, f"Completion error: {str(e)}")

    async def _mark_job_failed(self, job_id: str, error_message: str):
        """Mark training job as failed."""
        try:
            self.supabase.table('training_jobs').update({
                'status': TrainingStatus.FAILED.value,
                'error_message': error_message
            }).eq('id', job_id).execute()
        except Exception as e:
            print(f"Error marking job as failed: {e}")

    async def cancel_training(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """
        Cancel a running training job.

        Returns:
            (success, error_message)
        """
        try:
            # Update status
            self.supabase.table('training_jobs').update({
                'status': TrainingStatus.CANCELLED.value
            }).eq('id', job_id).execute()

            # TODO: Kill the subprocess if running
            # This would require tracking process IDs

            return True, None

        except Exception as e:
            return False, str(e)

    async def get_training_jobs(
        self,
        user_id: str,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[bool, Optional[list], Optional[str]]:
        """
        Get training jobs for a user.

        Returns:
            (success, jobs_list, error_message)
        """
        try:
            query = self.supabase.table('training_jobs').select('*').eq('user_id', user_id)

            if status:
                query = query.eq('status', status)

            response = query.order('created_at', desc=True).range(offset, offset + limit - 1).execute()

            return True, response.data, None

        except Exception as e:
            return False, None, str(e)

    async def delete_training_job(self, job_id: str, user_id: str) -> Tuple[bool, Optional[str]]:
        """
        Delete a training job and clean up files.

        Returns:
            (success, error_message)
        """
        try:
            # Delete from database
            self.supabase.table('training_jobs').delete().eq('id', job_id).eq('user_id', user_id).execute()

            # Clean up workspace files
            job_dir = self.workspace_dir / job_id
            if job_dir.exists():
                shutil.rmtree(job_dir)

            return True, None

        except Exception as e:
            return False, str(e)
