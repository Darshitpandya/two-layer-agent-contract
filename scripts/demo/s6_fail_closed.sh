#!/bin/bash
source /tmp/mcp_sid.sh
echo "=== Stopping policy processor ==="
docker stop guidance-policy
sleep 3
echo ""
echo "=== deploy(staging) with policy processor stopped ==="
curl -s "http://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
echo ""
echo "=== Restarting policy processor ==="
docker start guidance-policy
sleep 3
curl http://localhost:3002/health
