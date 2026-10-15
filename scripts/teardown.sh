#!/usr/bin/env bash
set -euo pipefail

echo "==> two-layer-agent-contract: teardown"

# Preferred: use Docker Compose (handles all containers)
if command -v docker &>/dev/null; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  docker compose -f "$REPO_ROOT/docker-compose.yml" down 2>/dev/null && \
    echo "[ok] Docker Compose stack stopped" && exit 0
fi

# Fallback: stop individual containers and processes
if docker ps --filter name=tlac-gateway --format '{{.Names}}' | grep -q tlac-gateway; then
  docker stop tlac-gateway && echo "[ok] tlac-gateway stopped"
fi

for PORT in 3001 3002 3009; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    echo "[ok] port $PORT cleared"
  fi
done

echo "Teardown complete."
