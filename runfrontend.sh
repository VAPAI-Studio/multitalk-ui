#!/bin/bash

# Usage: ./runfrontend.sh [backend_port]
# Default backend port is 8000
# API calls use relative /api path — Vite proxies them to the local backend.
# This works both on localhost AND via the Cloudflare tunnel (applocal.vapai.studio).

# Load Homebrew PATH (macOS)
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null

BACKEND_PORT=${1:-8000}

cd "$(dirname "$0")/frontend"
npm install
# API URL auto-detects from hostname — no env var needed
# applocal.vapai.studio is treated as dev, uses relative /api via Vite proxy
npm run dev
