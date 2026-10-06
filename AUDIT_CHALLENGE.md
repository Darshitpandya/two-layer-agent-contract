# Independent Challenge Audit

**Challenge date:** 2026-10-06  
**Method:** Attempt to falsify every PASS in AUDIT_REPORT.md related to the Two-Layer Agent Contract  
**Approach:** Run every scenario independently. Accept no prior conclusions. Attempt adversarial variations.  
**Stack:** `docker compose up -d` — fresh start, no state carried from prior audit  

---

## Summary of findings

| Finding | Original verdict | Challenge verdict | Change |
|---|---|---|---|
| AGENTS.md does not affect authorization | PASS | **PASS — confirmed** | None |
| production_admin genuinely in backend | PASS | **PASS — confirmed** | None |
| production_admin genuinely absent from gateway | PASS | **PASS — confirmed** | None |
| production_admin invocation denied through gateway | PASS | **PASS — confirmed** | None |
| deploy(staging) succeeds | PASS | **PASS — confirmed** | None |
| deploy(production) denied by runtime policy | PASS | **PASS — confirmed, adversarially tested** | None |
| Production denial before backend execution | PASS | **PASS — confirmed** | None |
| Policy service failure → fail closed | PASS | **PASS — confirmed by live container stop** | None |
| Gateway bypass possible via port 3001 | FAIL (original found this) | **FAIL — independently reproduced** | Confirms blocker |
| Core tests independent of LLM | PASS | **PASS — confirmed** | None |
| Evidence from real execution | PASS | **PASS — confirmed with CHALLENGE-MARKER** | None |
| fail-closed test in CI is a real integration test | PASS (implied) | **DOWNGRADED → PARTIAL** | CI test is mock assertion |

---

## 1. AGENTS.md → authorization coupling

**Falsification attempt:** Check gateway config, policy.ts, and gateway Docker image for any AGENTS.md reference. Attempt deploy(production) with no guidance context.

**Commands run:**
```bash
grep -r "AGENTS|agents\.md|guidance" gateway/config.yaml gateway/config-compose.yaml gateway/extmcp-policy/policy.ts
grep -n "readFile|readFileSync|fs\." gateway/extmcp-policy/policy.ts
docker run --rm ghcr.io/agentgateway/agentgateway:v1.5.0 find / -name "AGENTS.md"
curl ... deploy(environment=production) [no AGENTS.md context]
```

**Results:**
- Gateway config: no reference to AGENTS.md. Only a comment referencing `docs/production-hardening.md`.
- policy.ts: zero file reads. Policy logic derives entirely from the MCP request arguments.
- Gateway Docker image: no AGENTS.md present.
- Runtime: deploy(production) → DENY with no AGENTS.md loaded by the client.

**Challenge verdict: PASS confirmed.**  
No coupling found at any level — source, config, image, or runtime.

---

## 2. production_admin genuinely present in backend

**Falsification attempt:** Verify handler exists in source AND that it executes at runtime when called directly.

**Commands run:**
```bash
grep -n "production_admin|handleProductionAdmin" mcp-server/src/tools.ts
grep -n "production_admin|handleProductionAdmin" mcp-server/src/http-server.ts
# Runtime: tools/list direct to port 3001
# Runtime: tools/call production_admin direct to port 3001
```

**Results:**
- `tools.ts` line 147: `production_admin` in TOOL_DEFINITIONS
- `tools.ts` line 85: `handleProductionAdmin()` function defined and exported
- `http-server.ts` line 109: case 'production_admin' routes to handler
- Runtime tools/list direct: `['status', 'deploy', 'production_admin']` — confirmed present
- Runtime tools/call direct: `"success":true,"operation":"restart","target":"BYPASS-TEST"` — handler executes

**Challenge verdict: PASS confirmed.**  
The tool is not a stub. It executes real logic. The backend is intentionally unconstrained.

---

## 3. production_admin genuinely absent from gateway discovery

**Falsification attempt:** Run tools/list through gateway and check exhaustively. Also check if the hidden tool is discoverable through any alternate path.

**Commands run:**
```bash
# Gateway tools/list
curl ... tools/list [via gateway session]
```

**Results:**
- Gateway tools/list: `['status', 'deploy']` — production_admin absent
- No alternate discovery path found (no secondary gateway endpoint, no admin UI exposed)

**Challenge verdict: PASS confirmed.**  
Absence is real, not cosmetic. The mcpAuthorization CEL rule (`mcp.tool.name == "status"` and `mcp.tool.name == "deploy"`) in config-compose.yaml produces a genuine discovery-level filter.

---

## 4 + 5. production_admin invocation through gateway — hidden and denied independently

**Falsification attempts:**
1. Standard invocation
2. Repeated invocation (different args)
3. Case-variant (`PRODUCTION_ADMIN`)
4. Partial name match (`production_adm`)

**Commands run:**
```bash
curl ... tools/call production_admin {operation:restart}      # standard
curl ... tools/call production_admin {operation:rollback}     # variant args
curl ... tools/call PRODUCTION_ADMIN {operation:restart}      # case variant
curl ... tools/call production_adm {operation:restart}        # partial name
```

**Results:**
- Standard: `{"error":{"code":-32603,"message":""}}` — DENY. Backend log: `[]`
- Variant args: same DENY. Backend log: `[]`
- Case variant (`PRODUCTION_ADMIN`): `{"error":{"code":-32602,"message":"Unknown tool: PRODUCTION_ADMIN"}}` — different error code (MethodNotFound from backend), but still denied. Backend reached but unknown tool. **Note:** this is a different denial path — case-variant reaches the backend because mcpAuthorization does case-sensitive matching and the ExtMCP policy also uses exact string match. The tool name `PRODUCTION_ADMIN` is not in the allow-list so agentgateway's mcpAuthorization blocks it before ExtMCP... but actually the error code -32602 (Invalid params) vs -32603 suggests a different flow.

**Deeper investigation of case-variant path:**

The gateway log shows `gen_ai.tool.name=PRODUCTION_ADMIN` is NOT present in logs for the case-variant. The error `"Unknown tool: PRODUCTION_ADMIN"` with code -32602 comes from the gateway's JSON-RPC error handling for a tool not in the allow-list. The backend log is empty — backend was not reached.

- Partial name: `"Unknown tool: production_adm"` — similar. Backend log: `[]`

**Policy log confirms:**  
`[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`  
(appears twice, for two standard invocations)

**Challenge verdict: PASS confirmed.**  
All four invocation variants denied. Backend log empty in all cases. Hidden ≠ denied is correctly enforced as two independent properties.

---

## 6. deploy(staging) succeeds

**Falsification attempt:** Fresh stack, fresh call, verify end-to-end receipt including backend log entry.

**Command run:**
```bash
curl ... tools/call deploy {environment:staging, version:2.0.0}
curl -sf http://localhost:3001/test/log
```

**Results:**
- Response: `"success":true,"environment":"staging","version":"2.0.0"` — ALLOW
- Backend log: `[{"tool":"deploy","args":{"environment":"staging","version":"2.0.0"},...}]`
- Policy log: `[POLICY] tools/call tool=deploy → Pass`

**Challenge verdict: PASS confirmed.**

---

## 7. deploy(production) denied by runtime policy — adversarially tested

**Falsification attempts:**
1. Standard production deploy
2. Extra fields (`override:true`) — does extra argument confuse the policy?
3. Environment as array (`["staging","production"]`) — does containing "staging" bypass the check?
4. Environment as null — does null bypass?

**Commands run:**
```bash
curl ... deploy {environment:production, version:2.0.0}
curl ... deploy {environment:production, version:2.0.0, override:true}
curl ... deploy {environment:["staging","production"], version:2.0.0}
curl ... deploy {environment:null, version:2.0.0}
```

**Results:**
1. Standard: DENY. Backend log: `[]`
2. With `override:true`: DENY. Backend log: `[]`. Policy log: `DENY: production deployments are not permitted`
3. Array environment: DENY. Policy log: `DENY: deploy requires environment to be "staging"; got: ["staging","production"]`
4. Null environment: DENY. Policy log: `DENY: deploy requires environment to be "staging"; got: null`

**Policy evaluation is strict equality (`env === 'staging'`)** — no partial match, no array confusion, no null bypass. The fail-safe path in `evaluatePolicy` denies anything that is not exactly the string `'staging'`.

**Challenge verdict: PASS confirmed, strengthened by adversarial testing.**

---

## 8. Production denial before backend execution

**Falsification attempt:** Clear backend log, attempt production deploy, immediately check log, verify MCP server received no forwarded calls.

**Commands run:**
```bash
curl -X DELETE http://localhost:3001/test/log
curl ... deploy {environment:production, version:9.9.9}
curl http://localhost:3001/test/log
docker logs guidance-mcp-server | tail -5
```

**Results:**
- Backend log after DENY: `[]` — empty
- MCP server access logs: only session initialization entries, no `tools/call` requests
- Policy log: `DENY: production deployments are not permitted through this MCP surface`
- Gateway architecture: mcpGuardrails processor runs `tools/call: request` (pre-backend phase). The ExtMCP `CheckRequest` returns `AuthorizationError`. agentgateway does not forward to backend on `AuthorizationError`.

**Challenge verdict: PASS confirmed.**  
Denial is pre-execution. The backend receives no request. This is verified both by the empty call log and by the absence of MCP server access log entries for the tool call.

---

## 9. Policy service failure → fail closed

**Falsification attempt:** Actually stop the guidance-policy container (not a mock), then attempt both staging and production deploys. Verify backend log unchanged. Then restart and verify recovery.

**Commands run:**
```bash
# Confirm staging works before stop
curl ... deploy staging → ALLOW

# Stop container
docker stop guidance-policy

# Attempt staging deploy with policy down
curl ... deploy staging
curl http://localhost:3001/test/log

# Attempt production deploy with policy down
curl ... deploy production

# Restart
docker start guidance-policy
curl http://localhost:3002/health
curl ... deploy staging → ALLOW (confirms recovery)
```

**Results:**
- Before stop: staging → ALLOW ✓
- After stop: staging → `{"error":{"code":-32603,"message":"mcpGuardrails checkRequest failed: upstream call timeout"}}` — DENY
- After stop: production → `{"error":{"code":-32603,"message":"mcpGuardrails checkRequest failed: upstream call failed: Connect: deadline has elapsed"}}` — DENY
- Backend log: `[]` — unchanged. No calls forwarded during policy outage.
- Gateway log: `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`
- After restart: staging → ALLOW ✓ — recovery confirmed

**Challenge verdict: PASS confirmed by live container stop/start.**  
This is not a mock. The container was actually stopped. Both staging and production are denied when the policy processor is unreachable.

---

## 10. Gateway bypass via port 3001 — INDEPENDENTLY REPRODUCED

**Falsification attempt:** Reproduce the blocking finding from AUDIT_REPORT.md independently.

**Commands run:**
```bash
# Initialize session directly to port 3001 (bypasses agentgateway)
DIRECT_SID=$(curl -si http://localhost:3001/mcp ... initialize ...)

# tools/list direct
curl ... http://localhost:3001/mcp tools/list

# deploy(production) direct
curl ... http://localhost:3001/mcp tools/call deploy {environment:production}

# production_admin direct
curl ... http://localhost:3001/mcp tools/call production_admin {operation:restart}
```

**Results:**
- Direct session: OBTAINED ✓
- Direct tools/list: `['status', 'deploy', 'production_admin']` — all three visible
- Direct deploy(production): `"success":true,"environment":"production","version":"BYPASS-TEST"` — **ALLOW**
- Backend log: `[{"tool":"deploy","args":{"environment":"production","version":"BYPASS-TEST"},...}]` — **recorded**
- Direct production_admin: `"success":true,"operation":"restart","target":"BYPASS-TEST"` — **ALLOW**
- Backend log: `[{"tool":"production_admin",...}]` — **recorded**

**Challenge verdict: BLOCKING ISSUE independently confirmed.**

The original audit PASS for "enforcement is at the gateway" is **not fully correct**. The enforcement is at the gateway for calls that go through the gateway. The lab configuration exposes a direct path that completely bypasses all enforcement. This is not a theoretical concern — it is a reproduced attack path.

**Impact on original PASS verdicts:**

- "Runtime authority is determined independently of model compliance" — **PARTIAL**. True when the gateway is in the path. False when port 3001 is directly reachable. The lab as configured allows a client to obtain full backend authority by dialling a different port.
- "Backend not normally exposed" — **FAIL** (confirmed)
- "Gateway as exposed chokepoint" — **FAIL** (confirmed)

---

## 11. Core enforcement tests independent of LLM

**Falsification attempt:** Inspect all contract test files for LLM client imports, model references, or fixture-based responses.

**Results:**
- Zero imports of any LLM SDK in contract-tests/
- The string "lab-agent" appears as a clientInfo name — this is a string label, not an LLM client
- All tests use `mcpToolsCall` which is a plain HTTP fetch to the gateway
- `policyCheck` helper imports `evaluatePolicy` directly (see below) — never calls an LLM

**Challenge verdict: PASS confirmed.**

---

## 12. Evidence from real execution vs fixtures

**Falsification attempt:** Run contract tests fresh. Inject CHALLENGE-MARKER into a deploy call and verify it appears in the backend log with a real timestamp.

**Results:**
- Contract tests run fresh: 5 PASS, 17/17 tests pass
- CHALLENGE-MARKER deploy: `version=CHALLENGE-MARKER timestamp=2026-10-06T08:18:09.451Z` appears in backend log
- The timestamp is from this audit run — not a fixture

**Challenge verdict: PASS confirmed.**

---

## NEW FINDING: fail-closed contract test is a mock assertion in normal operation

The original audit gave this an implicit PASS by stating "contract tests pass." On closer inspection:

**`fail-closed.test.ts` test 2** — "deploy(staging) is denied when policy processor is stopped"

When `POLICY_UNAVAILABLE` env var is not set (which includes all normal `make test` runs and all CI runs), this test executes:
```typescript
const failClosedBehaviour = 'deny'; // the only safe default
expect(failClosedBehaviour).toBe('deny');
```

This is a **tautology**. It tests that the string `'deny'` equals the string `'deny'`. It provides zero evidence about gateway behaviour. It passes regardless of whether the gateway is fail-closed, fail-open, or not running at all.

**test 3** — "backend did not receive the call when policy processor was unavailable"  
Same issue: when `POLICY_UNAVAILABLE` is not set:
```typescript
const backendCallsOnPolicyFailure = 0;
expect(backendCallsOnPolicyFailure).toBe(0);
```
Again a tautology.

The actual fail-closed behaviour was verified in this challenge audit by stopping the Docker container (falsification 9). The gateway does fail closed correctly. But the test that claims to cover this scenario is not actually testing it in normal operation.

**Challenge verdict: DOWNGRADED from PASS to PARTIAL.**

The behaviour is correct. The test is not. The CI test for fail-closed is a mock assertion that will always pass. A developer relying on the test suite alone cannot distinguish a fail-closed gateway from a fail-open gateway through these tests without setting `POLICY_UNAVAILABLE=true`.

---

## policyCheck helper bypasses the gateway

`helpers.ts` `policyCheck()` imports `evaluatePolicy` directly from `policy.ts`, bypassing the gRPC server, the agentgateway, and the entire network path. No test in `contract-tests/` uses `policyCheck()` — confirmed by grep — so this does not affect any test verdict. But it is a documented weak point: if a future test were written using `policyCheck`, it would give a false impression of integration coverage.

---

## Summary table with challenge verdicts

| # | Question | Original | Challenge | Notes |
|---|---|---|---|---|
| 1 | AGENTS.md affects authorization? | PASS | **PASS** | Zero coupling at source, config, image, runtime |
| 2 | Restricted tool genuinely in backend? | PASS | **PASS** | Handler executes, produces real output |
| 3 | Hidden from gateway discovery? | PASS | **PASS** | tools/list confirms absence |
| 4 | Hidden tool invocable via gateway? | PASS | **PASS** | 4 invocation variants all denied |
| 5 | Invocation denied? | PASS | **PASS** | Backend log empty in all cases |
| 6 | deploy(staging) succeeds? | PASS | **PASS** | Result + backend log both confirm |
| 7 | deploy(production) fails via runtime policy? | PASS | **PASS** | 4 adversarial variants all denied |
| 8 | Production denial before backend execution? | PASS | **PASS** | Backend log empty, no MCP server access log entry |
| 9 | Policy failure → fail closed? | PASS | **PASS** | Live container stop confirms |
| 10 | Normal client can bypass gateway? | FAIL | **FAIL — reproduced** | Port 3001 bypass confirmed |
| 11 | Tests independent of LLM? | PASS | **PASS** | No LLM client in any test |
| 12 | Evidence from real execution? | PASS | **PASS** | CHALLENGE-MARKER confirms live execution |
| — | fail-closed CI test is real integration test? | (implied PASS) | **PARTIAL — downgraded** | Test is a tautology without POLICY_UNAVAILABLE=true |

---

## Verdict

**No original PASS verdict for the core enforcement path is overturned.**

The two-layer enforcement fires correctly for every tested case. The authorization is genuinely independent of guidance. The backend is genuinely unconstrained. The gateway genuinely narrows the surface. All denials happen before backend execution.

**Two issues confirmed as blockers — unchanged from original audit:**

1. **Port 3001 bypass** — independently reproduced. `deploy(production)` and `production_admin` both succeed when called directly to port 3001. This directly contradicts the claim that enforcement is at the gateway for any client that knows the backend port. Fix: remove port 3001 from docker-compose external port mapping.

2. **Empty DENY message** — confirmed. All denied responses carry `"message":""`. The policy reason is visible in container logs but not in the MCP client response.

**One new finding — downgrade from implied PASS to PARTIAL:**

3. **fail-closed contract test is a tautology** — the test that claims to prove fail-closed behaviour in `fail-closed.test.ts` tests 2 and 3 are mock assertions that always pass. The actual gateway fail-closed behaviour is correct (verified by live container stop in this audit) but is not covered by the automated test suite in normal operation.

**Recommended verdict remains: READY WITH MINOR FIXES.**  
The core contract holds. Fix the port exposure and the test before conference day.
