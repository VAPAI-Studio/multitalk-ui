from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from api import jobs, storage, datasets, image_edit, comfyui, edited_images, style_transfer, style_transfer_v2, style_transfer_v3, multitalk

# Only load .env file if not running on Heroku
if not os.getenv("DYNO"):  # DYNO is a Heroku-specific environment variable
    from dotenv import load_dotenv
    load_dotenv()
    print("🔧 Local development: Loaded .env file")
else:
    print("☁️ Running on Heroku: Using environment variables")

app = FastAPI(title="MultiTalk API", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.vercel.app", "http://localhost:5173", "*"],  # In production, replace with your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(jobs.router, prefix="/api")
app.include_router(storage.router, prefix="/api")
app.include_router(datasets.router, prefix="/api")
app.include_router(image_edit.router, prefix="/api")
app.include_router(comfyui.router, prefix="/api")
app.include_router(edited_images.router, prefix="/api")
app.include_router(style_transfer.router, prefix="/api/style-transfers")
app.include_router(style_transfer_v2.router, prefix="/api/style-transfers-v2")
app.include_router(style_transfer_v3.router, prefix="/api/style-transfers-v3")
app.include_router(multitalk.router, prefix="/api/multitalk")

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