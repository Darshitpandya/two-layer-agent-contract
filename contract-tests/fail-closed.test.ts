/**
 * FAIL-CLOSED: real integration test
 *
 * Proves fail-closed by actually stopping the tlac-policy container.
 * Requires: docker compose stack running (make up)
 * Requires: Docker CLI available
 *
 * Sequence:
 *   STEP A: policy available → deploy(staging) → ALLOW, backend log contains call
 *   STEP B: docker stop tlac-policy → deploy(staging) → DENY, backend log empty
 *   STEP C: docker start tlac-policy → wait for health → deploy(staging) → ALLOW, backend log contains call
 */
import { execSync } from 'node:child_process';
import {
  GATEWAY_URL,
  MCP_SERVER_URL,
  POLICY_URL,
  mcpToolsCall,
  getMcpCallLog,
  clearMcpCallLog,
} from './helpers';

const CONTAINER = 'tlac-policy';
const TIMEOUT = 60_000;

function dockerRun(cmd: string): void {
  execSync(cmd, { stdio: 'pipe' });
}

function containerRunning(name: string): boolean {
  try {
    const out = execSync(`docker inspect --format={{.State.Running}} ${name}`, { stdio: 'pipe' })
      .toString()
      .trim();
    return out === 'true';
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, expectUp: boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (expectUp && r.ok) return;
    } catch {
      if (!expectUp) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitForHealth timeout: ${url} expectUp=${expectUp}`);
}

beforeAll(async () => {
  // Docker must be available
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Docker is required for fail-closed integration tests. Install Docker Desktop.'
    );
  }

  // Stack must be running — check gateway responsiveness
  const gwOk = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'health', version: '1.0.0' },
      },
    }),
  })
    .then(() => true)
    .catch(() => false);

  if (!gwOk) throw new Error('Stack not running. Start with: make up');

  // Policy container must be running
  if (!containerRunning(CONTAINER)) {
    throw new Error(`Container '${CONTAINER}' not running. Start with: make up`);
  }
}, TIMEOUT);

afterAll(async () => {
  // Always ensure policy container is running after tests finish
  if (!containerRunning(CONTAINER)) {
    try {
      dockerRun(`docker start ${CONTAINER}`);
      await waitForHealth(`${POLICY_URL}/health`, true, 15_000).catch(() => {});
    } catch {
      // Best-effort cleanup — don't mask test failures
    }
  }
});

describe('FAIL-CLOSED: policy processor unavailable', () => {
  // Increase timeout for entire describe block — docker stop/start cycle takes ~15s
  jest.setTimeout(TIMEOUT);

  test('STEP A: deploy(staging) succeeds when policy is available', async () => {
    await clearMcpCallLog();
    const marker = `FAILCLOSED-BEFORE-${Date.now()}`;

    const response = await mcpToolsCall(GATEWAY_URL, 'deploy', {
      environment: 'staging',
      version: marker,
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const log = await getMcpCallLog();
    const ourCall = log.find((e) => e.tool === 'deploy' && e.args['version'] === marker);
    expect(ourCall).toBeDefined(); // backend received the call
  });

  test('STEP B: deploy(staging) is denied when policy container is stopped', async () => {
    await clearMcpCallLog();

    // Actually stop the container
    dockerRun(`docker stop ${CONTAINER}`);
    await waitForHealth(`${POLICY_URL}/health`, false, 10_000);

    try {
      const marker = `FAILCLOSED-DURING-${Date.now()}`;
      const response = await mcpToolsCall(GATEWAY_URL, 'deploy', {
        environment: 'staging',
        version: marker,
      });

      // Gateway must deny — fail-closed
      expect(response.error).toBeDefined();
      expect(response.result).toBeUndefined();

      // Backend must not have received the call
      const log = await getMcpCallLog();
      const ourCall = log.find((e) => e.args?.['version'] === marker);
      expect(ourCall).toBeUndefined(); // backend did NOT receive the call
    } finally {
      // Always restart policy container regardless of test outcome
      dockerRun(`docker start ${CONTAINER}`);
      await waitForHealth(`${POLICY_URL}/health`, true, 15_000);
      // Give the gateway time to detect and re-establish its gRPC connection
      // to the policy processor (agentgateway uses connection pooling with backoff)
      await new Promise((r) => setTimeout(r, 5_000));
    }
  });

  test('STEP C: deploy(staging) succeeds after policy container is restored', async () => {
    // Policy was restarted in STEP B's finally block (including gateway reconnect wait)
    await clearMcpCallLog();
    const marker = `FAILCLOSED-AFTER-${Date.now()}`;

    // Retry the call until the gateway has fully reconnected to the policy processor.
    // The gateway may need a few extra seconds after the policy HTTP health endpoint
    // is up before its internal gRPC connection pool is ready.
    let response: { result?: unknown; error?: { code: number; message: string } } = {};
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      response = await mcpToolsCall(GATEWAY_URL, 'deploy', {
        environment: 'staging',
        version: marker,
      });
      if (!response.error) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const log = await getMcpCallLog();
    const ourCall = log.find((e) => e.tool === 'deploy' && e.args['version'] === marker);
    expect(ourCall).toBeDefined(); // backend received the call after recovery
  });
});
