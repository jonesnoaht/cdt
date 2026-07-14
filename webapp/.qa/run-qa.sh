#!/bin/bash
cd "$(dirname "$0")/.."
export PGHOST=127.0.0.1 PGPORT=55435
./node_modules/.bin/tsx src/server/main.ts > /tmp/qa-api.log 2>&1 &
API_PID=$!
./node_modules/.bin/vite --port 5199 --strictPort > /tmp/qa-vite.log 2>&1 &
VITE_PID=$!
echo "$API_PID $VITE_PID" > /tmp/qa-pids
wait
