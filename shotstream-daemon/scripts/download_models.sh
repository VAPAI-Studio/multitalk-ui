#!/usr/bin/env bash
# Linux equivalent of download_models.ps1.
set -euo pipefail

ROOT="${SHOTSTREAM_MODELS_DIR:-/mnt/data/shotstream}"
echo "Using models dir: $ROOT"

for t in git git-lfs; do
  command -v "$t" >/dev/null 2>&1 || { echo "$t is required. Install it first." >&2; exit 1; }
done

git lfs install >/dev/null

mkdir -p "$ROOT/outputs" "$ROOT/hf_cache"

clone_if_missing() {
  local url="$1" dest="$2"
  if [[ -d "$dest" ]]; then
    echo "[skip] $dest already exists"
    return
  fi
  echo "[clone] $url -> $dest"
  git clone "$url" "$dest"
}

clone_if_missing https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B "$ROOT/wan_models"
clone_if_missing https://huggingface.co/KlingTeam/ShotStream   "$ROOT/ckpts"

echo
echo "Done. Sizes:"
du -sh "$ROOT"/* 2>/dev/null || true

for f in "$ROOT/ckpts/shotstream.yaml" "$ROOT/ckpts/shotstream_merged.pt"; do
  [[ -f "$f" ]] || echo "WARNING: missing $f — check the HF repo for the actual filename."
done

cat <<EOF

Next:
  1) cp shotstream-daemon/.env.example shotstream-daemon/.env
     (adjust SHOTSTREAM_MODELS_DIR to $ROOT)
  2) cd shotstream-daemon && docker compose up --build
EOF
