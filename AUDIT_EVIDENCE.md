# Audit Evidence

Every command executed during the audit and its concise result.  
All commands run against: `/Volumes/Personal/kiro-cli-agentic engineering day-repo/guidance-is-not-policy`  
Stack started with: `docker compose up -d`  

---

## Stack startup

```
docker compose up -d
```
Result: All three containers started and healthy within 10s.
```
NAME                  STATUS
guidance-gateway      Up 10 seconds
guidance-mcp-server   Up 16 seconds (healthy)
guidance-policy       Up 16 seconds (healthy)
```

---

## Health checks

```
curl -sf http://localhost:3001/health
```
Result: `{"status":"ok","tools":["status","deploy","production_admin"]}`

```
curl -sf http://localhost:3002/health
```
Result: `{"status":"ok","mode":"grpc-extmcp"}`

---

## Session initialization

```
INIT=$(curl -si http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}')
SID=$(echo "$INIT" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n')
```
Result: Session ID obtained (base64 encoded JWT-style token)

---

## CASE A — Backend capability surface

```
curl -sf http://localhost:3001/health
```
Result:
```json
{"status":"ok","tools":["status","deploy","production_admin"]}
```
Source: `mcp-server/src/tools.ts` — TOOL_DEFINITIONS array  
Confirms: backend exposes all three tools including production_admin  

---

## CASE B — Gateway-mediated discovery

```
curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```
Result (SSE data line):
```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[
  {"name":"status",...},
  {"name":"deploy",...}
]}}
```
production_admin: ABSENT  
Source: `gateway/config-compose.yaml` mcpAuthorization rules — deploy and status listed, production_admin absent  
Confirms: discovery surface narrowed by mcpAuthorization  

---

## CASE C — Direct production_admin invocation denied

```
curl -s http://localhost:3000/mcp \
  -H ... -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"production_admin","arguments":{"operation":"restart","target":"api"}}}'
```
Result: `{"jsonrpc":"2.0","id":3,"error":{"code":-32603,"message":""}}`  
HTTP status: 200 (MCP uses JSON-RPC errors, not HTTP 4xx)  
Policy log: `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`  
Gateway log: `error="mcp: mcpGuardrails rejected: " reason=MCP`  

```
curl -sf http://localhost:3001/test/log
```
Result: `[]` — backend received zero calls  
Confirms: hidden ≠ denied; direct invocation denied; backend non-receipt verified  

---

## CASE D — Same tool, different authority

```
# Clear log
curl -s -X DELETE http://localhost:3001/test/log

# Staging deploy
curl -s http://localhost:3000/mcp ... \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
```
Result: `{"result":{"content":[{"type":"text","text":"{\"success\":true,\"environment\":\"staging\",...}"}]}}`  
Policy log: `[POLICY] tools/call tool=deploy → Pass`  

```
# Production deploy
curl -s http://localhost:3000/mcp ... \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}'
```
Result: `{"jsonrpc":"2.0","id":5,"error":{"code":-32603,"message":""}}`  
Policy log: `[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface`  

```
curl -sf http://localhost:3001/test/log
```
Result: `[{"tool":"deploy","args":{"environment":"staging","version":"1.2.0"},"timestamp":"2026-10-06T08:10:05.504Z"}]`  
Confirms: staging in log, production absent; argument-sensitive enforcement at policy processor level  

---

## CASE E — Guidance / authority disagreement

```
# No AGENTS.md loaded, no guidance context — pure curl client
curl -s http://localhost:3000/mcp ... \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}'
```
Result: `{"jsonrpc":"2.0","id":6,"error":{"code":-32603,"message":""}}`  
Confirms: production denied regardless of whether guidance exists  
Gateway enforces based on request content alone, not model or guidance state  

---

## CASE F — Fail-closed

```
docker stop guidance-policy
sleep 3
curl -s -w "\nHTTP:%{http_code}" http://localhost:3000/mcp ... \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
```
Result:
```json
{"jsonrpc":"2.0","id":7,"error":{"code":-32603,"message":"mcpGuardrails checkRequest failed: upstream call timeout"}}
HTTP:200
```
Backend log: `[{"tool":"deploy","args":{"environment":"staging","version":"1.2.0"},...}]` — unchanged from Case D, no new entry  
Gateway log: `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`  
Confirms: failClosed — policy processor unavailable = request denied, backend not reached  

```
docker start guidance-policy
sleep 3
curl -sf http://localhost:3002/health
```
Result: `{"status":"ok","mode":"grpc-extmcp"}` — processor restarted successfully  

---

## CASE G — Gateway access log

```
docker logs guidance-gateway 2>&1 | grep "error=" | tail -5
```
Result:
```
error="mcp: mcpGuardrails rejected: " reason=MCP  (production_admin)
error="mcp: mcpGuardrails rejected: " reason=MCP  (deploy production)
error="mcp: mcpGuardrails rejected: " reason=MCP  (deploy production Case E)
error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"  (fail-closed)
```

---

## Policy unit tests

```
cd gateway/extmcp-policy && npm test
```
Result:
```
PASS ./policy.test.ts
Tests: 14 passed, 14 total
```
All 14 unit tests pass including: staging allow, production deny, missing env deny, production_admin deny, status allow, unknown tool allow, failClosed path.

---

## Contract tests against live stack

```
cd contract-tests && \
  GATEWAY_URL=http://localhost:3000 \
  MCP_SERVER_URL=http://localhost:3001 \
  POLICY_URL=http://localhost:3002 \
  npm test
```
Result:
```
PASS ./fail-closed.test.ts
PASS ./arg-sensitive.test.ts
PASS ./denied.test.ts
PASS ./allowed.test.ts
PASS ./hidden.test.ts
Test Suites: 5 passed, 5 total
Tests:       17 passed, 17 total
```

---

## Dependency pins

```
cat mcp-server/package.json | python3 -c "..."  # check for ^ ~ * > <
cat gateway/extmcp-policy/package.json | python3 -c "..."
cat contract-tests/package.json | python3 -c "..."
```
Result: All 23 dependencies across 3 packages show PINNED. No ^ or ~ prefixes found.

---

## Secrets scan

```
grep -r "password\|secret\|token\|api_key\|apikey" --include="*.ts" --include="*.yaml" --include="*.yml" --include="*.json" -l .
```
Result: No files found. No committed secrets.

---

## AGENTS.md coupling check

```
grep -r "import\|require\|source\|agentgateway\|policy\|grpc\|enforce" agents/ AGENTS.md
```
Result: Only human-readable text references. No code imports or reads AGENTS.md files.

```
grep -r "AGENTS\|agents\.md\|guidance" gateway/src/ gateway/extmcp-policy/
```
Result: Only appears in comments and package name strings. No logic references guidance files.

---

## BLOCKING FINDING: Port 3001 gateway bypass

```
# Direct to MCP server, bypassing agentgateway
DIRECT_SID=$(curl -si http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | grep -i "^mcp-session-id:" | awk '{print $2}')

curl -s http://localhost:3001/mcp \
  -H "mcp-session-id: $DIRECT_SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.0.0"}}}'
```
Result:
```json
{"result":{"content":[{"type":"text","text":"{\"success\":true,\"environment\":\"production\",...}"}]}}
```
**ALLOW — gateway completely bypassed. This is a blocking issue.**

---

## BLOCKING FINDING: Empty DENY error message

```
curl -s http://localhost:3000/mcp ... \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.0.0"}}}'
```
Result: `{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":""}}`  
**message is empty string. Policy reason stripped by agentgateway.**  
Policy log shows: `[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface`

---

## Container user check

```
grep -E "USER|user" mcp-server/Dockerfile gateway/extmcp-policy/Dockerfile
```
Result: No output. Neither Dockerfile sets a USER directive. Both containers run as root.

---

## Overclaim scan

```
grep -r "secure\|production.ready\|prevents.*injection\|fully.protected\|guaranteed\|zero.trust\|cannot.be.bypassed\|deterministic.auth" README.md ADOPTING.md SECURITY.md docs/ -i
```
Result: No matches. No overclaims found.

---

## Stack teardown

```
docker compose down
```
Result: All containers stopped and removed. Network removed.
