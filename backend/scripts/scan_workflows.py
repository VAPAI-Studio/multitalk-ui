#!/usr/bin/env python3
"""
Scan all workflow JSON files and cross-reference against the node registry.

Reports:
  - Which custom node packages are required
  - Which class_types are UNKNOWN (not in registry or built-in list)
  - Which model files are missing from the manifest (with --check-models)

Exit codes:
  0 = all class_types resolved
  1 = unknown class_types found
  2 = error
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Paths relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
WORKFLOWS_DIR = BACKEND_DIR / "workflows"
CONFIG_DIR = BACKEND_DIR / "runpod_config"
REGISTRY_PATH = CONFIG_DIR / "node_registry.json"
MANIFEST_PATH = CONFIG_DIR / "model_manifest.json"

# ComfyUI built-in class_types (ship with core ComfyUI, no custom node needed)
COMFYUI_BUILTINS = {
    "BasicScheduler",
    "CFGGuider",
    "CheckpointLoaderSimple",
    "CLIPLoader",
    "CLIPTextEncode",
    "CLIPVisionEncode",
    "CLIPVisionLoader",
    "ConditioningZeroOut",
    "DualCLIPLoader",
    "EmptyImage",
    "EmptyLatentImage",
    "EmptyLTXVLatentVideo",
    "EmptySD3LatentImage",
    "FluxGuidance",
    "FluxKontextMultiReferenceLatentMethod",
    "FluxKontextImageScale",
    "GetImageSize",
    "ImageCrop",
    "ImageFromBatch",
    "ImageScaleBy",
    "ImageScaleToTotalPixels",
    "ImageToMask",
    "Int",
    "KSampler",
    "KSamplerAdvanced",
    "KSamplerSelect",
    "LatentUpscaleModelLoader",
    "LoadAudio",
    "LoadImage",
    "LoraLoaderModelOnly",
    "ManualSigmas",
    "ModelSamplingAuraFlow",
    "ModelSamplingFlux",
    "ModelSamplingSD3",
    "ModelPatchLoader",
    "PerpNegGuider",
    "PreviewAudio",
    "PreviewImage",
    "RandomNoise",
    "ReferenceLatent",
    "RepeatImageBatch",
    "SamplerCustomAdvanced",
    "SaveImage",
    "TextEncodeQwenImageEditPlus",
    "CFGNorm",
    "UNETLoader",
    "USOStyleReference",
    "VAEDecode",
    "VAEEncode",
    "VAELoader",
}

# File extensions that indicate model files
MODEL_EXTENSIONS = {".safetensors", ".pth", ".ckpt", ".bin", ".onnx"}

# Values to skip when extracting model refs (API models, runtime downloads, etc.)
MODEL_EXCLUSIONS = {
    "gemini-3-pro-image-preview",
    "gemini-3-pro-preview",
    "gemini-2.0-flash",
    "umxl",  # Open-Unmix, downloaded at runtime
}

# Fields commonly holding model references
MODEL_FIELDS = {
    "ckpt_name", "model_name", "unet_name", "vae_name", "lora_name",
    "clip_name", "clip_name1", "clip_name2", "model", "lora",
    "audio_model", "name", "gemma_path",
}


def load_registry() -> dict:
    with open(REGISTRY_PATH) as f:
        return json.load(f)


def load_manifest() -> dict:
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def build_classtype_to_package(registry: dict) -> dict[str, str]:
    """Build reverse map: class_type -> package name."""
    mapping = {}
    for pkg_name, pkg_info in registry.get("packages", {}).items():
        for ct in pkg_info.get("class_types", []):
            mapping[ct] = pkg_name
    return mapping


def find_workflow_files(base_dir: Path, specific: str | None = None) -> list[Path]:
    """Find all .json workflow files, optionally filtering by name."""
    files = []
    for root, _, filenames in os.walk(base_dir):
        for fname in filenames:
            if fname.endswith(".json"):
                if specific and Path(fname).stem != specific:
                    continue
                files.append(Path(root) / fname)
    return sorted(files)


def extract_class_types(workflow: dict) -> set[str]:
    """Extract all class_type values from a workflow JSON."""
    class_types = set()
    for node_id, node_data in workflow.items():
        if isinstance(node_data, dict) and "class_type" in node_data:
            class_types.add(node_data["class_type"])
    return class_types


def extract_model_refs(workflow: dict) -> set[str]:
    """Extract model file references from workflow inputs."""
    refs = set()
    for node_id, node_data in workflow.items():
        if not isinstance(node_data, dict):
            continue
        inputs = node_data.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for key, value in inputs.items():
            if not isinstance(value, str):
                continue
            # Check by field name
            if key in MODEL_FIELDS:
                # Skip template placeholders
                if value.startswith("{{") and value.endswith("}}"):
                    continue
                # Skip excluded values (API models, runtime downloads)
                if value.strip() in MODEL_EXCLUSIONS:
                    continue
                refs.add(value)
                continue
            # Check by file extension
            ext = os.path.splitext(value)[1].lower()
            if ext in MODEL_EXTENSIONS:
                refs.add(value)
    return refs


def workflow_name(path: Path) -> str:
    """Get workflow name relative to workflows dir."""
    rel = path.relative_to(WORKFLOWS_DIR)
    return str(rel.with_suffix(""))


def scan(args) -> dict:
    """Main scan logic. Returns structured results."""
    registry = load_registry()
    ct_to_pkg = build_classtype_to_package(registry)

    workflow_files = find_workflow_files(WORKFLOWS_DIR, args.workflow if hasattr(args, "workflow") else None)
    if not workflow_files:
        print("No workflow files found.", file=sys.stderr)
        sys.exit(2)

    all_class_types: dict[str, list[str]] = {}  # class_type -> [workflow_names]
    all_model_refs: dict[str, list[str]] = {}   # model_ref -> [workflow_names]

    for wf_path in workflow_files:
        try:
            with open(wf_path) as f:
                wf = json.load(f)
        except json.JSONDecodeError as e:
            print(f"WARNING: Invalid JSON in {wf_path}: {e}", file=sys.stderr)
            continue

        wf_name = workflow_name(wf_path)

        for ct in extract_class_types(wf):
            all_class_types.setdefault(ct, []).append(wf_name)

        for ref in extract_model_refs(wf):
            all_model_refs.setdefault(ref, []).append(wf_name)

    # Classify class_types
    builtin = {}
    registered = {}
    unknown = {}
    for ct, workflows in sorted(all_class_types.items()):
        if ct in COMFYUI_BUILTINS:
            builtin[ct] = workflows
        elif ct in ct_to_pkg:
            registered[ct] = {"package": ct_to_pkg[ct], "workflows": workflows}
        else:
            unknown[ct] = workflows

    # Required packages
    required_packages = {}
    for ct, info in registered.items():
        pkg = info["package"]
        if pkg not in required_packages:
            pkg_info = registry["packages"][pkg]
            required_packages[pkg] = {
                "repo": pkg_info["repo"],
                "branch": pkg_info.get("branch"),
                "has_requirements": pkg_info.get("has_requirements", False),
                "matched_class_types": 0,
            }
        required_packages[pkg]["matched_class_types"] += 1

    # Model check
    model_check = None
    if hasattr(args, "check_models") and args.check_models:
        manifest = load_manifest()
        manifest_filenames = set()
        for m in manifest.get("models", []):
            manifest_filenames.add(m["filename"])
            manifest_filenames.add(m["filename"].strip())
            # Also add just the filename without path prefixes
            basename = os.path.basename(m["filename"])
            manifest_filenames.add(basename)
            manifest_filenames.add(basename.strip())

        # Also build a set of normalized manifest filenames (no spaces, forward slashes)
        manifest_normalized = set()
        for m in manifest.get("models", []):
            fn = m["filename"].replace("\\", "/").replace(" ", "")
            manifest_normalized.add(fn)
            manifest_normalized.add(os.path.basename(fn))

        missing_models = {}
        for ref, workflows in sorted(all_model_refs.items()):
            basename = os.path.basename(ref.replace("\\", "/"))
            normalized = ref.replace("\\", "/").strip()
            basename_stripped = basename.strip()
            ref_nospace = ref.replace("\\", "/").replace(" ", "")
            basename_nospace = os.path.basename(ref_nospace)

            found = (
                ref in manifest_filenames
                or ref.strip() in manifest_filenames
                or basename in manifest_filenames
                or basename_stripped in manifest_filenames
                or normalized in manifest_filenames
                # Whitespace-normalized comparison
                or ref_nospace in manifest_normalized
                or basename_nospace in manifest_normalized
                # Also check without directory prefixes
                or any(
                    ref.endswith(m) or m.endswith(basename_stripped)
                    or normalized.endswith(m.replace("\\", "/"))
                    or (os.path.dirname(normalized) and m == os.path.dirname(normalized).split("/")[-1])
                    for m in manifest_filenames
                )
            )
            if not found:
                missing_models[ref] = workflows

        model_check = {
            "manifest_count": len(manifest.get("models", [])),
            "workflow_refs_count": len(all_model_refs),
            "missing_from_manifest": missing_models,
        }

    return {
        "workflows_scanned": len(workflow_files),
        "total_class_types": len(all_class_types),
        "builtin_count": len(builtin),
        "registered_count": len(registered),
        "unknown_count": len(unknown),
        "required_packages": required_packages,
        "unknown_class_types": unknown,
        "model_refs": all_model_refs,
        "model_check": model_check,
    }


def print_report(results: dict):
    """Print human-readable report."""
    print("=" * 60)
    print("  Workflow Scanner Report")
    print("=" * 60)
    print()
    print(f"Workflows scanned: {results['workflows_scanned']}")
    print(f"Unique class_types found: {results['total_class_types']}")
    print(f"  Built-in:    {results['builtin_count']}")
    print(f"  Registered:  {results['registered_count']}")
    print(f"  UNKNOWN:     {results['unknown_count']}")
    print()

    # Required packages
    pkgs = results["required_packages"]
    print(f"--- Required Custom Node Packages ({len(pkgs)}) ---")
    for i, (name, info) in enumerate(sorted(pkgs.items()), 1):
        req = " [+requirements.txt]" if info["has_requirements"] else ""
        print(f"  {i:2d}. {name:<45s} ({info['matched_class_types']} nodes){req}")
    print()

    # Unknown class_types
    unknowns = results["unknown_class_types"]
    if unknowns:
        print(f"--- UNKNOWN class_types ({len(unknowns)}) ---")
        for ct, workflows in sorted(unknowns.items()):
            print(f"  {ct}")
            print(f"     used in: {workflows}")
        print()
        print("  ACTION: Add these class_types to node_registry.json")
        print("          or add them to COMFYUI_BUILTINS in this script.")
        print()
    else:
        print("--- All class_types resolved! ---")
        print()

    # Model check
    mc = results.get("model_check")
    if mc:
        print(f"--- Model Check ---")
        print(f"  Models in manifest:      {mc['manifest_count']}")
        print(f"  Model refs in workflows: {mc['workflow_refs_count']}")
        missing = mc["missing_from_manifest"]
        if missing:
            print(f"  MISSING from manifest:   {len(missing)}")
            print()
            for ref, workflows in sorted(missing.items()):
                print(f"    {ref}")
                print(f"       used in: {workflows}")
            print()
            print("  ACTION: Add missing models to model_manifest.json")
        else:
            print(f"  MISSING from manifest:   0")
            print("  All models accounted for!")
        print()


def main():
    parser = argparse.ArgumentParser(description="Scan ComfyUI workflow files")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    parser.add_argument("--check-models", action="store_true", help="Cross-reference model_manifest.json")
    parser.add_argument("--workflow", type=str, default=None, help="Scan only one workflow by name")
    args = parser.parse_args()

    try:
        results = scan(args)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON: {e}", file=sys.stderr)
        sys.exit(2)

    if args.json:
        # Clean up for JSON output
        output = {k: v for k, v in results.items() if k != "model_refs"}
        print(json.dumps(output, indent=2))
    else:
        print_report(results)

    # Exit code
    if results["unknown_count"] > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
