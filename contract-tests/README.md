# Contract Tests

34 tests prove that the enforcement boundary is a runtime mechanism — not a story about what the model was told to do.

> **The evidence is runtime evidence, not model obedience.**

---

## What each suite proves

### `allowed.test.ts`
Staging deploy is permitted end-to-end. Confirms the happy path works and policy does not over-block. Backend receipt confirmed via call log.

### `hidden.test.ts`
`production_admin` is absent from gateway discovery. Backend has 3 tools — agent sees 2. Discovery filtering reduces the reasoning surface.

### `denied.test.ts`
Direct invocation of `production_admin` is rejected regardless of discovery. Even if a caller skips `tools/list` and calls directly, the policy layer rejects it. Backend call log confirms non-arrival.

### `arg-sensitive.test.ts` — most architecturally significant
Same tool name (`deploy`), different authority based on arguments:
- `deploy(environment=staging)` → **ALLOWED**
- `deploy(environment=production)` → **DENIED**

Proves argument-sensitive policy is necessary — discovery-layer filtering cannot express this distinction.

### `fail-closed.test.ts`
Policy processor unavailability causes denial, not pass-through. Disrupting the policy layer downgrades to "nothing works" rather than "everything is allowed."

---

## Running the tests

**Standard workflow (recommended):**

```bash
# from repo root
make up       # start Docker Compose stack
make session  # initialize MCP session
make verify   # full suite: topology + unit + contract + fail-closed
```

**Contract tests only (stack must be running):**

```bash
make test
# or directly:
cd contract-tests
GATEWAY_URL=http://localhost:3000 \
MCP_SERVER_URL=http://localhost:3009 \
POLICY_URL=http://localhost:3002 \
npm test
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_URL` | `http://localhost:3000` | Gateway endpoint |
| `MCP_SERVER_URL` | `http://localhost:3009` | MCP server test support endpoint |
| `POLICY_URL` | `http://localhost:3002` | Policy processor health endpoint |

---

## Contract tests vs model compliance

| Property | Model compliance | Contract tests |
|---|---|---|
| Evidence type | Stochastic sampling | Deterministic HTTP assertions |
| Subject | LLM output | Gateway / policy / MCP server behaviour |
| Bypassed by confused model? | Possible | No — enforcement is independent of the model |
| Passes when model is replaced? | Maybe | Yes — tests talk to infrastructure |
