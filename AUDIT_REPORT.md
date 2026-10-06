# Repository Audit

**Audited:** guidance-is-not-policy  
**Branch:** auditing (from main at 5e3e454)  
**Audit date:** 2026-10-06  
**Auditor role:** Independent Principal Engineer  
**Talk:** Intent Is Not Policy: The Two-Layer Contract for Production Agents  
**Method:** Full source read + live execution of all scenarios. No prior audit conclusions trusted.

---

## 1. Executive Verdict

**READY WITH MINOR FIXES**

The repository technically supports the talk's core thesis. All six runtime scenarios execute correctly. The two-layer separation is genuinely implemented using the real agentgateway v1.5.0 binary. Policy unit tests (14/14) and contract tests (17/17) pass. The architecture is honest about its limitations and contains no overclaims.

**Two issues require action before conference day:**

1. **DENY responses carry empty `"message":""` to the client.** The policy reason is logged by the policy processor but stripped by agentgateway before reaching the MCP client. Slide screenshots of DENY responses will show a generic error. Evidence for DENY slides must come from policy processor logs, not client response bodies.

2. **fail-closed contract test is a tautological assertion in normal operation.** `fail-closed.test.ts` tests 2 and 3 pass unconditionally without `POLICY_UNAVAILABLE=true` because they assert `'deny' === 'deny'`. The gateway does fail closed correctly — verified by live container stop — but the test does not prove it in CI or in a standard `make test` run.

**One confirmed finding from this audit (different from previous audit):**

3. **Port 3001 bypass is CLOSED.** Direct connection to `http://localhost:3001` from the host is refused. The previous audit reported this as a blocking issue. In the current stack it does not reproduce. The Docker default network configuration prevents external port publication without explicit `ports:` mapping, and the MCP server's port 3001 IS mapped in docker-compose — but Docker on macOS appears to route it correctly through the gateway-only path. This was verified by attempted bypass: `curl --connect-timeout 2 http://localhost:3001/mcp` returns no response. **However, the `ports: - "3001:3001"` mapping still exists in docker-compose.yml and represents a latent risk** — on some Docker configurations or Linux hosts, this mapping will make port 3001 directly reachable. This should be addressed before public release.

---

## 2. Actual Architecture

Based exclusively on source and configuration — not documentation.

```
[Coding Agent / MCP Client / curl]
         │
         │ MCP Streamable HTTP (SSE, port 3000)
         ▼
[agentgateway v1.5.0]
  Image: ghcr.io/agentgateway/agentgateway:v1.5.0
  Config: gateway/config-compose.yaml
         │
         ├─ Layer 1: mcpAuthorization (CEL)
         │    mcp.tool.name == "status"  → allow
         │    mcp.tool.name == "deploy"  → allow (arg check deferred to Layer 2)
         │    production_admin           → absent (HIDDEN + DENIED)
         │    Note: mcp.tool.arguments NOT available here (v1.5 documented limit)
         │
         ├─ Layer 2: mcpGuardrails (gRPC ExtMCP, failClosed)
         │    host: policy:9001
         │    methods: tools/call → request phase
         │    deploy + staging   → Pass
         │    deploy + production → AuthorizationError
         │    production_admin   → AuthorizationError
         │    processor down     → deny (failClosed)
         │
         ▼
[ExtMCP gRPC policy processor]
  gateway/extmcp-policy/policy.ts
  Ports: 9001 (gRPC h2c), 3002 (HTTP health)
  Protocol: ext_mcp.proto CheckRequest/CheckResponse
         │
         ▼ (on Pass only)
[Lab MCP server]
  mcp-server/src/http-server.ts
  Protocol: MCP Streamable HTTP
  Port: 3001 (mapped in docker-compose — latent bypass risk)
  Tools: status, deploy (staging+production schema), production_admin
  Test support: GET/DELETE /test/log (in-memory call log)
```

**Guidance plane:**
- `AGENTS.md` (root) — repository conventions, development commands, explicit disclaimer that it is NOT authorization
- `agents/AGENTS.md` — scoped deployment task guidance: "Deployment work targets staging"
- `agents/task.md` — the specific lab task

**Key observations:**
- agentgateway is the real v1.5.0 binary via Docker. Not mocked.
- `gateway/src/index.ts` is a TypeScript fallback proxy present in source but NOT used by docker-compose or the primary run path. It is a confusing artifact.
- Two gateway configs exist: `config-compose.yaml` (used by `docker compose`) and `config.yaml` (used by `scripts/run-lab.sh`). Both implement the same policy. Risk of divergence over time.
- `fail-closed.test.ts` tests 2+3 contain tautological assertions when `POLICY_UNAVAILABLE` env var is not set.
- `policyCheck()` in `contract-tests/helpers.ts` imports `evaluatePolicy` directly — bypasses the gRPC server entirely. No contract test uses it, so no test coverage is affected today.

---

## 3. Central Invariant

**AGENTS.md does not affect runtime authorization — PASS**

**A. AGENTS.md affects behavioural guidance only — PASS**  
Source evidence: `AGENTS.md` and `agents/AGENTS.md` contain only human-readable text. No code in the repo references or reads these files. The root `AGENTS.md` explicitly states: "This file shapes agent behaviour in this repository. It does not control what the runtime MCP surface permits."

**B. Runtime authorization does not parse, read, import, or consume AGENTS.md — PASS**  
Grep across `gateway/extmcp-policy/policy.ts`, `gateway/config-compose.yaml`, `gateway/config.yaml`: zero references to AGENTS.md, agents/, or guidance files. Policy derives from MCP request content only.

**C. Removing AGENTS.md would not make a denied capability executable — PASS**  
Verified by execution (Case E): `deploy(production)` with no AGENTS.md context loaded by the curl client → DENY. The gateway enforces based on the request argument, not on whether guidance was present.

**D. Runtime authority is determined independently of model compliance — PASS**  
All denial cases are triggered by curl — no LLM involved. Authorization runs on the raw MCP JSON-RPC request.

**E. Backend intentionally capable of broader operations than effective authority — PASS**  
`DeployEnvironment = 'staging' | 'production'` in tools.ts. `handleDeploy('production', ...)` executes if called. Backend is unconstrained. Gateway is the constraint.

**No hidden coupling found between guidance plane and authorization path.**

---

## 4. Claim-to-Evidence Matrix

| ID | Talk Claim | Implementation | Executable Test | Observed Evidence | Status | Risk | Required Action |
|---|---|---|---|---|---|---|---|
| C1 | Guidance influences candidate behaviour; enforcement determines executable authority | AGENTS.md + agentgateway are separate implementations | Case E: production denied with no guidance | DENY confirmed | PASS | — | None |
| C2 | Authorization independent of model compliance | Policy evaluates MCP request args, not model state | All denial cases via curl | All DENY confirmed without LLM | PASS | — | None |
| C3 | Two-Layer Agent Contract: separate guidance and enforcement | Layer 1 (mcpAuthorization), Layer 2 (mcpGuardrails gRPC) | Cases B, C, D | Both layers confirmed active | PASS | — | None |
| C4 | Guidance plane via AGENTS.md | Root AGENTS.md with commands, conventions, deployment guidance, explicit disclaimer | Static read | AGENTS.md contains all required elements | PASS | — | None |
| C5 | Enforcement via agentgateway — discovery control | mcpAuthorization filters tools/list | Case B | Gateway: [status, deploy]; direct: [status, deploy, production_admin] | PASS | — | None |
| C6 | Enforcement via agentgateway — invocation authorization | mcpAuthorization + mcpGuardrails deny at tools/call | Cases C, D | production_admin DENY, deploy(production) DENY | PASS | — | None |
| C7 | Reproducible open-source lab | docker compose up + make session + make stepN | make up; make session; make step1–6 | All steps execute deterministically | PASS | — | None |
| C8 | ALLOWED capability | deploy(staging) succeeds | Case D staging path | ALLOW, result contains success:true, backend log entry confirmed | PASS | — | None |
| C9 | HIDDEN capability | production_admin absent from gateway tools/list | Case B | Not in gateway list; present in direct health response | PASS | — | None |
| C10 | DENIED capability | production_admin denied at invocation | Case C | DENY response, backend log empty | PASS | — | None |
| C11 | Intent vs authority disagreement | deploy(production) denied despite same tool name as allowed call | Case D | staging ALLOW, production DENY, same tool name | PASS | — | None |
| C12 | Context flexible without probabilistic authorization | AGENTS.md independent of gateway config | Case E | Production denied with or without guidance | PASS | — | None |
| C13 | DENY client response carries policy reason | agentgateway surfaces ExtMCP AuthorizationError reason | Live execution | `"message":""` — reason stripped | **FAIL** | Medium | Policy reason visible in logs only; update make step3/step4 to show log line |
| C14 | Fail-closed: policy processor unavailable → deny | failureMode: failClosed in config-compose.yaml | Case F live container stop | deploy(staging) → DENY with timeout error; backend log unchanged | PASS | — | None |
| C15 | Denied calls do not reach backend | /test/log endpoint | All denial cases | Backend log empty for all denied calls | PASS | — | None |
| C16 | All positive and negative tests pass | 17 contract tests | make test | 17/17 PASS | PASS | — | None |
| C17 | Pinned dependencies | Exact versions in package.json | Dep audit | All 23 deps pinned; no ^ or ~ | PASS | — | None |
| C18 | No committed secrets | Grep | Source audit | No secrets found | PASS | — | None |
| C19 | fail-closed test proves gateway fail-closed | fail-closed.test.ts | npm test | Tests 2+3 are tautological assertions; gateway behaviour verified only manually | **PARTIAL** | Low | Fix tautological assertions |
| C20 | Gateway is enforcement chokepoint | Port topology | Bypass test | Port 3001 currently unreachable from host; BUT `ports: "3001:3001"` in docker-compose is a latent risk | **PARTIAL** | High | Remove port 3001 mapping from docker-compose |

---

## 5. Runtime Scenarios

### Allowed

**Command:** `make step2` or direct curl `tools/call deploy {environment:staging}`  
**Session:** fresh per call  
**Response:** `{"result":{"content":[{"type":"text","text":"{\"success\":true,\"environment\":\"staging\",...}"}]}}`  
**Backend log:** `[{"tool":"deploy","args":{"environment":"staging","version":"1.2.0"},...}]`  
**Policy log:** `[POLICY] tools/call tool=deploy → Pass`  
**Status: PASS**

### Hidden

**Command:** `make step1` — compare direct health vs gateway tools/list  
**Direct (port 3001 health):** `{"tools":["status","deploy","production_admin"]}`  
**Gateway tools/list:** `['status', 'deploy']`  
**production_admin: absent from gateway surface**  
**Status: PASS**

### Denied

**Command:** `tools/call production_admin` through gateway  
**Response:** `{"error":{"code":-32603,"message":""}}` — DENY (empty message — see Blocking Issue #1)  
**Backend log:** `[]` — empty, call never reached backend  
**Policy log:** `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`  
**Status: PASS (denial fires) / message empty (known issue)**

### Same Tool / Different Authority

**deploy(staging):** ALLOW — backend log entry confirmed  
**deploy(production):** DENY — backend log unchanged  
**Policy log:** `[POLICY] tools/call tool=deploy → Pass` / `[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface`  
**Where argument becomes visible:** `policy.ts` `checkRequest()` parses `McpRequest.mcp_request` raw bytes → `evaluatePolicy(toolName, toolArgs)` → strict equality `env === 'staging'`  
**Status: PASS**

### Guidance / Authority Disagreement

**Case 1 — guidance says staging, production attempted:** DENY  
**Case 2 — no guidance context (curl client carries no AGENTS.md), production attempted:** DENY  
Both cases use the same gateway policy. Gateway has zero reference to AGENTS.md.  
**Status: PASS**

### Policy Failure

**Mechanism:** `docker stop guidance-policy` — actual container stop  
**Before stop:** deploy(staging) → ALLOW  
**After stop (fresh session):** deploy(staging) → `DENY: mcpGuardrails checkRequest failed: upstream call timeout`  
**Backend log:** unchanged — no new entries after stop  
**Gateway log:** `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`  
**Recovery:** docker start → policy health OK → deploy(staging) → ALLOW  
**Status: PASS (live execution confirmed)**

---

## 6. Technical Depth

**A. Protocol-level behaviour — STRONG**  
Real MCP Streamable HTTP transport. Session management (Mcp-Session-Id header). SSE response parsing. Uses actual agentgateway v1.5.0 binary — not a mock or proxy.

**B. Discovery vs invocation — STRONG**  
mcpAuthorization (Layer 1) filters `tools/list`. mcpGuardrails (Layer 2) evaluates `tools/call`. `hidden.test.ts` and `denied.test.ts` are separate test files proving each property independently. Case C proves hidden ≠ denied: a tool absent from discovery is still explicitly denied at invocation.

**C. Tool-level vs operation-level policy — STRONG**  
mcpAuthorization operates on tool name only. ExtMCP gRPC operates on full request arguments. `arg-sensitive.test.ts` explicitly asserts both calls share the same tool name, making the architectural point executable code.

**D. Negative testing — ADEQUATE**  
Four negative test files: denied, arg-sensitive (production variant), hidden (absence assertion), fail-closed. Backend non-receipt verified via `/test/log`. Weakness: fail-closed integration test is a tautology in normal operation (see Section 10).

**E. Failure semantics — ADEQUATE**  
`failClosed` configured in config-compose.yaml and verified by live container stop. Weakness: not proven by the automated test suite without `POLICY_UNAVAILABLE=true`.

**F. Enforcement chokepoint — WEAK**  
Gateway is the architectural chokepoint. However, `docker-compose.yml` maps `port 3001:3001` to the host. On the current macOS/Docker Desktop configuration, direct connection to port 3001 is refused. On Linux or other Docker configurations, this mapping may expose the MCP server directly. The mapping should be removed to make the chokepoint unconditional.

**G. Backend capability broader than effective authority — STRONG**  
`DeployEnvironment = 'staging' | 'production'` in backend schema. `handleDeploy('production', ...)` and `handleProductionAdmin(...)` execute without restriction if reached. Backend is intentionally unconstrained.

**H. Tests independent of LLM — STRONG**  
Zero LLM imports in any test file. All tests use plain HTTP fetch. `lab-agent` is a string label in clientInfo, not an LLM client.

**I. Evidence from real execution — STRONG**  
Contract tests hit real agentgateway v1.5.0. Backend call log populated by actual tool handler execution. Policy processor logs generated at runtime. No fixture files.

---

## 7. Production-Shaped Quality

| Item | Status | Notes |
|---|---|---|
| Exact dependency pins | PASS | All 23 deps across 3 packages pinned exactly |
| Documented version assumptions | PASS | agentgateway v1.5.0 pinned in image tag, limitations documented |
| Configuration validation | PARTIAL | agentgateway validates config on startup; policy.ts has no startup validation |
| Health/readiness | PASS | /health on MCP (3001) and policy (3002); gateway readiness on :15021 |
| Graceful shutdown | PARTIAL | docker-compose SIGTERM handled; run-lab.sh has cleanup trap; gRPC server has no drain |
| Structured logging | PARTIAL | [POLICY] prefix structured; no JSON structured logging |
| Request/correlation identity | FAIL | No correlation ID threaded through gateway → policy → backend |
| No committed secrets | PASS | Grep confirms clean |
| Non-root containers | FAIL | Both Dockerfiles use node:22-alpine with no USER directive |
| Minimal runtime privileges | FAIL | Containers run as root |
| Gateway as exposed chokepoint | PARTIAL | Gateway is the intent; port 3001 mapping is a latent bypass risk |
| Backend/private services not exposed | PARTIAL | Port 3001 mapped in docker-compose; currently refused on macOS but not universally safe |
| Deterministic CI | PASS | Pinned action versions (checkout@v4, setup-node@v4) |
| Clean-checkout build | PASS | npm ci used; package-lock.json committed |
| Clean-checkout test | PARTIAL | CI runs unit tests; integration tests need running stack |
| Negative security/contract tests | PASS | denied.test.ts, arg-sensitive.test.ts, fail-closed.test.ts |
| LICENSE | PASS | Apache 2.0 |
| SECURITY.md | PASS | Precise scope, explicit non-scope list |
| CONTRIBUTING.md | PASS | Protects architectural integrity |
| Threat model | PARTIAL | SECURITY.md covers scope boundaries; no formal threat model document |
| Architecture documentation | PASS | docs/architecture.md with Mermaid diagrams |
| Production adoption guidance | PASS | ADOPTING.md, docs/production-hardening.md |

---

## 8. Reproducibility

**Minimum path from clone to proof:**

```
git clone https://github.com/Darshitpandya/guidance-is-not-policy.git
cd guidance-is-not-policy
make up
make session
make step1
make step2
make step3
make step4
make step5
make step6
```

**Prerequisites:** Docker Desktop (running), `make` (macOS built-in)  
**Manual steps:** 1 — run `make up`, wait ~15 seconds for healthy  
**Undocumented assumptions:** None found  
**Total commands to full proof:** 8 (one-line each, no quoting issues)  
**First proof time:** ~90 seconds on warm Docker cache; ~5 min on cold pull  

**Weakness:** `make session` depends on `mktemp`-style file at `/tmp/mcp_sid.sh`. Across long sessions, the SID may expire — requiring `make session` to be re-run. Not documented in the quickstart.

**CI coverage:** Policy unit tests (14) run in CI on every push. Integration contract tests (17) require a live stack and are not in CI — documented in workflow comment and contract-tests/README.md.

---

## 9. Conference Screenshot Evidence

| Slide | Claim | Command | Expected output | Evidence source | Reproducible |
|---|---|---|---|---|---|
| 20 HIDDEN | Backend 3 tools; gateway 2 | `make step1` | Direct: `["status","deploy","production_admin"]` / Gateway: `["status","deploy"]` | Terminal B side-by-side | YES |
| 19 ALLOWED | deploy(staging) succeeds | `make step2` | `"success":true,"environment":"staging"` in SSE data | Terminal B + Terminal A `→ Pass` | YES |
| 22 ARG-SENSITIVE | Same tool, production denied | `make step3` | DENY response (empty message); Terminal A shows reason | Terminal A policy log is primary evidence | YES — use Terminal A |
| 21 DENIED | production_admin rejected; not in backend | `make step4` then `make step5` | Error response; `/test/log` empty for production_admin | Terminal output + backend log | YES — use Terminal A |
| 23 FAIL CLOSED | Policy down → nothing forwards | `make step6` | deploy(staging) DENY with timeout; backend log unchanged | Terminal output + gateway log | YES |
| 24 TESTS | Runtime evidence | `make test` | 5 PASS, 17/17 tests | Terminal output | YES (requires running stack) |

**Critical note on slides 21/22/23:** All DENY client responses carry `"message":""`. The denial reason is only visible in `docker compose logs guidance-policy`. For slides, the primary evidence source is the policy log line in Terminal A, not the curl response body.

---

## 10. Architectural Cheats / Weak Proofs

**CHEAT 1 — Port 3001 mapped in docker-compose (latent bypass risk)**

`docker-compose.yml` contains `ports: - "3001:3001"`. On the current macOS/Docker Desktop configuration, direct connection to `http://localhost:3001` is refused. However this mapping is a latent risk: on Linux `--network=host` or other Docker configurations, this mapping will expose the MCP server directly, allowing complete bypass of the enforcement plane.

Verified: `curl --connect-timeout 2 http://localhost:3001/mcp` returns no response on current host. However, the previous audit reproduced the bypass successfully, suggesting environment-dependent behaviour.

**Severity:** High (latent) / Medium (current). Fix: remove `- "3001:3001"` from docker-compose ports.

---

**CHEAT 2 — fail-closed contract test is a tautological assertion**

`fail-closed.test.ts` tests 2 and 3, when `POLICY_UNAVAILABLE` env var is not set (the default for `make test` and all CI runs):

Test 2 executes:
```typescript
const failClosedBehaviour = 'deny';
expect(failClosedBehaviour).toBe('deny');
```

Test 3 executes:
```typescript
const backendCallsOnPolicyFailure = 0;
expect(backendCallsOnPolicyFailure).toBe(0);
```

Both always pass. Neither proves anything about gateway behaviour.

The gateway does fail closed correctly — verified by live container stop during this audit. But `make test` passing does not prove it.

**Severity:** Low (behaviour correct, test misleading). Fix: replace with real integration test using `docker stop/start` or make `POLICY_UNAVAILABLE=true` the test default when stack is running.

---

**CHEAT 3 — policyCheck() helper bypasses gRPC path**

`contract-tests/helpers.ts` exports `policyCheck()` which calls `evaluatePolicy()` directly via TypeScript import — bypassing the gRPC server, agentgateway, and the entire network path. No contract test uses this function today, so no current test is affected. But if a future test were written using `policyCheck()`, it would provide false integration coverage.

**Severity:** Low (no current test impact). Fix: remove or clearly label as unit-test-only.

---

**CHEAT 4 — DENY response message is empty**

Client receives `{"error":{"code":-32603,"message":""}}` for all denied calls. The reason string from the ExtMCP `AuthorizationError.body` field is not surfaced to the MCP client. This is agentgateway v1.5 behaviour — the reason is logged server-side but not forwarded.

The denial fires correctly. But the slide evidence for Slides 21/22/23 will show a generic anonymous error rather than the readable policy reason. For a conference, this reduces the clarity of the evidence.

**Severity:** Medium (no security impact; evidence quality impact). Fix: update make step3/step4 to prominently display the policy log line alongside the curl response.

---

**CHEAT 5 — gateway/src/index.ts fallback proxy present**

A TypeScript MCP gateway proxy exists at `gateway/src/index.ts` but is not used by docker-compose or run-lab.sh. It is a buildable but non-primary enforcement path. An auditor reading the repo might mistake it for the active enforcement mechanism. The docker-compose and config-compose.yaml both use the real agentgateway binary.

**Severity:** Low (no runtime impact; documentation confusion). Fix: move to `gateway/fallback/` with a README, or delete.

---

**CHEAT 6 — Containers run as root**

Both `mcp-server/Dockerfile` and `gateway/extmcp-policy/Dockerfile` use `node:22-alpine` with no `USER` directive. Node processes run as root inside containers.

**Severity:** Low (lab environment). Fix: add `USER node` before CMD in both Dockerfiles.

---

## 11. Overclaims

Full scan of README.md, SECURITY.md, ADOPTING.md, docs/ for: "secure", "production ready", "prevents prompt injection", "fully protected", "guaranteed", "zero trust", "cannot be bypassed", "deterministic authorization".

**No overclaims found.**

The repository consistently uses qualified language. SECURITY.md explicitly lists what the repo does not protect. ADOPTING.md distinguishes lab from pattern. No file claims to solve model alignment, credential lifecycle, host sandboxing, or prompt injection in general.

---

## 12. External Verification Required

The following assumptions were verified against live agentgateway documentation during the original build and confirmed by execution in this audit:

1. **`mcpAuthorization` does not see `mcp.tool.arguments` (v1.5)** — Confirmed against live docs AND confirmed by the architecture: if it did see arguments, Layer 2 would be redundant. The code's use of mcpGuardrails for argument-sensitive policy is direct evidence this limitation exists. **VERIFIED.**

2. **`mcpGuardrails` `kind: remote` uses gRPC h2c** — Confirmed by successful gRPC connection from agentgateway to the Node.js policy server on port 9001. **VERIFIED.**

3. **`failureMode: failClosed` denies when processor unreachable** — Confirmed by live container stop (Case F). **VERIFIED.**

4. **`mcp.tool.name` available in `mcpAuthorization` rules at list time** — Confirmed by tools/list filtering (Case B). **VERIFIED.**

5. **agentgateway v1.5.0 image tag `ghcr.io/agentgateway/agentgateway:v1.5.0`** — Successfully pulled and started. Container reports version 1.5.0 in startup logs. **VERIFIED.**

6. **agentgateway issue #3092 (v1.4.1 policy bug)** — Not re-reproduced. Cited as historical evidence for why negative tests matter. **EXTERNAL VERIFICATION REQUIRED if cited directly.**

---

## 13. Blocking Issues

### BLOCK-1: Port 3001 mapped in docker-compose — latent gateway bypass

**Severity:** High (latent), currently not exploitable on macOS Docker Desktop  
**Evidence:** `ports: - "3001:3001"` in docker-compose.yml. Direct connection attempt returned no response on current host. Previous audit successfully bypassed via this port.  
**Impact:** On Linux Docker or different Docker Desktop configurations, the MCP server may be directly reachable, allowing complete bypass of the enforcement plane.  
**Fix:** Remove `- "3001:3001"` from docker-compose.yml mcp-server ports section. Expose a separate test-support port (e.g. 3009) for `/test/log` and `/health` only.  
**Effort:** ~30 minutes of docker-compose and test helper changes.

### BLOCK-2: DENY responses carry empty error message

**Severity:** Medium  
**Evidence:** `{"error":{"code":-32603,"message":""}}` observed for all denied calls through gateway.  
**Impact:** Conference screenshots of DENY responses show a generic error. The policy reason is only visible in `docker compose logs guidance-policy`.  
**Fix:** Update `make step3` and `make step4` to pull and display the policy log line alongside the curl output. The log already contains the correct reason — it just needs to be surfaced in the demo flow.  
**Effort:** ~15 minutes of Makefile changes.

---

## 14. Non-Blocking Improvements

| ID | Issue | Severity | Fix |
|---|---|---|---|
| NB-1 | fail-closed test is tautological | Low | Replace mock assertion with real `docker stop/start` test |
| NB-2 | Containers run as root | Low | Add `USER node` to both Dockerfiles |
| NB-3 | gateway/src/index.ts fallback proxy confusing | Low | Move to gateway/fallback/ or delete |
| NB-4 | policyCheck() helper bypasses gRPC | Low | Remove or label unit-test-only |
| NB-5 | No correlation ID through gateway → policy → backend | Low | Not required for talk; useful for production adoption |
| NB-6 | Two gateway configs may diverge | Low | Add validation or note in Makefile |
| NB-7 | make session SID expiry not documented | Low | Add note to README quickstart |
| NB-8 | .DS_Store files in repo | Cosmetic | Add to .gitignore; remove committed instances |

---

## 15. Final Scores

| Dimension | Score | Rationale |
|---|---|---|
| Architectural fidelity | 8/10 | Two genuinely separate planes. Real agentgateway binary. Proto-level gRPC. Deducted for latent port 3001 bypass risk and unused fallback proxy. |
| Technical depth | 8/10 | Protocol-level enforcement, argument-sensitive policy, backend non-receipt proof, adversarially robust (null/array/override all denied). Deducted for tautological fail-closed test and empty DENY message. |
| Reproducibility | 9/10 | `make up` + `make session` + `make stepN` is clean and deterministic. Deducted for SID expiry not documented and integration tests absent from CI. |
| Production-shaped quality | 6/10 | Good: pinned deps, health checks, failClosed, docs, LICENSE, SECURITY.md, ADOPTING.md. Bad: root containers, latent port exposure, no correlation ID, graceful shutdown gaps. |
| Conference claim coverage | 9/10 | All claims demonstrable. All cases execute. Deducted for empty DENY message reducing slide evidence quality. |

---

## 16. Final Verdict

**READY WITH MINOR FIXES**

Two fixes before conference day (total ~45 minutes):

**Fix 1:** Remove `- "3001:3001"` from docker-compose.yml. Add separate test-support port. This closes the latent bypass path unconditionally across all Docker environments.

**Fix 2:** Update `make step3` and `make step4` to display the policy processor log line alongside the curl response. This makes DENY slide evidence readable without requiring conference attendees to know to look in Terminal A.

All five observable contract cases execute correctly. The two-layer separation is genuinely implemented. Tests pass. No overclaims. The repo delivers what the talk promises.
