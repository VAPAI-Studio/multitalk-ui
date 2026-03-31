from fastapi import APIRouter, Header, UploadFile
from typing import Optional
import asyncio
import base64
import uuid
from datetime import datetime

import httpx

from models.virtual_set import (
    VirtualSetGenerateRequest,
    VirtualSetGenerateResponse,
    VirtualSetStatusResponse,
    VirtualSetSaveWorldRequest,
    VirtualSetSaveWorldResponse,
    VirtualSetReconstructRequest,
    VirtualSetReconstructResponse,
    VirtualSetGenerateAssetRequest,
    VirtualSetGenerateAssetResponse,
)
from config.settings import settings
from services.worldlabs_service import WorldLabsService
from services.comfyui_service import ComfyUIService
from services.workflow_service import WorkflowService
from services.storage_service import StorageService
from services.image_job_service import ImageJobService
from services.world_job_service import WorldJobService
from models.image_job import CreateImageJobPayload, CompleteImageJobPayload
from models.world_job import CreateWorldJobPayload, CompleteWorldJobPayload
from core.supabase import get_supabase_for_token
from core.auth import resolve_user_id

router = APIRouter(prefix="/virtual-set", tags=["virtual-set"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def _resolve_token(authorization: Optional[str] = None, x_api_key: Optional[str] = None) -> Optional[str]:
    """Resolve auth token from Bearer header or API key."""
    if x_api_key:
        return None
    return _extract_bearer_token(authorization)


@router.post("/upload-video")
async def upload_video(
    file: UploadFile,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Upload a video file to Supabase Storage for Virtual Set world generation."""
    try:
        content = await file.read()
        if len(content) > 100 * 1024 * 1024:
            return {"success": False, "error": "Video must be under 100MB"}

        storage = StorageService()
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y-%m-%d')
        unique_id = str(uuid.uuid4())[:8]
        filename = file.filename or "video.mp4"
        path = f"input-videos-virtualset/{timestamp}/{unique_id}_{filename}"
        content_type = file.content_type or "video/mp4"

        loop = asyncio.get_event_loop()
        upload_response = await loop.run_in_executor(
            None,
            lambda: storage.supabase.storage
            .from_("multitalk-videos")
            .upload(path, content, {"content-type": content_type, "upsert": "true"}),
        )

        if hasattr(upload_response, "error") and upload_response.error:
            return {"success": False, "error": f"Upload failed: {upload_response.error}"}
        elif isinstance(upload_response, dict) and upload_response.get("error"):
            return {"success": False, "error": f"Upload failed: {upload_response['error']}"}

        public_url = storage.supabase.storage.from_("multitalk-videos").get_public_url(path)
        if isinstance(public_url, dict):
            public_url = public_url.get("publicUrl") or public_url.get("public_url") or str(public_url)

        return {"success": True, "video_url": public_url, "filename": filename}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/generate", response_model=VirtualSetGenerateResponse)
async def generate_world(
    request: VirtualSetGenerateRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Upload media to storage and submit to World Labs for 3D world generation.
    Supports image, multi-image, and video prompt types."""
    try:
        print(f"\n🎬 Virtual Set Generate Request:")
        print(f"   Prompt Type: {request.prompt_type}")
        print(f"   Model: {request.model}")
        print(f"   Display Name: {request.display_name}")
        print(f"   Text Prompt: {request.text_prompt}")

        storage_service = StorageService()
        worldlabs_service = WorldLabsService()

        image_url = None
        images_with_urls = None
        video_url = None

        if request.prompt_type == "image":
            # Single image: upload to Supabase and get public URL
            print("📤 Uploading single image to Supabase...")
            if not request.image_data:
                print("❌ No image_data provided")
                return VirtualSetGenerateResponse(
                    success=False, error="image_data is required for image prompt type"
                )
            upload_success, public_url, upload_error = (
                await storage_service.upload_image_from_data_url(
                    request.image_data, "virtual-set-sources"
                )
            )
            if not upload_success or not public_url:
                print(f"❌ Image upload failed: {upload_error}")
                return VirtualSetGenerateResponse(
                    success=False, error=f"Failed to upload image: {upload_error}"
                )
            image_url = public_url
            print(f"✅ Image uploaded: {image_url[:100]}...")

        elif request.prompt_type == "multi-image":
            # Multiple images: upload each to Supabase
            if not request.images or len(request.images) < 2:
                return VirtualSetGenerateResponse(
                    success=False, error="At least 2 images are required for multi-image prompt"
                )
            max_images = 8 if request.reconstruct_images else 4
            if len(request.images) > max_images:
                return VirtualSetGenerateResponse(
                    success=False,
                    error=f"Maximum {max_images} images allowed"
                    + (" (8 with reconstruct mode)" if not request.reconstruct_images else ""),
                )

            images_with_urls = []
            for img in request.images:
                upload_success, public_url, upload_error = (
                    await storage_service.upload_image_from_data_url(
                        img.image_data, "virtual-set-sources"
                    )
                )
                if not upload_success or not public_url:
                    return VirtualSetGenerateResponse(
                        success=False,
                        error=f"Failed to upload image: {upload_error}",
                    )
                images_with_urls.append({
                    "url": public_url,
                    "azimuth": img.azimuth if img.azimuth is not None else 0,
                })

        elif request.prompt_type == "video":
            # Video: URL should already be uploaded via /upload-video
            if not request.video_url:
                return VirtualSetGenerateResponse(
                    success=False, error="video_url is required for video prompt type"
                )
            video_url = request.video_url

        # Submit to World Labs
        success, operation_id, error = await worldlabs_service.generate_world(
            prompt_type=request.prompt_type,
            image_url=image_url,
            images=images_with_urls,
            reconstruct_images=request.reconstruct_images,
            video_url=video_url,
            text_prompt=request.text_prompt,
            display_name=request.display_name,
            model=request.model,
        )

        return VirtualSetGenerateResponse(
            success=success,
            operation_id=operation_id,
            error=error,
        )

    except Exception as e:
        return VirtualSetGenerateResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.get("/status/{operation_id}", response_model=VirtualSetStatusResponse)
async def get_world_status(operation_id: str):
    """Poll World Labs operation status and extract splat URL when done."""
    try:
        worldlabs_service = WorldLabsService()

        success, done, world_data, error = await worldlabs_service.poll_operation(
            operation_id
        )

        if not success:
            return VirtualSetStatusResponse(
                success=False,
                error=error,
            )

        if not done:
            return VirtualSetStatusResponse(
                success=True,
                done=False,
            )

        # Extract splat URL from completed world data
        splat_url = WorldLabsService.extract_splat_url(world_data or {})
        world_id = (world_data or {}).get("id")

        if not splat_url:
            return VirtualSetStatusResponse(
                success=False,
                done=True,
                error="No splat asset URL found in world response",
            )

        return VirtualSetStatusResponse(
            success=True,
            done=True,
            splat_url=splat_url,
            world_id=world_id,
        )

    except Exception as e:
        return VirtualSetStatusResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.post("/save-world", response_model=VirtualSetSaveWorldResponse)
async def save_world(
    request: VirtualSetSaveWorldRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Save a generated 3D world as a world job for the feed."""
    try:
        storage_service = StorageService()
        supabase = get_supabase_for_token(_resolve_token(authorization, x_api_key))
        world_job_service = WorldJobService(supabase)

        # Upload original image to get a URL for the feed thumbnail
        upload_success, image_url, upload_error = (
            await storage_service.upload_image_from_data_url(
                request.image_data, "virtual-set-sources"
            )
        )
        if not upload_success or not image_url:
            return VirtualSetSaveWorldResponse(
                success=False,
                error=f"Failed to store image: {upload_error}",
            )

        # Resolve user_id from auth
        user_id = resolve_user_id(authorization, x_api_key)
        if not user_id:
            return VirtualSetSaveWorldResponse(
                success=False,
                error="Authentication required to save worlds",
            )

        # Create world job
        job_payload = CreateWorldJobPayload(
            user_id=user_id,
            splat_url=request.splat_url,
            world_id=request.world_id,
            model=request.model,
            prompt_type=request.prompt_type,
            input_image_urls=[image_url],
            thumbnail_url=image_url,
            display_name=f"3D World ({request.model})",
        )

        success, created_job_id, error = await world_job_service.create_job(job_payload)
        if not success:
            return VirtualSetSaveWorldResponse(
                success=False,
                error=f"Failed to save world: {error}",
            )

        # Mark as completed immediately
        if created_job_id:
            await world_job_service.complete_job(
                CompleteWorldJobPayload(
                    job_id=created_job_id,
                    status="completed",
                    splat_url=request.splat_url,
                    world_id=request.world_id,
                    thumbnail_url=image_url,
                )
            )

        return VirtualSetSaveWorldResponse(
            success=True,
            job_id=created_job_id,
        )

    except Exception as e:
        return VirtualSetSaveWorldResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


def _extract_image_bytes(data_or_url: str) -> bytes:
    """Extract raw image bytes from a data URL string."""
    if data_or_url.startswith("data:"):
        _, encoded = data_or_url.split(",", 1)
        return base64.b64decode(encoded)
    raise ValueError("Not a data URL — use _fetch_image_bytes for remote URLs")


async def _fetch_image_bytes(url: str) -> bytes:
    """Download image bytes from a remote URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


def _image_ext_from_data_url(data_url: str) -> str:
    """Infer file extension from a data URL's MIME type."""
    if "image/png" in data_url:
        return "png"
    if "image/webp" in data_url:
        return "webp"
    return "jpg"


@router.post("/reconstruct", response_model=VirtualSetReconstructResponse)
async def reconstruct_image(
    request: VirtualSetReconstructRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Reconstruct a high-quality image from screenshot + reference via ComfyUI workflow."""
    image_job_id = None

    try:
        comfyui_service = ComfyUIService()
        workflow_service = WorkflowService()
        storage_service = StorageService()
        supabase = get_supabase_for_token(_resolve_token(authorization, x_api_key))
        image_job_service = ImageJobService(supabase)

        comfy_url = request.comfy_url
        if not comfy_url:
            return VirtualSetReconstructResponse(
                success=False,
                error="ComfyUI URL is required for reconstruction",
            )

        # --- 1. Upload screenshot to Supabase for record-keeping ---
        screenshot_upload_success, screenshot_url, screenshot_error = (
            await storage_service.upload_image_from_data_url(
                request.screenshot_data, "virtual-set-screenshots"
            )
        )
        if not screenshot_upload_success:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to store screenshot: {screenshot_error}",
            )

        # --- 2. Upload/resolve original image to Supabase for record-keeping ---
        if request.original_image_data.startswith("data:image/"):
            original_upload_success, original_url, original_error = (
                await storage_service.upload_image_from_data_url(
                    request.original_image_data, "virtual-set-sources"
                )
            )
        else:
            original_upload_success = True
            original_url = request.original_image_data
            original_error = None

        if not original_upload_success:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to store original image: {original_error}",
            )

        # --- 3. Extract image bytes and upload both to ComfyUI ---
        uid = str(uuid.uuid4())[:8]

        # Screenshot bytes (always a data URL from canvas)
        screenshot_bytes = _extract_image_bytes(request.screenshot_data)
        screenshot_ext = _image_ext_from_data_url(request.screenshot_data)
        screenshot_comfy_name = f"vs_screenshot_{uid}.{screenshot_ext}"

        upload_ok, screenshot_filename, upload_err = await comfyui_service.upload_audio(
            comfy_url, screenshot_bytes, screenshot_comfy_name
        )
        if not upload_ok:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to upload screenshot to ComfyUI: {upload_err}",
            )

        # Reference image bytes (can be data URL or remote URL)
        if request.original_image_data.startswith("data:"):
            ref_bytes = _extract_image_bytes(request.original_image_data)
            ref_ext = _image_ext_from_data_url(request.original_image_data)
        else:
            ref_bytes = await _fetch_image_bytes(request.original_image_data)
            ref_ext = "jpg"
        ref_comfy_name = f"vs_reference_{uid}.{ref_ext}"

        upload_ok, reference_filename, upload_err = await comfyui_service.upload_audio(
            comfy_url, ref_bytes, ref_comfy_name
        )
        if not upload_ok:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to upload reference to ComfyUI: {upload_err}",
            )

        # --- 4. Build workflow from template ---
        base_prompt = (
            "Reconstruct this scene from a new camera angle. The first image is a gaussian splatting 3D capture showing the "
            "desired camera position and composition - ignore its rendering artifacts and quality issues. The second image is the "
            "style and quality reference - match its visual style, textures, colors, and level of detail exactly. Combine the "
            "viewpoint of the first image with the aesthetic of the second image."
        )
        full_prompt = f"{base_prompt} {request.prompt}".strip() if request.prompt else base_prompt

        timestamp = datetime.now().strftime("%m-%d-%H-%M-%S")
        output_prefix = f"image-{timestamp}"

        build_ok, workflow, build_err = await workflow_service.build_workflow(
            "Reconstruccion-virtualset-nb2",
            {
                "SCREENSHOT_FILENAME": screenshot_filename,
                "REFERENCE_FILENAME": reference_filename,
                "PROMPT": full_prompt,
                "OUTPUT_PREFIX": output_prefix,
            },
        )
        if not build_ok or not workflow:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to build workflow: {build_err}",
            )

        # --- 5. Submit to ComfyUI ---
        client_id = request.client_id or f"virtualset-{uid}"
        payload = {"prompt": workflow, "client_id": client_id}

        # Add ComfyUI API key for paid API nodes (Gemini/Nano Banana)
        api_key = settings.COMFY_API_KEY
        if api_key:
            payload["extra_data"] = {"api_key_comfy_org": api_key}

        submit_ok, prompt_id, submit_err = await comfyui_service.submit_prompt(
            comfy_url, payload
        )
        if not submit_ok or not prompt_id:
            return VirtualSetReconstructResponse(
                success=False,
                error=f"Failed to submit to ComfyUI: {submit_err}",
            )

        # --- 6. Create image job record ---
        user_id = resolve_user_id(authorization, x_api_key)
        job_payload = CreateImageJobPayload(
            user_id=user_id or "anonymous",
            comfy_job_id=prompt_id,
            workflow_name="virtual-set",
            comfy_url=comfy_url,
            input_image_urls=[screenshot_url, original_url],
            prompt=full_prompt,
            parameters={"model": "Nano Banana 2 (Gemini 3.1 Flash Image)"},
        )

        success, created_job_id, error = await image_job_service.create_job(job_payload)
        if success and created_job_id:
            image_job_id = created_job_id
            await image_job_service.update_to_processing(image_job_id)

        # --- 7. Return prompt_id for frontend polling ---
        return VirtualSetReconstructResponse(
            success=True,
            prompt_id=prompt_id,
            job_id=image_job_id,
        )

    except Exception as e:
        if image_job_id:
            try:
                ijs = ImageJobService(get_supabase_for_token(_resolve_token(authorization, x_api_key)))
                await ijs.complete_job(
                    CompleteImageJobPayload(
                        job_id=image_job_id,
                        status="failed",
                        error_message=f"Server error: {str(e)}",
                    )
                )
            except Exception:
                pass

        return VirtualSetReconstructResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.post("/generate-asset", response_model=VirtualSetGenerateAssetResponse)
async def generate_asset(
    request: VirtualSetGenerateAssetRequest,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Generate a 3D GLB asset from one or two images using Tripo AI via ComfyUI."""
    image_job_id = None

    try:
        comfyui_service = ComfyUIService()
        workflow_service = WorkflowService()
        storage_service = StorageService()
        supabase = get_supabase_for_token(_resolve_token(authorization, x_api_key))
        image_job_service = ImageJobService(supabase)

        comfy_url = request.comfy_url
        if not comfy_url:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error="ComfyUI URL is required",
            )

        # --- 1. Upload images to Supabase for record-keeping ---
        front_upload_success, front_url, front_error = (
            await storage_service.upload_image_from_data_url(
                request.image_front, "virtual-set-sources"
            )
        )
        if not front_upload_success:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error=f"Failed to store front image: {front_error}",
            )

        # If no back image provided, use front image for both
        if request.image_back:
            back_upload_success, back_url, back_error = (
                await storage_service.upload_image_from_data_url(
                    request.image_back, "virtual-set-sources"
                )
            )
            if not back_upload_success:
                return VirtualSetGenerateAssetResponse(
                    success=False,
                    error=f"Failed to store back image: {back_error}",
                )
        else:
            back_url = front_url
            back_upload_success = True

        # --- 2. Extract image bytes and upload to ComfyUI ---
        uid = str(uuid.uuid4())[:8]

        # Front image bytes
        front_bytes = _extract_image_bytes(request.image_front)
        front_ext = _image_ext_from_data_url(request.image_front)
        front_comfy_name = f"3d_front_{uid}.{front_ext}"

        upload_ok, front_filename, upload_err = await comfyui_service.upload_audio(
            comfy_url, front_bytes, front_comfy_name
        )
        if not upload_ok:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error=f"Failed to upload front image to ComfyUI: {upload_err}",
            )

        # Back image bytes
        if request.image_back:
            back_bytes = _extract_image_bytes(request.image_back)
            back_ext = _image_ext_from_data_url(request.image_back)
        else:
            # Duplicate front image
            back_bytes = front_bytes
            back_ext = front_ext

        back_comfy_name = f"3d_back_{uid}.{back_ext}"
        upload_ok, back_filename, upload_err = await comfyui_service.upload_audio(
            comfy_url, back_bytes, back_comfy_name
        )
        if not upload_ok:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error=f"Failed to upload back image to ComfyUI: {upload_err}",
            )

        # --- 3. Build workflow from template ---
        timestamp = datetime.now().strftime("%m-%d-%H-%M-%S")
        output_prefix = f"3d/asset-{timestamp}"

        build_ok, workflow, build_err = await workflow_service.build_workflow(
            "image-to-3d",
            {
                "IMAGE_FRONT": front_filename,
                "IMAGE_BACK": back_filename,
                "OUTPUT_PREFIX": output_prefix,
            },
        )
        if not build_ok or not workflow:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error=f"Failed to build workflow: {build_err}",
            )

        # --- 4. Submit to ComfyUI ---
        client_id = request.client_id or f"3d-asset-{uid}"
        payload = {"prompt": workflow, "client_id": client_id}

        # Add ComfyUI API key if available
        api_key = settings.COMFY_API_KEY
        if api_key:
            payload["extra_data"] = {"api_key_comfy_org": api_key}

        submit_ok, prompt_id, submit_err = await comfyui_service.submit_prompt(
            comfy_url, payload
        )
        if not submit_ok or not prompt_id:
            return VirtualSetGenerateAssetResponse(
                success=False,
                error=f"Failed to submit to ComfyUI: {submit_err}",
            )

        # --- 5. Create image job record ---
        user_id = resolve_user_id(authorization, x_api_key)
        job_payload = CreateImageJobPayload(
            user_id=user_id or "anonymous",
            comfy_job_id=prompt_id,
            workflow_name="image-to-3d",
            comfy_url=comfy_url,
            input_image_urls=[front_url, back_url],
            prompt=request.asset_name,
            parameters={"model": "Tripo AI (Multiview to Model)"},
        )

        success, created_job_id, error = await image_job_service.create_job(job_payload)
        if success and created_job_id:
            image_job_id = created_job_id
            await image_job_service.update_to_processing(image_job_id)

        # --- 6. Return prompt_id for frontend polling ---
        return VirtualSetGenerateAssetResponse(
            success=True,
            prompt_id=prompt_id,
            job_id=image_job_id,
        )

    except Exception as e:
        if image_job_id:
            try:
                ijs = ImageJobService(get_supabase_for_token(_resolve_token(authorization, x_api_key)))
                await ijs.complete_job(
                    CompleteImageJobPayload(
                        job_id=image_job_id,
                        status="failed",
                        error_message=f"Server error: {str(e)}",
                    )
                )
            except Exception:
                pass

        return VirtualSetGenerateAssetResponse(
            success=False,
            error=f"Server error: {str(e)}",
        )


@router.post("/upload-glb")
async def upload_glb(
    payload: dict,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Download GLB from ComfyUI and upload to Supabase Storage."""
    try:
        storage_service = StorageService()

        comfy_url = payload.get("comfy_url")
        filename = payload.get("filename")
        subfolder = payload.get("subfolder", "")
        job_id = payload.get("job_id", "unknown")

        if not comfy_url or not filename:
            return {"success": False, "error": "Missing required parameters"}

        # Upload GLB to Supabase
        success, glb_url, error = await storage_service.upload_glb_from_comfyui(
            comfy_url, filename, subfolder, job_id
        )

        if not success:
            return {"success": False, "error": error}

        return {"success": True, "glb_url": glb_url}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/health")
async def check_config():
    """Check if World Labs API is configured (reconstruction uses ComfyUI)."""
    worldlabs_service = WorldLabsService()

    has_worldlabs = bool(worldlabs_service.api_key)

    return {
        "configured": has_worldlabs,
        "worldlabs_configured": has_worldlabs,
        "message": (
            "World Labs API configured. Reconstruction uses ComfyUI."
            if has_worldlabs
            else "Missing: WORLDLABS_API_KEY"
        ),
    }
