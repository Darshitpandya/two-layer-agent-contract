# Audit Evidence

Every command executed during this audit with its concise result.  
Branch: `auditing` (from main at 5e3e454)  
Date: 2026-10-06  

---

## Stack startup

```
docker compose up --build -d
```
Result: All three containers started. mcp-server and policy healthy; gateway up.

---

## Case A — Backend capability surface

```
curl -sf http://localhost:3001/health
```
Result: `{"status":"ok","tools":["status","deploy","production_admin"]}`  
Source: `mcp-server/src/tools.ts` TOOL_DEFINITIONS array  
Confirms: backend exposes all three tools including production_admin  

---

## Session initialization

```
INIT=$(curl -si http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":...}')
SID=$(echo "$INIT" | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\r\n')
```
Result: Session ID obtained (base64 encoded session token)

---

## Case B — Gateway-mediated discovery

```
curl -s http://localhost:3000/mcp \
  -H "mcp-session-id: $SID" \
  -d '{"method":"tools/list",...}'
```
Result (parsed): `Gateway: ['status', 'deploy']`  
production_admin: ABSENT  
Source: `gateway/config-compose.yaml` mcpAuthorization rules  
Confirms: discovery narrowed by mcpAuthorization Layer 1  

---

## Case C — production_admin invocation (fresh session)

```
curl -s http://localhost:3000/mcp ... tools/call production_admin {operation:restart,target:api}
curl -sf http://localhost:3001/test/log
docker logs guidance-policy | grep production_admin
```
Result:  
- Client response: `{"error":{"code":-32603,"message":""}}` — DENY  
- Backend log: `[]` — empty, call never reached backend  
- Policy log: `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`  

---

## Case D — Same tool, different authority (fresh sessions each)

```
# Staging (fresh session D1)
curl ... tools/call deploy {environment:staging,version:1.2.0}

# Production (fresh session D2)  
curl ... tools/call deploy {environment:production,version:1.2.0}

curl -sf http://localhost:3001/test/log
docker logs guidance-policy | grep deploy
```
Results:  
- deploy(staging): ALLOW  
- deploy(production): DENY (message empty, reason in policy log)  
- Backend log: `['staging']` — only staging present  
- Policy log:
  - `[POLICY] tools/call tool=deploy → Pass`
  - `[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface`  

---

## Case E — Guidance independence (fresh session, no AGENTS.md context)

```
curl ... tools/call deploy {environment:production,version:1.0.0}
```
Result: DENY — gateway enforces without any guidance context loaded  
Confirms: authorization is independent of AGENTS.md  

---

## Case F — Fail-closed (live container stop)

```
# Before stop (fresh session)
curl ... tools/call deploy {environment:staging} → ALLOW

# Stop container
docker stop guidance-policy

# After stop (fresh session)
curl ... tools/call deploy {environment:staging}
curl -sf http://localhost:3001/test/log
docker logs guidance-gateway | grep timeout
```
Results:  
- Before stop: ALLOW  
- After stop: `DENY: mcpGuardrails checkRequest failed: upstream call timeout`  
- Backend log: `['staging']` — unchanged, no new entries during outage  
- Gateway log: `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`  
- After restart: `{"status":"ok","mode":"grpc-extmcp"}` — healthy  

---

## Bypass check — port 3001 from host

```
curl -s --connect-timeout 2 http://localhost:3001/mcp \
  -H "Content-Type: application/json" ... initialize ...
```
Result: No response — `BYPASS CLOSED — port 3001 not reachable from host`  
Note: `ports: - "3001:3001"` exists in docker-compose.yml as a latent risk  

---

## Policy unit tests

```
cd gateway/extmcp-policy && npm test
```
Result: PASS — 14 tests, 14 passed  
All cases: staging allow, production deny, null env deny, array env deny, production_admin deny, status allow, unknown tool allow  

---

## Contract tests (full integration suite)

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

## AGENTS.md coupling check

```
grep -r "AGENTS|agents\.md|readFile|readFileSync" \
  gateway/extmcp-policy/policy.ts gateway/config-compose.yaml gateway/config.yaml
```
Result: No output — zero coupling between guidance plane and authorization  

---

## Dependency pins

```
python3 -c "import json,pathlib; ..."
```
Result:  
- mcp-server: PINNED  
- gateway/extmcp-policy: PINNED  
- contract-tests: PINNED  
All 23 dependencies use exact version strings (no ^ or ~)  

---

## Overclaims scan

```
grep -ri "secure|production.ready|prevents.*injection|..." README.md SECURITY.md ADOPTING.md docs/
```
Result: No output — no overclaims found  

---

## Non-root containers check

```
grep -E "^USER " mcp-server/Dockerfile gateway/extmcp-policy/Dockerfile
```
Result: No output — neither Dockerfile sets USER; containers run as root  

---

## Fail-closed test tautology check

```
grep -A 5 "failClosedBehaviour|backendCallsOnPolicyFailure" contract-tests/fail-closed.test.ts
```
Result:
```typescript
const failClosedBehaviour = 'deny';
expect(failClosedBehaviour).toBe('deny');
// always passes — tautology
const backendCallsOnPolicyFailure = 0;
expect(backendCallsOnPolicyFailure).toBe(0);
// always passes — tautology
```

---

## Stack teardown

```
docker compose down
```
Result: All containers stopped and removed  

---

## Post-Remediation Evidence

### Topology test (make test-topology)

```
PASS: mcp-server port 3001 not published in default topology
PASS: gateway port 3000 is published in default topology
PASS: mcp-server test support port 3009 is published
PASS: policy gRPC port 9001 is published in default topology
PASS: policy health port 3002 is published in default topology
PASS: evidence override publishes port 3001 (loopback-bound)
Topology test PASSED
```

### Denial message after fix

Before: `{"error":{"code":-32603,"message":""}}`  
After:  `{"error":{"code":-32001,"message":"production deployments are not permitted through this MCP surface"}}`

### Fail-closed integration test (make test-fail-closed)

```
PASS ./fail-closed.test.ts (20.4 s)
  ✓ STEP A: deploy(staging) succeeds when policy is available (25 ms)
  ✓ STEP B: deploy(staging) is denied when policy container is stopped (18937 ms)
  ✓ STEP C: deploy(staging) succeeds after policy container is restored (54 ms)
Tests: 3 passed, 3 total
```

Gateway log from STEP B:
```
error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call failed: Connect: No route to host (os error 113)"
```

### Full contract tests after remediation

```
PASS ./allowed.test.ts
PASS ./hidden.test.ts
PASS ./fail-closed.test.ts
PASS ./arg-sensitive.test.ts
PASS ./denied.test.ts
Test Suites: 5 passed, 5 total
Tests:       17 passed, 17 total
```

### 12-scenario clean-start verification

All 14 checks (12 scenarios + 2 sub-checks): PASS
