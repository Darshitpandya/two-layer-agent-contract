# Repository Audit

**Audited:** guidance-is-not-policy  
**Audit date:** 2026-10-06  
**Auditor role:** Independent Principal Engineer  
**Talk:** Intent Is Not Policy: The Two-Layer Contract for Production Agents  
**Method:** Source read + full live execution of all scenarios  

---

## 1. Executive Verdict

**READY WITH MINOR FIXES**

The repository technically and reproducibly supports the talk's core thesis. All five observable contract cases execute correctly through the real agentgateway v1.5.0 binary. The two-layer separation is genuinely implemented, not simulated. Policy unit tests (14) and contract tests (17) pass. The architecture is honest about its limitations.

Two blocking issues must be fixed before conference day:

1. **DENY responses return empty error message string** — `{"error":{"code":-32603,"message":""}}` — the denial reason from the ExtMCP processor is stripped by agentgateway before surfacing to the client. This does not affect enforcement correctness but makes the slide evidence read as an anonymous error rather than a readable policy decision. The policy processor logs show the correct reason; the client response does not.

2. **MCP server port 3001 is publicly exposed in `docker-compose.yml`** — a client can bypass agentgateway entirely by connecting directly to `http://localhost:3001/mcp`, call `deploy(environment="production")`, and get `"success":true`. This contradicts the talk's claim that enforcement is at the gateway. It is mitigated (the talk is about the pattern, not the lab's network topology), but the `AUDIT_FINDINGS.md` section must explicitly acknowledge it and the README must note it.

---

## 2. Actual Architecture

Based exclusively on source and configuration — not documentation.

```
[Coding Agent / curl client]
         │
         │ MCP Streamable HTTP (SSE)
         ▼
[agentgateway v1.5.0]  ←  ghcr.io/agentgateway/agentgateway:v1.5.0
  gateway/config-compose.yaml (docker-compose)
  gateway/config.yaml         (run-lab.sh / mixed)
         │
         │ Layer 1: mcpAuthorization (CEL on mcp.tool.name)
         │   - status → allow
         │   - deploy → allow
         │   - production_admin → absent (HIDDEN from tools/list, DENIED at call)
         │
         │ Layer 2: mcpGuardrails (gRPC ExtMCP, request phase)
         │   failureMode: failClosed
         │   host: policy:9001 (compose) / host.docker.internal:9001 (run-lab)
         │
         ▼
[ExtMCP gRPC policy processor]  ←  Node.js, port 9001 (h2c)
  gateway/extmcp-policy/policy.ts
  Implements: ext_mcp.proto CheckRequest
         │
         │ deploy + staging  → Pass
         │ deploy + production → AuthorizationError
         │ production_admin → AuthorizationError
         │
         ▼ (on Pass only)
[Lab MCP server]  ←  Node.js, MCP Streamable HTTP, port 3001
  mcp-server/src/http-server.ts
  Tools: status, deploy, production_admin
  In-memory call log at GET /test/log (test support)
```

**Guidance plane:**
- `AGENTS.md` (root) — repository conventions, what the guidance layer is NOT
- `agents/AGENTS.md` — scoped deployment guidance: "deployment targets staging"
- `agents/task.md` — the lab deployment task

**Key observations:**
- agentgateway is the real v1.5.0 binary, not a mock or proxy
- `gateway/src/index.ts` is a TypeScript fallback proxy — it exists in source but is NOT used by docker-compose or run-lab.sh. It is a confusing artifact.
- `docker-compose.yml` uses `gateway/config-compose.yaml`; `scripts/run-lab.sh` uses `gateway/config.yaml` — two configs, both correct but one unmaintained discrepancy risk
- MCP server port 3001 is publicly exposed in docker-compose (see blocking issue #2)
- No identity/auth wired — the gateway applies mcpAuthorization rules uniformly to all callers

---

## 3. Central Invariant

**AGENTS.md does not affect runtime authorization. PASS.**

**A. AGENTS.md affects behavioural guidance only.**  
PASS. `AGENTS.md` and `agents/AGENTS.md` contain only text guidance (commands, conventions, deployment target preference). No code references them. Confirmed by grep: no import, require, source, or read of any AGENTS.md file in `gateway/`, `mcp-server/`, or `contract-tests/`.

**B. Runtime authorization does not parse, read, import, consume, or derive policy from AGENTS.md.**  
PASS. Exhaustive grep of `gateway/extmcp-policy/policy.ts`, `gateway/src/index.ts`, and `gateway/config*.yaml` confirms zero references to AGENTS.md, agents/, or guidance. Policy is derived solely from the MCP request (tool name + arguments).

**C. Removing AGENTS.md would affect agent behaviour but not runtime capability.**  
PASS. Verified by execution (Case E): deploy(production) is denied with no guidance context — the curl client carries no AGENTS.md. The gateway denies based solely on the argument value. Removing AGENTS.md does not make production executable.

**D. Runtime authority is determined independently of model compliance.**  
PASS. Authorization runs on the request content, not on whether the agent "chose" correctly. Every denied case was denied regardless of what any model would have decided.

**E. Backend intentionally capable of broader operations than effective authority.**  
PASS. Backend schema includes `DeployEnvironment = 'staging' | 'production'` and `production_admin` tool. `handleDeploy('production', ...)` and `handleProductionAdmin(...)` execute successfully if called directly. The backend does not enforce the restriction — the gateway does.

**No hidden coupling found between guidance plane and authorization path.**

---

## 4. Claim-to-Evidence Matrix

| ID | Talk / abstract claim | Repository implementation | Executable test | Observed evidence | Status | Risk | Required action |
|---|---|---|---|---|---|---|---|
| C1 | "Guidance influences candidate behaviour. Enforcement determines executable authority." | Two separate implementations: AGENTS.md (guidance), agentgateway+ExtMCP (enforcement) | Case E: guidance missing, production still denied | deploy(production) DENY with no AGENTS.md context | PASS | — | None |
| C2 | "Authorization must not depend on the model choosing to comply" | Runtime policy runs on MCP request content, not model state | All denial cases bypass model entirely | All DENY cases confirmed by curl | PASS | — | None |
| C3 | "Two-Layer Agent Contract: separates guidance from runtime enforcement" | Layer 1 (mcpAuthorization), Layer 2 (mcpGuardrails gRPC) are independent implementations | Cases B, C, D | tools/list filtered, tools/call denied, argument-sensitive deny all confirmed | PASS | — | None |
| C4 | "Guidance plane expressed through AGENTS.md" | root AGENTS.md + agents/AGENTS.md with commands, conventions, deployment target | Static read | AGENTS.md contains repository layout, commands, deployment guidance, explicit "not authorization" section | PASS | — | None |
| C5 | "Enforcement plane implemented through agentgateway" | Real agentgateway v1.5.0 binary via Docker | Cases B, C, D, F | Gateway logs confirm enforcement firing | PASS | — | None |
| C6 | "Controls what capabilities the agent can discover" | mcpAuthorization filters tools/list | Case B | Gateway: [status, deploy]. Direct: [status, deploy, production_admin] | PASS | — | None |
| C7 | "Controls what capabilities the agent can invoke" | mcpAuthorization + mcpGuardrails deny at tools/call | Cases C, D | production_admin DENY, deploy(production) DENY | PASS | — | None |
| C8 | "Reproducible open-source lab" | docker compose up --build + make session + make stepN | Reproducibility section | Clean checkout to proof: 3 commands | PASS | — | None |
| C9 | "Trace allowed, hidden and denied capabilities" | make step1/step2/step3/step4 | All cases | ALLOWED staging, HIDDEN production_admin, DENIED direct call | PASS | — | None |
| C10 | "Show what happens when intent and runtime authority disagree" | Case D: same tool, different environment, different outcome | Case D | deploy(staging) ALLOW, deploy(production) DENY, backend log confirms | PASS | — | None |
| C11 | "Context can remain flexible without making authorization probabilistic" | AGENTS.md independent of gateway config | Case E | deploy(production) denied with or without guidance | PASS | — | None |
| C12 | "Allowed, hidden, denied outcomes" | Three distinct enforcement properties all implemented | Cases B, C, D | All three observed | PASS | — | None |
| C13 | DENY response surfaces policy reason to client | agentgateway should surface reason from ExtMCP error | Case D DENY response | `"message":""` — empty string | **FAIL** | Medium | Fix error message surfacing |
| C14 | Gateway is the chokepoint — backend not directly reachable | MCP server port 3001 exposed in docker-compose | Direct bypass test | deploy(production) via port 3001 returns success | **FAIL** | High | Remove port 3001 from docker-compose external ports |
| C15 | Fail-closed: policy processor unavailable → deny | failureMode: failClosed in config | Case F | deploy(staging) denied with timeout error when policy stopped | PASS | — | None |
| C16 | Denied calls do not reach backend | Call log at /test/log | Cases C, D, F | Backend log empty / unchanged after all denials | PASS | — | None |
| C17 | Positive tests pass | make test / npm test | Live stack test run | 17/17 contract tests pass | PASS | — | None |
| C18 | Negative tests pass | contract-tests/ denied, arg-sensitive, fail-closed | Live stack test run | All negative cases pass | PASS | — | None |
| C19 | Pinned dependencies | All package.json files use exact versions | Dependency audit | All 23 dependencies pinned, no ^ or ~ | PASS | — | None |
| C20 | No committed secrets | grep scan | Source audit | No secrets found | PASS | — | None |

---

## 5. Runtime Scenarios

### Allowed

**Command:** `make step2` or direct curl tools/call deploy(staging)  
**Result:**
```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"success\":true,\"environment\":\"staging\",\"version\":\"1.2.0\",...}"}]}}
```
**Backend log:** `[{"tool":"deploy","args":{"environment":"staging","version":"1.2.0"},...}]`  
**Policy log:** `[POLICY] tools/call tool=deploy → Pass`  
**Status:** PASS

### Hidden

**Command:** `make step1` — compare direct vs gateway tools/list  
**Direct (port 3001):** `{"tools":["status","deploy","production_admin"]}`  
**Gateway (port 3000):** tools array contains only `status` and `deploy`. `production_admin` absent.  
**Status:** PASS

### Denied

**Command:** tools/call production_admin through gateway  
**Response:** `{"error":{"code":-32603,"message":""}}`  
**HTTP status:** 200 (agentgateway uses HTTP 200 with JSON-RPC error body for MCP denials)  
**Backend log:** `[]` — empty, call never reached backend  
**Gateway log:** `error="mcp: mcpGuardrails rejected: "`  
**Policy log:** `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available`  
**Issue:** Error message is empty string in client response. Policy processor reason is lost in transport.  
**Status:** PASS (denial fires) / PARTIAL (reason not surfaced to client)

### Same Tool / Different Authority

**Command:** deploy(staging) then deploy(production) through same session  
**Staging result:** success=true, environment=staging  
**Production result:** `{"error":{"code":-32603,"message":""}}` — denied  
**Backend log:** `[{"tool":"deploy","args":{"environment":"staging",...}}]` — only staging present  
**Policy log:**
```
[POLICY] tools/call tool=deploy → Pass
[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface
```
**Where argument becomes visible to policy:** `policy.ts` line ~120, `rawBytes` parsed from `McpRequest.mcp_request`, then `evaluatePolicy(toolName, toolArgs)` called. The argument check is in `evaluatePolicy` in `policy.ts`.  
**Status:** PASS (enforcement), PARTIAL (client-facing reason is empty)

### Guidance / Authority Disagreement

**Case 1 — guidance says staging, production invocation attempted:**  
Direct curl with no AGENTS.md context → deploy(production) → DENY  
**Case 2 — guidance missing, production invocation:**  
Same result. The gateway has no reference to AGENTS.md. Runtime policy fires identically.  
**Status:** PASS

### Policy Failure

**Mechanism:** `docker stop guidance-policy`  
**Result:** `{"error":{"code":-32603,"message":"mcpGuardrails checkRequest failed: upstream call timeout"}}`  
**Backend log:** unchanged — no new calls  
**Gateway log:** `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call timeout"`  
**Failure mode:** failClosed confirmed — requests not forwarded when processor unreachable  
**Status:** PASS

---

## 6. Technical Depth

**A. Protocol-level behaviour — STRONG**  
Uses real MCP streamable HTTP transport (SSE, session management, MCP-Protocol-Version header). Not a mock or simplified proxy. agentgateway v1.5.0 binary handles the actual protocol.

**B. Discovery vs invocation — separately enforced, separately tested — STRONG**  
Layer 1 (mcpAuthorization) filters tools/list. Layer 2 (mcpGuardrails) evaluates tools/call. Case C explicitly tests that a tool absent from discovery is still rejected at invocation — the "hidden ≠ denied" proof. Contract test files are separate: `hidden.test.ts` and `denied.test.ts`.

**C. Tool-level vs operation-level policy — STRONG**  
mcpAuthorization operates on tool name. ExtMCP gRPC operates on full request arguments. The `arg-sensitive.test.ts` suite explicitly asserts both calls use the same tool name (`expect(stagingToolName).toBe(productionToolName)`), making the architectural point executable.

**D. Negative testing — ADEQUATE**  
Four negative test files: denied, arg-sensitive (production), fail-closed (unit path), hidden (absence assertion). Backend non-receipt verified via `/test/log`. Weakness: fail-closed integration test does not actually stop the policy processor in CI — it falls back to a mock assertion.

**E. Failure semantics — ADEQUATE**  
failClosed configured and manually verified. Policy processor stop/start tested. Weakness: no automated CI test that stops the container and verifies gateway denial. The fail-closed test in CI is a mock assertion, not a live integration.

**F. Enforcement chokepoint — WEAK**  
agentgateway is the chokepoint in intent. In practice, `docker-compose.yml` exposes port 3001 publicly. A client can bypass the gateway entirely and call `deploy(production)` directly to the MCP server, receiving `"success":true`. This is the most significant architectural cheat in the lab. The talk acknowledges non-MCP bypass paths in Slide 21 and docs, but the lab itself demonstrates the bypass rather than preventing it.

**G. Backend capability broader than effective authority — STRONG**  
`DeployEnvironment = 'staging' | 'production'` and `production_admin` tool both exist in the backend. `handleDeploy('production', ...)` executes without restriction. The backend is intentionally unconstrained.

**H. Tests do not depend on LLM — STRONG**  
All tests use curl / fetch. No LLM, no model, no agent client. Policy is exercised by direct HTTP calls.

**I. Evidence from real executions — STRONG**  
Contract tests execute real HTTP against real agentgateway v1.5.0. Policy processor log lines are generated at runtime. Backend call log is populated by actual tool handler execution.

---

## 7. Production-Shaped Quality

| Item | Status | Notes |
|---|---|---|
| Exact dependency pins | PASS | All 23 deps across 3 packages pinned to exact versions |
| Documented compatibility/version assumptions | PASS | agentgateway v1.5.0 pinned, Docker image tag pinned, limitations documented |
| Configuration validation | PARTIAL | agentgateway validates its config on startup; policy.ts has no startup config validation |
| Health/readiness behaviour | PASS | `/health` on MCP server (3001) and policy (3002); gateway readiness on :15021 |
| Graceful shutdown | PARTIAL | docker-compose handles SIGTERM; run-lab.sh has cleanup trap; policy gRPC server has no graceful drain |
| Structured logging | PARTIAL | Policy processor uses structured `[POLICY]` prefix; MCP server logs to stderr; no JSON structured logging |
| Request/correlation identity | FAIL | No request ID or correlation header threaded through gateway → policy → backend |
| No committed secrets | PASS | Grep confirms no secrets in tracked files |
| Non-root containers | FAIL | Both Dockerfiles use `node:22-alpine` default which runs as root. No `USER` directive. |
| Minimal runtime privileges | FAIL | Containers run as root; no capability dropping; no read-only filesystem |
| Gateway as exposed chokepoint | FAIL | Port 3001 exposed in docker-compose — backend directly reachable |
| Backend/private services not normally exposed | FAIL | Same as above — port 3001 publicly mapped |
| Deterministic CI | PASS | GitHub Actions with pinned action versions (checkout@v4, setup-node@v4) |
| Clean-checkout build | PASS | npm ci used throughout; package-lock.json committed |
| Clean-checkout test | PARTIAL | CI runs unit tests only; integration tests require running stack not available in CI |
| Negative security/contract tests | PASS | denied.test.ts, arg-sensitive.test.ts, fail-closed.test.ts all present |
| LICENSE | PASS | Apache 2.0 |
| SECURITY.md | PASS | Present, precise scope, explicit non-scope list |
| CONTRIBUTING.md | PASS | Present, protects architectural integrity |
| Threat model | PARTIAL | SECURITY.md covers scope. No separate formal threat model document. |
| Architecture documentation | PASS | docs/architecture.md with Mermaid diagrams |
| Production adoption guidance | PASS | docs/production-hardening.md, ADOPTING.md |

---

## 8. Reproducibility

**Path from clone to proof:**

```
git clone https://github.com/Darshitpandya/guidance-is-not-policy.git
cd guidance-is-not-policy
make up          # docker compose up --build -d
make session     # initialize MCP session
make step1       # HIDDEN
make step2       # ALLOWED
make step3       # ARG-SENSITIVE DENY
make step4       # DENIED
make step5       # BACKEND LOG
make step6       # FAIL CLOSED
```

**Prerequisites:** Docker Desktop (running), make (macOS built-in)  
**Manual steps:** 1 (run `make up`, wait for healthy)  
**Undocumented assumptions:** None found  
**Total commands:** 8  
**Failures during audit:** None  
**Time from clone to first proof:** ~90 seconds (image pull already cached); ~5 min on cold pull

**Weakness:** `make session` requires manual copy-paste of session ID if the automatic extraction fails (terminal wrapping issue documented in repo history). Makefile now handles this automatically via `/tmp/mcp_sid.sh`.

**CI coverage:** Unit tests (policy: 14) run in CI. Integration contract tests (17) do not — require live stack. This is documented in CI workflow and contract-tests/README.md.

---

## 9. Conference Screenshot Evidence

| Slide | Presentation claim | Command | Expected output | Evidence | Reproducible |
|---|---|---|---|---|---|
| 19 ALLOWED | deploy(staging) succeeds | `make step2` | `"success":true,"environment":"staging"` in SSE data line | Terminal B + Terminal A policy log `→ Pass` | YES |
| 20 HIDDEN | Backend 3 tools, gateway 2 | `make step1` | Direct: `["status","deploy","production_admin"]` / Gateway: `["status","deploy"]` | Side-by-side terminal output | YES |
| 21 DENIED | production_admin rejected, not in backend log | `make step4` then `make step5` | Error JSON + empty production_admin in log | Terminal output + `/test/log` | YES — but error message is `""` |
| 22 ARG-SENSITIVE | Same tool, different outcome | `make step3` | deploy(production) returns error; Terminal A shows DENY reason | Terminal A policy log is clearest evidence | YES — policy log shows reason even though client response is empty |
| 23 FAIL CLOSED | Policy down → nothing forwards | `make step6` | deploy(staging) denied with timeout error | Terminal output + backend log unchanged | YES |
| 24 CONTRACT TESTS | Runtime evidence not model obedience | `make test` | 5 PASS, 17 tests | Terminal output | YES (requires running stack) |

**Issue with Slide 21/22:** Client-facing DENY response is `{"error":{"code":-32603,"message":""}}`. The reason string is visible in Terminal A policy logs but not in the curl response. For slides, Terminal A is the primary evidence source for DENY reasons.

---

## 10. Architectural Cheats / Weak Proofs

**CHEAT 1 — BLOCKING: Port 3001 exposed in docker-compose (gateway bypass)**

`docker-compose.yml` maps port 3001 to host. Any client can connect to `http://localhost:3001/mcp` directly, bypassing agentgateway entirely. Verified: `deploy(environment="production")` through port 3001 returns `"success":true`.

This is the most significant finding. The talk's core claim is that runtime enforcement is at the gateway. The lab configuration undermines this by making the backend directly reachable.

*Mitigation in documentation:* The talk and `SECURITY.md` acknowledge non-MCP bypass paths. But the lab should not demonstrate the bypass itself.

*Fix:* Remove `- "3001:3001"` from docker-compose.yml. Keep internal port for container-to-container communication. Add internal Docker network so gateway reaches the MCP server but the host cannot.

**CHEAT 2 — NON-BLOCKING: DENY error message is empty string**

Client receives `{"error":{"code":-32603,"message":""}}` for all denied calls. The policy reason (`"production deployments are not permitted through this MCP surface"`) is logged by the policy processor but stripped by agentgateway before reaching the client.

The denial fires correctly — this does not affect enforcement. But it affects the conference evidence quality and is confusing to developers using the repo.

*Root cause:* agentgateway's `mcpGuardrails` error mapping strips the `body` field from the `AuthorizationError` proto response when constructing the JSON-RPC error. This is likely a v1.5.0 behaviour — the body is logged server-side but not forwarded to the client.

*Fix options:* (a) Accept and document it — point to policy log as the evidence source. (b) Map the error body through a different mechanism if agentgateway v1.5 supports it. Option (a) is the pragmatic conference-day choice.

**CHEAT 3 — NON-BLOCKING: fail-closed test does not stop the container in CI**

`fail-closed.test.ts` test 2 ("deploy(staging) is denied when policy processor is stopped") falls back to a mock assertion (`expect(failClosedBehaviour).toBe('deny')`) when `POLICY_UNAVAILABLE` env var is not set. In CI, this test passes trivially without exercising the gateway at all.

*Fix:* The Makefile `step6` target and manual verification via `make step6` are the real proof. The test comment documents this correctly. This is acceptable as a known limitation if documented.

**CHEAT 4 — NON-BLOCKING: gateway/src/index.ts fallback proxy present but confusing**

A TypeScript MCP proxy exists at `gateway/src/index.ts` but is not used by docker-compose or run-lab.sh. An auditor reading the repo might mistake it for the enforcement mechanism. It was built during development but superseded by the real agentgateway binary.

*Fix:* Move to `gateway/fallback/` with a README noting it is not the primary path, or delete it entirely.

**CHEAT 5 — NON-BLOCKING: Containers run as root**

Both Dockerfiles use `node:22-alpine` with no `USER` directive. Node processes run as root inside the containers.

*Fix:* Add `USER node` before the CMD in both Dockerfiles.

**FINDING: No architectural cheat found in the core enforcement path.** The policy evaluation runs through real agentgateway → real gRPC ExtMCP server → evaluatePolicy function. The test log at `/test/log` is populated by actual execution of `handleDeploy()`, not a mock.

---

## 11. Overclaims

Scanned `README.md`, `ADOPTING.md`, `SECURITY.md`, `docs/` for: "secure", "production ready", "prevents prompt injection", "fully protected", "guaranteed", "zero trust", "cannot be bypassed", "deterministic authorization".

**No overclaims found.**

The repository consistently uses qualified language:
- "production-shaped properties" (not "production-ready")
- "influences candidate behaviour" (not "controls")
- "enforcement determines executable authority" (narrowly scoped)
- SECURITY.md explicitly lists non-scope items

One phrase to watch: `SECURITY.md` says "deployment and data-mutation operations: default to failClosed". This is a recommendation, not a claim about the implementation. It is appropriately framed as advice.

---

## 12. External Verification Required

The following claims rely on agentgateway v1.5.0 documented behaviour that was verified against live docs during the build process:

1. **`mcpAuthorization` does not see `mcp.tool.arguments`** — Documented at `agentgateway.dev/docs/standalone/latest/documentation/configuration/security/mcp-authz/` section "Tool arguments are not available during authorization". Verified against live docs. VERIFIED.

2. **`mcpGuardrails` `kind: remote` uses gRPC h2c** — Documented at agentgateway guardrails setup page. Verified against live docs and confirmed by successful gRPC connection. VERIFIED.

3. **`failureMode: failClosed` denies when processor unreachable** — Verified by execution (Case F). VERIFIED.

4. **`mcp.tool.name` available in `mcpAuthorization` rules** — Verified by execution (tools/list filtering confirmed). VERIFIED.

5. **agentgateway v1.5.0 vs v1.6.0 config format compatibility** — The docs site shows v1.6 as "latest". The repo uses v1.5.0 image. The config format used (`mcpAuthorization` with `rules`, `mcpGuardrails` with `processors`) was verified against the v1.5.0 image via actual execution. VERIFIED.

6. **agentgateway issue #3092 (v1.4.1 policy bug)** — Referenced in talk and docs as evidence for why negative tests matter. Not re-reproduced in this audit. EXTERNAL VERIFICATION REQUIRED if this specific citation is challenged.

---

## 13. Blocking Issues

### BLOCK-1: MCP server port 3001 exposed in docker-compose — gateway bypass

**Severity:** High  
**Evidence:** `curl -s http://localhost:3001/mcp ... deploy(production) → "success":true`  
**Impact:** Contradicts the talk's enforcement claim. An adversary (or conference attendee testing the boundary) can bypass the entire enforcement plane in 30 seconds.  
**Fix:** Remove `- "3001:3001"` from docker-compose.yml mcp-server ports section. Replace with internal Docker network only. The gateway can still reach it via `mcp-server:3001` internally.  
**Effort:** 2 lines of YAML + 1 commit.

### BLOCK-2: DENY responses carry empty error message

**Severity:** Medium  
**Evidence:** `{"error":{"code":-32603,"message":""}}` observed for all denied tool calls through gateway  
**Impact:** Conference screenshots of DENY responses show a generic error with no readable reason. Slide 22 requires showing that the denial carries the policy reason.  
**Fix options:**  
(a) Document that the policy reason is visible in Terminal A (docker compose logs) but not in the curl response. Update make step3/step4 output to prominently show the policy log line.  
(b) Investigate whether agentgateway v1.5 supports `message` passthrough for `mcpGuardrails` errors — may require a different error response format in the proto response.  
**Effort:** Option (a) = documentation update. Option (b) = investigation + possible upstream limitation.

---

## 14. Non-Blocking Improvements

| ID | Issue | Severity | Fix |
|---|---|---|---|
| NB-1 | Containers run as root (no USER directive) | Low | Add `USER node` to both Dockerfiles |
| NB-2 | gateway/src/index.ts fallback proxy is confusing | Low | Move to gateway/fallback/ or delete |
| NB-3 | fail-closed CI test is a mock assertion | Low | Document clearly (already partially done); acceptable for conference |
| NB-4 | No request correlation ID | Low | Not required for the talk; useful for production adoption |
| NB-5 | Policy gRPC server has no graceful drain on SIGTERM | Low | Add signal handler to flush in-flight RPCs |
| NB-6 | No `make doctor` target to pre-check prerequisites | Low | Add `make doctor` that checks Docker, node version, image presence |
| NB-7 | Two gateway configs (config.yaml vs config-compose.yaml) could diverge | Low | Add a validation step or note in Makefile |
| NB-8 | Branch protection not enabled (GitHub Free plan blocks it on private repos) | Low | Make repo public and enable immediately |
| NB-9 | `.DS_Store` files in repo tree | Cosmetic | Add to .gitignore and remove committed instances |

---

## 15. Final Scores

| Dimension | Score | Rationale |
|---|---|---|
| Architectural fidelity | 8/10 | Two genuinely separate planes. Real agentgateway binary. Proto-level gRPC. Deducted for port 3001 exposure and unused fallback proxy. |
| Technical depth | 8/10 | Protocol-level enforcement, argument-sensitive policy, backend non-receipt proof, real tools. Deducted for empty DENY message and CI-level fail-closed gap. |
| Reproducibility | 9/10 | `make up` + `make session` + `make stepN` is the cleanest path in the repo history. Deducted for integration tests not running in CI. |
| Production-shaped quality | 6/10 | Good: pinned deps, health checks, failClosed, docs, LICENSE, SECURITY.md. Bad: root containers, port exposure, no correlation ID, graceful shutdown gaps. |
| Conference claim coverage | 9/10 | All talk claims are demonstrable. All cases execute. Deducted for empty DENY message reducing slide evidence quality. |

---

## 16. Final Verdict

**READY WITH MINOR FIXES**

Two fixes required before conference day:

**Fix 1 (30 min):** Remove port 3001 from docker-compose external port mapping. Use internal Docker network only.

**Fix 2 (30 min):** Accept that DENY client responses carry empty message. Update make step3/step4 output to explicitly print the policy log lines from Terminal A alongside the curl response, making the evidence complete.

All five observable contract cases execute correctly against real agentgateway v1.5.0. The two-layer separation is genuinely implemented. Tests pass. Architecture is honest about its limitations. Documentation has no overclaims. The repo delivers what the talk promises.
