#!/bin/bash
# Start backend + frontend + Cloudflare tunnel in parallel
# Access via https://applocal.vapai.studio from any device on any network

echo "Starting multitalk-ui local dev stack..."
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  Tunnel:   https://applocal.vapai.studio"
echo ""

# Start backend in background
bash "$(dirname "$0")/runbackend.sh" &
BACKEND_PID=$!

# Give backend a moment to start
sleep 3

# Start frontend in background
VITE_API_BASE_URL="/api" bash -c "cd '$(dirname "$0")/frontend' && npm run dev" &
FRONTEND_PID=$!

# Give frontend a moment to start
sleep 3

# Start Cloudflare tunnel
cloudflared tunnel --config "C:/Users/PC/.cloudflared/vapai-local-config.yml" run &
TUNNEL_PID=$!

echo ""
echo "All services started. Press Ctrl+C to stop everything."
echo ""

# Wait and clean up on exit
trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID $TUNNEL_PID 2>/dev/null" EXIT
wait
