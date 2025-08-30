from typing import List, Optional, Tuple
from datetime import datetime
import asyncio
import httpx

from core.supabase import get_supabase
from models.job import MultiTalkJob, CreateJobPayload, CompleteJobPayload, JobStatus

class JobService:
    def __init__(self):
        self.supabase = get_supabase()
    
    async def create_job(self, payload: CreateJobPayload) -> Tuple[bool, Optional[str]]:
        """Creates a new job record in Supabase when submission starts"""
        try:
            job_data = {
                "job_id": payload.job_id,
                "status": "submitted",
                "timestamp_submitted": datetime.now().isoformat(),
                "comfy_url": payload.comfy_url,
                "image_filename": payload.image_filename,
                "audio_filename": payload.audio_filename,
                "width": payload.width,
                "height": payload.height,
                "trim_to_audio": payload.trim_to_audio,
            }

            try:
                # Use asyncio.wait_for for timeout
                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        lambda: self.supabase.table('multitalk_jobs').insert(job_data).execute()
                    ),
                    timeout=5.0
                )
                
                if response.data:
                    print(f"Job created successfully: {payload.job_id}")
                    return True, None
                else:
                    error_msg = f"No data returned when creating job {payload.job_id}"
                    print(f"Error creating job: {error_msg}")
                    return True, f"DB error (non-blocking): {error_msg}"
                    
            except asyncio.TimeoutError:
                print("DB timeout but continuing with processing")
                return True, "DB timeout (non-blocking)"
                
        except Exception as error:
            print(f"Error creating job: {error}")
            return True, f"DB error (non-blocking): {str(error)}"
    
    async def update_job_to_processing(self, job_id: str) -> Tuple[bool, Optional[str]]:
        """Updates job status to processing"""
        try:
            response = await asyncio.to_thread(
                lambda: self.supabase.table('multitalk_jobs')
                .update({
                    "status": "processing",
                    "updated_at": datetime.now().isoformat()
                })
                .eq('job_id', job_id)
                .execute()
            )
            
            if response.data:
                return True, None
            else:
                return False, "Failed to update job status"
                
        except Exception as error:
            print(f"Error updating job to processing: {error}")
            return False, str(error)
    
    async def complete_job(self, payload: CompleteJobPayload) -> Tuple[bool, Optional[str]]:
        """Completes a job with success or error status"""
        try:
            update_data = {
                "status": payload.status,
                "timestamp_completed": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }
            
            if payload.filename:
                update_data["filename"] = payload.filename
            if payload.subfolder:
                update_data["subfolder"] = payload.subfolder
            if payload.error_message:
                update_data["error_message"] = payload.error_message
            if payload.video_url:
                update_data["video_url"] = payload.video_url

            response = await asyncio.to_thread(
                lambda: self.supabase.table('multitalk_jobs')
                .update(update_data)
                .eq('job_id', payload.job_id)
                .execute()
            )
            
            if response.data:
                print(f"Job completed successfully: {payload.job_id}")
                return True, None
            else:
                return False, "Failed to complete job"
                
        except Exception as error:
            print(f"Error completing job: {error}")
            return False, str(error)
    
    async def get_recent_jobs(self, limit: int = 50) -> Tuple[List[MultiTalkJob], Optional[str]]:
        """Gets recent jobs from Supabase"""
        try:
            response = await asyncio.to_thread(
                lambda: self.supabase.table('multitalk_jobs')
                .select('*')
                .order('timestamp_submitted', desc=True)
                .limit(limit)
                .execute()
            )
            
            if response.data:
                jobs = [MultiTalkJob(**job) for job in response.data]
                return jobs, None
            else:
                return [], "No jobs found"
                
        except Exception as error:
            print(f"Error fetching jobs: {error}")
            return [], str(error)
    
    async def get_job(self, job_id: str) -> Tuple[Optional[MultiTalkJob], Optional[str]]:
        """Gets a specific job by ID"""
        try:
            response = await asyncio.to_thread(
                lambda: self.supabase.table('multitalk_jobs')
                .select('*')
                .eq('job_id', job_id)
                .single()
                .execute()
            )
            
            if response.data:
                job = MultiTalkJob(**response.data)
                return job, None
            else:
                return None, "Job not found"
                
        except Exception as error:
            print(f"Error fetching job: {error}")
            return None, str(error)
    
    async def get_completed_jobs_with_videos(self, limit: int = 20) -> Tuple[List[MultiTalkJob], Optional[str]]:
        """Gets jobs with completed status that have video files"""
        try:
            try:
                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        lambda: self.supabase.table('multitalk_jobs')
                        .select('*')
                        .eq('status', 'completed')
                        .not_('filename', 'is', None)
                        .order('timestamp_completed', desc=True)
                        .limit(limit)
                        .execute()
                    ),
                    timeout=10.0
                )
                
                if response.data:
                    jobs = [MultiTalkJob(**job) for job in response.data]
                    return jobs, None
                else:
                    return [], None
                    
            except asyncio.TimeoutError:
                return [], "Request timeout - using offline mode"
                
        except Exception as error:
            print(f"Error fetching completed jobs: {error}")
            
            # Handle specific error types more gracefully
            if "fetch" in str(error).lower():
                return [], "Network error - check connection"
            
            return [], str(error)