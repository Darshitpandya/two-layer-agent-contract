# Gateway: agentgateway + ExtMCP Policy Processor

This directory contains two components that form the **enforcement plane** for the `two-layer-agent-contract` architecture:

1. `config.yaml` — agentgateway v1.5 configuration (coarse-grained, tool-name-level authz)
2. `extmcp-policy/` — ExtMCP request-phase policy processor (fine-grained, argument-level authz)

---

## What agentgateway does in this architecture

agentgateway is a proxy that sits between AI agents and MCP servers. Every tools/list and tools/call request passes through the gateway before reaching the backend. The gateway is the **enforcement plane** — not the guidance layer, not the trust layer, the *enforcement* layer.

```
AI Agent
   │
   ▼
agentgateway :3000          ← enforcement plane
   │   mcpAuthorization     ← tool-name-level deny/filter
   │   ExtMCP policy hook   ← argument-level deny/filter
   │
   ▼
MCP Server :3001            ← backend; never receives unauthorised requests
```

The agent cannot bypass the gateway. The agent cannot see tools it is not permitted to discover. The agent cannot call tools it is not permitted to invoke. This is not achieved by telling the agent not to — it is achieved by making it structurally impossible.

---

## What config.yaml enforces

`config.yaml` defines two enforcement rules using the `mcpAuthorization` v1.5 feature:

### `lab-agent` identity
- **Allowed**: `status`, `deploy`
- **Denied and hidden**: `production_admin`

`filterDiscovery: true` means `lab-agent` receives a tools/list response that does not include `production_admin`. The tool does not appear as a hint, a suggestion, or a comment in the agent's context. It is structurally absent.

### `restricted-agent` identity
- **Allowed**: nothing (empty `tools` list)

`restricted-agent` can connect to the gateway but receives an empty tools/list. Every tools/call returns a denial. This is useful for audit-only or monitoring agents that must never invoke actions.

### Default behaviour
Any identity without a matching rule is **denied all access** (fail closed). Connecting to the gateway without a recognised identity yields no tools.

---

## What ExtMCP policy adds that gateway-level authz cannot

`mcpAuthorization` operates at the **tool name level**. It can answer: "Is `lab-agent` allowed to call a tool named `deploy`?" — and the answer is yes.

But it cannot answer: "Is `lab-agent` allowed to call `deploy` with `environment=production`?"

That is the gap ExtMCP policy fills.

| Decision | mcpAuthorization | ExtMCP policy |
|---|---|---|
| Block `production_admin` for `lab-agent` | ✅ (tool name) | ✅ (belt-and-suspenders) |
| Allow `deploy` for `lab-agent` | ✅ (tool name) | ✅ (if env=staging) |
| Block `deploy(env=production)` | ❌ cannot see args | ✅ argument-sensitive |
| Block `deploy` with no environment | ❌ cannot see args | ✅ fail-closed on ambiguity |

The ExtMCP policy processor (`extmcp-policy/policy.ts`) listens on port 3002. agentgateway calls `POST /policy/check` with the full request (tool name + arguments) before forwarding to the backend. The processor returns `{ allow: true }` or `{ allow: false, reason: "..." }`.

This is the critical architectural point: **the same tool name can be safe or unsafe depending on its arguments**. Tool-name-level authz is necessary but not sufficient.

---

## The v1.5 limitation: mcpAuthorization does not see tool arguments

This is a documented limitation of agentgateway v1.5. The `mcpAuthorization` rules in `config.yaml` are evaluated against the tool name only, before argument parsing. The request body (which contains the arguments) is not available to the authz rules engine.

This is why the ExtMCP policy hook exists as a separate HTTP endpoint. It receives the fully-parsed request and can make argument-sensitive decisions. This two-layer design is intentional:

- **Layer 1 (gateway)**: fast, cheap, name-level filtering — removes entire categories of risk
- **Layer 2 (policy processor)**: slower, richer, argument-level decisions — enforces fine-grained invariants

Both layers must be active. Neither is sufficient alone.

---

## Running the gateway locally

### Prerequisites
- Docker
- Lab MCP server running on port 3001 (`cd ../mcp-server && npm start`)
- ExtMCP policy processor running on port 3002 (`cd extmcp-policy && npm start`)

### Start agentgateway v1.5

```bash
docker run --rm \
  -p 3000:3000 \
  -v "$(pwd)/config.yaml:/etc/agentgateway/config.yaml:ro" \
  --network host \
  ghcr.io/agentgateway/agentgateway:1.5 \
  --config /etc/agentgateway/config.yaml
```

The `--network host` flag allows the gateway container to reach `localhost:3001` (MCP server) and `localhost:3002` (policy processor) on the host machine. On macOS, replace with explicit host references if needed:

```bash
# macOS: use host.docker.internal instead of localhost in config.yaml
docker run --rm \
  -p 3000:3000 \
  -v "$(pwd)/config.yaml:/etc/agentgateway/config.yaml:ro" \
  ghcr.io/agentgateway/agentgateway:1.5 \
  --config /etc/agentgateway/config.yaml
```

### Start the ExtMCP policy processor

```bash
cd extmcp-policy
npm install
npm run build
npm start
# Listening on port 3002
```

### Verify the enforcement plane

```bash
# Health check
curl http://localhost:3002/health
# {"status":"ok"}

# Test a staging deploy (should be allowed)
curl -X POST http://localhost:3002/policy/check \
  -H 'Content-Type: application/json' \
  -d '{"tool":"deploy","arguments":{"environment":"staging"}}'
# {"allow":true}

# Test a production deploy (should be denied)
curl -X POST http://localhost:3002/policy/check \
  -H 'Content-Type: application/json' \
  -d '{"tool":"deploy","arguments":{"environment":"production"}}'
# {"allow":false,"reason":"production deployments are not permitted through this MCP surface"}
```

---

## Running the policy processor tests

```bash
cd extmcp-policy
npm install
npm run build
npm test
```

---

## References

- [agentgateway v1.5 documentation](https://agentgateway.dev/docs/standalone/latest/)
- [agentgateway mcpAuthorization reference](https://agentgateway.dev/docs/standalone/latest/authorization/)
- [ExtMCP policy processor protocol](https://agentgateway.dev/docs/standalone/latest/extmcp/)
