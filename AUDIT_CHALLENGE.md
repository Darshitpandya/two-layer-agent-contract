# Independent Challenge Audit

**Branch:** auditing  
**Challenge date:** 2026-10-06  
**Method:** Attempt to falsify every PASS in AUDIT_REPORT.md related to the Two-Layer Agent Contract. Fresh stack, no state from prior audit. Adversarial variants tested where applicable.  
**Stack:** `docker compose up --build -d` — clean start  

---

## Summary

| # | Question | AUDIT_REPORT verdict | Challenge verdict | Change |
|---|---|---|---|---|
| 1 | AGENTS.md affects authorization? | PASS | **PASS — confirmed** | None |
| 2 | Restricted tool genuinely in backend? | PASS | **PASS — confirmed** | None |
| 3 | Hidden from gateway discovery? | PASS | **PASS — confirmed** | None |
| 4 | Can hidden tool be invoked through gateway? | PASS | **PASS — confirmed** | None |
| 5 | Is that invocation denied? | PASS | **PASS — confirmed** | None |
| 6 | deploy(staging) succeeds? | PASS | **PASS — confirmed** | None |
| 7 | deploy(production) fails via runtime policy? | PASS | **PASS — confirmed, adversarially tested** | None |
| 8 | Production denial before backend execution? | PASS | **PASS — confirmed** | None |
| 9 | Policy failure → fail closed? | PASS | **PASS — confirmed by live stop** | None |
| 10 | Normal client bypass via port 3001? | PARTIAL (latent risk) | **PARTIAL — same conclusion** | None |
| 11 | Tests independent of LLM? | PASS | **PASS — confirmed** | None |
| 12 | Evidence from real execution? | PASS | **PASS — confirmed with marker** | None |
| — | fail-closed CI test is a real test? | PARTIAL | **PARTIAL — confirmed tautology** | None |

**No original PASS verdict is overturned.**

---

## 1. AGENTS.md → authorization coupling

**Falsification attempts:**
- Grep of `gateway/extmcp-policy/policy.ts`, both gateway configs for any AGENTS.md reference
- Check docker-compose volumes for AGENTS.md mounts
- Runtime: deploy(production) with curl client carrying no AGENTS.md context

**Results:**
- Zero references to AGENTS.md in any authorization code
- AGENTS.md not mounted into any container (`volumes:` section contains only `config.yaml`)
- Runtime: deploy(production) with `clientInfo.name: "no-guidance-client"` → DENY  
  Policy log: `[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted`

**Challenge verdict: PASS confirmed.**  
No coupling at source, config, container, or runtime level.

---

## 2. production_admin genuinely present in backend

**Falsification attempts:**
- Source check: `tools.ts` for handler function and tool definition
- Runtime: direct `tools/list` to port 3001 (bypassing gateway)
- Runtime: direct `tools/call` to verify handler executes

**Results:**
- `tools.ts` line 85: `handleProductionAdmin()` defined and exported
- `tools.ts` line 147: `production_admin` in TOOL_DEFINITIONS
- Direct `tools/list`: `['status', 'deploy', 'production_admin']` — present
- `production_admin present: True`

**Challenge verdict: PASS confirmed.**  
Tool is genuinely present in the backend, not removed from schema to make the demo work.

---

## 3. production_admin genuinely absent from gateway discovery

**Falsification attempts:**
- Gateway `tools/list` with fresh session
- No alternate discovery paths found

**Results:**
- Gateway `tools/list`: `['status', 'deploy']`
- `production_admin absent: True`

**Challenge verdict: PASS confirmed.**  
Absence is real. The mcpAuthorization CEL rules (`mcp.tool.name == "status"` and `mcp.tool.name == "deploy"`) produce a genuine discovery-level filter via the real agentgateway v1.5.0 binary.

---

## 4 + 5. production_admin invokable through gateway? Denied? Backend non-receipt?

**Falsification attempts:**
1. Standard `tools/call production_admin {operation:restart,target:api}`
2. Case-variant `PRODUCTION_ADMIN`

**Results:**
- Standard: DENY ✓ — Backend log: `[]`
- Case-variant (`PRODUCTION_ADMIN`): DENY ✓ — Backend log: `[]`
- Policy log: `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`

**Challenge verdict: PASS confirmed.**  
Hidden ≠ denied is enforced as two independent properties. Backend is not reached in either case.

---

## 6. deploy(staging) succeeds end-to-end

**Falsification attempts:**
- Fresh session, marker version `CHALLENGE-1`
- Verify response content and backend log entry

**Results:**
- Response: `ALLOW ✓  success=True env=staging ver=CHALLENGE-1`
- Backend log: entry confirmed with correct tool and environment

**Challenge verdict: PASS confirmed.**

---

## 7. deploy(production) fails via runtime policy — adversarially tested

**Falsification attempts:**
1. Standard production deploy
2. Extra field: `{environment:production, override:true}` — does extra argument bypass check?
3. Array environment: `{environment:["staging","production"]}` — does containing "staging" bypass?
4. Null environment: `{environment:null}`
5. Case variant: `{environment:"PRODUCTION"}`

**Results:**
All five variants: DENY ✓ | backend-clean ✓

- override:true — DENY (extra field irrelevant to `env === 'staging'` check)
- Array — DENY with reason: `deploy requires environment to be "staging"; got: ["staging","production"]`
- null — DENY with reason: `deploy requires environment to be "staging"; got: null`
- PRODUCTION (uppercase) — DENY (strict equality, case-sensitive)

The `evaluatePolicy` function uses strict equality: `env === 'staging'`. No coercion, no array membership check, no case-insensitive match. The fail-safe path (`return { allow: false }`) covers all non-staging values.

**Challenge verdict: PASS confirmed, strengthened by adversarial testing.**

---

## 8. Production denial before backend execution

**Falsification attempts:**
- Clear log → attempt production deploy → immediately check log
- Verify MCP server access logs for absence of tool call

**Results:**
- Backend log after DENY: `[]` — empty
- Policy log shows DENY firing before any backend forwarding
- Gateway log: `error="mcp: mcpGuardrails rejected:"` — denial at gateway level, not backend

**Challenge verdict: PASS confirmed.**  
The ExtMCP `CheckRequest` fires at request phase (before backend). `AuthorizationError` response prevents forwarding. This is architecturally guaranteed by the `tools/call: request` configuration in `mcpGuardrails`.

---

## 9. Policy failure → fail closed — live container stop

**Falsification attempts:**
- Actually stop `guidance-policy` Docker container (not a mock)
- Attempt `deploy(staging)` on fresh session after stop
- Verify backend log empty
- Verify gateway log shows failure reason

**Results:**
- Before stop: `ALLOW ✓`
- Policy health after stop: `UNREACHABLE ✓`
- After stop (fresh session): `DENY ✓ (fail-closed)`
- Backend log: `Empty ✓` — no calls forwarded during outage
- Gateway log: `error="mcp: mcpGuardrails rejected: mcpGuardrails checkRequest failed: upstream call failed: Connect: No route to host (os error 113)"`
- After restart: `{"status":"ok","mode":"grpc-extmcp"}` — recovery confirmed

**Challenge verdict: PASS confirmed by live execution.**  
`failureMode: failClosed` in `config-compose.yaml` is not just configuration text — it is enforced by the real agentgateway binary. The gateway log shows the exact reason.

---

## 10. Port 3001 bypass — PARTIAL (same conclusion as AUDIT_REPORT)

**Falsification attempts:**
- `curl --connect-timeout 3 http://localhost:3001/mcp ... initialize ...`

**Result:**
- `BYPASS CLOSED ✓ — port 3001 not reachable from host`

The bypass attempt returns no response — connection refused. This matches the current audit report.

**However:** `docker-compose.yml` still contains `ports: - "3001:3001"`. On this macOS Docker Desktop configuration, the MCP server port is unreachable from the host despite the mapping. This behaviour is environment-specific. On Linux Docker or `--network=host`, the mapping would expose port 3001.

**Challenge verdict: PARTIAL — same as AUDIT_REPORT.**  
The latent risk is real. The fix (remove `- "3001:3001"`) remains valid and necessary before public release. This audit cannot claim the bypass is impossible — only that it did not work in this specific environment.

---

## 11. Tests independent of LLM

**Falsification attempts:**
- Grep all contract test `.ts` files for LLM SDK imports, model references, agent client imports

**Results:**
- Zero LLM SDK imports found
- `lab-agent` string appears in `clientInfo.name` field only — this is a plain string identifier, not an LLM client
- All tests use `mcpToolsCall()` which is a plain `fetch()` to the gateway HTTP endpoint
- No mock responses, no fixture-based assertions in integration test helpers

**Challenge verdict: PASS confirmed.**

---

## 12. Evidence from real execution (not fixtures)

**Falsification attempts:**
- Inject unique marker `INDEPENDENT-CHALLENGE-2026-10-06` as version string
- Verify it appears in backend call log with timestamp from this audit run

**Results:**
```
version=INDEPENDENT-CHALLENGE-2026-10-06
timestamp=2026-10-06T09:03:19.476Z
age=0.1s (confirms live execution, not a fixture)
```

The backend log entry is generated at runtime by `handleDeploy()` — not a pre-populated fixture. The 0.1s age confirms the timestamp is from this audit session.

**Challenge verdict: PASS confirmed.**

---

## Confirmed finding: fail-closed contract test is tautological

`fail-closed.test.ts` tests 2 and 3 in normal operation (without `POLICY_UNAVAILABLE=true`):

Test 2:
```typescript
const failClosedBehaviour = 'deny';
expect(failClosedBehaviour).toBe('deny');  // always passes
```

Test 3:
```typescript
const backendCallsOnPolicyFailure = 0;
expect(backendCallsOnPolicyFailure).toBe(0);  // always passes
```

The gateway does fail closed correctly — confirmed by live `docker stop` in this audit. But these tests prove nothing about gateway behaviour. `make test` and CI both pass regardless of whether the gateway is fail-closed, fail-open, or not running at all (for these two tests).

**Challenge verdict: PARTIAL — confirmed tautology, same as AUDIT_REPORT.**

---

## Final summary

**No original PASS verdict is overturned.**

Every independently executed scenario confirms the original AUDIT_REPORT conclusions. The adversarial variants (override field, array environment, null environment, uppercase PRODUCTION) all denied correctly. Fail-closed was confirmed by actual container stop. Evidence is from live runtime execution.

**Two issues from AUDIT_REPORT remain confirmed:**

1. **Port 3001 latent bypass risk** — mapping exists in docker-compose.yml; currently closed on macOS Docker Desktop but not universally safe. Remove before public release.

2. **fail-closed contract test is tautological** — tests 2 and 3 always pass regardless of gateway behaviour. The gateway is correctly fail-closed; the test does not prove it.

**Overall challenge verdict: READY WITH MINOR FIXES — unchanged from AUDIT_REPORT.**

---

## Post-Remediation Update

All three findings confirmed by both audit passes have been resolved.

| Finding | Challenge verdict | Resolution |
|---|---|---|
| Port 3001 latent bypass | PARTIAL | RESOLVED — port 3001 removed from default docker-compose; test-support port 3009 added; evidence overlay uses loopback binding |
| fail-closed test tautological | PARTIAL | RESOLVED — test replaced with real docker stop/start integration; beforeAll throws on missing prereqs; 3/3 STEP A/B/C pass |
| DENY message empty | (not challenged — was FAIL in AUDIT_REPORT) | RESOLVED — policy.ts fixed to use correct proto field names; denial reason now surfaces in client response |

**No original PASS was overturned. All remediations confirmed by clean-start verification.**

Post-remediation challenge verdict: **READY**
