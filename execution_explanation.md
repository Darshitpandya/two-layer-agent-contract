# Execution Explanation

## What the terminal screenshots are actually conveying

The screenshots are not showing "here is a security tool". They are showing **a proof of a concept**.

The talk's central claim is: *guidance and authorization are two different things, and you can separate them architecturally*. The terminal output is the evidence that the separation works — that you can have guidance in one place (AGENTS.md) and enforcement in another place (agentgateway) and they operate independently.

Every step proves one specific property:

- **Step 1** — the enforcement plane can narrow what a coding agent can discover
- **Step 2** — the normal path still works when guidance and enforcement agree
- **Step 3** — the same tool name produces different outcomes based on arguments, without changing the guidance
- **Step 4** — hiding a tool is not enough; call-time denial is a separate, independent property
- **Step 5** — denied calls provably never reached the backend
- **Step 6** — when the policy processor goes down, nothing slips through

None of this requires screenshots to be "impressive". The screenshots are **falsifiable evidence** — they show that the contract actually holds at runtime, not just in theory.

---

## Where this contract sits in real production

The contract sits at the **MCP gateway layer** — between your coding agent and every tool it can call.

```
Your org's coding agent
        │
        ▼
agentgateway  ← the enforcement plane lives here
        │
        ├──→ your deployment tools
        ├──→ your database tools
        ├──→ your cloud provider tools
        └──→ your internal APIs
```

In production this is infrastructure, not application code. The team that owns the platform or developer tooling layer owns this. Not the team building the agent. Not the team that wrote the tools. The platform team that decides what agents are allowed to do across the org.

---

## Who follows the contract and who enforces it

**AGENTS.md** is written by — and followed by — the coding agent. It shapes what the agent *tries* to do. The agent reads it, the agent follows it (or doesn't — that's the point). Any developer on the team can write it. It lives in the repository.

**agentgateway config** is owned by the platform team. It decides what the agent *can* do regardless of what it tries. It lives in infrastructure, not in the repository. A developer changing AGENTS.md cannot change what agentgateway permits.

**The policy processor** (the ExtMCP code) is where your organization's specific rules live. In this lab it's `deploy(production) → DENY`. In a real org it would be things like:

- `only agents with this service account identity can trigger deployments`
- `database write operations require a ticket ID in the arguments`
- `production environment argument is always denied through MCP; use the deployment pipeline instead`
- `PII-tagged tools are only accessible to agents running in the data team's workspace`

**Approve/deny/hidden decisions** in production are made by:

| Decision | Who makes it | How |
|---|---|---|
| Which tools an agent can discover | Platform team | agentgateway mcpAuthorization CEL rules |
| Which argument values are permitted | Platform team + security team | ExtMCP policy code |
| What guidance the agent follows | Developer / team | AGENTS.md in the repository |
| Whether the policy processor is fail-open or fail-closed | Platform team | `failureMode` config — organizational risk decision |

---

## The real-world scenario the talk is arguing for

Right now most orgs give coding agents an AGENTS.md and assume that's enough. An agent running in a staging repository shouldn't be able to deploy to production. So they write "deploy to staging" in the instructions and call it done.

The talk argues that is not a boundary. It's a preference. If the agent's tool surface includes a production deployment tool, and the only thing stopping it is a sentence in a markdown file, then any of these breaks it:

- the agent misreads the instruction
- the instruction is ambiguous
- a prompt injection in a file the agent reads overrides the instruction
- the model version changes and follows instructions slightly differently
- a developer removes the instruction by accident

The Two-Layer Contract says: put the instruction in AGENTS.md where it belongs. Then also enforce it at the gateway where it cannot be overridden by anything the agent does or reads.

The screenshots prove that second layer works. That's all they're doing.
