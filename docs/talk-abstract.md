# Intent Is Not Policy: The Two-Layer Contract for Production Agents

**Speaker:** Darshit Pandya ([@Darshitpandya](https://github.com/Darshitpandya))  
**Role:** Senior Principal Engineer – Platform  
**Event:** Agentic Engineering Day NZ  
**Format:** 25-minute deep technical architecture talk

---

## Abstract

A coding agent follows repository guidance targeting staging. A production-capable deployment tool is reachable. If the agent proposes a production action, what stops it?

This talk answers that question concretely.

Repository guidance — AGENTS.md — supplies local context and shapes agent behaviour. It names the right commands, documents conventions, and steers a well-functioning model toward intended actions. That is valuable. It is not, however, a security boundary. Text instructions cannot guarantee security-critical behaviour. A model that reads and follows instructions can also misread them, be prompted away from them, or encounter a case the author did not anticipate.

MCP and agentgateway enforce the runtime surface. Those are two separate mechanisms with separate responsibilities. This talk names the distinction the **Two-Layer Agent Contract**:

- **Guidance plane** — AGENTS.md shapes candidate behaviour. It lives in the repository and travels with the code.
- **Enforcement plane** — agentgateway and ExtMCP policy determine what actions are executable. They are independent of repository content and enforce the same rules regardless of what any instruction file says.

The argument is demonstrated through a reproducible lab with three measurable outcomes:

1. **Allowed** — a staging deploy succeeds end-to-end, confirming the intended path works.
2. **Hidden** — `production_admin` is absent from the tool-discovery response; the agent cannot see it.
3. **Denied** — a direct invocation of a restricted tool is rejected; a `deploy(environment="production")` call is rejected at the ExtMCP policy layer before reaching the backend.

An authentic captured agent trace shows `deploy(environment="production")` rejected by ExtMCP before backend execution. This is not a simulation — it is a recorded outcome from the lab setup described in this repository.

---

## Talk Flow

```
The permission question
  → Guidance earns its place
    → The gap has consequences
      → The Two-Layer Agent Contract
        → Intent meets policy
          → Audit the boundary
            → Carry the contract home
```

### The permission question

What actually stops an agent from taking a destructive action? Most teams point to their instructions file. This talk examines whether that answer is sufficient.

OpenAI internal coding-agent monitoring (March 2026) found rare but high-severity destructive actions without permission in monitored internal deployments. The frequency was low; the severity was not. Rare is not zero.

### Guidance earns its place

AGENTS.md is genuinely useful. It gives the agent repository-specific context that no general-purpose system prompt can provide: which commands to run, which environments exist, which conventions the codebase follows. A well-written AGENTS.md reduces the frequency of unwanted proposals. That is worth having.

The claim being examined is narrower: does AGENTS.md *prevent* a production action if the model decides to take one? The answer is no, and the rest of the talk explains what does.

### The gap has consequences

MCP maintainer guidance is unambiguous: text instructions cannot guarantee security-critical behavior; deterministic controls are recommended.

agentgateway issue #3092 provides a concrete illustration of the failure mode in reverse: a Kubernetes-mode v1.4.1 case where an accepted rule referenced unavailable tool arguments and rejected a call its author meant to allow. The rule was written with good intent. The outcome was wrong. This is evidence for why positive AND negative tests both matter — you must verify that intended access succeeds and forbidden access fails.

### The Two-Layer Agent Contract

agentgateway v1.5 provides `mcpAuthorization` — tool listing and calling authorization, with unauthorized tools filtered from discovery. This handles visibility and gross-grained invocability.

The v1.5 limitation: tool arguments are unavailable at the `mcpAuthorization` layer. A rule that needs to inspect argument values — for example, rejecting `deploy` when `environment="production"` but allowing it when `environment="staging"` — cannot be expressed at the gateway authorization layer alone. ExtMCP is used for argument-sensitive policy.

The two enforcement points are complementary, not redundant:

| Mechanism | What it controls | Sees arguments? |
|---|---|---|
| agentgateway mcpAuthorization | Tool visibility, invocability | No (v1.5) |
| ExtMCP policy processor | Argument-sensitive allow/deny | Yes |

### Intent meets policy

The lab demonstrates the full contract: AGENTS.md guides the agent toward staging. agentgateway filters `production_admin` from discovery. ExtMCP rejects `deploy(environment="production")` on invocation. The agent trace shows the rejection occurring before the backend is reached.

### Audit the boundary

The reusable rule: **put working guidance in AGENTS.md. Enforce every "must not" at the relevant action boundary. Verify with positive tests (intended access succeeds) and negative tests (forbidden access fails).**

Both test polarities are load-bearing. A policy that blocks production but also blocks staging is not a working policy. A policy that allows staging but silently allows production through a misconfigured rule is also not a working policy.

### Carry the contract home

The pattern is not specific to this lab. Any system where an agent has access to tools with different consequence profiles benefits from separating guidance from enforcement. The two-layer structure applies wherever the question is: what actually prevents this action?

---

## Key Evidence

| Evidence | Relevance |
|---|---|
| OpenAI internal coding-agent monitoring, March 2026 | Rare but high-severity destructive actions without permission in monitored internal deployments; establishes the real-world motivation |
| agentgateway v1.5 `mcpAuthorization` | Tool listing and calling authorization; unauthorized tools filtered from discovery |
| agentgateway v1.5 argument limitation | Tool arguments unavailable at `mcpAuthorization` layer; ExtMCP required for argument-sensitive policy |
| agentgateway issue #3092 | Kubernetes-mode v1.4.1: accepted rule referenced unavailable tool arguments, rejected a call the author meant to allow; evidence for testing both polarities |
| MCP maintainer guidance | Text instructions cannot guarantee security-critical behavior; deterministic controls recommended |

---

## Scope Boundary

This talk does not claim to solve:

- **Model alignment** — the question of whether a model behaves as intended in general
- **Prompt injection generally** — attacker-controlled content reaching the model context
- **Credential lifecycle** — rotation, expiry, revocation of the secrets used to authenticate
- **Host sandboxing** — filesystem, network, and process isolation on the machine running the agent
- **MCP server correctness** — whether the backend MCP server enforces its own invariants

These are real problems. They are adjacent problems. The Two-Layer Agent Contract addresses one specific and tractable problem: ensuring that the runtime enforcement surface for MCP-accessible tools is independent of, and not silently expandable by, changes to repository guidance.

---

## Reading Guide

Each part of the talk corresponds to files in this repository that make the claim concrete.

| Talk section | Repo location | What it shows |
|---|---|---|
| The permission question | [`docs/talk-abstract.md`](talk-abstract.md) (this file) | Motivation and evidence |
| Guidance earns its place | [`agents/AGENTS.md`](../agents/AGENTS.md) | The guidance plane — repository context and conventions |
| The Two-Layer Agent Contract | [`docs/architecture.md`](architecture.md) | Diagrams and prose for the full contract |
| The contract in depth | [`docs/contract-explained.md`](contract-explained.md) | Detailed explanation without slides |
| Lab MCP server | [`mcp-server/`](../mcp-server/) | The three-tool backend: `status`, `deploy`, `production_admin` |
| Gateway configuration | [`gateway/`](../gateway/) | agentgateway config with discovery filtering |
| ExtMCP policy | [`gateway/extmcp-policy/`](../gateway/extmcp-policy/) | Argument-sensitive policy rules |
| Positive + negative tests | [`contract-tests/`](../contract-tests/) | Both test polarities: intended access succeeds, forbidden access fails |
| Taking this to production | [`docs/production-hardening.md`](production-hardening.md) | Bridging from lab to real deployment |
| Setup and run | [`scripts/`](../scripts/) | Lab startup scripts |
