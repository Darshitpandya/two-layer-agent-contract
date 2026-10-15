# Lab MCP Server

Minimal MCP backend for the Two-Layer Agent Contract reference implementation. Exposes three tools across three risk tiers so the enforcement plane has something meaningful to enforce against.

## Tools

| Tool | Risk tier | Default outcome through gateway |
|---|---|---|
| `status` | Read-only | Always allowed |
| `deploy` | Write, arg-sensitive | `staging` → allowed · `production` → denied |
| `production_admin` | Elevated | Always denied, hidden from discovery |

The three tiers are intentional — they let the contract tests prove that low-risk, medium-risk, and high-risk calls each receive the correct treatment from the enforcement plane.

## Run locally

```bash
cd mcp-server
npm install
npm run build
npm start
```

Or use the full stack:

```bash
# from repo root
make up
```

## Test support endpoints

Two endpoints on port 3009 exist for contract tests only — not MCP protocol:

```bash
GET  http://localhost:3009/health      # tool inventory
GET  http://localhost:3009/test/log    # backend call log
DELETE http://localhost:3009/test/log  # clear log between tests
```

The call log is in-memory and resets on restart. Contract tests use it to confirm backend non-arrival for denied calls.

## Replacing this server

To point the enforcement plane at a real MCP server:

1. Update `target` in `gateway/config.yaml` and `gateway/config.docker.yaml`
2. Update tool names in `gateway/config.yaml` to match your server
3. Update argument checks in `gateway/extmcp-policy/policy.ts`
4. Update tool names in `contract-tests/` fixtures

See [`ADOPTING.md`](../ADOPTING.md) for the full adoption guide.
