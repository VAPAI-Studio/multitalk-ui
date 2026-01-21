#!/bin/bash

# Usage: ./runbackend.sh [port]
# Default port is 8000

# Load Homebrew PATH (macOS)
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null

PORT=${1:-8000}

cd "$(dirname "$0")/backend"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip3 install -r requirements.txt
python3 -m uvicorn main:app --reload --port $PORT
