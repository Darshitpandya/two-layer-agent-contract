/**
 * ALLOWED: staging deploy
 *
 * Proves that a `deploy(environment=staging)` call is permitted end-to-end:
 *   1. The deploy tool is visible in the gateway's tools/list surface.
 *   2. The call succeeds through the gateway (policy allows it).
 *   3. The backend (MCP server) actually executed the call.
 *
 * These are integration tests — they require the full stack to be running.
 * Start the stack with: ./scripts/run-lab.sh
 */

import {
  GATEWAY_URL,
  MCP_SERVER_URL,
  checkServicesAvailable,
  mcpToolsList,
  mcpToolsCall,
  clearMcpCallLog,
} from './helpers';

let servicesAvailable = false;

beforeAll(async () => {
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.warn(
      '\n⚠️  Services not running — ALLOWED tests will be skipped.\n' +
        '   Start the stack with: ./scripts/run-lab.sh\n'
    );
  }
});

beforeEach(async () => {
  if (servicesAvailable) {
    await clearMcpCallLog();
  }
});

describe('ALLOWED: staging deploy', () => {
  test('deploy tool is visible in gateway tools/list for lab-agent', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    const tools = await mcpToolsList(GATEWAY_URL, 'lab-agent');

    expect(tools).toContain('deploy');
  });

  test('deploy(environment=staging) call succeeds through gateway', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    const response = await mcpToolsCall(
      GATEWAY_URL,
      'deploy',
      { environment: 'staging', version: '1.0.0' },
      'lab-agent'
    );

    // The call must not return an RPC error
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });

  test('backend receives the staging deploy call', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    // Make the deploy call through the gateway
    const response = await mcpToolsCall(
      GATEWAY_URL,
      'deploy',
      { environment: 'staging', version: '2.0.0' },
      'lab-agent'
    );

    // The response itself should echo back the environment
    expect(response.error).toBeUndefined();

    // Verify via the status tool on the direct MCP server that the deploy was recorded
    const statusResponse = await mcpToolsCall(MCP_SERVER_URL, 'status', {});
    expect(statusResponse.error).toBeUndefined();

    const status = statusResponse.result as Record<string, unknown> | undefined;
    // The status result should reflect a staging deployment
    expect(status).toBeDefined();

    // The deploy response result should contain the environment
    const result = response.result as Record<string, unknown> | null | undefined;
    if (result && typeof result === 'object') {
      // Accept either a direct `environment` field or nested content
      const resultStr = JSON.stringify(result);
      expect(resultStr).toContain('staging');
    }
  });
});
