#!/usr/bin/env bash
#
# run-lab.sh — start the full two-layer-agent-contract lab stack and run contract tests
#
# This script is an alternative to the Makefile workflow.
# For the standard demo workflow, use:
#
#   make up       — start Docker Compose stack
#   make session  — initialize MCP session
#   make verify   — run full verification suite
#
# This script starts services directly (without Docker Compose) and is useful
# when Docker Compose is not available or for CI environments.
#
# Prerequisites: Node.js 22+, Docker
#
# Usage:
#   ./scripts/run-lab.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== two-layer-agent-contract lab stack ==="
echo ""
echo "  Guidance plane:    AGENTS.md"
echo "  Enforcement plane: agentgateway v1.5.0 + ExtMCP policy processor"
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
  if docker ps --filter name=tlac-gateway --format '{{.Names}}' 2>/dev/null | grep -q tlac-gateway; then
    docker stop tlac-gateway >/dev/null 2>&1 || true
  fi
  echo "Lab stopped."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Start services
# ---------------------------------------------------------------------------

echo "Starting services..."

# Lab MCP server (streamable HTTP, port 3001 internal + port 3009 test support)
MCP_HTTP_PORT=3001 TEST_SUPPORT_PORT=3009 \
  node "$REPO_ROOT/mcp-server/dist/http-server.js" &
MCP_PID=$!
echo "  [ok] MCP server PID=$MCP_PID (port 3001 internal, port 3009 test support)"

# ExtMCP gRPC policy processor (port 9001 gRPC, port 3002 health)
POLICY_GRPC_PORT=9001 POLICY_HTTP_PORT=3002 FAILURE_MODE=failClosed \
  node "$REPO_ROOT/gateway/extmcp-policy/dist/policy.js" &
POLICY_PID=$!
echo "  [ok] ExtMCP policy PID=$POLICY_PID (gRPC port 9001, health port 3002)"

sleep 1

# agentgateway v1.5.0 via Docker (port 3000)
echo "  [..] Starting agentgateway v1.5.0..."
docker run --rm -d \
  --name tlac-gateway \
  -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -v "$REPO_ROOT/gateway/config.yaml:/config.yaml:ro" \
  ghcr.io/agentgateway/agentgateway:v1.5.0 \
  -f /config.yaml >/dev/null

sleep 3
echo "  [ok] agentgateway v1.5.0 (port 3000)"
echo ""
echo "Stack running:"
echo "  Gateway:           http://localhost:3000/mcp"
echo "  Policy health:     http://localhost:3002/health"
echo "  MCP test support:  http://localhost:3009/health"
echo ""
echo "==> Running contract tests"
echo ""

(cd "$REPO_ROOT/contract-tests" && \
  GATEWAY_URL=http://localhost:3000 \
  MCP_SERVER_URL=http://localhost:3009 \
  POLICY_URL=http://localhost:3002 \
  npm test) || true

echo ""
echo "Stack still running. Press Ctrl-C to stop."
echo ""

wait
