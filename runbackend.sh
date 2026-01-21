#!/bin/bash

# Usage: ./runbackend.sh [port]
# Default port is 8000

PORT=${1:-8000}

cd "$(dirname "$0")/backend"
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
python3 -m uvicorn main:app --reload --port $PORT
