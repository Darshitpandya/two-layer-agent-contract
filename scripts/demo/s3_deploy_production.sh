#!/bin/bash
source /tmp/mcp_sid.sh
echo "=== deploy(environment=production) ==="
curl -s "http://localhost:3000/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}'
