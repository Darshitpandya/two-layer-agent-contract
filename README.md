# two-layer-agent-contract

**Guidance influences what an agent does. Enforcement determines what it can execute. These are separate mechanisms. This repo proves it.**

[![MIT License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Stable](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/Darshitpandya/two-layer-agent-contract/releases)
[![Works with agentgateway v1.5](https://img.shields.io/badge/agentgateway-v1.5.0-8b5cf6.svg)](https://github.com/agentgateway/agentgateway/releases/tag/v1.5.0)
[![MCP](https://img.shields.io/badge/protocol-MCP-38bdf8.svg)](https://modelcontextprotocol.io)
[![34 contract tests](https://img.shields.io/badge/contract%20tests-34%20passing-34d399.svg)](#contract-tests)
[![Talk: Agentic Engineering Day NZ](https://img.shields.io/badge/talk-Agentic%20Engineering%20Day%20NZ-f59e0b.svg)](#talk)

[![Follow on X](https://img.shields.io/badge/X-%40darshitpandya-000000?logo=x)](https://x.com/darshitpandya)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Darshit%20Pandya-0077b5?logo=linkedin)](https://linkedin.com/in/darshitpandya)
[![Platform Pioneer](https://img.shields.io/badge/website-platformpioneer.io-fb7185)](https://platformpioneer.io)

---

> **Talk:** *Intent Is Not Policy: The Two-Layer Contract for Production Agents*
> **Event:** Agentic Engineering Day NZ
> **Speaker:** Darshit Pandya — Senior Principal Engineer, Platform

---

## The problem this repo demonstrates

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

## Quickstart

**Prerequisites:** Docker Desktop, `make`

```bash
git clone https://github.com/Darshitpandya/two-layer-agent-contract.git
cd two-layer-agent-contract
make up
make session
make show-visibility   # see the enforcement boundary in action
```

---

## What you are running

Three containers, one enforcement boundary:

![The Two-Layer Agent Contract — guidance plane influences candidate action, enforcement plane determines executable authority](docs/assets/two-layer-contract.gif)

---

## Running the demo

Open two terminal windows in the repo directory.

**Terminal A — stack and live logs:**

```bash
make up     # start all three Docker containers
make logs   # follow live logs (leave running)
```

**Terminal B — demo steps:**

```bash
make session           # initialize MCP session (once after make up)

make show-visibility   # tool surface: without vs through agentgateway
make show-allow        # deploy(staging) → ALLOW
make show-deny         # deploy(production) → DENY — same tool, different outcome
make show-hidden-denied  # production_admin direct call → DENY
make show-backend-log  # backend receipt: only allowed calls arrived
make show-fail-closed  # policy down → failClosed → nothing forwards
```

Run everything at once:

```bash
make demo
```

---

## What each step proves

| Command | What it demonstrates |
|---|---|
| `make show-visibility` | Backend has 3 tools. Agent sees 2. `production_admin` hidden before discovery. |
| `make show-allow` | Normal path works. Guidance and policy agree. Backend receipt confirmed. |
| `make show-deny` | Same tool name (`deploy`). Different argument. Different outcome. |
| `make show-hidden-denied` | Hidden ≠ denied. Both enforced independently. |
| `make show-backend-log` | Call log proves non-receipt. Evidence is runtime, not model compliance. |
| `make show-fail-closed` | `failClosed` configured and testable. Policy down = nothing forwarded. |

---

## The two-layer separation

| Layer | Component | Responsibility |
|---|---|---|
| Guidance plane | `AGENTS.md` | Repository-local context, conventions, preferred behaviour |
| Enforcement plane | `agentgateway` | MCP discovery filtering, call authorization |
| Enforcement plane | `ExtMCP policy` | Argument-sensitive request policy, fail-mode semantics |

**The separation is the point.**
An agent following repository guidance correctly does not prove that an incorrect action is impossible.
Runtime enforcement makes that proof.

---

## Taking the pattern to your project

**Start here: [`ADOPTING.md`](ADOPTING.md)**

It tells you exactly which 4–5 files to copy, what to change, and what to ignore.
The lab, Docker Compose, and Makefile are for running the demo — not for your production setup.

---

## Contract tests

34 tests prove runtime behaviour — not model compliance.

```
contract-tests/
├── allowed.test.ts       staging deploy visible + backend receipt confirmed
├── hidden.test.ts        production_admin absent from effective discovery
├── denied.test.ts        direct invocation rejected, backend non-receipt confirmed
├── arg-sensitive.test.ts staging allowed, production denied, same tool name
└── fail-closed.test.ts   policy processor unavailable → not forwarded
```

```bash
make verify       # run all 34 tests
make test         # contract tests only (stack must be running)
```

---

## Repository layout

```
two-layer-agent-contract/
│
├── AGENTS.md                    ← Guidance plane: repo-local context for coding agents
│
├── mcp-server/                  ← Lab MCP backend: status, deploy, production_admin
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
├── contract-tests/              ← 5 suites, 34 tests, runtime evidence
├── scripts/                     ← setup, run-lab, teardown
└── docs/
    ├── architecture.md          ← Two-layer contract diagrams
    ├── contract-explained.md    ← Pattern deep-dive
    └── production-hardening.md  ← Taking this to production
```

---

## All make targets

```
make up                  start Docker stack
make down                stop Docker stack
make logs                follow live logs
make session             initialize MCP session (required before steps)
make show-visibility     tool surface — without vs through agentgateway
make show-allow          deploy(staging) → ALLOW
make show-deny           deploy(production) → DENY
make show-hidden-denied  production_admin direct call → DENY
make show-backend-log    backend receipt log
make show-fail-closed    policy unavailable → failClosed
make demo                run all steps in sequence
make test                contract tests (live stack required)
make verify              full verification: topology + unit + contract + fail-closed
make clean               stop stack and remove session files
```

---

## What this does not solve

Stated explicitly to match the talk scope:

- Model alignment or instruction-following reliability
- Prompt injection in general
- Credential lifecycle, secrets management
- Host sandboxing or subprocess privileges
- MCP server input validation
- Non-MCP paths to the same backend

This addresses a narrower problem: **behavioural instructions do not have to carry authorization responsibility.**

---

## Technical reference

| Component | Version | Reference |
|---|---|---|
| agentgateway | v1.5.0 | [Release](https://github.com/agentgateway/agentgateway/releases/tag/v1.5.0) · [MCP authz docs](https://agentgateway.dev/docs/standalone/latest/documentation/configuration/security/mcp-authz/) |
| ExtMCP | agentgateway v1.5 | [Request checks](https://agentgateway.dev/docs/standalone/latest/documentation/mcp/guardrails/about/) |
| MCP SDK | @modelcontextprotocol/sdk@1.10.2 | [npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| Node.js | 22+ | Required |

---

## Talk

> **Intent Is Not Policy: The Two-Layer Contract for Production Agents**
> Agentic Engineering Day NZ · Darshit Pandya

Full abstract, evidence, and reading guide: [`docs/talk-abstract.md`](docs/talk-abstract.md)

---

## Docs

- [`ADOPTING.md`](ADOPTING.md) — start here to apply the pattern to your project
- [`docs/architecture.md`](docs/architecture.md) — two-layer contract diagrams
- [`docs/contract-explained.md`](docs/contract-explained.md) — pattern deep-dive
- [`docs/production-hardening.md`](docs/production-hardening.md) — production adaptation guide
- [`docs/talk-abstract.md`](docs/talk-abstract.md) — full talk abstract and evidence

---

## Contributing

Issues, PRs, and real-world adoption stories welcome.
See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

## Security

See [`SECURITY.md`](SECURITY.md) for scope, limitations, and vulnerability reporting.

## License

Apache 2.0 — see [`LICENSE`](LICENSE).

---

**Intent is not policy. Context can remain flexible. Runtime authority must remain explicit.**
