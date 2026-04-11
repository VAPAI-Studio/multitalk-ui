"""Snapshot serialization and deserialization service.

Provides create_snapshot() and deserialize_snapshot() as module-level functions
for creating full-copy snapshots of project writing state (PhaseData, ListItems,
ScreenplayContent) and reconstructing them from stored JSONB blobs.
"""

import json
import logging
from typing import List, Optional, Set
from uuid import UUID

from sqlalchemy.orm import Session, joinedload, undefer

from screenwriter.models.database import (
    Project, PhaseData, ListItem, ScreenplayContent,
    ProjectSnapshot, SnapshotTriggerType,
)

logger = logging.getLogger(__name__)


def _serialize_phase_data(pd: PhaseData) -> dict:
    """Serialize a PhaseData row with nested ListItems."""
    return {
        "id": str(pd.id),
        "project_id": str(pd.project_id),
        "phase": pd.phase.value if hasattr(pd.phase, 'value') else pd.phase,
        "subsection_key": pd.subsection_key,
        "content": pd.content or {},
        "ai_suggestions": pd.ai_suggestions or {},
        "sort_order": pd.sort_order or 0,
        "list_items": [_serialize_list_item(li) for li in pd.list_items],
    }


def _serialize_list_item(li: ListItem) -> dict:
    """Serialize a ListItem row."""
    return {
        "id": str(li.id),
        "phase_data_id": str(li.phase_data_id),
        "item_type": li.item_type,
        "sort_order": li.sort_order or 0,
        "content": li.content or {},
        "ai_suggestions": li.ai_suggestions or {},
        "status": li.status or "draft",
    }


def _serialize_screenplay_content(sc: ScreenplayContent) -> dict:
    """Serialize a ScreenplayContent row."""
    return {
        "id": str(sc.id),
        "project_id": str(sc.project_id),
        "list_item_id": str(sc.list_item_id) if sc.list_item_id else None,
        "content": sc.content or "",
        "formatted_content": sc.formatted_content or {},
        "version": sc.version or 1,
    }


def create_snapshot(
    db: Session,
    project_id,
    trigger_type: SnapshotTriggerType,
    label: Optional[str] = None,
) -> ProjectSnapshot:
    """Create a full-copy snapshot of project writing state.

    Serializes all PhaseData (with nested ListItems) and ScreenplayContent
    rows into a versioned JSONB blob.

    Args:
        db: SQLAlchemy session (synchronous)
        project_id: Project UUID or string to snapshot
        trigger_type: What triggered this snapshot (manual, auto_wizard, auto_yolo, pre_restore)
        label: Optional human-readable label

    Returns:
        The created ProjectSnapshot row
    """
    # Eager-load list_items to avoid N+1
    phase_data_rows = (
        db.query(PhaseData)
        .options(joinedload(PhaseData.list_items))
        .filter(PhaseData.project_id == str(project_id))
        .all()
    )

    screenplay_rows = (
        db.query(ScreenplayContent)
        .filter(ScreenplayContent.project_id == str(project_id))
        .all()
    )

    # Build version envelope
    data = {
        "version": 1,
        "phase_data": [_serialize_phase_data(pd) for pd in phase_data_rows],
        "screenplay_content": [_serialize_screenplay_content(sc) for sc in screenplay_rows],
    }

    # Compute metadata
    total_list_items = sum(len(pd.list_items) for pd in phase_data_rows)
    blob_json = json.dumps(data)
    metadata = {
        "phase_data_count": len(phase_data_rows),
        "list_item_count": total_list_items,
        "screenplay_count": len(screenplay_rows),
        "blob_bytes": len(blob_json.encode("utf-8")),
    }

    snapshot = ProjectSnapshot(
        project_id=str(project_id),
        label=label,
        trigger_type=trigger_type.value if hasattr(trigger_type, 'value') else trigger_type,
        data=data,
        metadata_=metadata,
        version=1,
    )
    db.add(snapshot)
    db.flush()

    logger.info(
        "Created %s snapshot for project %s: %d phases, %d items, %d screenplay, %d bytes",
        trigger_type.value if hasattr(trigger_type, 'value') else trigger_type,
        project_id,
        metadata["phase_data_count"],
        metadata["list_item_count"],
        metadata["screenplay_count"],
        metadata["blob_bytes"],
    )

    return snapshot


def deserialize_snapshot(snapshot: ProjectSnapshot) -> dict:
    """Reconstruct the full data structure from a snapshot blob.

    Converts string UUIDs back to UUID objects for downstream use.

    Args:
        snapshot: ProjectSnapshot row with data blob

    Returns:
        Dict with 'version', 'phase_data' (list of dicts with UUID objects),
        and 'screenplay_content' (list of dicts with UUID objects).
    """
    data = snapshot.data
    if not data:
        return {"version": 1, "phase_data": [], "screenplay_content": []}

    result = {
        "version": data.get("version", 1),
        "phase_data": [],
        "screenplay_content": [],
    }

    for pd in data.get("phase_data", []):
        deserialized_pd = {
            "id": UUID(pd["id"]),
            "project_id": UUID(pd["project_id"]),
            "phase": pd["phase"],
            "subsection_key": pd["subsection_key"],
            "content": pd.get("content", {}),
            "ai_suggestions": pd.get("ai_suggestions", {}),
            "sort_order": pd.get("sort_order", 0),
            "list_items": [],
        }
        for li in pd.get("list_items", []):
            deserialized_pd["list_items"].append({
                "id": UUID(li["id"]),
                "phase_data_id": UUID(li["phase_data_id"]),
                "item_type": li["item_type"],
                "sort_order": li.get("sort_order", 0),
                "content": li.get("content", {}),
                "ai_suggestions": li.get("ai_suggestions", {}),
                "status": li.get("status", "draft"),
            })
        result["phase_data"].append(deserialized_pd)

    for sc in data.get("screenplay_content", []):
        result["screenplay_content"].append({
            "id": UUID(sc["id"]),
            "project_id": UUID(sc["project_id"]),
            "list_item_id": UUID(sc["list_item_id"]) if sc.get("list_item_id") else None,
            "content": sc.get("content", ""),
            "formatted_content": sc.get("formatted_content", {}),
            "version": sc.get("version", 1),
        })

    return result


def restore_from_snapshot(
    db: Session,
    project_id,
    snapshot: ProjectSnapshot,
    phase_ids: Optional[List[str]] = None,
) -> dict:
    """Restore project writing state from a snapshot.

    Uses UPDATE-over-DELETE strategy to preserve ListItem UUIDs so that
    downstream FK references (Shot.scene_item_id) survive the restore cycle.

    Algorithm:
    1. Create safety snapshot (PRE_RESTORE) before any mutations (always FULL)
    2. Deserialize snapshot data
    3. Compute set differences for each entity type
    4. DELETE/UPDATE/INSERT in FK-safe order
    5. Set staleness flags
    6. Flush (caller commits)

    Args:
        db: SQLAlchemy session (synchronous)
        project_id: Project UUID or string
        snapshot: ProjectSnapshot row with data blob
        phase_ids: Optional list of phase names to restore. If None, restore all.

    Returns:
        Dict with safety_snapshot_id, restored_snapshot_id, and counts
    """
    pid = str(project_id)

    # 1. Create safety snapshot before mutations (always FULL snapshot)
    safety = create_snapshot(db, project_id, SnapshotTriggerType.PRE_RESTORE, label="Before restore")

    # 2. Deserialize target snapshot
    data = deserialize_snapshot(snapshot)

    # 3. Build ID sets from snapshot data
    snap_pd_ids: Set[str] = set()
    snap_li_ids: Set[str] = set()
    snap_sc_ids: Set[str] = set()

    snap_pd_map = {}  # id_str -> phase_data dict
    snap_li_map = {}  # id_str -> list_item dict
    snap_sc_map = {}  # id_str -> screenplay_content dict

    total_list_items = 0
    phase_id_set = set(phase_ids) if phase_ids else None

    for pd_entry in data.get("phase_data", []):
        # If partial restore, skip phases not in the requested set
        if phase_id_set is not None and pd_entry["phase"] not in phase_id_set:
            continue
        pd_id_str = str(pd_entry["id"])
        snap_pd_ids.add(pd_id_str)
        snap_pd_map[pd_id_str] = pd_entry
        for li_entry in pd_entry.get("list_items", []):
            li_id_str = str(li_entry["id"])
            snap_li_ids.add(li_id_str)
            snap_li_map[li_id_str] = li_entry
            total_list_items += 1

    # ScreenplayContent: include entries whose list_item_id is in the filtered LI set,
    # or include all if full restore. SC entries with list_item_id=None are included
    # only on full restore (they are project-level, not phase-associated).
    for sc_entry in data.get("screenplay_content", []):
        sc_li_id = str(sc_entry["list_item_id"]) if sc_entry.get("list_item_id") else None
        if phase_id_set is not None:
            # Only include SC entries linked to a list item being restored
            if sc_li_id is None or sc_li_id not in snap_li_ids:
                continue
        sc_id_str = str(sc_entry["id"])
        snap_sc_ids.add(sc_id_str)
        snap_sc_map[sc_id_str] = sc_entry

    # 4. Query current state
    # For partial restore, scope current queries to affected phases only
    if phase_id_set is not None:
        current_pds = db.query(PhaseData).filter(
            PhaseData.project_id == pid,
            PhaseData.phase.in_(list(phase_id_set)),
        ).all()
    else:
        current_pds = db.query(PhaseData).filter(PhaseData.project_id == pid).all()
    current_pd_ids = {str(pd.id) for pd in current_pds}

    # Get ListItems for current PhaseData scope
    if current_pd_ids:
        current_lis = (
            db.query(ListItem)
            .filter(ListItem.phase_data_id.in_(list(current_pd_ids)))
            .all()
        )
    else:
        current_lis = []
    current_li_ids = {str(li.id) for li in current_lis}

    # Get ScreenplayContent for current ListItem scope (partial) or all (full)
    if phase_id_set is not None:
        if current_li_ids:
            current_scs = db.query(ScreenplayContent).filter(
                ScreenplayContent.project_id == pid,
                ScreenplayContent.list_item_id.in_(list(current_li_ids)),
            ).all()
        else:
            current_scs = []
    else:
        current_scs = db.query(ScreenplayContent).filter(ScreenplayContent.project_id == pid).all()
    current_sc_ids = {str(sc.id) for sc in current_scs}

    # 5. Compute set differences
    pd_to_delete = current_pd_ids - snap_pd_ids
    pd_to_update = current_pd_ids & snap_pd_ids
    pd_to_insert = snap_pd_ids - current_pd_ids

    li_to_delete = current_li_ids - snap_li_ids
    li_to_update = current_li_ids & snap_li_ids
    li_to_insert = snap_li_ids - current_li_ids

    sc_to_delete = current_sc_ids - snap_sc_ids
    sc_to_update = current_sc_ids & snap_sc_ids
    sc_to_insert = snap_sc_ids - current_sc_ids

    # 6. Execute in FK-safe order

    # 6a. DELETE ScreenplayContent rows not in snapshot
    if sc_to_delete:
        db.query(ScreenplayContent).filter(
            ScreenplayContent.id.in_(list(sc_to_delete))
        ).delete(synchronize_session="fetch")

    # 6b. DELETE ListItems not in snapshot (SET NULL on shots, CASCADE on element_scene_links)
    if li_to_delete:
        db.query(ListItem).filter(
            ListItem.id.in_(list(li_to_delete))
        ).delete(synchronize_session="fetch")

    # 6c. DELETE PhaseData rows not in snapshot
    if pd_to_delete:
        db.query(PhaseData).filter(
            PhaseData.id.in_(list(pd_to_delete))
        ).delete(synchronize_session="fetch")

    # 6d. UPDATE existing PhaseData rows
    for pd_id_str in pd_to_update:
        pd_data = snap_pd_map[pd_id_str]
        pd_row = db.query(PhaseData).filter(PhaseData.id == pd_id_str).first()
        if pd_row:
            pd_row.phase = pd_data["phase"]
            pd_row.subsection_key = pd_data["subsection_key"]
            pd_row.content = pd_data["content"]
            pd_row.ai_suggestions = pd_data["ai_suggestions"]
            pd_row.sort_order = pd_data["sort_order"]

    # 6e. INSERT new PhaseData rows
    for pd_id_str in pd_to_insert:
        pd_data = snap_pd_map[pd_id_str]
        new_pd = PhaseData(
            id=pd_id_str,
            project_id=pid,
            phase=pd_data["phase"],
            subsection_key=pd_data["subsection_key"],
            content=pd_data["content"],
            ai_suggestions=pd_data["ai_suggestions"],
            sort_order=pd_data["sort_order"],
        )
        db.add(new_pd)

    # Flush to ensure PhaseData rows exist before ListItem inserts
    db.flush()

    # 6f. UPDATE existing ListItem rows
    for li_id_str in li_to_update:
        li_data = snap_li_map[li_id_str]
        li_row = db.query(ListItem).filter(ListItem.id == li_id_str).first()
        if li_row:
            li_row.phase_data_id = str(li_data["phase_data_id"])
            li_row.item_type = li_data["item_type"]
            li_row.sort_order = li_data["sort_order"]
            li_row.content = li_data["content"]
            li_row.ai_suggestions = li_data["ai_suggestions"]
            li_row.status = li_data["status"]

    # 6g. INSERT new ListItem rows
    for li_id_str in li_to_insert:
        li_data = snap_li_map[li_id_str]
        new_li = ListItem(
            id=li_id_str,
            phase_data_id=str(li_data["phase_data_id"]),
            item_type=li_data["item_type"],
            sort_order=li_data["sort_order"],
            content=li_data["content"],
            ai_suggestions=li_data["ai_suggestions"],
            status=li_data["status"],
        )
        db.add(new_li)

    # Flush to ensure ListItem rows exist before ScreenplayContent inserts
    db.flush()

    # 6h. UPDATE existing ScreenplayContent rows
    for sc_id_str in sc_to_update:
        sc_data = snap_sc_map[sc_id_str]
        sc_row = db.query(ScreenplayContent).filter(ScreenplayContent.id == sc_id_str).first()
        if sc_row:
            sc_row.list_item_id = str(sc_data["list_item_id"]) if sc_data["list_item_id"] else None
            sc_row.content = sc_data["content"]
            sc_row.formatted_content = sc_data["formatted_content"]
            sc_row.version = sc_data["version"]

    # 6i. INSERT new ScreenplayContent rows
    for sc_id_str in sc_to_insert:
        sc_data = snap_sc_map[sc_id_str]
        new_sc = ScreenplayContent(
            id=sc_id_str,
            project_id=pid,
            list_item_id=str(sc_data["list_item_id"]) if sc_data["list_item_id"] else None,
            content=sc_data["content"],
            formatted_content=sc_data["formatted_content"],
            version=sc_data["version"],
        )
        db.add(new_sc)

    # 7. Set staleness flags
    project = db.query(Project).filter(Project.id == pid).first()
    if project:
        project.breakdown_stale = True
        project.shotlist_stale = True

    # 8. Flush (caller commits)
    db.flush()

    restored_pd_count = len(snap_pd_map)
    restored_sc_count = len(snap_sc_map)

    logger.info(
        "Restored project %s from snapshot %s: %d phases, %d items, %d screenplay",
        project_id, snapshot.id,
        restored_pd_count,
        total_list_items,
        restored_sc_count,
    )

    # 9. Return result
    return {
        "safety_snapshot_id": str(safety.id),
        "restored_snapshot_id": str(snapshot.id),
        "phase_data_count": restored_pd_count,
        "list_item_count": total_list_items,
        "screenplay_count": restored_sc_count,
    }


def remove_screenplay_content(db: Session, project_id) -> dict:
    """Remove all screenplay content from a project with safety snapshot.

    Creates a safety snapshot before mutations, then:
    1. Deletes all ScreenplayContent rows for the project
    2. Clears write-phase PhaseData content and ai_suggestions
    3. Sets breakdown_stale and shotlist_stale flags on the project

    CRITICAL: Both ScreenplayContent rows AND write-phase PhaseData.content
    must be cleared to avoid stale screenplay reappearing (Pitfall 1).

    Args:
        db: SQLAlchemy session (synchronous)
        project_id: Project UUID or string

    Returns:
        Dict with safety_snapshot_id, removed_screenplay_count, cleared_phase_data_count
    """
    pid = str(project_id)

    # 1. Create safety snapshot before any mutations
    snapshot = create_snapshot(
        db, project_id, SnapshotTriggerType.AUTO_WIZARD,
        label="Before screenplay removal",
    )

    # 2. Delete all ScreenplayContent rows
    removed_count = (
        db.query(ScreenplayContent)
        .filter(ScreenplayContent.project_id == pid)
        .delete(synchronize_session="fetch")
    )

    # 3. Clear write-phase PhaseData content and ai_suggestions
    cleared_count = (
        db.query(PhaseData)
        .filter(PhaseData.project_id == pid, PhaseData.phase == "write")
        .update({"content": {}, "ai_suggestions": {}}, synchronize_session="fetch")
    )

    # 4. Set staleness flags
    project = db.query(Project).filter(Project.id == pid).first()
    if project:
        project.breakdown_stale = True
        project.shotlist_stale = True

    # 5. Flush (caller commits)
    db.flush()

    logger.info(
        "Removed screenplay from project %s: %d ScreenplayContent rows, %d write-phase PhaseData cleared",
        project_id, removed_count, cleared_count,
    )

    return {
        "safety_snapshot_id": str(snapshot.id),
        "removed_screenplay_count": removed_count,
        "cleared_phase_data_count": cleared_count,
    }
