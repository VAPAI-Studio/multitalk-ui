import json
from pathlib import Path
from typing import Dict, List, Optional
import copy

_TEMPLATE_DIR = Path(__file__).parent
_cache: Dict[str, dict] = {}  # cleared on reload


def _resolve_refs(config: dict) -> dict:
    """Resolve $ref entries in phases to shared config files."""
    for phase in config.get("phases", []):
        if "$ref" in phase:
            ref_path = _TEMPLATE_DIR / phase["$ref"]
            if ref_path.exists():
                with open(ref_path) as rf:
                    ref_data = json.load(rf)
                # Keep id and order from the referencing phase, merge rest from referenced file
                phase_id = phase.get("id")
                phase_order = phase.get("order")
                phase.update(ref_data)
                if phase_id:
                    phase["id"] = phase_id
                if phase_order is not None:
                    phase["order"] = phase_order
                del phase["$ref"]
    return config


def get_template(template_id: str) -> dict:
    """Load and cache a template config by ID."""
    if template_id not in _cache:
        path = _TEMPLATE_DIR / f"{template_id}.json"
        if not path.exists():
            raise ValueError(f"Template '{template_id}' not found")
        with open(path) as f:
            config = json.load(f)
        config = _resolve_refs(config)
        _cache[template_id] = config
    return copy.deepcopy(_cache[template_id])


def list_templates() -> List[dict]:
    """Return summary list of all available templates."""
    templates = []
    for json_file in sorted(_TEMPLATE_DIR.glob("*.json")):
        with open(json_file) as f:
            config = json.load(f)
        templates.append({
            "id": config["id"],
            "name": config["name"],
            "description": config["description"],
            "icon": config.get("icon", "file-text"),
        })
    return templates


def get_template_subsections(template_id: str) -> List[dict]:
    """Get flat list of all phase+subsection keys for a template (used when creating a project)."""
    config = get_template(template_id)
    subsections = []
    for phase in config.get("phases", []):
        for i, sub in enumerate(phase.get("subsections", [])):
            subsections.append({
                "phase": phase["id"],
                "subsection_key": sub["key"],
                "sort_order": i,
            })
    return subsections
