#!/bin/bash
# Start Mass Unfollow in development mode

echo "Starting Mass Unfollow…"

# Start backend
echo "Starting backend on port 3001…"
cd /home/ubuntu/mass-unfollow/backend
npm run dev &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start frontend
echo "Starting frontend on port 3000…"
cd /home/ubuntu/mass-unfollow/frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Mass Unfollow is running!"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
