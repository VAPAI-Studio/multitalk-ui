"""Custom workflow builder API endpoints (admin-only).

Provides parse, CRUD, and publish/unpublish endpoints for custom workflow
configurations. Every endpoint requires admin authentication via
Depends(verify_admin) at the endpoint level (NOT router-level).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from core.auth import get_current_user, verify_admin
from models.custom_workflow import (
    CreateCustomWorkflowRequest,
    CustomWorkflowListResponse,
    CustomWorkflowResponse,
    ExecuteWorkflowRequest,
    ExecuteWorkflowResponse,
    ParseWorkflowRequest,
    ParseWorkflowResponse,
    UpdateCustomWorkflowRequest,
)
from services.custom_workflow_service import CustomWorkflowService

router = APIRouter(prefix="/api/custom-workflows", tags=["custom-workflows"])


@router.post("/parse", response_model=ParseWorkflowResponse)
async def parse_workflow(
    payload: ParseWorkflowRequest,
    admin_user: dict = Depends(verify_admin),
) -> ParseWorkflowResponse:
    """
    Parse a raw ComfyUI workflow JSON and return structured nodes.

    Accepts API-format workflow JSON, detects format, and extracts nodes
    with their configurable inputs (filtering out link arrays).

    Returns success=True with nodes for API format, success=False with
    error message for UI format or unknown format. Always returns 200.

    Admin-only.
    """
    service = CustomWorkflowService()
    success, response, error = await service.parse_workflow(payload.workflow_json)
    return response


@router.post("/", response_model=CustomWorkflowResponse, status_code=201)
async def create_workflow(
    payload: CreateCustomWorkflowRequest,
    admin_user: dict = Depends(verify_admin),
) -> JSONResponse:
    """
    Create a new custom workflow configuration.

    Generates slug from name (if not provided), saves workflow template
    to disk, and inserts configuration into the database.

    Returns 201 on success, 409 on slug conflict, 400 on other failures.

    Admin-only.
    """
    service = CustomWorkflowService()
    admin_id = admin_user.id if hasattr(admin_user, "id") else admin_user.get("id")
    success, workflow, error = await service.create(payload, created_by=admin_id)

    if not success:
        if error and ("duplicate" in error.lower() or "unique" in error.lower()):
            raise HTTPException(status_code=409, detail=error)
        raise HTTPException(status_code=400, detail=error or "Failed to create workflow")

    return JSONResponse(
        status_code=201,
        content=CustomWorkflowResponse(success=True, workflow=workflow).model_dump(),
    )


@router.get("/", response_model=CustomWorkflowListResponse)
async def list_workflows(
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowListResponse:
    """
    List all custom workflows (published and unpublished).

    Returns workflows ordered by created_at descending.

    Admin-only.
    """
    service = CustomWorkflowService()
    workflows = await service.list_all()
    return CustomWorkflowListResponse(success=True, workflows=workflows)


@router.get("/published", response_model=CustomWorkflowListResponse)
async def list_published_workflows(
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowListResponse:
    """
    List only published custom workflows.

    Returns published workflows ordered by created_at descending.

    Admin-only.
    """
    service = CustomWorkflowService()
    workflows = await service.list_published()
    return CustomWorkflowListResponse(success=True, workflows=workflows)


@router.get("/{workflow_id}", response_model=CustomWorkflowResponse)
async def get_workflow(
    workflow_id: str,
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowResponse:
    """
    Get a single custom workflow by ID.

    Returns 404 if workflow not found.

    Admin-only.
    """
    service = CustomWorkflowService()
    workflow = await service.get(workflow_id)

    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return CustomWorkflowResponse(success=True, workflow=workflow)


@router.put("/{workflow_id}", response_model=CustomWorkflowResponse)
async def update_workflow(
    workflow_id: str,
    payload: UpdateCustomWorkflowRequest,
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowResponse:
    """
    Partially update a custom workflow configuration.

    Only non-None fields from the request are applied. Returns 400 on failure.

    Admin-only.
    """
    service = CustomWorkflowService()
    success, workflow, error = await service.update(workflow_id, payload)

    if not success:
        raise HTTPException(status_code=400, detail=error or "Failed to update workflow")

    return CustomWorkflowResponse(success=True, workflow=workflow)


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    admin_user: dict = Depends(verify_admin),
) -> dict:
    """
    Delete a custom workflow by ID.

    Removes both the database row and the template file from disk.
    Returns 404 if workflow not found, 500 on other errors.

    Admin-only.
    """
    service = CustomWorkflowService()
    success, error = await service.delete(workflow_id)

    if not success:
        if error and "not found" in error.lower():
            raise HTTPException(status_code=404, detail=error)
        raise HTTPException(status_code=500, detail=error or "Failed to delete workflow")

    return {"success": True}


@router.post("/{workflow_id}/publish", response_model=CustomWorkflowResponse)
async def publish_workflow(
    workflow_id: str,
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowResponse:
    """
    Publish a custom workflow (set is_published=True).

    Returns 400 if workflow not found or update fails.

    Admin-only.
    """
    service = CustomWorkflowService()
    success, workflow, error = await service.toggle_publish(workflow_id, True)

    if not success:
        raise HTTPException(status_code=400, detail=error or "Failed to publish workflow")

    return CustomWorkflowResponse(success=True, workflow=workflow)


@router.post("/{workflow_id}/unpublish", response_model=CustomWorkflowResponse)
async def unpublish_workflow(
    workflow_id: str,
    admin_user: dict = Depends(verify_admin),
) -> CustomWorkflowResponse:
    """
    Unpublish a custom workflow (set is_published=False).

    Returns 400 if workflow not found or update fails.

    Admin-only.
    """
    service = CustomWorkflowService()
    success, workflow, error = await service.toggle_publish(workflow_id, False)

    if not success:
        raise HTTPException(status_code=400, detail=error or "Failed to unpublish workflow")

    return CustomWorkflowResponse(success=True, workflow=workflow)


@router.post("/{workflow_id}/execute", response_model=ExecuteWorkflowResponse)
async def execute_workflow(
    workflow_id: str,
    payload: ExecuteWorkflowRequest,
    current_user: dict = Depends(get_current_user),
) -> ExecuteWorkflowResponse:
    """
    Execute a custom workflow (test run or production).

    Authenticated (not admin-only) — published features are accessible to all users.
    Routes to ComfyUI or RunPod depending on execution_backend field.

    Returns 404 if workflow not found, 500 on execution failure.
    """
    service = CustomWorkflowService()
    workflow = await service.get(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if payload.execution_backend == 'runpod':
        success, job_id, error = await service.execute_dynamic_workflow_runpod(
            workflow, payload.parameters
        )
    else:
        success, job_id, error = await service.execute_dynamic_workflow(
            workflow, payload.parameters, payload.base_url, payload.client_id
        )

    if not success:
        raise HTTPException(status_code=500, detail=error or "Execution failed")

    return ExecuteWorkflowResponse(
        success=True,
        prompt_id=job_id,
        execution_backend=payload.execution_backend,
    )
