#!/bin/bash
echo "=== Backend call log (what actually reached the MCP server) ==="
curl http://localhost:3001/test/log
