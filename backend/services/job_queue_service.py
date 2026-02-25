"""Service for rate-limited job submission to ComfyUI."""

import asyncio
from typing import Callable, List, Dict, Any
import logging

logger = logging.getLogger(__name__)


class JobQueueService:
    """
    Manages job submission with rate limiting to prevent overwhelming ComfyUI.

    Uses a semaphore to limit concurrent submissions and adds delays between jobs.
    """

    def __init__(self, max_concurrent: int = 5, delay_between_jobs: float = 1.5):
        """
        Initialize job queue service.

        Args:
            max_concurrent: Maximum number of concurrent job submissions
            delay_between_jobs: Delay in seconds between consecutive submissions
        """
        self.max_concurrent = max_concurrent
        self.delay_between_jobs = delay_between_jobs
        self.semaphore = asyncio.Semaphore(max_concurrent)

        logger.info(
            f"JobQueueService initialized: "
            f"max_concurrent={max_concurrent}, delay={delay_between_jobs}s"
        )

    async def submit_job_with_limit(
        self,
        submit_func: Callable,
        *args,
        **kwargs
    ) -> Any:
        """
        Submit a single job with rate limiting.

        Args:
            submit_func: Async function to call for job submission
            *args: Positional arguments for submit_func
            **kwargs: Keyword arguments for submit_func

        Returns:
            Result from submit_func

        Example:
            await queue.submit_job_with_limit(
                comfyui_service.submit_workflow,
                workflow_name='ImageGrid',
                parameters={...}
            )
        """
        async with self.semaphore:
            try:
                result = await submit_func(*args, **kwargs)
                # Wait before allowing next submission
                await asyncio.sleep(self.delay_between_jobs)
                return result
            except Exception as e:
                logger.error(f"Error submitting job: {str(e)}")
                # Still wait on error to avoid hammering the server
                await asyncio.sleep(self.delay_between_jobs)
                raise

    async def submit_batch(
        self,
        jobs: List[Dict[str, Any]],
        submit_func: Callable
    ) -> List[Any]:
        """
        Submit multiple jobs with rate limiting.

        All jobs are submitted concurrently but respect the rate limits.

        Args:
            jobs: List of job dictionaries with parameters
            submit_func: Async function to call for each job (receives **job as kwargs)

        Returns:
            List of results (or exceptions for failed jobs)

        Example:
            jobs = [
                {'workflow': 'ImageGrid', 'seed': 1},
                {'workflow': 'ImageGrid', 'seed': 2},
            ]
            results = await queue.submit_batch(jobs, comfyui_service.submit_workflow)
        """
        tasks = [
            self.submit_job_with_limit(submit_func, **job)
            for job in jobs
        ]

        # gather with return_exceptions=True to continue even if some fail
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Log any exceptions
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Job {idx} failed: {str(result)}")

        return results

    async def submit_with_progress(
        self,
        jobs: List[Dict[str, Any]],
        submit_func: Callable,
        progress_callback: Callable[[int, int], None] = None
    ) -> List[Any]:
        """
        Submit multiple jobs with progress tracking.

        Args:
            jobs: List of job dictionaries
            submit_func: Async function to call for each job
            progress_callback: Optional callback(completed, total) called after each job

        Returns:
            List of results
        """
        total = len(jobs)
        completed = 0
        results = []

        for job in jobs:
            try:
                result = await self.submit_job_with_limit(submit_func, **job)
                results.append(result)
            except Exception as e:
                logger.error(f"Job failed: {str(e)}")
                results.append(e)

            completed += 1

            if progress_callback:
                try:
                    progress_callback(completed, total)
                except Exception as e:
                    logger.error(f"Progress callback failed: {str(e)}")

        return results
