/**
 * Lab MCP server entry point.
 *
 * Exposes three tools (status, deploy, production_admin) over stdio transport
 * so that the two-layer-agent-contract gateway and contract tests can interact
 * with a realistic but in-process backend.
 *
 * stdout is reserved for MCP JSON-RPC messages; all diagnostic output goes to
 * stderr so it does not corrupt the protocol stream.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  TOOL_DEFINITIONS,
  handleStatus,
  handleDeploy,
  handleProductionAdmin,
  DeployEnvironment,
  ProductionAdminOperation,
} from './tools.js';

// ---------------------------------------------------------------------------
// Server initialisation
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'two-layer-agent-contract-lab', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// tools/list — advertise available tools to the client
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

// ---------------------------------------------------------------------------
// tools/call — route to the correct handler based on tool name
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const safeArgs = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'status': {
      const result = handleStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    case 'deploy': {
      const environment = safeArgs['environment'] as DeployEnvironment;
      const version = safeArgs['version'] as string;

      if (!environment || !version) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required parameters: environment, version',
            },
          ],
          isError: true,
        };
      }

      if (environment !== 'staging' && environment !== 'production') {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid environment: "${environment}". Must be "staging" or "production".`,
            },
          ],
          isError: true,
        };
      }

      const result = handleDeploy(environment, version);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    case 'production_admin': {
      const operation = safeArgs['operation'] as ProductionAdminOperation;
      const target = safeArgs['target'] as string;

      if (!operation || !target) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required parameters: operation, target',
            },
          ],
          isError: true,
        };
      }

      if (
        operation !== 'restart' &&
        operation !== 'rollback' &&
        operation !== 'scale'
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid operation: "${operation}". Must be "restart", "rollback", or "scale".`,
            },
          ],
          isError: true,
        };
      }

      const result = handleProductionAdmin(operation, target);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: "${name}"`
      );
  }
});

// ---------------------------------------------------------------------------
// Connect and run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    'Lab MCP server started. Tools: status, deploy, production_admin\n'
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal error starting MCP server: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
