#!/usr/bin/env bash
#
# run-lab.sh — start the full guidance-is-not-policy lab stack
#
# Stack:
#   Port 3001  Lab MCP server (Node.js, streamable HTTP)
#   Port 9001  ExtMCP gRPC policy processor (Node.js, h2c gRPC)
#   Port 3002  HTTP health for policy processor
#   Port 3000  agentgateway v1.5.0 (Docker)
#
# Prerequisites: Node.js 22+, Docker
#
# Usage:
#   ./scripts/run-lab.sh
#
# To run contract tests separately (stack must already be running):
#   cd contract-tests && npm test
#
# To test fail-closed (policy processor stopped):
#   1. Stop the policy processor: kill $(lsof -ti:9001)
#   2. Attempt a tools/call through the gateway — it should be denied
#   3. See contract-tests/fail-closed.test.ts for the reproducible assertion

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== guidance-is-not-policy lab stack ==="
echo ""
echo "  Layer 1: agentgateway v1.5.0 mcpAuthorization (tool-name control)"
echo "  Layer 2: ExtMCP gRPC processor (argument-sensitive enforcement)"
echo ""

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Install from https://docs.docker.com/get-docker/"
  exit 1
fi

NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required. Found: $(node --version)"
  exit 1
fi

# ---------------------------------------------------------------------------
# Build all Node.js services
# ---------------------------------------------------------------------------

echo "Building services..."
(cd "$REPO_ROOT/mcp-server" && npm install --silent && npm run build --silent)
echo "  [ok] mcp-server"

(cd "$REPO_ROOT/gateway/extmcp-policy" && npm install --silent && npm run build --silent)
echo "  [ok] extmcp-policy"

(cd "$REPO_ROOT/contract-tests" && npm install --silent)
echo "  [ok] contract-tests"
echo ""

# ---------------------------------------------------------------------------
# Cleanup on exit
# ---------------------------------------------------------------------------

cleanup() {
  echo ""
  echo "==> Stopping lab stack..."
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true
  [ -n "${POLICY_PID:-}" ] && kill "$POLICY_PID" 2>/dev/null || true
  if docker ps --filter name=guidance-gateway --format '{{.Names}}' 2>/dev/null | grep -q guidance-gateway; then
    docker stop guidance-gateway >/dev/null 2>&1 || true
  fi
  echo "Lab stopped."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Start Node.js services
# ---------------------------------------------------------------------------

echo "Starting services..."

# Layer 1 backend: Lab MCP server (streamable HTTP, port 3001)
MCP_HTTP_PORT=3001 node "$REPO_ROOT/mcp-server/dist/http-server.js" &
MCP_PID=$!
echo "  [ok] MCP server PID=$MCP_PID (port 3001)"

# Layer 2: ExtMCP gRPC policy processor (h2c gRPC port 9001, HTTP health port 3002)
POLICY_GRPC_PORT=9001 POLICY_HTTP_PORT=3002 FAILURE_MODE=failClosed \
  node "$REPO_ROOT/gateway/extmcp-policy/dist/policy.js" &
POLICY_PID=$!
echo "  [ok] ExtMCP policy PID=$POLICY_PID (gRPC port 9001, health port 3002)"

# Wait for Node services to be ready
sleep 1

# Layer 1 gateway: agentgateway v1.5.0 via Docker (port 3000)
# --add-host: ensure host.docker.internal resolves on Linux (macOS/Windows already have it)
echo "  [..] Starting agentgateway v1.5.0 (Docker)..."
docker run --rm -d \
  --name guidance-gateway \
  -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -v "$REPO_ROOT/gateway/config.yaml:/config.yaml:ro" \
  ghcr.io/agentgateway/agentgateway:v1.5.0 \
  -f /config.yaml >/dev/null

# Wait for gateway to be ready
sleep 3

echo "  [ok] agentgateway v1.5.0 (port 3000)"
echo ""
echo "Stack running:"
echo "  MCP server:        http://localhost:3001"
echo "  Policy processor:  grpc://localhost:9001  (health: http://localhost:3002)"
echo "  Gateway:           http://localhost:3000/mcp"
echo ""
echo "==> Running contract tests"
echo ""

(cd "$REPO_ROOT/contract-tests" && npm test) || true

echo ""
echo "Stack still running. Press Ctrl-C to stop."
echo ""

wait
