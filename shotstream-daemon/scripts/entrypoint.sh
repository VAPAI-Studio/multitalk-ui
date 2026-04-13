#!/usr/bin/env bash
set -euo pipefail

# Sanity-check that the volumes are mounted — clearer error than a Python
# stack trace when someone forgets to configure D:\shotstream.
if [[ ! -f "${SHOTSTREAM_CONFIG}" ]]; then
  echo "[entrypoint] WARNING: ${SHOTSTREAM_CONFIG} not found."
  echo "[entrypoint]   Make sure D:\\shotstream\\ckpts is mounted to /workspace/ckpts"
  echo "[entrypoint]   and contains shotstream.yaml + shotstream_merged.pt."
fi
if [[ ! -d "/workspace/wan_models" ]]; then
  echo "[entrypoint] WARNING: /workspace/wan_models not mounted."
  echo "[entrypoint]   Mount D:\\shotstream\\wan_models (Wan2.1-T2V-1.3B)."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 9100 "$@"
