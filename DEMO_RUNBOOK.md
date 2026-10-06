# DEMO RUNBOOK
## Intent Is Not Policy: The Two-Layer Contract for Production Agents

Branch: `auditing` · Repo: `guidance-is-not-policy`

---

## Pre-flight

- Docker Desktop running, no other service on ports 3000, 3002, 3009
- Two terminal windows open side by side
- Browser tab ready: `http://localhost:3009/test/log`
- All commands run from repo root: `guidance-is-not-policy/`

---

## Two-Terminal Layout

| Terminal | Role | What runs there |
|----------|------|-----------------|
| **A** | Logs (leave running) | `make up` → `make logs` |
| **B** | Commands | `make session` once, then `make step1`–`make step6` |

---

## PHASE 1 — Startup

### 1.1 Start the stack (Terminal A)

```
make up
```

**Expected:** Docker builds and starts three containers. After ~8s, `docker compose ps` prints:

```
guidance-mcp-server   Up (healthy)
guidance-policy       Up (healthy)
guidance-gateway      Up
```

**Recovery:** If any container exits or stays unhealthy:
```
docker compose down
make up
```

---

### 1.2 Attach log stream (Terminal A — leave running)

```
make logs
```

**Expected:** Streaming log output from all three containers. Keep this visible throughout the demo — it is the live evidence panel.

**Recovery:** If logs stop: `make logs` again (stack keeps running).

---

### 1.3 Initialize MCP session (Terminal B)

```
make session
```

**Expected:**
```
Session ready.
Handshake complete. Run: make step1
```
Session ID written to `/tmp/mcp_sid.sh`.

**Recovery:** If output shows `ERROR: No session ID` or SID is blank — the gateway is not yet ready. Wait 5s and run `make session` again. If it still fails, check `docker compose ps` and restart the stack.

---

## PHASE 2 — Readiness Verification

### 2.1 Policy health check (Terminal B)

```
curl http://localhost:3002/health
```

**Expected:** `{"status":"ok","failureMode":"failClosed"}` (or similar OK response)

**Recovery:** If connection refused — policy container isn't up. Check `docker compose ps`, restart with `make up`.

---

## PHASE 3 — Demo Steps

### STEP 1 — Hidden: gateway filters production_admin (Terminal B)

```
make step1
```

**What it does:** Queries the backend health endpoint (via port 3009), then queries the gateway `tools/list`. Compares what the backend has vs. what the agent sees.

**Expected — backend (port 3009):**
```
deploy
get_deployment_status
production_admin
```
Three tools listed.

**Expected — gateway tools/list:**
```
deploy
get_deployment_status
```
Two tools. `production_admin` is absent.

**Expected in Terminal A logs:** A `tools/list` log entry from `guidance-gateway`.

**Recovery:** If gateway returns all 3 tools — confirm you are on the `auditing` branch and the correct `config-compose.yaml` is in place. Run `docker compose down && make up`.

---

### STEP 2 — Allowed: deploy staging succeeds (Terminal B)

```
make step2
```

**What it does:** Clears the backend call log, then calls `deploy(environment=staging, version=1.2.0)` through the gateway.

**Expected output:**
```
ALLOW  success=true  environment=staging  version=1.2.0
```

**Expected in Terminal A logs:** `[POLICY] tools/call tool=deploy → Pass`

**Recovery:** If result shows DENY — check that `guidance-policy` is running (`docker compose ps`). If the container stopped, run `docker start guidance-policy`, wait 10s, re-run `make step2`.

---

### STEP 3 — Arg-sensitive deny: deploy production blocked (Terminal B)

```
make step3
```

**What it does:** Calls the same `deploy` tool with `environment=production`. Same tool name, different argument, different outcome.

**Expected output:**
```
DENIED
```
Policy log line visible: `[POLICY] tools/call tool=deploy → DENY` (also visible in Terminal A).

Backend section shows: `not invoked ✓` — the request never reached the MCP server.

**Recovery:** If result shows ALLOW — the policy rules are not applied. Confirm `guidance-policy` is running and the `auditing` branch policy code is deployed. Restart stack.

---

### STEP 4 — Denied: production_admin direct invocation blocked (Terminal B)

```
make step4
```

**What it does:** Attempts to call `production_admin` directly through the gateway (bypassing discovery). Demonstrates the tool is both hidden from listing AND independently blocked on invocation.

**Expected output:**
```
DENIED
```
Policy log shows: `[POLICY] tools/call tool=production_admin → DENY`

Backend section shows: `not invoked ✓`

**Recovery:** If result shows ALLOW — policy is not enforcing. Restart stack from `auditing` branch.

---

### STEP 5 — Backend non-arrival proof: call log shows only staging (Terminal B)

```
make step5
```

**What it does:** Fetches the backend call log (`http://localhost:3009/test/log`) and prints every call that actually reached the MCP server.

**Expected output:** Only the staging deploy call from Step 2 appears:
```
✓  tool=deploy  environment=staging
```

`production` and `production_admin` calls are absent — they were stopped at the gateway and never forwarded.

**Recovery:** If production calls appear in the log — policy enforcement is not working. Restart stack.

---

### STEP 6 — Fail-closed: policy down blocks everything (Terminal B)

```
make step6
```

**What it does:**
1. Stops the `guidance-policy` container (`docker stop guidance-policy`)
2. Waits 3s
3. Calls `deploy(environment=staging, version=1.2.0)` — a normally-allowed call
4. Restarts `guidance-policy` (`docker start guidance-policy`)

**Expected — during policy-down:**
```
DENY   <timeout or policy unavailable error message>
```
Even the safe staging call is rejected. The gateway fails closed — no policy decision = no forwarding.

**Expected in Terminal A logs:** Timeout or connection error from gateway to policy.

**Expected — after restart:**
```
{"status":"ok","failureMode":"failClosed"}
```
Policy health endpoint confirms recovery.

**Recovery:** If DENY does not appear immediately after stopping the container — wait up to 15s for the gRPC connection to time out. The gateway must exhaust its retry window before the fail-closed path triggers.

**Recovery after restart:** If a subsequent `make step2` still denies — wait 5–10s for the gRPC reconnect to complete, then retry.

---

## PHASE 4 — Shutdown and Reset

### Clean shutdown (Terminal B)

```
make clean
```

**Expected:**
```
Cleaning up...
Done.
```
Removes `/tmp/mcp_sid.sh` and `/tmp/mcp_raw.txt`. All containers stopped and removed.

**Recovery:** If `make clean` fails partway through:
```
docker compose down
rm -f /tmp/mcp_sid.sh /tmp/mcp_raw.txt
```

---

## Quick Reference

| Endpoint | Purpose |
|----------|---------|
| `http://localhost:3000` | Gateway (agent-facing, MCP protocol) |
| `http://localhost:3002/health` | Policy processor health |
| `http://localhost:3009/health` | Backend tool inventory (test support) |
| `http://localhost:3009/test/log` | Backend call log (test support) |

| Port | Accessible from host? |
|------|-----------------------|
| 3000 | Yes — gateway |
| 3001 | **No** — MCP server internal only |
| 3002 | Yes — policy health |
| 3009 | Yes — test support (health + log) |

| Container name | Docker stop/start target |
|----------------|--------------------------|
| `guidance-gateway` | gateway |
| `guidance-policy` | policy processor |
| `guidance-mcp-server` | MCP server |

---

## Full Step Sequence (cheat sheet)

```
# Terminal A
make up
make logs          ← leave running

# Terminal B
make session       ← once
make step1         ← hidden: 3 tools → 2 tools
make step2         ← allowed: staging ALLOW
make step3         ← arg-sensitive: production DENY
make step4         ← direct invocation: production_admin DENY
make step5         ← backend log: only staging arrived
make step6         ← fail-closed: policy down = staging DENY → restart → ALLOW
make clean         ← shutdown
```
