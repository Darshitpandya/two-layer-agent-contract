/**
 * HIDDEN: production_admin absent from discovery
 *
 * Proves that the gateway's tools/list surface is narrower than the backend's:
 *   1. production_admin IS present when querying the MCP server directly.
 *   2. production_admin is ABSENT when querying through the gateway.
 *   3. The gateway surface has strictly fewer tools than the backend surface.
 *
 * This is Layer 1 of the Two-Layer Agent Contract — restricting what the model
 * can discover and therefore what it can attempt to call.  Hiding a tool from
 * discovery is not the enforcement boundary (Layer 2 / fail-closed covers that),
 * but it is a meaningful reduction of the attack surface.
 *
 * Requires the full stack to be running: ./scripts/run-lab.sh
 */

import {
  GATEWAY_URL,
  MCP_SERVER_URL,
  checkServicesAvailable,
  mcpToolsList,
} from './helpers';

let servicesAvailable = false;

beforeAll(async () => {
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.warn(
      '\n⚠️  Services not running — HIDDEN tests will be skipped.\n' +
        '   Start the stack with: ./scripts/run-lab.sh\n'
    );
  }
});

describe('HIDDEN: production_admin absent from discovery', () => {
  test('production_admin appears in direct MCP server tools/list', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    // Query the backend directly — no policy filtering
    const directTools = await mcpToolsList(MCP_SERVER_URL);

    expect(directTools).toContain('production_admin');
  });

  test('production_admin is absent from gateway tools/list for lab-agent', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    // Query through the gateway — policy filtering applies
    const gatewayTools = await mcpToolsList(GATEWAY_URL, 'lab-agent');

    expect(gatewayTools).not.toContain('production_admin');
  });

  test('the effective surface is narrower than the backend surface', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    const directTools = await mcpToolsList(MCP_SERVER_URL);
    const gatewayTools = await mcpToolsList(GATEWAY_URL, 'lab-agent');

    // The gateway must expose strictly fewer tools than the backend
    expect(directTools.length).toBeGreaterThan(gatewayTools.length);

    // The backend has production_admin; the gateway does not
    expect(directTools).toContain('production_admin');
    expect(gatewayTools).not.toContain('production_admin');

    // Every tool the gateway exposes must also exist on the backend
    for (const tool of gatewayTools) {
      expect(directTools).toContain(tool);
    }
  });
});
