#!/usr/bin/env python3
"""
Generate a Dockerfile with all required custom node installations.

Reads the dockerfile.template and replaces the auto-generated section
with git clone + pip install commands for every required package.

Usage:
  python generate_dockerfile.py                     # Print to stdout
  python generate_dockerfile.py --output Dockerfile  # Write to file
  python generate_dockerfile.py --force              # Ignore unknown class_types
"""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
CONFIG_DIR = BACKEND_DIR / "runpod_config"
TEMPLATE_PATH = CONFIG_DIR / "dockerfile.template"
REGISTRY_PATH = CONFIG_DIR / "node_registry.json"

# Import scanner logic
sys.path.insert(0, str(SCRIPT_DIR))
from scan_workflows import scan, WORKFLOWS_DIR


START_MARKER = "# --- AUTO-GENERATED CUSTOM NODES START ---"
END_MARKER = "# --- AUTO-GENERATED CUSTOM NODES END ---"


def generate_install_block(required_packages: dict, registry: dict) -> str:
    """Generate the Dockerfile RUN commands for custom node installation."""
    lines = [
        START_MARKER,
        "# DO NOT EDIT between these markers. Run: python scripts/generate_dockerfile.py",
        f"# Generated from node_registry.json ({len(required_packages)} packages)",
        "",
    ]

    for pkg_name in sorted(required_packages.keys()):
        pkg_info = registry["packages"][pkg_name]
        repo = pkg_info["repo"]
        branch = pkg_info.get("branch")
        has_reqs = pkg_info.get("has_requirements", False)

        # Git clone command
        clone_cmd = f"git clone {repo} {pkg_name}"
        if branch:
            clone_cmd = f"git clone --branch {branch} {repo} {pkg_name}"

        lines.append(f"RUN cd /comfyui/custom_nodes && \\")
        lines.append(f"    {clone_cmd}")

        # pip install requirements if needed
        if has_reqs:
            lines.append(f"RUN cd /comfyui/custom_nodes/{pkg_name} && \\")
            lines.append(f"    pip install -r requirements.txt --no-cache-dir")

        lines.append("")

    lines.append(END_MARKER)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Generate Dockerfile with custom node installs")
    parser.add_argument("--output", type=str, default=None, help="Write to file instead of stdout")
    parser.add_argument("--force", action="store_true", help="Proceed even if unknown class_types exist")
    args = parser.parse_args()

    # Load registry
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    # Run scanner to find required packages
    class ScanArgs:
        json = False
        check_models = False
        workflow = None

    scan_results = scan(ScanArgs())

    if scan_results["unknown_count"] > 0 and not args.force:
        print("ERROR: Unknown class_types found. Fix these first or use --force:", file=sys.stderr)
        for ct, workflows in scan_results["unknown_class_types"].items():
            print(f"  {ct} -> {workflows}", file=sys.stderr)
        sys.exit(1)

    # Load template
    if not TEMPLATE_PATH.exists():
        print(f"ERROR: Template not found: {TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(2)

    template = TEMPLATE_PATH.read_text()

    # Check markers exist
    if START_MARKER not in template or END_MARKER not in template:
        print("ERROR: Template missing START/END markers", file=sys.stderr)
        sys.exit(2)

    # Generate the install block
    install_block = generate_install_block(scan_results["required_packages"], registry)

    # Replace between markers
    start_idx = template.index(START_MARKER)
    end_idx = template.index(END_MARKER) + len(END_MARKER)
    result = template[:start_idx] + install_block + template[end_idx:]

    # Output
    if args.output:
        Path(args.output).write_text(result)
        pkg_count = len(scan_results["required_packages"])
        print(f"Dockerfile written to {args.output} ({pkg_count} custom node packages)")
    else:
        print(result)


if __name__ == "__main__":
    main()
