#!/bin/bash
source /tmp/mcp_sid.sh
curl -s -X DELETE http://localhost:3001/test/log > /dev/null
echo "=== deploy(environment=staging) ==="
curl -s "http://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
