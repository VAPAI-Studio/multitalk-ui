# backend/app/api/endpoints/wizards.py

import logging
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from uuid import UUID

from screenwriter.models import schemas, database
from screenwriter.api.dependencies import get_db, get_current_user
from screenwriter.services.template_ai_service import template_ai_service
from screenwriter.services.snapshot_service import create_snapshot
from screenwriter.db import SessionLocal
from screenwriter.services.agent_review_middleware import agent_review_middleware
from screenwriter.utils.bible_context import build_bible_context
from screenwriter.models.database import SnapshotTriggerType
from .phase_data import _mark_breakdown_stale, _mark_shotlist_stale

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_project_context(db: Session, project: database.Project, bible_context: Optional[str] = None) -> str:
    """Build project context string from all phase data, including list items."""
    phase_data_records = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project.id
    ).all()

    project_data = {}
    list_items_map = {}
    for pd in phase_data_records:
        phase_key = pd.phase.value if hasattr(pd.phase, 'value') else pd.phase
        if phase_key not in project_data:
            project_data[phase_key] = {}
        project_data[phase_key][pd.subsection_key] = pd.content or {}

        # Include list items (characters, scenes, etc.)
        if pd.list_items:
            items = [{"item_type": li.item_type, **(li.content or {})} for li in pd.list_items]
            if items:
                list_items_map[f"{phase_key}.{pd.subsection_key}"] = items

    template_id = project.template.value if hasattr(project.template, 'value') else project.template
    return template_ai_service._build_project_context(project_data, template_id, list_items=list_items_map, project_title=project.title, bible_context=bible_context)


def _get_character_data(db: Session, project_id) -> list:
    """Fetch character ListItems for the project."""
    characters_pd = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project_id,
        database.PhaseData.phase == "story",
        database.PhaseData.subsection_key == "characters",
    ).first()
    if not characters_pd:
        return []
    items = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == characters_pd.id
    ).order_by(database.ListItem.sort_order).all()
    return [{"item_type": li.item_type, **(li.content or {})} for li in items]


async def _run_wizard_background(
    run_id, project_id, template_id: str,
    wizard_type: str, config: dict, phase: str, owner_id: str,
    bible_context: str = None,
):
    """Background task: run wizard generation and update the WizardRun record."""
    db = SessionLocal()
    wizard_run = None
    try:
        wizard_run = db.query(database.WizardRun).filter(
            database.WizardRun.id == run_id
        ).first()
        project = db.query(database.Project).filter(
            database.Project.id == project_id
        ).first()

        wizard_run.status = "running"
        db.commit()

        project_context = _get_project_context(db, project, bible_context=bible_context)

        result = await template_ai_service.wizard_generate(
            wizard_type=wizard_type,
            config=config,
            project_context=project_context,
            template_id=template_id,
        )

        review_result = await agent_review_middleware.review_step_output(
            phase=phase,
            subsection_key=wizard_type,
            raw_output=result,
            owner_id=owner_id,
            session_factory=SessionLocal,
            wizard_type=wizard_type,
        )
        result = review_result["output"]

        if "_meta" not in result:
            result["_meta"] = {}
        result["_meta"]["agents_consulted"] = review_result["agents_consulted"]
        result["_meta"]["review_applied"] = review_result["review_applied"]

        wizard_run.result = result
        wizard_run.status = "completed"
    except Exception as e:
        logger.error(f"Wizard background task failed ({wizard_type}): {e}")
        if wizard_run:
            wizard_run.status = "failed"
            wizard_run.error_message = str(e)
    finally:
        db.commit()
        db.close()


@router.post("/run", response_model=schemas.WizardRunResponse)
async def run_wizard(
    request: schemas.WizardRunRequest,
    background_tasks: BackgroundTasks,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start a wizard run. Returns immediately; generation runs in the background."""
    project = db.query(database.Project).filter(
        database.Project.id == request.project_id,
        database.Project.owner_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not project.template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project has no template")

    # Build bible context for episode projects (passed as string to background task)
    bible_context = build_bible_context(db, project)

    # Inject character data for scene wizard before handing off to background
    config = dict(request.config)
    if request.wizard_type == "scene_wizard":
        config["_characters"] = _get_character_data(db, project.id)

    wizard_run = database.WizardRun(
        project_id=project.id,
        wizard_type=request.wizard_type,
        phase=request.phase,
        config=request.config,
        status="pending",
    )
    db.add(wizard_run)
    db.commit()
    db.refresh(wizard_run)

    background_tasks.add_task(
        _run_wizard_background,
        run_id=wizard_run.id,
        project_id=project.id,
        template_id=project.template.value,
        wizard_type=request.wizard_type,
        config=config,
        phase=request.phase,
        owner_id=str(current_user.id),
        bible_context=bible_context,
    )

    return wizard_run


@router.get("/{run_id}", response_model=schemas.WizardRunResponse)
async def get_wizard_run(
    run_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get wizard run status and results."""
    wizard_run = db.query(database.WizardRun).filter(
        database.WizardRun.id == str(run_id)
    ).first()
    if not wizard_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizard run not found")

    # Verify ownership
    project = db.query(database.Project).filter(
        database.Project.id == str(wizard_run.project_id),
        database.Project.owner_id == str(current_user.id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return wizard_run


@router.post("/{run_id}/apply")
async def apply_wizard_results(
    run_id: UUID,
    current_user: schemas.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Apply wizard results to project data (create list_items from generated episodes/scenes)."""
    wizard_run = db.query(database.WizardRun).filter(
        database.WizardRun.id == str(run_id)
    ).first()
    if not wizard_run or wizard_run.status != "completed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Wizard run not found or not completed")

    project = db.query(database.Project).filter(
        database.Project.id == str(wizard_run.project_id),
        database.Project.owner_id == str(current_user.id)
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    create_snapshot(db, project.id, SnapshotTriggerType.AUTO_WIZARD)

    return apply_wizard_result_to_db(
        db, project, wizard_run.phase, wizard_run.wizard_type, wizard_run.result or {}
    )


def apply_wizard_result_to_db(db: Session, project, phase: str, wizard_type: str, result: dict) -> dict:
    """Apply wizard generation results to the database. Reusable by both the apply endpoint and YOLO fill."""

    # Import wizard: populate all phases from imported screenplay
    if wizard_type == "import_and_align":
        return _apply_import_result(db, project, result)

    # Idea wizard: update PhaseData fields directly
    if wizard_type == "idea_wizard":
        fields = result.get("fields", {})
        if not fields:
            return {"status": "success", "message": "No fields to apply"}

        phase_data = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == phase,
            database.PhaseData.subsection_key == "idea_wizard",
        ).first()
        if not phase_data:
            phase_data = database.PhaseData(
                project_id=project.id,
                phase=phase,
                subsection_key="idea_wizard",
                content={},
            )
            db.add(phase_data)
            db.flush()

        existing = dict(phase_data.content or {})
        existing.update(fields)
        phase_data.content = existing
        flag_modified(phase_data, "content")
        db.commit()
        return {"status": "success", "fields_updated": list(fields.keys())}

    items_created = 0

    # Script writer wizard: store screenplays in ScreenplayContent + PhaseData
    if wizard_type == "script_writer_wizard":
        screenplays = result.get("screenplays", [])
        if not screenplays:
            return {"status": "success", "items_created": 0, "message": "No screenplays to apply"}

        phase_data = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == phase,
            database.PhaseData.subsection_key == "screenplay_editor"
        ).first()
        if not phase_data:
            phase_data = database.PhaseData(
                project_id=project.id,
                phase=phase,
                subsection_key="screenplay_editor",
                content={},
            )
            db.add(phase_data)
            db.flush()

        phase_data.content = {"screenplays": screenplays}
        flag_modified(phase_data, "content")

        for sp in screenplays:
            sc = database.ScreenplayContent(
                project_id=project.id,
                content=sp.get("content", ""),
                formatted_content=sp,
            )
            db.add(sc)

        _mark_breakdown_stale(db, project.id)
        _mark_shotlist_stale(db, project.id)
        db.commit()
        return {"status": "success", "items_created": len(screenplays)}

    # Episode/scene wizard: create ListItem records
    if wizard_type == "scene_wizard":
        items_key = "scenes"
        item_type = "scene"
        subsection_key = "scene_list"
    else:
        return {"status": "success", "items_created": 0, "message": "No items to apply for this wizard type"}

    phase_data = db.query(database.PhaseData).filter(
        database.PhaseData.project_id == project.id,
        database.PhaseData.phase == phase,
        database.PhaseData.subsection_key == subsection_key
    ).first()
    if not phase_data:
        phase_data = database.PhaseData(
            project_id=project.id,
            phase=phase,
            subsection_key=subsection_key,
            content={},
        )
        db.add(phase_data)
        db.flush()

    existing_count = db.query(database.ListItem).filter(
        database.ListItem.phase_data_id == phase_data.id
    ).count()

    generated_items = result.get(items_key, [])
    for i, item_data in enumerate(generated_items):
        db_item = database.ListItem(
            phase_data_id=phase_data.id,
            item_type=item_type,
            sort_order=existing_count + i,
            content=item_data,
            status="draft"
        )
        db.add(db_item)
        items_created += 1

    _mark_breakdown_stale(db, project.id)
    _mark_shotlist_stale(db, project.id)
    db.commit()
    return {"status": "success", "items_created": items_created}


def _apply_import_result(db: Session, project, result: dict) -> dict:
    """Apply imported screenplay data across all project phases."""
    counts = {"characters": 0, "scenes": 0, "screenplays": 0, "fields": 0}

    # 1. Idea fields (logline, theme, genre, tone)
    fields = result.get("fields", {})
    if fields:
        idea_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "idea",
            database.PhaseData.subsection_key == "idea_wizard",
        ).first()
        if not idea_pd:
            idea_pd = database.PhaseData(
                project_id=project.id, phase="idea",
                subsection_key="idea_wizard", content={},
            )
            db.add(idea_pd)
            db.flush()
        existing = dict(idea_pd.content or {})
        existing.update(fields)
        idea_pd.content = existing
        flag_modified(idea_pd, "content")
        counts["fields"] = len(fields)

    # 2. Story beats
    story_beats = result.get("story_beats", {})
    if story_beats:
        story_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "story",
            database.PhaseData.subsection_key == "story",
        ).first()
        if not story_pd:
            story_pd = database.PhaseData(
                project_id=project.id, phase="story",
                subsection_key="story", content={},
            )
            db.add(story_pd)
            db.flush()
        existing = dict(story_pd.content or {})
        existing.update(story_beats)
        story_pd.content = existing
        flag_modified(story_pd, "content")

    # 3. Characters
    characters = result.get("characters", [])
    if characters:
        chars_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "story",
            database.PhaseData.subsection_key == "characters",
        ).first()
        if not chars_pd:
            chars_pd = database.PhaseData(
                project_id=project.id, phase="story",
                subsection_key="characters", content={},
            )
            db.add(chars_pd)
            db.flush()
        for i, char in enumerate(characters):
            item_type = char.pop("item_type", "supporting")
            db.add(database.ListItem(
                phase_data_id=chars_pd.id,
                item_type=item_type,
                sort_order=i,
                content=char,
                status="draft",
            ))
            counts["characters"] += 1

    # 4. Scenes
    scenes = result.get("scenes", [])
    if scenes:
        scenes_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "scenes",
            database.PhaseData.subsection_key == "scene_list",
        ).first()
        if not scenes_pd:
            scenes_pd = database.PhaseData(
                project_id=project.id, phase="scenes",
                subsection_key="scene_list", content={},
            )
            db.add(scenes_pd)
            db.flush()
        for i, scene in enumerate(scenes):
            scene_data = {k: v for k, v in scene.items() if k != "screenplay_text"}
            db.add(database.ListItem(
                phase_data_id=scenes_pd.id,
                item_type="scene",
                sort_order=i,
                content=scene_data,
                status="draft",
            ))
            counts["scenes"] += 1

    # 5. Screenplay content
    screenplays = result.get("screenplays", [])
    if screenplays:
        write_pd = db.query(database.PhaseData).filter(
            database.PhaseData.project_id == project.id,
            database.PhaseData.phase == "write",
            database.PhaseData.subsection_key == "screenplay_editor",
        ).first()
        if not write_pd:
            write_pd = database.PhaseData(
                project_id=project.id, phase="write",
                subsection_key="screenplay_editor", content={},
            )
            db.add(write_pd)
            db.flush()
        write_pd.content = {"screenplays": screenplays}
        flag_modified(write_pd, "content")

        for sp in screenplays:
            db.add(database.ScreenplayContent(
                project_id=project.id,
                content=sp.get("content", ""),
                formatted_content=sp,
            ))
            counts["screenplays"] += 1

    _mark_breakdown_stale(db, project.id)
    _mark_shotlist_stale(db, project.id)
    db.commit()
    return {"status": "success", "imported": counts}
