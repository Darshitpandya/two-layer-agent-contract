/**
 * HTTP wrapper for the guidance-is-not-policy lab MCP server.
 *
 * This file exposes the MCP tools over HTTP so that the gateway and contract
 * tests can interact with them via standard HTTP requests instead of stdio.
 *
 * Endpoints:
 *   GET  /health         — liveness check
 *   POST /rpc            — MCP JSON-RPC (tools/list, tools/call)
 *   GET  /test/log       — in-memory call log (contract test support)
 *   DELETE /test/log     — clear the call log (contract test support)
 *
 * Ports:
 *   MCP_HTTP_PORT (default 3001) — this server
 */

import express from 'express';
import {
  TOOL_DEFINITIONS,
  handleStatus,
  handleDeploy,
  handleProductionAdmin,
  deploymentLog,
  DeployEnvironment,
  ProductionAdminOperation,
} from './tools.js';

// ---------------------------------------------------------------------------
// In-memory call log — records every tools/call that reaches the backend.
// Used by contract tests to verify whether a call was forwarded or blocked.
// ---------------------------------------------------------------------------

interface CallLogEntry {
  tool: string;
  args: Record<string, unknown>;
  timestamp: string;
}

const callLog: CallLogEntry[] = [];

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string };
}

function rpcSuccess(id: number | string, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string
): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

function handleToolsList(): unknown {
  return { tools: TOOL_DEFINITIONS };
}

function handleToolsCall(
  name: string,
  args: Record<string, unknown>
): unknown {
  // Record in call log for contract test verification
  callLog.push({ tool: name, args, timestamp: new Date().toISOString() });

  switch (name) {
    case 'status': {
      const result = handleStatus();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'deploy': {
      const environment = args['environment'] as DeployEnvironment | undefined;
      const version = args['version'] as string | undefined;

      if (!environment || !version) {
        return {
          content: [{ type: 'text', text: 'Missing required parameters: environment, version' }],
          isError: true,
        };
      }

      if (environment !== 'staging' && environment !== 'production') {
        return {
          content: [{ type: 'text', text: `Invalid environment: "${environment}".` }],
          isError: true,
        };
      }

      const result = handleDeploy(environment, version);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'production_admin': {
      const operation = args['operation'] as ProductionAdminOperation | undefined;
      const target = args['target'] as string | undefined;

      if (!operation || !target) {
        return {
          content: [{ type: 'text', text: 'Missing required parameters: operation, target' }],
          isError: true,
        };
      }

      const result = handleProductionAdmin(operation, target);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    default:
      throw Object.assign(new Error(`Unknown tool: "${name}"`), { code: -32601 });
  }
}

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['MCP_HTTP_PORT'] ?? '3001', 10);

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tools: TOOL_DEFINITIONS.map((t) => t.name) });
});

// MCP JSON-RPC endpoint
app.post('/rpc', (req, res) => {
  const body = req.body as Partial<JsonRpcRequest>;
  const id = body.id ?? null;

  try {
    const { method, params = {} } = body;

    if (!method) {
      res.status(400).json(rpcError(id, -32600, 'Invalid Request: missing method'));
      return;
    }

    if (method === 'tools/list') {
      res.json(rpcSuccess(id as number | string, handleToolsList()));
      return;
    }

    if (method === 'tools/call') {
      const name = (params as Record<string, unknown>)['name'] as string | undefined;
      const args = ((params as Record<string, unknown>)['arguments'] ?? {}) as Record<string, unknown>;

      if (!name) {
        res.status(400).json(rpcError(id, -32602, 'Invalid params: missing tool name'));
        return;
      }

      try {
        const result = handleToolsCall(name, args);
        res.json(rpcSuccess(id as number | string, result));
      } catch (toolErr: unknown) {
        const code = typeof toolErr === 'object' && toolErr !== null && 'code' in toolErr
          ? (toolErr as { code: number }).code
          : -32603;
        const message = toolErr instanceof Error ? toolErr.message : String(toolErr);
        res.status(404).json(rpcError(id, code, message));
      }
      return;
    }

    res.status(404).json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: unknown) {
    console.error('[MCP HTTP] Unexpected error:', err);
    res.status(500).json(
      rpcError(id, -32603, err instanceof Error ? err.message : 'Internal error')
    );
  }
});

// ---------------------------------------------------------------------------
// Test support endpoints — NOT for production use
// ---------------------------------------------------------------------------

/**
 * GET /test/log
 * Returns the in-memory call log. Contract tests use this to verify that
 * a call did (or did not) reach the backend after a gateway decision.
 */
app.get('/test/log', (_req, res) => {
  res.json(callLog);
});

/**
 * DELETE /test/log
 * Clears the in-memory call log. Tests call this in beforeEach to start
 * with a clean slate.
 */
app.delete('/test/log', (_req, res) => {
  callLog.length = 0;
  deploymentLog.length = 0;
  res.json({ cleared: true });
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[MCP HTTP] Lab MCP server listening on port ${PORT}`);
    console.log(`[MCP HTTP] Tools: status, deploy, production_admin`);
    console.log(`[MCP HTTP] POST /rpc       — JSON-RPC endpoint`);
    console.log(`[MCP HTTP] GET  /health    — health check`);
    console.log(`[MCP HTTP] GET  /test/log  — call log (contract tests only)`);
  });
}

export { app, callLog };
