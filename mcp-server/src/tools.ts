/**
 * Tool definitions and handlers for the guidance-is-not-policy lab MCP server.
 *
 * Exposes three tools that demonstrate the enforcement boundary between
 * agent guidance (system prompt) and policy (gateway enforcement):
 *   - status:           read-only, no approval required
 *   - deploy:           write operation, staging is self-serve, production is guarded
 *   - production_admin: elevated operation, always requires explicit approval
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeployEnvironment = 'staging' | 'production';
export type ProductionAdminOperation = 'restart' | 'rollback' | 'scale';

// Return types for each tool
export interface StatusResult {
  environment: string;
  version: string;
  healthy: boolean;
  timestamp: string;
}

export interface DeployResult {
  success: boolean;
  environment: string;
  version: string;
  deployedAt: string;
  message: string;
}

export interface ProductionAdminResult {
  success: boolean;
  operation: string;
  target: string;
  executedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory deployment log (used by contract tests to verify backend receipt)
// Intentionally in-memory: resets on restart. Tests launch a fresh server
// process and then call deploy; a non-empty log proves the call reached
// the backend.
// ---------------------------------------------------------------------------

export const deploymentLog: Array<{
  environment: string;
  version: string;
  timestamp: string;
}> = [];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function handleStatus(): StatusResult {
  return {
    environment: 'production',
    version: '1.2.3',
    healthy: true,
    timestamp: new Date().toISOString(),
  };
}

export function handleDeploy(
  environment: DeployEnvironment,
  version: string
): DeployResult {
  const deployedAt = new Date().toISOString();

  // Record in deployment log so contract tests can verify backend receipt
  deploymentLog.push({ environment, version, timestamp: deployedAt });

  return {
    success: true,
    environment,
    version,
    deployedAt,
    message: `Successfully deployed version ${version} to ${environment}.`,
  };
}

export function handleProductionAdmin(
  operation: ProductionAdminOperation,
  target: string
): ProductionAdminResult {
  return {
    success: true,
    operation,
    target,
    executedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// MCP Tool definitions (JSON Schema for tools/list)
// ---------------------------------------------------------------------------

// We use a plain object type compatible with the SDK Tool interface to avoid
// importing SDK types here and creating a circular dependency with index.ts.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'status',
    description:
      'Returns the current deployment status of the service. ' +
      'Read-only — no side effects.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'deploy',
    description:
      'Deploys a service version to the specified environment. ' +
      'Staging deployments are self-serve; production deployments are ' +
      'subject to gateway policy enforcement.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          enum: ['staging', 'production'],
          description: 'Target deployment environment.',
        },
        version: {
          type: 'string',
          description: 'Semantic version string to deploy (e.g. "1.2.3").',
        },
      },
      required: ['environment', 'version'],
    },
  },
  {
    name: 'production_admin',
    description:
      'Performs an administrative operation on a production target. ' +
      'All operations are high-privilege and require explicit approval ' +
      'from the gateway policy layer before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['restart', 'rollback', 'scale'],
          description: 'Administrative operation to perform.',
        },
        target: {
          type: 'string',
          description:
            'Resource target for the operation (e.g. service name, instance ID).',
        },
      },
      required: ['operation', 'target'],
    },
  },
];
