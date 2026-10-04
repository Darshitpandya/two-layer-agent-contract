/**
 * ExtMCP request-phase policy processor
 *
 * Architectural role:
 * agentgateway's mcpAuthorization layer enforces tool-name-level access control —
 * it can allow or deny a tool by name, but it cannot inspect the tool's arguments.
 * This server fills that gap.
 *
 * agentgateway calls POST /policy/check BEFORE forwarding any tools/call request
 * to the backend MCP server. This processor inspects the full request (tool name
 * + arguments) and returns { allow: true } or { allow: false, reason: "..." }.
 *
 * Example decisions this server makes that gateway-level authz cannot:
 *   deploy(environment="production")  → DENY  (same tool name as staging, different risk)
 *   deploy(environment="staging")     → ALLOW
 *   production_admin(...)             → DENY  (belt-and-suspenders; gateway also blocks)
 *
 * Failure mode:
 *   FAILURE_MODE=failOpen   → errors in policy evaluation ALLOW the request (dev only)
 *   FAILURE_MODE=failClosed → errors DENY the request (default, production-safe)
 */

import express, { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The decision returned by the policy processor.
 * allow=true means the request may proceed to the backend.
 * allow=false means agentgateway should reject the request with the given reason.
 */
export type PolicyDecision = {
  allow: boolean;
  reason?: string;
};

/**
 * The request body agentgateway sends to the policy processor.
 */
type PolicyCheckRequest = {
  tool: string;
  arguments: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Core policy evaluation (pure function — no HTTP, easily unit-testable)
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a tool call should be allowed.
 *
 * This function is the single source of truth for all policy decisions.
 * It is exported so it can be unit-tested independently of the HTTP server.
 *
 * Design principle: fail CLOSED on ambiguity. If a deploy call does not
 * specify an environment, deny it — do not guess the caller's intent.
 */
export function evaluatePolicy(
  tool: string,
  args: Record<string, unknown>
): PolicyDecision {
  // --- production_admin: always deny, regardless of arguments ---------------
  // This is belt-and-suspenders: agentgateway's mcpAuthorization should have
  // already blocked this at the name level. This processor adds argument-level
  // confirmation that even if the gateway rule is misconfigured, the tool is
  // never reached.
  if (tool === 'production_admin') {
    return {
      allow: false,
      reason: 'production_admin is not available to this identity',
    };
  }

  // --- deploy: argument-sensitive decisions ----------------------------------
  // This is the primary reason this policy processor exists.
  // mcpAuthorization allows "deploy" by name (for lab-agent), but we must
  // distinguish between safe (staging) and unsafe (production) invocations.
  if (tool === 'deploy') {
    const environment = args['environment'];

    // Missing environment argument: fail closed.
    // A deploy without a declared target environment is ambiguous and unsafe.
    if (environment === undefined || environment === null || environment === '') {
      return {
        allow: false,
        reason:
          'deploy requires an explicit environment argument; missing or empty value denied by policy',
      };
    }

    if (environment === 'production') {
      return {
        allow: false,
        reason:
          'production deployments are not permitted through this MCP surface',
      };
    }

    if (environment === 'staging') {
      return { allow: true };
    }

    // Unknown environment value: fail closed.
    // Only explicitly allow-listed environments are permitted.
    return {
      allow: false,
      reason: `deploy to environment "${String(environment)}" is not permitted; only "staging" is allowed`,
    };
  }

  // --- All other tools: allow (pass-through) --------------------------------
  // Tools not explicitly named in policy rules are allowed by default.
  // The gateway-level mcpAuthorization has already filtered to the identity's
  // allowlist, so any tool reaching this processor is already name-approved.
  return { allow: true };
}

// ---------------------------------------------------------------------------
// HTTP server (Express) — agentgateway integration surface
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const FAILURE_MODE = process.env['FAILURE_MODE'] ?? 'failClosed';
const failOpen = FAILURE_MODE === 'failOpen';

const app = express();
app.use(express.json());

/**
 * Health check endpoint.
 * agentgateway (and ops tooling) can poll this to verify the policy
 * processor is reachable before routing traffic through it.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * Policy check endpoint.
 * agentgateway calls this for every tools/call request it receives,
 * BEFORE forwarding to the backend MCP server.
 *
 * Request:  POST /policy/check
 *           Content-Type: application/json
 *           { "tool": "deploy", "arguments": { "environment": "production" } }
 *
 * Response: { "allow": false, "reason": "production deployments are not permitted..." }
 */
app.post('/policy/check', (req: Request, res: Response) => {
  try {
    const body = req.body as PolicyCheckRequest;
    const tool = body?.tool;
    const args = body?.arguments ?? {};

    // Basic input validation
    if (typeof tool !== 'string' || !tool) {
      res.status(400).json({
        allow: false,
        reason: 'invalid request: tool must be a non-empty string',
      });
      return;
    }

    const decision = evaluatePolicy(tool, args);

    // Structured log for observability — one line per decision
    const env =
      tool === 'deploy' && typeof args['environment'] === 'string'
        ? ` env=${args['environment']}`
        : '';
    const verdict = decision.allow ? 'ALLOW' : 'DENY';
    console.log(`[POLICY] tool=${tool}${env} -> ${verdict}`);
    if (!decision.allow && decision.reason) {
      console.log(`[POLICY]   reason: ${decision.reason}`);
    }

    res.json(decision);
  } catch (err) {
    // Failure mode: failOpen allows on error; failClosed denies on error.
    // The safe default (production) is failClosed — never allow on ambiguity.
    console.error('[POLICY] Error during policy evaluation:', err);

    if (failOpen) {
      console.warn('[POLICY] failOpen mode: allowing request despite error');
      res.json({ allow: true, reason: 'policy evaluation error; failOpen mode active' });
    } else {
      console.warn('[POLICY] failClosed mode: denying request due to error');
      res.status(500).json({
        allow: false,
        reason: 'policy evaluation error; request denied (failClosed)',
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Start server (only when run directly, not when imported for tests)
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[POLICY] ExtMCP policy processor listening on port ${PORT}`);
    console.log(`[POLICY] failure mode: ${FAILURE_MODE}`);
    console.log(`[POLICY] POST /policy/check  — policy evaluation endpoint`);
    console.log(`[POLICY] GET  /health        — health check endpoint`);
  });
}

export { app };
