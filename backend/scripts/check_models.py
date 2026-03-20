#!/usr/bin/env python3
"""
Check model requirements from the model manifest.

Reports all models needed, grouped by workflow, with download commands.

Usage:
  python check_models.py                     # Full report
  python check_models.py --summary           # Just totals
  python check_models.py --download-script   # Shell script with download commands
  python check_models.py --workflow NAME     # Show models for one workflow only
  python check_models.py --missing           # Cross-ref workflows and show unregistered models
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CONFIG_DIR = BACKEND_DIR / "runpod_config"
MANIFEST_PATH = CONFIG_DIR / "model_manifest.json"


def load_manifest() -> dict:
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def print_full_report(manifest: dict, workflow_filter: str | None = None):
    """Print full model report, optionally filtered by workflow."""
    models = manifest.get("models", [])

    if workflow_filter:
        models = [m for m in models if workflow_filter in m.get("used_by", [])]
        if not models:
            print(f"No models found for workflow: {workflow_filter}")
            return

    # Calculate totals
    total_size = sum(m.get("size_gb") or 0 for m in models)
    known_size = sum(1 for m in models if m.get("size_gb"))
    hf_count = sum(1 for m in models if m.get("source"))
    manual_count = len(models) - hf_count

    print("=" * 60)
    print("  Model Manifest Report")
    print("=" * 60)
    print()
    print(f"Total models: {len(models)}")
    print(f"Estimated storage: ~{total_size:.1f} GB ({known_size} of {len(models)} sizes known)")
    print(f"With HuggingFace URL: {hf_count}")
    print(f"Manual upload needed: {manual_count}")
    print()

    # Group by type
    by_type: dict[str, list] = {}
    for m in models:
        mtype = m.get("type", "unknown")
        by_type.setdefault(mtype, []).append(m)

    print("--- By Type ---")
    for mtype in sorted(by_type.keys()):
        type_models = by_type[mtype]
        type_size = sum(m.get("size_gb") or 0 for m in type_models)
        print(f"\n  {mtype} ({len(type_models)} models, ~{type_size:.1f} GB):")
        for m in type_models:
            size_str = f"{m['size_gb']:.1f} GB" if m.get("size_gb") else "? GB"
            source_str = "HF" if m.get("source") else "manual"
            print(f"    {m['filename']:<60s} ({size_str}, {source_str})")
            print(f"      path: {m.get('path', '?')}")
            print(f"      used by: {m.get('used_by', [])}")

    # Group by workflow
    print()
    print("--- By Workflow ---")
    all_workflows = set()
    for m in models:
        for wf in m.get("used_by", []):
            all_workflows.add(wf)

    for wf in sorted(all_workflows):
        if workflow_filter and wf != workflow_filter:
            continue
        wf_models = [m for m in models if wf in m.get("used_by", [])]
        wf_size = sum(m.get("size_gb") or 0 for m in wf_models)
        print(f"\n  {wf} ({len(wf_models)} models, ~{wf_size:.1f} GB):")
        for m in wf_models:
            size_str = f"{m['size_gb']:.1f} GB" if m.get("size_gb") else "? GB"
            print(f"    - {m['filename']:<55s} ({size_str})")


def print_summary(manifest: dict):
    """Print just the totals."""
    models = manifest.get("models", [])
    total_size = sum(m.get("size_gb") or 0 for m in models)
    hf_count = sum(1 for m in models if m.get("source"))
    manual_count = len(models) - hf_count

    print(f"Models: {len(models)} total, {hf_count} with HF URL, {manual_count} manual")
    print(f"Estimated storage: ~{total_size:.1f} GB")

    by_type: dict[str, int] = {}
    for m in models:
        mtype = m.get("type", "unknown")
        by_type[mtype] = by_type.get(mtype, 0) + 1
    for mtype, count in sorted(by_type.items()):
        print(f"  {mtype}: {count}")


def print_download_script(manifest: dict, workflow_filter: str | None = None):
    """Output a shell script to download all models with HuggingFace URLs."""
    models = manifest.get("models", [])

    if workflow_filter:
        models = [m for m in models if workflow_filter in m.get("used_by", [])]

    downloadable = [m for m in models if m.get("source")]
    manual = [m for m in models if not m.get("source")]

    print("#!/bin/bash")
    print("# Auto-generated model download script")
    print(f"# {len(downloadable)} downloadable, {len(manual)} manual")
    print()
    print("# Set MODELS_ROOT to your network volume models directory")
    print('MODELS_ROOT="${MODELS_ROOT:-/runpod-volume/models}"')
    print()

    for m in downloadable:
        path = m.get("path", "")
        filename = m["filename"]
        source = m["source"]
        size_str = f"~{m['size_gb']:.1f} GB" if m.get("size_gb") else "unknown size"

        print(f"# {filename} ({size_str})")
        print(f"# Used by: {', '.join(m.get('used_by', []))}")

        if source.startswith("https://huggingface.co/") and not source.endswith(".safetensors") and not source.endswith(".pth"):
            # This is a HuggingFace repo (multi-file model)
            print(f'mkdir -p "$MODELS_ROOT/{path}"')
            print(f'echo "Downloading {filename} (HF repo - use huggingface-cli)..."')
            repo_id = source.replace("https://huggingface.co/", "")
            print(f'huggingface-cli download {repo_id} --local-dir "$MODELS_ROOT/{path}{filename}"')
        else:
            # Direct file download
            print(f'mkdir -p "$MODELS_ROOT/{path}"')
            print(f'echo "Downloading {filename}..."')
            print(f'wget -c -O "$MODELS_ROOT/{path}{filename}" \\')
            print(f'  "{source}"')
        print()

    if manual:
        print()
        print("# --- MANUAL UPLOAD REQUIRED ---")
        print("# The following models don't have HuggingFace URLs.")
        print("# Upload them manually to the network volume.")
        for m in manual:
            path = m.get("path", "")
            print(f"# - {path}{m['filename']}  (used by: {', '.join(m.get('used_by', []))})")


def check_missing(manifest: dict):
    """Cross-reference workflows to find models not in manifest."""
    # Import scanner
    sys.path.insert(0, str(SCRIPT_DIR))
    from scan_workflows import scan

    class ScanArgs:
        json = False
        check_models = True
        workflow = None

    results = scan(ScanArgs())
    mc = results.get("model_check", {})
    missing = mc.get("missing_from_manifest", {})

    if missing:
        print(f"Found {len(missing)} model references NOT in manifest:")
        print()
        for ref, workflows in sorted(missing.items()):
            print(f"  {ref}")
            print(f"    used in: {workflows}")
        print()
        print("ACTION: Add these to model_manifest.json")
        sys.exit(1)
    else:
        print(f"All model references ({mc.get('workflow_refs_count', 0)}) accounted for in manifest.")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(description="Check model requirements")
    parser.add_argument("--summary", action="store_true", help="Just show totals")
    parser.add_argument("--download-script", action="store_true", help="Output download shell script")
    parser.add_argument("--workflow", type=str, default=None, help="Filter by workflow name")
    parser.add_argument("--missing", action="store_true", help="Show models in workflows but not in manifest")
    args = parser.parse_args()

    if args.missing:
        manifest = load_manifest()
        check_missing(manifest)
        return

    manifest = load_manifest()

    if args.download_script:
        print_download_script(manifest, args.workflow)
    elif args.summary:
        print_summary(manifest)
    else:
        print_full_report(manifest, args.workflow)


if __name__ == "__main__":
    main()
