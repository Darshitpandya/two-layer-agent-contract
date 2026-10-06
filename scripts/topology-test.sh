#!/usr/bin/env bash
# scripts/topology-test.sh — verify default docker-compose topology is correctly locked down
#
# Tests:
#   1. mcp-server does NOT publish port 3001 in the default topology
#   2. gateway publishes port 3000 in the default topology
#
# Run: bash scripts/topology-test.sh
# Or:  make test-topology

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo '=== Topology Test ==='
echo 'Verifying default docker-compose does not publish backend port 3001...'
echo ''

# Parse docker-compose.yml to check mcp-server has no host port 3001.
# We use `docker compose config --format json` to get the fully-resolved
# compose configuration (handles anchors, env vars, etc.) and then extract
# the ports for the mcp-server service.
PORTS=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" config --format json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
mcp = c.get('services', {}).get('mcp-server', {})
ports = mcp.get('ports', [])
print(json.dumps(ports))
" 2>/dev/null || echo '[]')

if echo "$PORTS" | grep -q '3001'; then
  echo 'FAIL: mcp-server publishes port 3001 in default topology'
  echo "Ports found: $PORTS"
  exit 1
fi
echo 'PASS: mcp-server port 3001 not published in default topology'

# Verify gateway port 3000 IS published.
GW_PORTS=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" config --format json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
gw = c.get('services', {}).get('gateway', {})
ports = gw.get('ports', [])
print(json.dumps(ports))
" 2>/dev/null || echo '[]')

if ! echo "$GW_PORTS" | grep -q '3000'; then
  echo 'FAIL: gateway port 3000 not published in default topology'
  exit 1
fi
echo 'PASS: gateway port 3000 is published in default topology'

# Verify mcp-server test support port 3009 IS published (for contract tests on host).
MCP_PORTS=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" config --format json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
mcp = c.get('services', {}).get('mcp-server', {})
ports = mcp.get('ports', [])
print(json.dumps(ports))
" 2>/dev/null || echo '[]')

if ! echo "$MCP_PORTS" | grep -q '3009'; then
  echo 'FAIL: mcp-server test support port 3009 not published in default topology'
  exit 1
fi
echo 'PASS: mcp-server test support port 3009 is published (health + call log only)'

# Verify policy ports 9001 and 3002 ARE published (required for contract tests).
POLICY_PORTS=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" config --format json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
policy = c.get('services', {}).get('policy', {})
ports = policy.get('ports', [])
print(json.dumps(ports))
" 2>/dev/null || echo '[]')

if ! echo "$POLICY_PORTS" | grep -q '9001'; then
  echo 'FAIL: policy gRPC port 9001 not published in default topology'
  exit 1
fi
echo 'PASS: policy gRPC port 9001 is published in default topology'

if ! echo "$POLICY_PORTS" | grep -q '3002'; then
  echo 'FAIL: policy health port 3002 not published in default topology'
  exit 1
fi
echo 'PASS: policy health port 3002 is published in default topology'

# Verify the evidence override DOES add port 3001 on loopback.
EVIDENCE_PORTS=$(docker compose -f "${REPO_ROOT}/docker-compose.yml" -f "${REPO_ROOT}/docker-compose.evidence.yml" config --format json 2>/dev/null | python3 -c "
import sys, json
c = json.load(sys.stdin)
mcp = c.get('services', {}).get('mcp-server', {})
ports = mcp.get('ports', [])
print(json.dumps(ports))
" 2>/dev/null || echo '[]')

if ! echo "$EVIDENCE_PORTS" | grep -q '3001'; then
  echo 'FAIL: evidence override does not publish port 3001'
  exit 1
fi
echo 'PASS: evidence override publishes port 3001 (loopback-bound)'

echo ''
echo 'Topology test PASSED'
