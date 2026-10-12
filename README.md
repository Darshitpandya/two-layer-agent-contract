# two-layer-agent-contract

**The Two-Layer Agent Contract: a reproducible reference implementation.**

Repository guidance influences what a coding agent does.  
Runtime policy determines what it can execute.  
These are separate mechanisms. This repo proves it.

---

> **Talk:** *Intent Is Not Policy: The Two-Layer Contract for Production Agents*  
> **Event:** Agentic Engineering Day NZ  
> **Speaker:** Darshit Pandya — Senior Principal Engineer, Platform  

---

## The contradiction this repo demonstrates

A repository contains:

```text
Deployment work targets staging.
```

The runtime exposes:

```text
deploy(environment)
  ├─ staging
  └─ production
```

The system expresses one intent while granting broader authority.  
No model failure is required. The architecture already contains it.

**This repo makes that boundary observable, enforceable, and testable.**

---

## Taking the pattern to your project

This repo has a lab (for understanding) and a pattern (for applying).

**If you want to apply this to your own project or org — start here: [`ADOPTING.md`](ADOPTING.md)**

It tells you exactly which 4–5 files to copy, what to change, and what to ignore.  
The lab, Docker Compose, and Makefile are for running the demo — not for your production setup.

---

## Quickstart

**Prerequisites:** Docker Desktop, `make` (already on macOS/Linux — verify with `make --version`)

```bash
git clone https://github.com/Darshitpandya/two-layer-agent-contract.git
cd two-layer-agent-contract
make up
```

---

## Running the demo

This repo uses `make` for all workflows. `make` is a standard build tool installed on every macOS and Linux machine. Instead of typing long commands, you type `make <target>` and it runs the right thing.

Open **two terminal windows**, both in the repo directory.

**Terminal A — start the stack and watch live logs:**

```bash
make up     # start all three Docker containers
make logs   # follow live logs (leave this running)
```

**Terminal B — run each demo step:**

```bash
make session   # initialize MCP session (run once after make up)
```

Then run each step in order. Each is one command. Each produces output you can screenshot.

```bash
make step1   # HIDDEN:        gateway shows 2 tools, backend has 3
make step2   # ALLOWED:       deploy(staging) succeeds end to end
make step3   # ARG-SENSITIVE: deploy(production) denied — same tool, different outcome
make step4   # DENIED:        production_admin blocked even when called directly
make step5   # BACKEND LOG:   proof of what actually reached the server
make step6   # FAIL CLOSED:   policy processor stopped — nothing forwards
```

Run all steps at once:

```bash
make demo
```

Run contract tests against the live stack:

```bash
make test
```

Stop everything:

```bash
make down
```

---

### What each step proves

| Command | Slide | Claim |
|---|---|---|
| `make step1` | 20 | Backend surface (3 tools) ≠ gateway surface (2 tools). Discovery is filtered. |
| `make step2` | 19 | Normal path works. Guidance and policy agree. Backend receipt confirmed. |
| `make step3` | 22 | Same tool name (`deploy`). Different argument. Different outcome. Policy log is the evidence. |
| `make step4` | 21 | Hidden ≠ denied. Both enforced independently. Backend never sees the call. |
| `make step5` | 21 | Call log proves non-receipt. Evidence is runtime, not model compliance. |
| `make step6` | 23 | `failClosed` configured and testable. Policy down = nothing forwarded. |

Watch **Terminal A** during each step. The policy processor logs every decision in real time:

```
guidance-policy | [POLICY] tools/call tool=deploy → Pass
guidance-policy | [POLICY] tools/call tool=deploy → DENY: production deployments are not permitted
guidance-gateway | error="mcp: mcpGuardrails rejected: upstream call timeout"
```

These log lines are the talk's core evidence — decisions happening at the enforcement plane, not inside the agent.

---

### All available make targets

```
make up        start Docker stack (builds images if needed)
make down      stop Docker stack
make logs      follow live logs from all containers
make session   initialize MCP session (required before steps)
make step1     HIDDEN — discovery filtering
make step2     ALLOWED — staging deploy
make step3     ARG-SENSITIVE DENY — production deploy
make step4     DENIED — production_admin direct call
make step5     BACKEND LOG — non-receipt proof
make step6     FAIL CLOSED — policy processor unavailable
make demo      run all steps in sequence
make test      run contract tests against live stack
make clean     stop stack and remove session files
```

---

## What you will see

### HIDDEN — production_admin absent from discovery (`make step1`)

The backend exposes three tools: `status`, `deploy`, `production_admin`.  
Through the gateway, the agent sees two: `status`, `deploy`.  
`production_admin` never enters the model-visible surface.

### ALLOWED — staging deploy succeeds (`make step2`)

`deploy(environment="staging", version="1.2.0")` passes through the gateway,  
is approved by the ExtMCP policy processor, and reaches the backend.

### ARG-SENSITIVE — same tool, production denied (`make step3`)

`deploy(environment="production")` uses the same tool name as the allowed call.  
The ExtMCP policy processor denies it before backend execution.  
**Tool identity is not always the smallest authorization unit.**

### DENIED — direct invocation rejected (`make step4`)

A client attempts `tools/call("production_admin")` directly — bypassing discovery.  
The gateway rejects it at the mcpAuthorization layer. The backend never receives it.  
**Hidden ≠ denied. Both properties are required. Both are enforced.**

### FAIL CLOSED — policy processor unavailable (`make step6`)

When the ExtMCP policy processor is stopped, all tool calls are blocked.  
Even a legitimate staging deploy is denied.  
Policy-engine failure semantics are explicit and testable.

### ARG-SENSITIVE — same tool, different authority

```text
deploy(environment="staging")    → ALLOW
deploy(environment="production") → DENY
```

Same tool name. Different operation semantics.  
agentgateway v1.5 `mcpAuthorization` does not see tool arguments.  
The ExtMCP policy processor sits at request-time and makes this decision.

### FAIL-CLOSED — policy processor unavailable

When the ExtMCP policy processor is stopped, requests are not forwarded.  
Policy-engine failure semantics are explicit and tested.

---

## Architecture

```
GUIDANCE PLANE
┌─────────────────────────────────────┐
│  AGENTS.md                          │
│  repository context                 │
│  commands + conventions             │
│  "deployment targets staging"       │
└────────────────┬────────────────────┘
                 │ influences
                 ▼
           Coding Agent
           candidate MCP action
                 │
                 ▼ MCP boundary
ENFORCEMENT PLANE
┌─────────────────────────────────────┐
│  agentgateway v1.5                  │
│  ├─ mcpAuthorization                │
│  │   discovery filtering            │
│  │   call authorization             │
│  └─ ExtMCP policy processor         │
│      argument-sensitive rules       │
│      failClosed / failOpen          │
│                                     │
│  Lab MCP server                     │
│  status · deploy · production_admin │
└─────────────────────────────────────┘
```

The full architecture with Mermaid diagrams: [`docs/architecture.md`](docs/architecture.md)

---

## Repository layout

```
two-layer-agent-contract/
│
├── AGENTS.md                    ← Guidance plane: repo-local context for coding agents
│
├── mcp-server/                  ← Lab MCP backend: status, deploy, production_admin
│   └── src/
│       ├── index.ts             ← MCP server (StdioServerTransport)
│       └── tools.ts             ← Tool definitions and handlers
│
├── gateway/
│   ├── config.yaml              ← agentgateway v1.5: discovery filtering + call authz
│   └── extmcp-policy/
│       ├── policy.ts            ← ExtMCP processor: argument-sensitive allow/deny
│       └── policy.test.ts       ← Unit tests for policy evaluation (14 cases)
│
├── agents/
│   ├── AGENTS.md                ← Scoped guidance: "deployment targets staging"
│   └── task.md                  ← The lab deployment task
│
├── contract-tests/
│   ├── helpers.ts               ← MCP JSON-RPC helpers
│   ├── allowed.test.ts          ← Staging deploy permitted and received
│   ├── hidden.test.ts           ← production_admin absent from gateway discovery
│   ├── denied.test.ts           ← Direct invocation rejected, backend non-receipt
│   ├── arg-sensitive.test.ts    ← Same tool, staging/production authority differs
│   └── fail-closed.test.ts      ← Policy unavailable → not forwarded
│
├── scripts/
│   ├── setup.sh                 ← Install deps, build, validate prerequisites
│   ├── run-lab.sh               ← Start stack, run contract tests
│   └── teardown.sh              ← Stop all services
│
└── docs/
    ├── architecture.md          ← Two-layer contract diagrams and explanation
    ├── talk-abstract.md         ← Full talk abstract, evidence, reading guide
    ├── contract-explained.md    ← Pattern deep-dive without the slides
    └── production-hardening.md  ← Taking this pattern to production
```

---

## Two-layer contract

| Layer | Component | Responsibility |
|---|---|---|
| Guidance plane | `AGENTS.md` | Repository-local context, conventions, preferred behaviour |
| Enforcement plane | `agentgateway` | MCP discovery filtering, call authorization |
| Enforcement plane | `ExtMCP policy` | Argument-sensitive request policy, fail-mode semantics |

**The separation is the point.**  
An agent following repository guidance correctly does not prove that an incorrect action is impossible.  
Runtime enforcement makes that proof.

---

## Taking This to Production

The lab is a minimal working example. Here is what changes for production use.

### 1. Replace the lab MCP server

The `mcp-server/` exposes toy tools. Your MCP server exposes your actual capabilities — a deployment pipeline, a cloud API, a database client.

To swap:
1. Remove `mcp-server/` from your deployment
2. Point `gateway/config.yaml` `target` at your MCP server
3. Update tool names in `gateway/config.yaml` to match yours
4. Update the argument check in `gateway/extmcp-policy/policy.ts` to match your tool's parameters
5. Update tool names in `contract-tests/` test fixtures

The gateway config and policy logic are independent of what the tools actually do.

### 2. Wire your identity provider

The lab uses a placeholder identity (`lab-agent`). Replace it with your auth source.

**API key (simplest):**
```yaml
# gateway/config.yaml
mcpAuthorization:
  identity:
    header: "X-Agent-Identity"
```

**OIDC (recommended for orgs):**
```yaml
mcpAuthorization:
  identity:
    oidc:
      issuer: "https://your-idp.example.com"
      audience: "your-mcp-gateway"
```

Do not commit credentials. Reference via environment variables.

### 3. Deploy agentgateway beyond localhost

| Situation | Recommended path |
|---|---|
| Single VM / small team | Docker Compose, nginx + TLS in front |
| Kubernetes | agentgateway Helm chart (v1.5) |
| AWS ECS | Task definition, ALB terminating TLS |
| CI only | Docker Compose in GitHub Actions (see `.github/workflows/`) |

TLS must terminate before the gateway receives MCP traffic. Do not expose gateway port directly.  
→ [agentgateway deployment docs](https://agentgateway.dev/docs/standalone/latest/documentation/deployment/)

### 4. Write your own AGENTS.md

Three principles from this lab that carry to any repository:

1. **Scope to the repository.** Write what an agent needs to work correctly here — commands, conventions, file locations.
2. **State preferred behaviour, not permissions.** "Deployment targets staging" is guidance. "Do not deploy to production" is not an authorization boundary.
3. **Keep guidance and policy in sync.** If AGENTS.md says "use staging" and the gateway allows production, that is the gap this repo exists to close. The contract tests verify that agreement.

### 5. Choose your failure mode deliberately

| Mode | When policy engine is unavailable | Right for |
|---|---|---|
| `failClosed` | Request not forwarded | High-consequence actions, compliance requirements |
| `failOpen` | Request forwarded without policy evaluation | High-availability requirements with alerting |

The question to answer with your team: *Is it safer for this action to fail or to proceed without a policy check?*

For deployment and data-mutation operations: default to `failClosed`.

Full detail: [`docs/production-hardening.md`](docs/production-hardening.md)

---

## What this repo does not solve

Stated explicitly, mirrors the talk:

- Model alignment or instruction-following reliability
- Prompt injection in general (this addresses one MCP path; other vectors are out of scope)
- Credential lifecycle, secrets management, or key rotation
- Host sandboxing or subprocess privileges
- MCP server input validation or correctness
- Non-MCP paths to the same backend (shell access, direct API calls, ambient credentials)

This addresses a narrower problem: **behavioural instructions do not have to carry authorization responsibility.**

---

## Contract tests

The tests prove runtime behaviour, not model compliance.

```
contract-tests/
├── allowed.test.ts       PASS  staging deploy visible + backend receipt confirmed
├── hidden.test.ts        PASS  production_admin absent from effective discovery
├── denied.test.ts        PASS  direct invocation rejected, backend non-receipt confirmed
├── arg-sensitive.test.ts PASS  staging allowed, production denied, same tool name
└── fail-closed.test.ts   PASS  policy processor unavailable → not forwarded
```

Run them:
```bash
./scripts/run-lab.sh        # starts stack and runs all tests
cd contract-tests && npm test  # run tests against already-running stack
```

> "The evidence is runtime evidence, not a story about model obedience."

---

## Prerequisites

- **Node.js 22+** — `node --version`
- **Docker** — for agentgateway v1.5
- **npm** — comes with Node.js

No cloud account required. Runs entirely locally.

---

## Technical reference

| Component | Version | Reference |
|---|---|---|
| agentgateway | v1.5.0 | [Release](https://github.com/agentgateway/agentgateway/releases/tag/v1.5.0) · [MCP authz docs](https://agentgateway.dev/docs/standalone/latest/documentation/configuration/security/mcp-authz/) |
| ExtMCP | agentgateway v1.5 | [Request checks](https://agentgateway.dev/docs/standalone/latest/documentation/mcp/guardrails/about/) |
| MCP SDK | @modelcontextprotocol/sdk@1.10.2 | [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| AGENTS.md | — | [agents.md project](https://agents.md/) |

**Key evidence cited in the talk:**
- [OpenAI internal coding-agent monitoring, March 2026](https://openai.com/index/how-we-monitor-internal-coding-agents-misalignment/) — rare but high-severity destructive actions in monitored internal deployments
- [agentgateway issue #3092](https://github.com/agentgateway/agentgateway/issues/3092) — accepted policy rule that rejected a call its author meant to allow; motivates why negative tests matter
- [MCP maintainer guidance on server instructions](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/) — text instructions cannot guarantee security-critical behaviour
- [OpenAI Agents SDK SECURITY.md](https://github.com/openai/openai-agents-python/blob/main/SECURITY.md) — application responsibility for tool and credential authorization

---

## Docs

- [`ADOPTING.md`](ADOPTING.md) — **start here if you want to use this in your project or org**
- [`docs/talk-abstract.md`](docs/talk-abstract.md) — full talk abstract, evidence, reading guide
- [`docs/architecture.md`](docs/architecture.md) — two-layer contract diagrams
- [`docs/contract-explained.md`](docs/contract-explained.md) — pattern deep-dive
- [`docs/production-hardening.md`](docs/production-hardening.md) — production adaptation guide

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).  
The contract test pattern is the most useful thing to extend.

## Security

See [`SECURITY.md`](SECURITY.md) for scope, limitations, and vulnerability reporting.

## License

Apache 2.0 — see [`LICENSE`](LICENSE).

---

**Intent is not policy. Context can remain flexible. Runtime authority must remain explicit.**
