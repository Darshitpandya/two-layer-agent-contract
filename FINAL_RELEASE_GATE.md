# Final Release Gate

**Branch:** auditing  
**Date:** 2026-10-06  
**Method:** Independent clean-start verification of the three remediated findings.  
No prior audit conclusions trusted. All claims verified by live execution.

---

## Default Topology

**PASS**

Port 3001 (MCP protocol) is not reachable from the host in the default topology.

Evidence:
```
curl --connect-timeout 3 http://localhost:3001/mcp ... → no response (connection refused)
```

Gateway on port 3000 accepts MCP sessions and enforces all policies.

Test-support port 3009 is accessible and serves only `/health` and `/test/log` — no MCP protocol access.

Topology test confirms via static config inspection:
```
PASS: mcp-server port 3001 not published in default topology
PASS: gateway port 3000 is published in default topology
PASS: mcp-server test support port 3009 is published (health + call log only)
```

agentgateway is the sole MCP ingress in the default topology.

---

## Evidence Topology

**PASS**

Direct backend access requires explicit invocation of the evidence overlay:
```
docker compose -f docker-compose.yml -f docker-compose.evidence.yml up --build
```

Evidence mode binds port 3001 to loopback only (`127.0.0.1:3001:3001`).

Verified:
- Default stack: port 3001 refused
- Evidence stack (after explicit opt-in): `curl http://127.0.0.1:3001/mcp` → session obtained
- Direct `tools/list` via port 3001: `['status', 'deploy', 'production_admin']` — all three visible
- `docker-compose.evidence.yml` contains prominent WARNING that this topology intentionally bypasses agentgateway and must not be used in production

Topology test confirms evidence overlay publishes port 3001:
```
PASS: evidence override publishes port 3001 (loopback-bound)
```

---

## Denial Observability

**PASS**

`deploy(environment="production")` now produces three observable facts:

**CLIENT — non-empty denial message:**
```json
{"error":{"code":-32001,"message":"production deployments are not permitted through this MCP surface"}}
```

**POLICY — actual runtime decision in logs:**
```
[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface
```

**BACKEND — zero production deploy calls received:**
```
backend received 0 production deploy calls
```

Same verified for `production_admin`:
- Client message: `"production_admin is not available to this identity"`
- Backend: 0 calls received

Root cause that was fixed: `policy.ts` was sending `{status_code, body}` instead of `{code, reason}` — the wrong field names for the `AuthorizationError` proto message. After fix, agentgateway correctly maps the `reason` field to the JSON-RPC `message` field in the client response.

---

## Fail-Closed Runtime Proof

**PASS**

Three-step sequence executed with unique version markers:

**STEP A — policy available:**
- `deploy(staging, GATE-FC-A-...)` → ALLOW
- Backend log: `backend-received` ✓

**STEP B — policy container stopped:**
- `docker stop guidance-policy` executed — container actually stopped
- Policy health endpoint unreachable confirmed before test
- `deploy(staging, GATE-FC-B-...)` → `DENY: mcpGuardrails checkRequest failed: upstream call timeout`
- Backend log: `backend-empty` ✓
- Gateway log: `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`

**STEP C — policy restored:**
- `docker start guidance-policy` executed
- Policy health confirmed before retry
- `deploy(staging, GATE-FC-C-...)` → ALLOW
- Backend log: `backend-received` ✓

Sequence: `available→ALLOW` / `stopped→DENY+empty` / `restored→ALLOW` — all three confirmed.

---

## Test Integrity

**PASS**

`fail-closed.test.ts` inspected for all specified failure modes:

**Tautological assertions:** None found. Zero `expect('constant').toBe('constant')` patterns.

**Mocks replacing runtime components:** None. Zero `jest.mock`, `jest.fn`, `mockReturnValue` calls.

**Silent skips:** None. The `return;` statements at lines 46/48 are inside the `waitForHealth()` polling helper — early-return on loop condition, not test-skip. The three test bodies have no silent skip paths.

**False-positive branches:** None. `beforeAll` throws (not skips) when Docker is unavailable or stack is not running.

**Assertions against constants:** None. All assertions reference runtime-observed values:
- `response.error` / `response.result` — from actual gateway HTTP call
- `ourCall` — from actual `/test/log` backend log lookup
- `dockerRun('docker stop guidance-policy')` — actual container lifecycle

`docker stop` and `docker start` commands are present and executed against the real container.

---

## Clean Verification

**PASS**

`make verify` executed from clean state (no running containers, freshly built):

```
make verify

Topology test:          6/6 PASS
Policy unit tests:     14/14 PASS
Contract tests:        17/17 PASS
Fail-closed test:       3/3 PASS

All verification checks passed.
make verify exit code: 0
```

Total test count: **37 tests, 37 passed, 0 failed, 0 skipped.**

No undocumented manual steps required. Clean checkout → `make up` → `make verify` is the complete path.

---

## Residual Risks

**Low — Containers run as root**  
Neither `mcp-server/Dockerfile` nor `gateway/extmcp-policy/Dockerfile` sets a `USER` directive. Node processes run as root inside containers. This is a lab environment — not a production deployment. Acceptable for the conference reference implementation. Add `USER node` before production deployment.

**Low — gateway/src/index.ts fallback proxy present**  
A TypeScript MCP proxy exists at `gateway/src/index.ts` but is not used in any runtime path. It is not started by docker-compose or run-lab.sh. The fallback is documented but adds confusion. Remove or move to `gateway/fallback/` in a follow-up.

**Low — No request correlation ID**  
No correlation ID is threaded from the MCP client through the gateway, policy processor, and backend. Policy log lines reference tool names but not request IDs. This is a monitoring gap, not a security gap. Not required for the talk.

**Low — Two gateway configs may diverge**  
`gateway/config.yaml` (for `run-lab.sh`) and `gateway/config-compose.yaml` (for `docker compose`) implement the same policy but are maintained separately. The topology test validates the default compose config only. Suggest consolidating to one config in a follow-up.

**Documentation only — evidence topology warning**  
The `docker-compose.evidence.yml` file contains a prominent WARNING but relies on the operator reading it. There is no technical enforcement preventing someone from using the evidence topology in a production environment. This is appropriate — the responsibility boundary is explicitly documented.

---

## Verdict

**READY FOR CONFERENCE RELEASE**

All six gate criteria pass from a clean independent runtime verification.

The three remediated findings are resolved with executable proof:

1. Default topology: port 3001 unreachable. agentgateway is sole MCP ingress. ✓  
2. Evidence topology: explicit opt-in required. Loopback-bound only. ✓  
3. Denial observability: client message non-empty. Policy reason in logs. Backend non-receipt confirmed. ✓  
4. Fail-closed: actual container stop. Denial confirmed. Backend empty confirmed. Recovery confirmed. ✓  
5. Test integrity: no tautologies, no mocks, no silent skips, no constant assertions. ✓  
6. `make verify` exits 0. 37/37 tests pass. No manual steps. ✓
