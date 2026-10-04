# guidance-is-not-policy — Lab MCP Server

This directory contains a minimal MCP server that acts as the **backend** in the Two-Layer Agent Contract reference implementation.

Its sole purpose is to expose three tools so that you can run the gateway and contract tests against a real (but in-process) MCP server without needing to provision actual infrastructure.

---

## What the three tools represent architecturally

| Tool | Risk tier | Who may call it |
|------|-----------|-----------------|
| `status` | Read-only | Any agent, no approval needed |
| `deploy` | Write — varies by environment | Staging: self-serve; Production: requires gateway approval |
| `production_admin` | Elevated / destructive | Always requires explicit human-in-the-loop approval from the gateway |

The tools intentionally cover three different risk tiers so the contract tests can verify that:

1. Low-risk calls pass through the gateway without friction.
2. Medium-risk calls (deploy to production) are blocked until a human approves them.
3. High-risk calls (`production_admin`) are always blocked by policy, regardless of what an agent's system prompt says.

This is the core claim of the Two-Layer Agent Contract: **guidance lives in the system prompt; enforcement lives in the gateway.** An agent that is merely asked nicely not to call `production_admin` can still call it — only the gateway can stop it.

---

## How to run

```bash
cd mcp-server
npm install
npm run build
npm start
```

The server speaks JSON-RPC over stdio. It logs startup and errors to **stderr**; stdout is reserved for the MCP protocol stream.

For development with live TypeScript recompilation:

```bash
npm run dev
```

---

## How to replace this server in production

This lab server is an in-process stub. To point the gateway at a real MCP server:

1. Replace the `mcp_server_url` (or equivalent transport config) in your gateway configuration with the real server's endpoint.
2. Remove or bypass this directory entirely — it is never imported by the gateway code directly.

See the root-level `README.md` for the full architecture and wiring instructions.

---

## The deployment log

`src/tools.ts` exports `deploymentLog`, an in-memory array that records every call to the `deploy` tool:

```ts
export const deploymentLog: Array<{
  environment: string;
  version: string;
  timestamp: string;
}>;
```

This array is **intentionally in-memory and resets on every restart**. Contract tests use it to verify that a `deploy` call actually reached the backend: the test launches a fresh server process (empty log), sends a request through the gateway, then inspects the log via a test-only introspection endpoint to confirm the backend received the call.

If you replace this server with a real implementation, use your backend's audit log or event stream as the equivalent verification mechanism.
