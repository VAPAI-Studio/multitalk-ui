#!/bin/bash

# Usage: ./runbackend.sh [port]
# Default port is 8000

# Load Homebrew PATH (macOS)
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null

PORT=${1:-8000}

cd "$(dirname "$0")/backend"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    python -m venv venv
fi

# Activate venv — Scripts/ on Windows, bin/ on macOS/Linux
if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port $PORT
