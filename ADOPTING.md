# Adopting the Two-Layer Agent Contract

This repo has two distinct layers. Understanding which one you need saves time.

---

## The two layers

| Layer | What it is | Who uses it |
|---|---|---|
| **The lab** | A working demo that proves the pattern. `mcp-server/`, `docker-compose.yml`, `Makefile`, `scripts/` | Anyone running the demo to understand the pattern |
| **The pattern** | The files you actually take to your project. `gateway/config.yaml`, `gateway/extmcp-policy/policy.ts`, `contract-tests/`, `agents/AGENTS.md` | Individuals and org teams applying this to real work |

**You run the lab to understand it. You take the pattern to apply it.**

---

## For individuals

You have a personal project or side project with an MCP-connected agent. You want to make sure your agent cannot execute actions it shouldn't.

### What to take — 4 files

| File | What to do with it |
|---|---|
| `agents/AGENTS.md` | Copy to your repo. Rewrite the content for your project's commands, conventions, and deployment guidance. Keep the "What this guidance file is not" section — it's architecturally important. |
| `gateway/config.yaml` | Copy to your project. Replace `status` and `deploy` with your actual tool names. Replace the CEL rules with rules that match your tools. |
| `gateway/extmcp-policy/policy.ts` | Copy to your project. Replace the `deploy`/`environment` check with the argument-sensitive rules your tools need. Keep the `evaluatePolicy` export — it's what you test. |
| `contract-tests/arg-sensitive.test.ts` | Copy and adapt. This is the test that proves your argument-sensitive rules fire correctly. Swap tool names and expected outcomes. |

### 3 things to change

**1. Tool names in `config.yaml`**
```yaml
# Replace this:
- 'mcp.tool.name == "deploy"'

# With your actual tool names:
- 'mcp.tool.name == "run_query"'
- 'mcp.tool.name == "send_message"'
```

**2. Argument check in `policy.ts`**
```typescript
// Replace this:
if (tool === 'deploy') {
  if (args['environment'] === 'production') {
    return { allow: false, reason: '...' };
  }
}

// With your actual rule:
if (tool === 'run_query') {
  if (args['database'] === 'prod') {
    return { allow: false, reason: 'production database queries require approval' };
  }
}
```

**3. Your MCP server URL in `config.yaml`**
```yaml
# Replace:
host: "http://host.docker.internal:3001/mcp"

# With your server:
host: "http://your-mcp-server:PORT/mcp"
```

### 1 test to run

```bash
# After adapting policy.ts, run the unit tests:
cd gateway/extmcp-policy && npm test
```

If these pass, your policy logic is correct before you wire up anything else.

### What to ignore

`mcp-server/` — that is a toy server for the demo. Your project has its own MCP server.  
`docker-compose.yml`, `Makefile`, `scripts/` — these run the lab. Not needed for your project.

---

## For org teams

Your team is building or running agent workflows connected to internal tools via MCP. You want to apply the enforcement pattern to your org's setup.

### Start here — read first

[`docs/contract-explained.md`](docs/contract-explained.md) — the full pattern explanation, the independence test, and the reusable checklist. Share this with your team before touching any code. It answers "why do we need this" before the "how."

### What to take — 5 files

| File | What to do with it |
|---|---|
| `agents/AGENTS.md` | The pattern for repository-local agent guidance. Copy the structure. Write your own version for each repo where agents work. Key rule: guidance states *how to work*, not *what is permitted*. |
| `gateway/config.yaml` | The agentgateway v1.5 configuration template. Replace tool names and CEL rules with your tools and your identity provider. |
| `gateway/extmcp-policy/policy.ts` | The ExtMCP gRPC policy processor. Replace the argument check with your rules. The server structure, failClosed default, and evaluatePolicy export stay identical. |
| `gateway/extmcp-policy/policy.test.ts` | Unit tests for your policy logic. Non-negotiable. These are how you know your policy does what you think it does before it runs in production. |
| `contract-tests/` | The full contract test suite pattern. Copy all five test files. Swap tool names and expected outcomes. These become your enforcement boundary verification suite. |

### Work through the production hardening checklist

[`docs/production-hardening.md`](docs/production-hardening.md) covers the five things that need changing before production use:

1. Replace the lab MCP server with your own
2. Wire your identity provider (OIDC example included)
3. Deploy agentgateway beyond localhost (Kubernetes, ECS, single VM)
4. Write your own `AGENTS.md` files using the three principles
5. Choose your failure mode explicitly (`failClosed` vs `failOpen`)

Each section ends with a one-line verification so you know when that step is done.

### What to ignore

`mcp-server/` — toy server for the demo. Your org has real MCP servers.  
`docker-compose.yml` — runs the lab locally. Your org has real deployment infrastructure.  
`Makefile`, `scripts/` — for running and demonstrating the lab. Not for production pipelines.

### The adoption checklist

Work through this with your platform team:

```
□ Read docs/contract-explained.md as a team
□ Identify which of your MCP tools need argument-sensitive enforcement
□ Write AGENTS.md for each repo where agents operate
□ Adapt gateway/config.yaml with your tool names and identity provider
□ Adapt gateway/extmcp-policy/policy.ts with your argument rules
□ Run npm test in gateway/extmcp-policy — all unit tests pass
□ Deploy agentgateway in front of your MCP server(s)
□ Copy contract-tests/ pattern and adapt for your tools
□ Run positive tests — intended access succeeds
□ Run negative tests — forbidden access fails
□ Test fail mode explicitly — stop policy processor, verify failClosed holds
□ Document your failure mode choice and why
```

---

## The question that tells you if you're ready

> *If your AGENTS.md said "use staging" and your gateway config allowed production, would you know?*

The contract tests answer that question with a pass or fail, not with a belief.

That is the reusable thing this repo gives you: not the code, but the habit of asking whether guidance and enforcement agree — and verifying the answer.

---

## Questions

Open an issue labelled `question`. Answers that clarify the pattern become documentation.

→ [docs/contract-explained.md](docs/contract-explained.md) — deeper pattern explanation  
→ [docs/production-hardening.md](docs/production-hardening.md) — production adaptation guide  
→ [docs/architecture.md](docs/architecture.md) — two-layer contract diagrams  
→ [CONTRIBUTING.md](CONTRIBUTING.md) — contributing to this repo
