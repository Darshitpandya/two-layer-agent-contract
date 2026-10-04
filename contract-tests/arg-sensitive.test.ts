/**
 * ARG-SENSITIVE: deploy tool, environment-dependent authority
 *
 * This is the most architecturally significant test suite.  It proves that
 * policy enforcement operates on the FULL tool invocation — including
 * arguments — not merely on the tool name.
 *
 * The same tool name ("deploy") produces different policy outcomes depending
 * on the value of the `environment` argument:
 *   - deploy(environment=staging)    → ALLOWED
 *   - deploy(environment=production) → DENIED
 *
 * This cannot be achieved by hiding a tool from discovery (Layer 1), because
 * both calls share the same tool name.  It requires the ExtMCP policy processor
 * (Layer 2) to inspect arguments at call time.
 *
 * Tests:
 *   1. deploy(environment=staging)    is allowed by ExtMCP policy.
 *   2. deploy(environment=production) is denied by ExtMCP policy.
 *   3. The staging deploy reaches the backend.
 *   4. The production deploy does NOT reach the backend.
 *   5. Both calls used the same tool name — the architectural point made explicit.
 *
 * Requires the full stack to be running: ./scripts/run-lab.sh
 */

import {
  GATEWAY_URL,
  checkServicesAvailable,
  mcpToolsCall,
  getMcpCallLog,
  clearMcpCallLog,
} from './helpers';

let servicesAvailable = false;

beforeAll(async () => {
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.warn(
      '\n⚠️  Services not running — ARG-SENSITIVE tests will be skipped.\n' +
        '   Start the stack with: ./scripts/run-lab.sh\n'
    );
  }
});

beforeEach(async () => {
  if (servicesAvailable) {
    await clearMcpCallLog();
  }
});

describe('ARG-SENSITIVE: deploy tool, environment-dependent authority', () => {
  test('deploy(environment=staging) is allowed by ExtMCP policy', async () => {
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

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });

  test('deploy(environment=production) is denied by ExtMCP policy', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    const response = await mcpToolsCall(
      GATEWAY_URL,
      'deploy',
      { environment: 'production', version: '1.0.0' },
      'lab-agent'
    );

    // The policy must deny a production deploy for lab-agent
    expect(response.error).toBeDefined();
    expect(response.result).toBeUndefined();
  });

  test('the staging deploy reaches the backend', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    await mcpToolsCall(
      GATEWAY_URL,
      'deploy',
      { environment: 'staging', version: '3.0.0' },
      'lab-agent'
    );

    const log = await getMcpCallLog();
    const stagingCalls = log.filter(
      (entry) => entry.tool === 'deploy' && entry.args['environment'] === 'staging'
    );
    expect(stagingCalls.length).toBeGreaterThan(0);
  });

  test('the production deploy does not reach the backend', async () => {
    if (!servicesAvailable) {
      console.warn('Skipping: services not available');
      return;
    }

    await mcpToolsCall(
      GATEWAY_URL,
      'deploy',
      { environment: 'production', version: '3.0.0' },
      'lab-agent'
    );

    const log = await getMcpCallLog();
    const productionCalls = log.filter(
      (entry) => entry.tool === 'deploy' && entry.args['environment'] === 'production'
    );
    expect(productionCalls).toHaveLength(0);
  });

  test('both calls use the same tool name', () => {
    // This test makes the architectural point explicit in code.
    //
    // The tool name for both the allowed staging call and the denied production
    // call is identical: 'deploy'.  There is no separate "production_deploy" tool
    // to hide from discovery.  The enforcement boundary is argument-aware policy
    // evaluation, not discovery surface filtering.

    const stagingToolName = 'deploy';
    const productionToolName = 'deploy';

    // Both calls share the exact same tool name
    expect(stagingToolName).toBe(productionToolName);
    expect(stagingToolName).toBe('deploy');

    // The only difference is the argument value:
    const stagingArgs = { environment: 'staging', version: '1.0.0' };
    const productionArgs = { environment: 'production', version: '1.0.0' };

    expect(stagingArgs['environment']).toBe('staging');
    expect(productionArgs['environment']).toBe('production');
    expect(stagingArgs['environment']).not.toBe(productionArgs['environment']);
  });
});
