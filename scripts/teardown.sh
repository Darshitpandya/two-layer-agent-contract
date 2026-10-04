#!/usr/bin/env bash
set -euo pipefail

echo "==> guidance-is-not-policy: teardown"

# Stop gateway container
if docker ps --filter name=guidance-gateway --format '{{.Names}}' | grep -q guidance-gateway; then
  docker stop guidance-gateway
  echo "[ok] gateway stopped"
else
  echo "[skip] gateway not running"
fi

# Kill any node processes on our ports
for PORT in 3001 3002; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    echo "[ok] port $PORT cleared"
  fi
done

echo "Teardown complete."
