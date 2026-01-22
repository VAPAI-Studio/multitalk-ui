#!/bin/bash

# Usage: ./runfrontend.sh [backend_port]
# Default backend port is 8000
# Frontend will connect to http://localhost:<backend_port>/api

# Load Homebrew PATH (macOS)
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null

BACKEND_PORT=${1:-8000}

cd "$(dirname "$0")/frontend"
npm install
VITE_API_BASE_URL="http://localhost:$BACKEND_PORT" npm run dev
