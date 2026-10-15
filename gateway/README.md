# Enforcement Plane

Two components that together form the enforcement plane of the Two-Layer Agent Contract:

| Component | What it enforces |
|---|---|
| `config.yaml` — agentgateway v1.5 | Tool-name-level filtering and authorization |
| `extmcp-policy/policy.ts` — ExtMCP processor | Argument-sensitive allow/deny decisions |

## Why two layers

`mcpAuthorization` in agentgateway v1.5 operates at the tool name level. It can block `production_admin` entirely. It cannot distinguish `deploy(staging)` from `deploy(production)` — it never sees the arguments.

The ExtMCP policy processor fills that gap. It receives the full request including arguments and returns `allow` or `deny` before the gateway forwards to the backend.

```
Agent → agentgateway → ExtMCP policy → MCP server
           (name)         (arguments)
```

Neither layer is sufficient alone. Both must be active.

## What config.yaml enforces

**`lab-agent` identity**
- Allowed: `status`, `deploy`
- Hidden and denied: `production_admin` (`filterDiscovery: true`)

**`restricted-agent` identity**
- Allowed: nothing — empty tool surface, all calls denied

**Default**: any unrecognised identity is denied all access (fail closed).

## What ExtMCP policy enforces

```
deploy(environment=staging)     → allow
deploy(environment=production)  → deny
deploy(missing environment)     → deny  (fail-safe)
production_admin(any args)      → deny
status(any args)                → allow
unknown tool                    → allow (pass-through)
```

Policy failure mode: `failClosed` — if the policy processor is unreachable, the gateway denies the request rather than forwarding it.

## Run the policy processor

```bash
cd extmcp-policy
npm install
npm run build
npm test    # 14 unit tests
npm start   # gRPC on :9001, health on :3002
```

Or use the full stack:

```bash
# from repo root
make up
```

## Verify enforcement

```bash
curl http://localhost:3002/health
# {"status":"ok","mode":"grpc-extmcp"}
```

## References

- [agentgateway v1.5 docs](https://agentgateway.dev/docs/standalone/latest/)
- [mcpAuthorization reference](https://agentgateway.dev/docs/standalone/latest/documentation/configuration/security/mcp-authz/)
- [ExtMCP guardrails](https://agentgateway.dev/docs/standalone/latest/documentation/mcp/guardrails/about/)
- [AAIF project page](https://www.solo.io/blog/agentgateway-joins-aaif-as-an-open-gateway-for-agentic-ai-infrastructure)
