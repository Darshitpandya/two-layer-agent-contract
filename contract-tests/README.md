# Contract Tests — Two-Layer Agent Contract

These tests prove that the enforcement boundary in the two-layer-agent-contract
reference implementation is a runtime mechanism, not a story about what the model
was told to do.

> **The evidence is runtime evidence, not a story about model obedience.**

---

## What each test file proves

### `allowed.test.ts` — Staging deploy is permitted end-to-end

Proves that the happy path works: a `deploy(environment=staging)` call is visible
in discovery, passes through the policy layer, and is actually executed by the
backend.  This baseline test confirms the stack is wired correctly and that the
policy does not block everything.

Architectural significance: enforcement must be selective, not a blanket deny-all.

---

### `hidden.test.ts` — `production_admin` is absent from gateway discovery

Proves that the gateway's `tools/list` surface is narrower than the backend's.
`production_admin` exists on the MCP server but is not advertised to `lab-agent`
through the gateway.

This is Layer 1 of the Two-Layer Agent Contract: reducing what the model can
discover reduces what it can attempt.  It is a defence-in-depth measure, not
the enforcement boundary itself — the denied tests (below) prove why.

Architectural significance: discovery filtering shrinks the attack surface but is
not sufficient alone.  A sufficiently motivated model (or a confused one) can
call a tool it was never shown.

---

### `denied.test.ts` — Direct invocation of `production_admin` is rejected regardless of discovery

Proves that the enforcement boundary is not "hide the tool from tools/list."
Even when a caller skips discovery and calls `production_admin` directly through
the gateway, the request is denied at the policy layer.  The backend call log
confirms the MCP server never received the call.

This is Layer 2 of the Two-Layer Agent Contract: the hard enforcement wall that
evaluates every call regardless of what was advertised.

Architectural significance: if you rely on discovery filtering alone, a single
rogue or confused LLM call bypasses your entire security model.  The denied test
proves that the wall exists independently of discovery.

---

### `arg-sensitive.test.ts` — Same tool name, different authority based on arguments

**This is the most architecturally significant test suite.**

Both `deploy(environment=staging)` and `deploy(environment=production)` use the
same tool name.  There is no "production_deploy" tool to hide from tools/list.
The policy evaluator must inspect the arguments at call time to distinguish them.

- `deploy(environment=staging)` → **ALLOWED**
- `deploy(environment=production)` → **DENIED**

The fifth test makes the architectural point explicit in code: both calls use the
string `'deploy'` as the tool name.  The enforcement difference is entirely
argument-driven.

Architectural significance: this is the definitive proof that argument-aware
policy evaluation (Layer 2) is necessary.  Discovery-layer filtering cannot
express "deploy is allowed to staging but not to production" without creating two
separate tools — which the arg-sensitive tests show is not the design here.

---

### `fail-closed.test.ts` — Policy processor unavailability causes denial, not pass-through

Proves that the gateway implements fail-closed behaviour.  When the policy
processor is unreachable, the gateway denies all requests rather than forwarding
them.

This property is critical: an attacker who disrupts the policy processor must not
gain unrestricted backend access.  The fail-closed contract means disruption of
the policy layer downgrades to "nothing works" rather than "everything is allowed."

For full integration testing of the fail-closed path, stop the policy processor
manually and run with `POLICY_UNAVAILABLE=true`:

```
POLICY_UNAVAILABLE=true npm run test:fail-closed
```

The unit path (default in CI) encodes the contract expectation directly.

---

## What these tests prove vs model compliance

Model compliance tests (e.g., "does the model follow instructions?") verify that
the LLM outputs a particular response given a particular prompt.  They are
inherently probabilistic — the model might comply today and not tomorrow, or comply
in English but not in French, or comply under low temperature but not high.

These contract tests are different.  They verify that the **runtime enforcement
layer** behaves correctly regardless of what the model does or says:

| Property | Model compliance | Contract tests |
|---|---|---|
| Evidence type | Stochastic sampling | Deterministic HTTP assertions |
| Subject | LLM output | Gateway / policy / MCP server behaviour |
| Can be bypassed by a confused model? | No guarantee | No — enforcement is independent of the model |
| Passes when model is replaced? | Maybe | Yes — tests talk to the infrastructure |

The contract tests are the only kind of test that can make a falsifiable claim
about enforcement.  A system that relies solely on model compliance has no such
claim.

---

## Prerequisites

- Node.js 22 or later
- The lab stack running (see below)

## Running the stack

```
./scripts/run-lab.sh
```

This starts three processes:
- `MCP server` on port 3001
- `Policy processor` on port 3002
- `Gateway` on port 3000

## Running the tests

```bash
# All contract tests (requires stack running)
cd contract-tests
npm install
npm test

# Individual test suites
npm run test:allowed
npm run test:hidden
npm run test:denied
npm run test:arg-sensitive
npm run test:fail-closed
```

## Running without the stack

All integration tests detect whether the services are available and emit a warning
rather than failing hard.  The `arg-sensitive` and `fail-closed` suites include
unit-level assertions that run in CI without a live stack.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GATEWAY_URL` | `http://localhost:3000` | Gateway endpoint |
| `MCP_SERVER_URL` | `http://localhost:3001` | Direct MCP server endpoint |
| `POLICY_URL` | `http://localhost:3002` | Policy processor endpoint |
| `POLICY_UNAVAILABLE` | `false` | Set to `true` to run fail-closed integration path |
