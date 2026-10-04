#!/usr/bin/env bash
#
# run-lab.sh — start the full guidance-is-not-policy lab stack
#
# Starts three processes:
#   1. MCP server (HTTP)    on port 3001
#   2. Policy processor     on port 3002
#   3. Gateway              on port 3000
#
# Usage:
#   ./scripts/run-lab.sh
#
# To test fail-closed behaviour manually:
#   1. Start the stack with this script.
#   2. Kill only the policy processor (Ctrl-C on that terminal, or kill the process).
#   3. Run: POLICY_UNAVAILABLE=true npm run test:fail-closed --prefix contract-tests
#
# Prerequisites:
#   - Node.js 22+
#   - npm install run in each subdirectory (or run: npm install in each)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== guidance-is-not-policy lab stack ==="
echo "Repo root: $REPO_ROOT"
echo ""

# ---------------------------------------------------------------------------
# Build all services
# ---------------------------------------------------------------------------

echo "Building MCP server..."
cd "$REPO_ROOT/mcp-server"
npm install --silent
npx tsc 2>/dev/null || true  # best-effort; run from dist if src exists

echo "Building policy processor..."
cd "$REPO_ROOT/gateway/extmcp-policy"
npm install --silent
npx tsc 2>/dev/null || true

echo "Building gateway..."
cd "$REPO_ROOT/gateway"
npm install --silent 2>/dev/null || true
npx tsc 2>/dev/null || true

# ---------------------------------------------------------------------------
# Start services in background
# ---------------------------------------------------------------------------

echo ""
echo "Starting services..."

# MCP server (HTTP wrapper)
MCP_HTTP_PORT=3001 node "$REPO_ROOT/mcp-server/dist/http-server.js" &
MCP_PID=$!
echo "  MCP server PID=$MCP_PID (port 3001)"

# Policy processor
PORT=3002 node "$REPO_ROOT/gateway/extmcp-policy/dist/policy.js" &
POLICY_PID=$!
echo "  Policy processor PID=$POLICY_PID (port 3002)"

# Gateway
GATEWAY_PORT=3000 MCP_SERVER_URL=http://localhost:3001 POLICY_URL=http://localhost:3002 \
  node "$REPO_ROOT/gateway/dist/index.js" &
GATEWAY_PID=$!
echo "  Gateway PID=$GATEWAY_PID (port 3000)"

# ---------------------------------------------------------------------------
# Cleanup on exit
# ---------------------------------------------------------------------------

trap 'echo ""; echo "Stopping lab stack..."; kill $MCP_PID $POLICY_PID $GATEWAY_PID 2>/dev/null; echo "Done."; exit 0' INT TERM EXIT

echo ""
echo "Stack running. Press Ctrl-C to stop."
echo ""
echo "Run contract tests in another terminal:"
echo "  cd contract-tests && npm test"
echo ""

# Wait for all background processes
wait
