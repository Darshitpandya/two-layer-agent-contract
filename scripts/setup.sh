#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"

echo "==> guidance-is-not-policy: setup"
echo ""

# Check prerequisites
check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 is required but not installed."
    echo "       $2"
    exit 1
  fi
}

check_command node "Install Node.js 22+: https://nodejs.org"
check_command npm "Comes with Node.js"
check_command docker "Install Docker: https://docs.docker.com/get-docker/"

NODE_VERSION=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required. Found: $(node --version)"
  exit 1
fi

echo "[ok] node $(node --version)"
echo "[ok] npm $(npm --version)"
echo "[ok] docker $(docker --version | head -1)"
echo ""

# Install dependencies
for pkg in mcp-server gateway/extmcp-policy contract-tests; do
  echo "==> Installing $pkg"
  (cd "$ROOT/$pkg" && npm install --silent)
  echo "[ok] $pkg"
done

echo ""

# Build TypeScript
for pkg in mcp-server gateway/extmcp-policy; do
  echo "==> Building $pkg"
  (cd "$ROOT/$pkg" && npm run build --silent)
  echo "[ok] $pkg built"
done

echo ""
echo "Setup complete. Run ./scripts/run-lab.sh to start the lab."
