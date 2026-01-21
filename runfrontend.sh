#!/bin/bash
cd "$(dirname "$0")/frontend"
# Use temporary cache to avoid permission issues
npm run dev --cache /tmp/npm-cache
