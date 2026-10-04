/**
 * MCP Streamable HTTP server for the guidance-is-not-policy lab.
 *
 * Implements the MCP streamable HTTP transport so agentgateway v1.5.0 can
 * connect to it as a real MCP backend (not a plain JSON-RPC proxy).
 *
 * Protocol:
 *   POST /mcp  — MCP JSON-RPC requests and notifications
 *   GET  /mcp  — SSE stream for server-initiated messages
 *
 * Additional test-support endpoints (NOT for production):
 *   GET  /health      — liveness check
 *   GET  /test/log    — in-memory call log for contract test verification
 *   DELETE /test/log  — clear the call log
 *
 * Ports:
 *   MCP_HTTP_PORT (default 3001)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
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
// Contract tests use GET /test/log to verify whether a call was forwarded.
// ---------------------------------------------------------------------------

export interface CallLogEntry {
  tool: string;
  args: Record<string, unknown>;
  timestamp: string;
}

export const callLog: CallLogEntry[] = [];

// ---------------------------------------------------------------------------
// Session store — maps session ID to transport instance
// ---------------------------------------------------------------------------

const transports = new Map<string, StreamableHTTPServerTransport>();

// ---------------------------------------------------------------------------
// MCP Server factory — creates one Server per session
// ---------------------------------------------------------------------------

function createMcpServer(): Server {
  const server = new Server(
    { name: 'guidance-is-not-policy-lab', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    // Record every call that reaches the backend
    callLog.push({ tool: name, args, timestamp: new Date().toISOString() });

    switch (name) {
      case 'status': {
        const result = handleStatus();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      case 'deploy': {
        const environment = args['environment'] as DeployEnvironment | undefined;
        const version = args['version'] as string | undefined;

        if (!environment || !version) {
          return {
            content: [{ type: 'text' as const, text: 'Missing required parameters: environment, version' }],
            isError: true,
          };
        }

        if (environment !== 'staging' && environment !== 'production') {
          return {
            content: [{ type: 'text' as const, text: `Invalid environment: "${environment}". Must be staging or production.` }],
            isError: true,
          };
        }

        const result = handleDeploy(environment, version);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      case 'production_admin': {
        const operation = args['operation'] as ProductionAdminOperation | undefined;
        const target = args['target'] as string | undefined;

        if (!operation || !target) {
          return {
            content: [{ type: 'text' as const, text: 'Missing required parameters: operation, target' }],
            isError: true,
          };
        }

        const result = handleProductionAdmin(operation, target);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: "${name}"`);
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['MCP_HTTP_PORT'] ?? '3001', 10);

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', tools: TOOL_DEFINITIONS.map((t) => t.name) });
});

// ---------------------------------------------------------------------------
// MCP Streamable HTTP transport endpoints
// ---------------------------------------------------------------------------

/**
 * POST /mcp — Handle MCP requests (initialize, tools/list, tools/call, etc.)
 *
 * For initialize: creates a new session and returns a session ID.
 * For subsequent requests: routes to the existing session's transport.
 */
app.post('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (!sessionId) {
      // New session — initialize
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          console.error(`[MCP] Session initialized: ${sid}`);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          transports.delete(sid);
          console.error(`[MCP] Session closed: ${sid}`);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      // Existing session
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: `Session not found: ${sessionId}` });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    }
  } catch (err) {
    console.error('[MCP] Error handling request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * GET /mcp — SSE stream for server-initiated messages.
 */
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: 'mcp-session-id header required for SSE stream' });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: `Session not found: ${sessionId}` });
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[MCP] Error handling SSE request:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * DELETE /mcp — Clean up a session.
 */
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: 'mcp-session-id header required' });
    return;
  }

  const transport = transports.get(sessionId);
  if (transport) {
    await transport.close();
    transports.delete(sessionId);
  }

  res.status(200).json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Test support endpoints — NOT for production use
// ---------------------------------------------------------------------------

/**
 * GET /test/log
 * Returns the in-memory call log. Contract tests use this to verify that
 * a call did (or did not) reach the backend after a gateway decision.
 */
app.get('/test/log', (_req: Request, res: Response) => {
  res.json(callLog);
});

/**
 * DELETE /test/log
 * Clears the in-memory call log and deployment log.
 * Tests call this in beforeEach to start with a clean slate.
 */
app.delete('/test/log', (_req: Request, res: Response) => {
  callLog.length = 0;
  deploymentLog.length = 0;
  res.json({ cleared: true });
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.error(`[MCP] Lab MCP server (streamable HTTP) listening on port ${PORT}`);
    console.error(`[MCP] Tools: status, deploy, production_admin`);
    console.error(`[MCP] POST   /mcp        — MCP streamable HTTP endpoint`);
    console.error(`[MCP] GET    /health     — health check`);
    console.error(`[MCP] GET    /test/log   — call log (contract tests only)`);
  });
}

export { app };
