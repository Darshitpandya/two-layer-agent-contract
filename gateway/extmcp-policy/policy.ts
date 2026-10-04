/**
 * ExtMCP gRPC policy processor for guidance-is-not-policy.
 *
 * Implements the ExtMcp gRPC service from the agentgateway ExtMCP protocol:
 * https://github.com/agentgateway/agentgateway/blob/main/crates/protos/proto/ext_mcp.proto
 *
 * Protocol: cleartext HTTP/2 (h2c), required by agentgateway for ExtMCP processors.
 *
 * TWO-LAYER CONTRACT — this is LAYER 2:
 *   Layer 1 (mcpAuthorization in config.yaml) handles tool-name visibility and call-level
 *   authorization. It cannot see tool arguments (agentgateway v1.5 documented limitation).
 *
 *   Layer 2 (this server) receives the full MCP request BEFORE it reaches the backend.
 *   It CAN see tool arguments (they arrive as raw JSON bytes in McpRequest.mcp_request).
 *   It denies deploy(environment="production") while allowing deploy(environment="staging").
 *
 * Enforcement logic:
 *   deploy + environment="staging"    → Pass (allow, forward to backend)
 *   deploy + environment="production" → AuthorizationError (deny, never reaches backend)
 *   deploy + missing/invalid env      → AuthorizationError (fail-safe deny)
 *   Any other tool                    → Pass (mcpAuthorization handles tool-name control)
 *
 * Fail mode:
 *   Configured via FAILURE_MODE env var. Errors in policy evaluation default to deny (failClosed).
 *   agentgateway's failureMode in config.yaml separately controls what happens if THIS server
 *   is unreachable.
 *
 * Port: POLICY_GRPC_PORT env var (default 9001)
 * Health: also exposes HTTP health at POLICY_HTTP_PORT (default 3002) for contract tests
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Load proto definition
// ---------------------------------------------------------------------------

// Proto file is at gateway/ext_mcp.proto
// __dirname is either:
//   - gateway/extmcp-policy/         (ts-jest / ts-node running source)
//   - gateway/extmcp-policy/dist/    (compiled, running from dist/)
// Resolve to the correct path in both cases.
const isCompiledDist = __dirname.endsWith('dist') || __dirname.endsWith('dist/');
const PROTO_PATH = isCompiledDist
  ? path.join(__dirname, '..', '..', 'ext_mcp.proto')   // dist/ → up two
  : path.join(__dirname, '..', 'ext_mcp.proto');          // source → up one

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  // @grpc/proto-loader resolves google.protobuf.Struct natively — no includeDirs needed
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = grpc.loadPackageDefinition(packageDefinition) as any;

// ---------------------------------------------------------------------------
// Policy decision types
// ---------------------------------------------------------------------------

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Core policy evaluation — pure function, independently testable
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a tool call should be allowed.
 *
 * @param tool    - The MCP tool name
 * @param args    - The tool arguments as a parsed object
 * @returns PolicyDecision with allow=true to forward, allow=false to deny
 */
export function evaluatePolicy(tool: string, args: Record<string, unknown>): PolicyDecision {
  if (tool === 'deploy') {
    const env = args['environment'];

    if (env === 'staging') {
      return { allow: true };
    }

    if (env === 'production') {
      return {
        allow: false,
        reason: 'production deployments are not permitted through this MCP surface',
      };
    }

    // Missing or unrecognised environment — fail safe
    return {
      allow: false,
      reason: `deploy requires environment to be "staging"; got: ${JSON.stringify(env ?? null)}`,
    };
  }

  if (tool === 'production_admin') {
    return {
      allow: false,
      reason: 'production_admin is not available to this identity',
    };
  }

  // All other tools: pass through (mcpAuthorization handles tool-name control)
  return { allow: true };
}

// ---------------------------------------------------------------------------
// gRPC service implementation
// ---------------------------------------------------------------------------

/**
 * CheckRequest — called BEFORE the MCP call reaches the backend.
 * Returns Pass to forward, AuthorizationError to deny.
 */
function checkRequest(
  call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<unknown>
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const request = call.request as any;
    const method: string = request.method ?? '';
    const rawBytes: Buffer | null = request.mcp_request ?? null;

    // Only inspect tools/call — pass everything else
    if (method !== 'tools/call') {
      console.log(`[POLICY] ${method} → Pass (non-tool-call method)`);
      callback(null, { pass: {} });
      return;
    }

    // Parse JSON-RPC params from raw bytes
    let toolName = '';
    let toolArgs: Record<string, unknown> = {};

    if (rawBytes) {
      try {
        const params = JSON.parse(rawBytes.toString('utf8')) as Record<string, unknown>;
        toolName = (params['name'] as string) ?? '';
        toolArgs = (params['arguments'] as Record<string, unknown>) ?? {};
      } catch {
        // Malformed params — fail closed
        console.log(`[POLICY] tools/call malformed params → DENY`);
        callback(null, {
          error: {
            status_code: 7, // PERMISSION_DENIED
            body: 'malformed MCP request params; request denied',
          },
        });
        return;
      }
    }

    const decision = evaluatePolicy(toolName, toolArgs);

    if (decision.allow) {
      console.log(`[POLICY] tools/call tool=${toolName} → Pass`);
      callback(null, { pass: {} });
    } else {
      console.log(`[POLICY] tools/call tool=${toolName} → DENY: ${decision.reason}`);
      callback(null, {
        error: {
          status_code: 7, // PERMISSION_DENIED
          body: decision.reason ?? 'denied by policy',
        },
      });
    }
  } catch (err) {
    const failureMode = process.env['FAILURE_MODE'] ?? 'failClosed';
    console.error('[POLICY] Unexpected error in CheckRequest:', err);

    if (failureMode === 'failOpen') {
      console.log('[POLICY] failOpen: passing request despite error');
      callback(null, { pass: {} });
    } else {
      console.log('[POLICY] failClosed: denying request due to policy evaluation error');
      callback(null, {
        error: {
          status_code: 7,
          body: 'policy evaluation error; request denied (failClosed)',
        },
      });
    }
  }
}

/**
 * CheckResponse — called AFTER the MCP backend returns a result.
 * We don't mutate responses in this lab — pass all through.
 */
function checkResponse(
  call: grpc.ServerUnaryCall<unknown, unknown>,
  callback: grpc.sendUnaryData<unknown>
): void {
  callback(null, { pass: {} });
}

// ---------------------------------------------------------------------------
// gRPC server
// ---------------------------------------------------------------------------

const GRPC_PORT = parseInt(process.env['POLICY_GRPC_PORT'] ?? '9001', 10);
const HTTP_PORT = parseInt(process.env['POLICY_HTTP_PORT'] ?? '3002', 10);

function startGrpcServer(): grpc.Server {
  const server = new grpc.Server();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExtMcp = (proto as any).agentgateway.dev.ext_mcp.ExtMcp;
  server.addService(ExtMcp.service, {
    CheckRequest: checkRequest,
    CheckResponse: checkResponse,
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(), // h2c as required by agentgateway
    (err, port) => {
      if (err) {
        console.error('[POLICY] Failed to bind gRPC server:', err);
        process.exit(1);
      }
      console.log(`[POLICY] ExtMCP gRPC server listening on port ${port} (h2c)`);
      console.log(`[POLICY] failure mode: ${process.env['FAILURE_MODE'] ?? 'failClosed'}`);
      console.log(`[POLICY] Implements: CheckRequest (arg-sensitive), CheckResponse (pass-through)`);
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP health server — for contract tests and Docker health checks
// ---------------------------------------------------------------------------

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: 'grpc-extmcp' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[POLICY] HTTP health server on port ${HTTP_PORT} — GET /health`);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  startGrpcServer();
  startHealthServer();
}

export { startGrpcServer, startHealthServer };
