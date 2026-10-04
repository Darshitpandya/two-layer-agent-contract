/**
 * Contract test helpers for the Two-Layer Agent Contract reference implementation.
 *
 * These helpers communicate with the three services in the lab stack:
 *   - Gateway    (default: http://localhost:3000) — policy-enforcing MCP proxy
 *   - MCP Server (default: http://localhost:3001) — backend tool executor
 *   - Policy     (default: http://localhost:3002) — ExtMCP policy processor
 */

// Base URLs — overridable via environment variables for CI
export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
export const MCP_SERVER_URL = process.env['MCP_SERVER_URL'] ?? 'http://localhost:3001';
export const POLICY_URL = process.env['POLICY_URL'] ?? 'http://localhost:3002';

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC helpers
// ---------------------------------------------------------------------------

/**
 * Sends a `tools/list` JSON-RPC request and returns the array of tool names.
 *
 * @param baseUrl   The base URL of the MCP endpoint (gateway or direct server).
 * @param identity  Optional agent identity; added as `X-Agent-Identity` header.
 */
export async function mcpToolsList(baseUrl: string, identity?: string): Promise<string[]> {
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (identity) {
    headers['X-Agent-Identity'] = identity;
  }

  const response = await fetch(`${baseUrl}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`tools/list HTTP ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as JsonRpcResponse;

  if (json.error) {
    throw new Error(`tools/list RPC error ${json.error.code}: ${json.error.message}`);
  }

  // The result is expected to be { tools: Array<{ name: string; ... }> }
  const result = json.result as { tools?: Array<{ name: string }> } | undefined;
  if (!result || !Array.isArray(result.tools)) {
    return [];
  }
  return result.tools.map((t) => t.name);
}

/**
 * Sends a `tools/call` JSON-RPC request.
 *
 * @param baseUrl   The base URL of the MCP endpoint (gateway or direct server).
 * @param tool      The tool name to call.
 * @param args      Arguments to pass to the tool.
 * @param identity  Optional agent identity; added as `X-Agent-Identity` header.
 */
export async function mcpToolsCall(
  baseUrl: string,
  tool: string,
  args: Record<string, unknown>,
  identity?: string
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (identity) {
    headers['X-Agent-Identity'] = identity;
  }

  const response = await fetch(`${baseUrl}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A non-2xx HTTP status still carries an RPC-level error — surface it.
    let text = '';
    try {
      text = await response.text();
    } catch {
      // ignore
    }
    return { error: { code: response.status, message: text || `HTTP ${response.status}` } };
  }

  const json = (await response.json()) as JsonRpcResponse;

  if (json.error) {
    return { error: { code: json.error.code, message: json.error.message } };
  }

  return { result: json.result };
}

// ---------------------------------------------------------------------------
// Policy processor helper
// ---------------------------------------------------------------------------

/**
 * Calls the policy processor directly to evaluate a tool/args pair.
 *
 * @param tool  The tool name being evaluated.
 * @param args  The arguments being passed to the tool.
 */
export async function policyCheck(
  tool: string,
  args: Record<string, unknown>
): Promise<{ allow: boolean; reason?: string }> {
  const response = await fetch(`${POLICY_URL}/policy/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: args }),
  });

  if (!response.ok) {
    throw new Error(`policyCheck HTTP ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as { allow: boolean; reason?: string };
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

/**
 * Returns `true` only if all three services respond to a health/list probe.
 * Used in `beforeAll` blocks to skip integration tests when the stack is down.
 */
export async function checkServicesAvailable(): Promise<boolean> {
  const checks = [
    fetch(`${GATEWAY_URL}/health`).catch(() => null),
    fetch(`${MCP_SERVER_URL}/health`).catch(() => null),
    fetch(`${POLICY_URL}/health`).catch(() => null),
  ];

  const results = await Promise.all(checks);
  return results.every((r) => r !== null && r.ok);
}

// ---------------------------------------------------------------------------
// MCP server call-log helper (used by denied / arg-sensitive tests)
// ---------------------------------------------------------------------------

/**
 * Fetches the in-memory call log from the MCP server's test endpoint.
 * Returns an array of { tool, args } records.
 */
export async function getMcpCallLog(): Promise<Array<{ tool: string; args: Record<string, unknown> }>> {
  const response = await fetch(`${MCP_SERVER_URL}/test/log`);
  if (!response.ok) {
    throw new Error(`GET /test/log HTTP ${response.status}`);
  }
  return (await response.json()) as Array<{ tool: string; args: Record<string, unknown> }>;
}

/**
 * Clears the in-memory call log on the MCP server (used in beforeEach).
 */
export async function clearMcpCallLog(): Promise<void> {
  const response = await fetch(`${MCP_SERVER_URL}/test/log`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /test/log HTTP ${response.status}`);
  }
}
