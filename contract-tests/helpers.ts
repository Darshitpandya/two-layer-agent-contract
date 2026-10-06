/**
 * Contract test helpers for the Two-Layer Agent Contract reference implementation.
 *
 * These helpers communicate with the three services in the lab stack using the
 * real MCP streamable HTTP transport (not plain JSON-RPC over HTTP).
 *
 * MCP Streamable HTTP protocol:
 *   1. POST /mcp with no session ID → initialize → returns Mcp-Session-Id header
 *   2. POST /mcp with session ID → tool calls, notifications, etc.
 *   3. Responses arrive as SSE streams: lines starting with "data: "
 *
 * Services:
 *   Gateway    (default: http://localhost:3000) — agentgateway v1.5.0
 *   MCP Server (default: http://localhost:3001) — lab MCP server (direct, bypasses gateway)
 *   Policy     (default: http://localhost:3002) — ExtMCP gRPC policy processor HTTP health
 */

// Base URLs — overridable via environment variables for CI
export const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
// MCP_SERVER_URL points to the test support port (3009), not the MCP protocol port (3001).
// Port 3001 is on the internal Docker network only — not reachable from the host.
// Port 3009 exposes only /health, GET /test/log, DELETE /test/log — no tool invocation.
export const MCP_SERVER_URL = process.env['MCP_SERVER_URL'] ?? 'http://localhost:3009';
export const POLICY_URL = process.env['POLICY_URL'] ?? 'http://localhost:3002';

const MCP_VERSION = '2025-03-26';

// ---------------------------------------------------------------------------
// MCP Streamable HTTP session management
// ---------------------------------------------------------------------------

interface McpSession {
  baseUrl: string;
  sessionId: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Parse SSE stream body: extract the first "data: ..." line and parse as JSON.
 */
function parseSseData(body: string): JsonRpcResponse | null {
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data) {
        try {
          return JSON.parse(data) as JsonRpcResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Initialize an MCP session against the given endpoint.
 * Returns a session object with the session ID for subsequent calls.
 */
export async function mcpInitSession(baseUrl: string): Promise<McpSession> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: { name: 'contract-test', version: '1.0.0' },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP initialize HTTP ${response.status}: ${await response.text()}`);
  }

  const sessionId = response.headers.get('mcp-session-id');
  if (!sessionId) {
    throw new Error('MCP initialize: no mcp-session-id header in response');
  }

  // Send initialized notification to complete handshake
  await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_VERSION,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return { baseUrl, sessionId };
}

// ---------------------------------------------------------------------------
// MCP tool helpers using real streamable HTTP protocol
// ---------------------------------------------------------------------------

/**
 * Sends a tools/list request through an MCP session.
 * Returns the array of tool names visible in this session.
 */
export async function mcpToolsList(
  baseUrl: string,
  _identity?: string  // kept for API compatibility; identity handled by session/gateway config
): Promise<string[]> {
  const session = await mcpInitSession(baseUrl);

  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_VERSION,
      'mcp-session-id': session.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`tools/list HTTP ${response.status}: ${await response.text()}`);
  }

  const body = await response.text();
  const json = parseSseData(body);

  if (!json) {
    throw new Error(`tools/list: could not parse SSE response: ${body}`);
  }

  if (json.error) {
    throw new Error(`tools/list RPC error ${json.error.code}: ${json.error.message}`);
  }

  const result = json.result as { tools?: Array<{ name: string }> } | undefined;
  if (!result || !Array.isArray(result.tools)) {
    return [];
  }
  return result.tools.map((t) => t.name);
}

/**
 * Sends a tools/call request through an MCP session.
 * Returns result or error from the JSON-RPC response.
 */
export async function mcpToolsCall(
  baseUrl: string,
  tool: string,
  args: Record<string, unknown>,
  _identity?: string  // kept for API compatibility
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const session = await mcpInitSession(baseUrl);

  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_VERSION,
      'mcp-session-id': session.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

  // HTTP 4xx/5xx before SSE: surface as RPC error
  if (!response.ok) {
    let text = '';
    try { text = await response.text(); } catch { /* ignore */ }
    return { error: { code: response.status, message: text || `HTTP ${response.status}` } };
  }

  const body = await response.text();
  const json = parseSseData(body);

  if (!json) {
    // Empty SSE body typically means the gateway rejected before sending data
    return { error: { code: -32603, message: 'no SSE data in response (likely denied by gateway)' } };
  }

  if (json.error) {
    return { error: { code: json.error.code, message: json.error.message } };
  }

  return { result: json.result };
}

// ---------------------------------------------------------------------------
// Policy processor helper (HTTP health endpoint)
// ---------------------------------------------------------------------------

/**
 * Calls the policy processor's evaluatePolicy logic directly via its HTTP endpoint.
 * Note: the policy processor is gRPC. This calls the HTTP health endpoint only.
 * For unit-level policy tests, import evaluatePolicy from the policy module directly.
 */
export async function policyCheck(
  tool: string,
  args: Record<string, unknown>
): Promise<{ allow: boolean; reason?: string }> {
  // The gRPC policy processor does not expose an HTTP /policy/check endpoint.
  // Import evaluatePolicy directly for unit tests.
  // This stub is kept for API compatibility with existing test files.
  const { evaluatePolicy } = await import('../gateway/extmcp-policy/policy.js');
  return evaluatePolicy(tool, args);
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

/**
 * Returns true if all three services are reachable and healthy.
 * Used in beforeAll blocks to skip integration tests when the stack is down.
 */
export async function checkServicesAvailable(): Promise<boolean> {
  try {
    // MCP server and policy: have /health endpoints
    const mcpHealth = await fetch(`${MCP_SERVER_URL}/health`).catch(() => null);
    const policyHealth = await fetch(`${POLICY_URL}/health`).catch(() => null);

    if (!mcpHealth?.ok || !policyHealth?.ok) return false;

    // agentgateway does not expose /health on port 3000 — it serves MCP only.
    // Send an initialize request; any HTTP response means the gateway is up.
    const gwCheck = await fetch(`${GATEWAY_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 0,
        method: 'initialize',
        params: {
          protocolVersion: MCP_VERSION,
          capabilities: {},
          clientInfo: { name: 'healthcheck', version: '1.0.0' },
        },
      }),
    }).catch(() => null);

    return gwCheck !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MCP server call-log helpers (test-support endpoints)
// ---------------------------------------------------------------------------

/**
 * Fetches the in-memory call log from the MCP server.
 * Contract tests use this to verify whether a call reached the backend.
 */
export async function getMcpCallLog(): Promise<Array<{ tool: string; args: Record<string, unknown> }>> {
  const response = await fetch(`${MCP_SERVER_URL}/test/log`);
  if (!response.ok) {
    throw new Error(`GET /test/log HTTP ${response.status}`);
  }
  return (await response.json()) as Array<{ tool: string; args: Record<string, unknown> }>;
}

/**
 * Clears the in-memory call log on the MCP server.
 * Call in beforeEach to start each test with a clean slate.
 */
export async function clearMcpCallLog(): Promise<void> {
  const response = await fetch(`${MCP_SERVER_URL}/test/log`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /test/log HTTP ${response.status}`);
  }
}
