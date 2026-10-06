# CONFERENCE_EVIDENCE.md

**Talk:** Intent Is Not Policy: The Two-Layer Contract for Production Agents  
**Event:** Agentic Engineering Day NZ  
**Repo:** guidance-is-not-policy  
**Branch:** auditing  
**Verified by:** FINAL_RELEASE_GATE.md — 37/37 tests pass, `make verify` exits 0

This document maps each live demo slide to its exact command, expected terminal output,
evidence source, and screenshot target. All outputs are confirmed from the release gate
run — no fabricated values.

---

## Pre-Demo Verification

Run this sequence from a clean terminal before the talk. Expected total time: ~3 minutes.

```bash
# 1. Start the stack
make up

# 2. Initialize the MCP session (run once; saves session ID to /tmp/mcp_sid.sh)
make session

# 3. Confirm all 37 tests pass
make verify
```

Expected final line from `make verify`:
```
All verification checks passed.
```

**Terminal layout for the live demo:**

- Terminal A — `make logs` (or `docker logs -f guidance-policy`) — policy log stream
- Terminal B — demo commands (`make step1` … `make step6`)

---

## Slide 17 — Reproducible Lab / Repository

**Presentation claim:** Anyone can clone this repo, run two commands, and reproduce every
enforcement property shown in this talk.

**Commands:**
```bash
make up
make verify
```

**Expected output — `make up`:**
```
Starting guidance-is-not-policy stack...
Default topology: mcp-server port 3001 is internal-only.
[docker compose up --build output]
Stack running.  Run: make session
```

Three containers start and reach healthy status:
- `guidance-mcp-server`
- `guidance-agentgateway`
- `guidance-policy`

**Expected output — `make verify`:**
```
Topology test:          6/6 PASS
Policy unit tests:     14/14 PASS
Contract tests:        17/17 PASS
Fail-closed test:       3/3 PASS

All verification checks passed.
Exit code: 0
```

Total: **37 tests, 37 passed, 0 failed, 0 skipped.**

**Evidence source:** `make verify` exit code 0; `docker compose ps` shows all containers healthy.

**Screenshot target:** The final `All verification checks passed.` line with the exit code, and `docker compose ps` showing 3 healthy containers.

---

## Slide 19 — ALLOWED (Staging Deploy Succeeds)

**Presentation claim:** When guidance and policy agree, the operation proceeds normally.
A staging deploy is permitted through both layers.

**Command:**
```bash
make step2
```

**Expected output (Terminal B):**
```
────────────────────────────────────────────────────
STEP 2 — ALLOWED
deploy(staging) succeeds. Guidance and policy agree.
────────────────────────────────────────────────────

deploy(environment=staging, version=1.2.0):
  ALLOW  success=True  environment=staging  version=1.2.0
```

**Expected output (Terminal A — policy log):**
```
[POLICY] tools/call tool=deploy → Pass
```

**Evidence source:**
- Policy log: `docker logs guidance-policy` — the `[POLICY] tools/call tool=deploy → Pass` line
- Client response: `success=True, environment=staging` from the MCP `tools/call` result

**Screenshot target:** Split view — Terminal B showing `ALLOW  success=True  environment=staging`
alongside Terminal A showing `[POLICY] tools/call tool=deploy → Pass`.

---

## Slide 20 — HIDDEN (production_admin Absent from Gateway Discovery)

**Presentation claim:** The gateway enforces the tool surface before any call is made.
`production_admin` exists in the backend but is filtered from the agent's view.

**Command:**
```bash
make step1
```

**Expected output (Terminal B):**
```
────────────────────────────────────────────────────
STEP 1 — HIDDEN
Backend has 3 tools. Gateway shows 2. production_admin is filtered.
────────────────────────────────────────────────────

Backend (direct, no gateway):
  status
  deploy
  production_admin

Gateway (what the agent sees):
  status
  deploy

production_admin: HIDDEN from agent discovery
```

**Evidence sources:**

| Surface | Endpoint | Result |
|---------|----------|--------|
| Backend (direct) | `curl http://localhost:3009/health` | `tools=['status','deploy','production_admin']` |
| Gateway (`tools/list`) | `http://localhost:3000/mcp` via MCP session | `['status','deploy']` |

**Screenshot target:** The two-column comparison in Terminal B: Backend shows 3 tools,
Gateway shows 2 — with the `production_admin: HIDDEN from agent discovery` label.

**Note:** Port 3009 is the test-support endpoint only. In the default topology, port 3001
(the MCP protocol port) is not published to the host. Do NOT screenshot a raw curl to
`http://localhost:3001` — it will show connection refused, which is correct but confusing
out of context.

---

## Slide 21 — DENIED (production_admin Direct Invocation Rejected)

**Presentation claim:** Even if an agent somehow knows the tool name, the policy layer
independently rejects the call. Hiding and denying are two independent enforcement points.

**Command:**
```bash
make step4
```

**Expected output (Terminal B):**
```
────────────────────────────────────────────────────
STEP 4 — DENIED
production_admin called directly. Hidden AND denied independently.
────────────────────────────────────────────────────

REQUEST
  production_admin(operation="restart", target="api-service")

CLIENT
  DENIED

POLICY
  tool=production_admin → DENY: production_admin is not available to this identity

BACKEND
  not invoked ✓
```

**Expected output (Terminal A — policy log):**
```
[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity
```

**Evidence sources:**
- Client result: `DENIED` (JSON-RPC error from gateway)
- Policy log: `[POLICY] tools/call tool=production_admin → DENY: production_admin is not available to this identity`
- Backend call log: `curl http://localhost:3009/test/log` → 0 calls for `production_admin`

**Screenshot target:** Terminal B showing all four labelled sections (REQUEST / CLIENT / POLICY / BACKEND)
with `DENIED` and `not invoked ✓`. Terminal A open alongside showing the matching policy log line.

**Note:** The POLICY line in Terminal B is extracted from `docker logs guidance-policy` at runtime —
it is not a hardcoded string. The same line appears in Terminal A's live stream.

---

## Slide 22 — SAME TOOL, DIFFERENT AUTHORITY (Deploy Staging vs Production)

**Presentation claim:** Tool name is not authority. The same `deploy` tool is allowed with
`environment=staging` and denied with `environment=production`. Authorization is
operation-semantic, not tool-name based.

**Command:**
```bash
make step3
```

**Expected output (Terminal B):**
```
────────────────────────────────────────────────────
STEP 3 — ARG-SENSITIVE DENY
Same tool name. Different argument. Different outcome.
────────────────────────────────────────────────────

REQUEST
  deploy(environment="production", version="1.2.0")

CLIENT
  DENIED

POLICY
  tool=deploy → DENY: production deployments are not permitted through this MCP surface

BACKEND
  not invoked ✓
```

**Expected output (Terminal A — policy log, both decisions visible together):**

From prior `make step2` (staging):
```
[POLICY] tools/call tool=deploy → Pass
```

From this step (production):
```
[POLICY] tools/call tool=deploy → DENY: production deployments are not permitted through this MCP surface
```

Both lines use the exact same tool name `deploy`. The argument value is the decision boundary.

**Evidence sources:**
- Policy log: two consecutive `tools/call tool=deploy` entries — one `Pass`, one `DENY`
- Backend call log: `curl http://localhost:3009/test/log` → 0 production calls

**Screenshot target:** Terminal A showing both policy log lines back-to-back — the `Pass` for
staging and the `DENY` for production — with identical tool name `deploy` in both. This is
the slide's key visual.

---

## Slide 23 — POLICY FAILURE / FAIL-CLOSED

**Presentation claim:** If the policy processor becomes unavailable, the gateway fails
closed — no requests are forwarded, even for operations that would normally be permitted.
A degraded policy layer blocks everything.

**Command:**
```bash
make step6
```

**Expected output (Terminal B):**
```
────────────────────────────────────────────────────
STEP 6 — FAIL CLOSED
Policy processor stopped. Even staging is blocked.
────────────────────────────────────────────────────

Stopping policy processor...
Policy: STOPPED

deploy(environment=staging) with policy processor down:
  DENY   mcpGuardrails checkRequest failed: upstream call timeout

failClosed: policy unavailable = request not forwarded

Restarting policy processor...
Policy: RUNNING  {"status":"ok"}
```

After restart, a repeat staging deploy returns `ALLOW` (same as Slide 19).

**Evidence sources:**
- Client result with policy stopped: `DENY` + `mcpGuardrails checkRequest failed: upstream call timeout`
- `docker stop guidance-policy` — actual container stop (not a mock)
- Client result after `docker start guidance-policy`: `ALLOW  success=True  environment=staging`

**Screenshot target:** The before/after sequence in Terminal B:
1. `Policy: STOPPED` → `DENY   mcpGuardrails checkRequest failed: upstream call timeout`
2. `Policy: RUNNING` → (repeat step2 showing ALLOW)

**Note for presenter:** `make step6` handles the `docker stop` and `docker start` internally.
The 18–20 second pause during STEP B is a real container lifecycle delay — not a hang.

---

## Slide 24 — CONTRACT TEST EVIDENCE

**Presentation claim:** Every enforcement property shown in the demo is machine-verified
by contract tests that run against the live stack. The tests cannot pass with a mock —
they require real Docker containers.

**Commands:**
```bash
# All contract tests (runs against the live stack)
make test

# Or as part of full verification suite
make verify

# Fail-closed subset only (clearly labelled steps A/B/C)
make test-fail-closed
```

**Expected output — `make test` (or `make verify` contract section):**
```
PASS contract-tests/allowed.test.ts
PASS contract-tests/denied.test.ts
PASS contract-tests/hidden.test.ts
PASS contract-tests/arg-sensitive.test.ts
PASS contract-tests/fail-closed.test.ts

Test Suites: 5 passed, 5 total
Tests:       17 passed, 17 total
```

**Expected output — `make test-fail-closed`:**
```
PASS ./fail-closed.test.ts (23.769 s)
  FAIL-CLOSED: policy processor unavailable
    ✓ STEP A: deploy(staging) succeeds when policy is available (32 ms)
    ✓ STEP B: deploy(staging) is denied when policy container is stopped (18986 ms)
    ✓ STEP C: deploy(staging) succeeds after policy container is restored (61 ms)
Tests: 3 passed, 3 total
```

STEP B runtime (~18–19 seconds) confirms a real `docker stop` / `docker start` cycle.
There are no mocks (`jest.mock`, `jest.fn` absent from the test file). The `beforeAll`
guard throws an error if the stack is not running — silent skips are impossible.

**Evidence sources:**
- `contract-tests/allowed.test.ts` — staging deploy allowed
- `contract-tests/denied.test.ts` — production_admin invocation denied
- `contract-tests/hidden.test.ts` — production_admin absent from gateway tools/list
- `contract-tests/arg-sensitive.test.ts` — deploy denied with environment=production
- `contract-tests/fail-closed.test.ts` — policy stop/start lifecycle (STEPS A/B/C)

**Screenshot target:** The `make test` output showing 5 PASS suites and `17 passed, 17 total`,
and the `make test-fail-closed` output showing STEP B with its ~18–19 second runtime.

---

## How to Capture Terminal A Policy Log Lines

For slides 21, 22, and 23, the policy log is the primary enforcement evidence.

**Option 1 — Full log follow (recommended for live demo):**
```bash
# In Terminal A, before starting the demo
docker logs -f guidance-policy
```

Each `make step` call will print the corresponding `[POLICY]` line in real time.

**Option 2 — Grep specific lines after each step:**
```bash
# After make step4 (Slide 21 — production_admin denied)
docker logs guidance-policy 2>&1 | grep 'POLICY.*production_admin.*DENY' | tail -1

# After make step3 (Slide 22 — production deploy denied)
docker logs guidance-policy 2>&1 | grep 'POLICY.*deploy.*DENY' | tail -1

# Both deploy decisions together (Slide 22 key visual)
docker logs guidance-policy 2>&1 | grep 'POLICY.*deploy' | tail -2
```

**Option 3 — Via Makefile steps (automated):**
`make step3` and `make step4` extract the relevant policy log line directly into the
POLICY section of their output. No manual grep required.

---

## What NOT to Screenshot

| Avoid | Reason |
|-------|--------|
| `curl http://localhost:3001/...` returning connection refused | Correct behavior but confusing — the audience will think something is broken |
| Raw `curl` output with SSE envelope (`data: {...}`) | Unreadable; use `make stepN` which parses and formats the output |
| `make step5` with an empty backend log | The log is reset by `make step2`; if running out of order the log may show staging calls, not emptiness |
| `docker compose ps` before containers are healthy | Shows `starting` state; wait for the 8-second settle in `make up` to complete |
| `make step6` mid-restart pause | The ~3-second pause before `Policy: RUNNING` appears looks like a hang — let it complete before screenshotting |

---

## Make Step Reference

| Command | Slide | What it shows |
|---------|-------|---------------|
| `make up` | 17 | Starts 3 containers (mcp-server, agentgateway, policy) |
| `make session` | 17 | Initializes MCP session, saves ID to `/tmp/mcp_sid.sh` |
| `make verify` | 17, 24 | Runs 37 tests across 4 suites; exits 0 on full pass |
| `make step1` | 20 | HIDDEN — backend has 3 tools; gateway shows 2; production_admin filtered |
| `make step2` | 19 | ALLOWED — staging deploy succeeds; policy log shows `Pass` |
| `make step3` | 22 | SAME TOOL DENY — deploy(production) denied; deploy(staging) was allowed |
| `make step4` | 21 | DENIED — production_admin invocation rejected; 0 backend calls |
| `make step5` | — | BACKEND LOG — shows only calls that actually reached the MCP server |
| `make step6` | 23 | FAIL CLOSED — policy stopped → staging denied; restarted → staging allowed |
| `make test` | 24 | Contract tests: 5 suites, 17 tests against live stack |
| `make test-fail-closed` | 24 | Fail-closed subset: STEP A/B/C with real docker stop/start |

---

## Port Reference

| Port | Service | Purpose |
|------|---------|---------|
| 3000 | agentgateway | MCP ingress — the only MCP entry point in the default topology |
| 3001 | mcp-server (internal) | MCP protocol — NOT published to host in default topology |
| 3002 | guidance-policy | Policy processor health check (`curl http://localhost:3002/health`) |
| 3009 | mcp-server (test-support) | Backend health + call log — NOT a MCP endpoint |

---

*Generated from FINAL_RELEASE_GATE.md — 2026-10-06. All outputs confirmed by independent clean-start execution.*
