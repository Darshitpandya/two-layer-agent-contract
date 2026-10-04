/**
 * Lab gateway — policy-enforcing MCP proxy
 *
 * Architectural role:
 *   This gateway sits between AI agents and the backend MCP server.
 *   It is the ENFORCEMENT PLANE: all MCP requests pass through here,
 *   and every tools/call is evaluated against the policy processor
 *   BEFORE being forwarded to the backend.
 *
 * Two-Layer Contract:
 *   Layer 1 — Discovery filtering: tools/list responses are filtered based on
 *             the agent identity. lab-agent cannot see production_admin.
 *   Layer 2 — Call-time enforcement: tools/call requests are checked against
 *             the policy processor. Even if a caller bypasses discovery and
 *             tries to call a denied tool directly, the policy layer rejects it.
 *
 * Fail-closed: if the policy processor is unreachable, ALL calls are denied.
 * This is the only safe default.
 *
 * Ports:
 *   GATEWAY_PORT (default 3000) — this gateway
 *   MCP_SERVER_URL (default http://localhost:3001) — backend MCP server
 *   POLICY_URL (default http://localhost:3002) — policy processor
 */

import express from 'express';

const GATEWAY_PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3000', 10);
const MCP_SERVER_URL = process.env['MCP_SERVER_URL'] ?? 'http://localhost:3001';
const POLICY_URL = process.env['POLICY_URL'] ?? 'http://localhost:3002';

// ---------------------------------------------------------------------------
// Identity → allowed tool names (Layer 1: discovery filtering)
// ---------------------------------------------------------------------------

const IDENTITY_ALLOWLIST: Record<string, Set<string>> = {
  'lab-agent': new Set(['status', 'deploy']),
  'restricted-agent': new Set([]),
};

/**
 * Returns the set of tool names allowed for the given identity.
 * If the identity is unknown, returns an empty set (fail-closed).
 */
function getAllowedTools(identity: string): Set<string> {
  return IDENTITY_ALLOWLIST[identity] ?? new Set([]);
}

// ---------------------------------------------------------------------------
// Policy processor call (Layer 2: argument-sensitive enforcement)
// ---------------------------------------------------------------------------

interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

/**
 * Calls the ExtMCP policy processor to evaluate a tool/args pair.
 *
 * Fail-closed: if the policy processor is unreachable or throws, the call is
 * denied. This ensures that disrupting the policy processor does NOT grant
 * unrestricted access.
 */
async function evaluatePolicyExternal(
  tool: string,
  args: Record<string, unknown>
): Promise<PolicyDecision> {
  try {
    const response = await fetch(`${POLICY_URL}/policy/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, arguments: args }),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      console.error(`[GATEWAY] Policy check returned HTTP ${response.status}`);
      // Fail closed — deny on error
      return { allow: false, reason: 'policy processor returned an error; request denied (failClosed)' };
    }

    return (await response.json()) as PolicyDecision;
  } catch (err) {
    console.error('[GATEWAY] Policy processor unreachable:', err instanceof Error ? err.message : err);
    // Fail closed — deny when policy processor is unavailable
    return { allow: false, reason: 'policy processor unavailable; request denied (failClosed)' };
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function rpcSuccess(id: number | string, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Backend proxy
// ---------------------------------------------------------------------------

async function proxyToBackend(body: JsonRpcRequest, identity?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (identity) {
    headers['X-Agent-Identity'] = identity;
  }

  const response = await fetch(`${MCP_SERVER_URL}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return await response.json();
}

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', role: 'gateway' });
});

/**
 * MCP JSON-RPC endpoint.
 *
 * handles:
 *   tools/list — filtered by identity allowlist (Layer 1)
 *   tools/call — checked by policy processor (Layer 2) then forwarded
 */
app.post('/rpc', async (req, res) => {
  const body = req.body as Partial<JsonRpcRequest>;
  const id = body.id ?? null;
  const identity = req.headers['x-agent-identity'] as string | undefined;

  try {
    const { method, params = {} } = body;

    if (!method) {
      res.status(400).json(rpcError(id, -32600, 'Invalid Request: missing method'));
      return;
    }

    // ------------------------------------------------------------------
    // tools/list — Layer 1: filter by identity allowlist
    // ------------------------------------------------------------------
    if (method === 'tools/list') {
      // Fetch the full list from the backend
      const backendResponse = await proxyToBackend(
        { jsonrpc: '2.0', id: body.id ?? 1, method: 'tools/list', params: {} },
        identity
      ) as { result?: { tools?: Array<{ name: string }> }; error?: unknown };

      if (backendResponse.error) {
        res.json(backendResponse);
        return;
      }

      const allTools = backendResponse.result?.tools ?? [];

      if (!identity) {
        // No identity header → return empty list (fail-closed for discovery)
        res.json(rpcSuccess(id as number | string, { tools: [] }));
        return;
      }

      const allowed = getAllowedTools(identity);
      const filteredTools = allTools.filter((t) => allowed.has(t.name));

      res.json(rpcSuccess(id as number | string, { tools: filteredTools }));
      return;
    }

    // ------------------------------------------------------------------
    // tools/call — Layer 2: policy evaluation then forward
    // ------------------------------------------------------------------
    if (method === 'tools/call') {
      const name = (params as Record<string, unknown>)['name'] as string | undefined;
      const args = ((params as Record<string, unknown>)['arguments'] ?? {}) as Record<string, unknown>;

      if (!name) {
        res.status(400).json(rpcError(id, -32602, 'Invalid params: missing tool name'));
        return;
      }

      // Layer 1 check at call time: is the tool in the identity's allowlist?
      if (identity) {
        const allowed = getAllowedTools(identity);
        if (!allowed.has(name)) {
          console.log(`[GATEWAY] DENY (allowlist) tool=${name} identity=${identity}`);
          res.status(403).json(
            rpcError(id, -32603, `Tool "${name}" is not permitted for identity "${identity}"`)
          );
          return;
        }
      }

      // Layer 2: policy processor evaluation (argument-sensitive)
      const decision = await evaluatePolicyExternal(name, args);

      if (!decision.allow) {
        console.log(`[GATEWAY] DENY (policy) tool=${name} reason=${decision.reason ?? 'no reason'}`);
        res.status(403).json(
          rpcError(id, -32603, decision.reason ?? `Tool "${name}" denied by policy`)
        );
        return;
      }

      console.log(`[GATEWAY] ALLOW tool=${name}`);

      // Forward to backend
      const backendBody: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: body.id ?? 1,
        method: 'tools/call',
        params: { name, arguments: args },
      };

      const backendResponse = await proxyToBackend(backendBody, identity);
      res.json(backendResponse);
      return;
    }

    // Unknown method — forward to backend as-is
    const backendResponse = await proxyToBackend(body as JsonRpcRequest, identity);
    res.json(backendResponse);
  } catch (err: unknown) {
    console.error('[GATEWAY] Unexpected error:', err);
    res.status(500).json(
      rpcError(id, -32603, err instanceof Error ? err.message : 'Internal error')
    );
  }
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(GATEWAY_PORT, () => {
    console.log(`[GATEWAY] Policy-enforcing MCP gateway listening on port ${GATEWAY_PORT}`);
    console.log(`[GATEWAY] Backend MCP server: ${MCP_SERVER_URL}`);
    console.log(`[GATEWAY] Policy processor:   ${POLICY_URL}`);
    console.log(`[GATEWAY] Fail-closed: YES (policy unreachable = deny all)`);
  });
}

export { app };
