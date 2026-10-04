/**
 * DENIED: direct invocation rejected regardless of discovery
 *
 * Proves that hiding a tool from tools/list is NOT the enforcement boundary.
 * Even when a caller bypasses discovery and invokes production_admin directly,
 * the gateway rejects the call at the policy layer.
 *
 * This is Layer 2 of the Two-Layer Agent Contract — the hard enforcement wall
 * that exists independent of what the model was told during discovery.
 *
 * Tests:
 *   1. tools/call for production_admin through the gateway returns an error.
 *   2. The denial does not depend on the tool having been in tools/list.
 *   3. The backend (MCP server) did NOT execute the production_admin call.
 *
 * Requires the full stack to be running: ./scripts/run-lab.sh
 */

import {
  GATEWAY_URL,
  checkServicesAvailable,
  mcpToolsList,
  mcpToolsCall,
  getMcpCallLog,
  clearMcpCallLog,
} from './helpers';

let servicesAvailable = false;

beforeAll(async () => {
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.warn(
      '\n⚠️  Services not running — DENIED tests will be skipped.\n' +
        '   Start the stack with: ./scripts/run-lab.sh\n'
    );
  }
});

beforeEach(async () => {
  if (servicesAvailable) {
    await clearMcpCallLog();
  }
});

describe('DENIED: direct invocation rejected regardless of discovery', () => {
  test('tools/call for production_admin through gateway returns an error', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    const response = await mcpToolsCall(
      GATEWAY_URL,
      'production_admin',
      { action: 'reset_db' },
      'lab-agent'
    );

    // The gateway must return an RPC-level error, not a successful result
    expect(response.error).toBeDefined();
    expect(response.result).toBeUndefined();
  });

  test('the denial does not require the tool to have been in tools/list', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    // First confirm production_admin is absent from the gateway's discovery surface
    const gatewayTools = await mcpToolsList(GATEWAY_URL, 'lab-agent');
    expect(gatewayTools).not.toContain('production_admin');

    // Now call it directly anyway — the gateway must still deny it
    const response = await mcpToolsCall(
      GATEWAY_URL,
      'production_admin',
      { action: 'list_users' },
      'lab-agent'
    );

    // Denied regardless of whether it was ever advertised
    expect(response.error).toBeDefined();

    // Architectural assertion: enforcement is independent of discovery
    // (the tool was NOT in tools/list, yet the call was still evaluated and denied)
    const wasInDiscovery = gatewayTools.includes('production_admin');
    expect(wasInDiscovery).toBe(false); // confirms the tool was hidden
    expect(response.error).toBeDefined(); // confirms it was still denied at call time
  });

  test('backend did not receive the production_admin call', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    // Attempt the denied call
    await mcpToolsCall(
      GATEWAY_URL,
      'production_admin',
      { action: 'drop_table', table: 'users' },
      'lab-agent'
    );

    // Inspect the MCP server's in-memory call log
    const log = await getMcpCallLog();

    // The backend must have zero records of production_admin being called
    const adminCalls = log.filter((entry) => entry.tool === 'production_admin');
    expect(adminCalls).toHaveLength(0);
  });
});
