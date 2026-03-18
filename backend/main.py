import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from api import storage, datasets, image_edit, comfyui, multitalk, auth, image_jobs, video_jobs, world_jobs, flux_trainer, lora_trainer, feed, google_drive, virtual_set, runpod, infrastructure, api_keys, upscale
from services.upscale_job_service import UpscaleJobService

# Only load .env file if not running on Heroku
if not os.getenv("DYNO"):  # DYNO is a Heroku-specific environment variable
    from dotenv import load_dotenv
    load_dotenv()
    print("🔧 Local development: Loaded .env file")
else:
    print("☁️ Running on Heroku: Using environment variables")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: recover interrupted upscale batches. Shutdown: no-op (state is in DB)."""
    from api.upscale import _process_batch

    try:
        service = UpscaleJobService()
        interrupted = await service.get_batches_by_status("processing")
        for batch in interrupted:
            batch_id = batch.get("id") or batch.get("batch_id")
            await service.fail_current_processing_video(
                batch_id, "Server restart interrupted processing"
            )
            asyncio.create_task(_process_batch(batch_id))
            print(f"[UPSCALE] Resumed interrupted batch {batch_id}")
    except Exception as e:
        print(f"[UPSCALE] Startup recovery error (non-fatal): {e}")

    yield
    # Shutdown: nothing to clean up (state is in DB)


app = FastAPI(title="MultiTalk API", version="1.0.0", lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.vercel.app", "http://localhost:5173", "*"],  # In production, replace with your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router, prefix="/api")
app.include_router(image_jobs.router, prefix="/api")
app.include_router(video_jobs.router, prefix="/api")
app.include_router(world_jobs.router, prefix="/api")
app.include_router(storage.router, prefix="/api")
app.include_router(datasets.router, prefix="/api")
app.include_router(image_edit.router, prefix="/api")
app.include_router(comfyui.router, prefix="/api")
app.include_router(multitalk.router, prefix="/api/multitalk")
app.include_router(flux_trainer.router, prefix="/api")
app.include_router(lora_trainer.router, prefix="/api")
app.include_router(feed.router, prefix="/api")
app.include_router(google_drive.router, prefix="/api")
app.include_router(virtual_set.router, prefix="/api")
app.include_router(runpod.router, prefix="/api")
app.include_router(api_keys.router, prefix="/api")
app.include_router(infrastructure.router)
app.include_router(upscale.router, prefix="/api")

@app.get("/")
async def root():
    return {"message": "MultiTalk API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/health")
async def api_health_check():
    return {"status": "healthy", "service": "api"}

@app.get("/api/environment")
async def get_environment_info():
    is_heroku = bool(os.getenv("DYNO"))
    return {
        "environment": "heroku" if is_heroku else "local",
        "is_heroku": is_heroku,
        "dyno": os.getenv("DYNO"),
        "port": os.getenv("PORT", "8000"),
        "config_source": "heroku_env" if is_heroku else "dotenv_file"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)