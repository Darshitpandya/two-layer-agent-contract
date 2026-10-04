/**
 * Unit tests for the ExtMCP policy processor's core evaluation logic.
 *
 * These tests target the exported `evaluatePolicy` function directly —
 * no HTTP server is started, no ports are bound. This keeps the tests
 * fast, isolated, and runnable in any CI environment.
 *
 * The tests document the policy rules as living specification:
 *   - deploy(staging)           → ALLOW
 *   - deploy(production)        → DENY  (argument-sensitive decision)
 *   - deploy(missing env)       → DENY  (fail safe / fail closed)
 *   - production_admin(any)     → DENY  (always blocked)
 *   - status()                  → ALLOW (safe read-only tool)
 *   - unknown tool              → ALLOW (pass-through; gateway filters first)
 */

import { evaluatePolicy, PolicyDecision } from './policy';

describe('evaluatePolicy', () => {
  // -------------------------------------------------------------------------
  // deploy tool — the primary argument-sensitive case
  // -------------------------------------------------------------------------

  describe('deploy tool', () => {
    it('allows deploy with environment=staging', () => {
      const decision: PolicyDecision = evaluatePolicy('deploy', {
        environment: 'staging',
      });

      expect(decision.allow).toBe(true);
      // No reason needed when allowing
      expect(decision.reason).toBeUndefined();
    });

    it('denies deploy with environment=production', () => {
      const decision: PolicyDecision = evaluatePolicy('deploy', {
        environment: 'production',
      });

      expect(decision.allow).toBe(false);
      // Reason must mention "production" so callers understand the restriction
      expect(decision.reason).toBeDefined();
      expect(decision.reason).toMatch(/production/i);
    });

    it('denies deploy with missing environment argument (fail safe)', () => {
      // Ambiguous calls are denied — do not guess the caller's intent
      const decision: PolicyDecision = evaluatePolicy('deploy', {});

      expect(decision.allow).toBe(false);
      expect(decision.reason).toBeDefined();
      // Reason should explain the missing argument
      expect(decision.reason).toMatch(/environment/i);
    });

    it('denies deploy with explicit undefined environment argument', () => {
      const decision: PolicyDecision = evaluatePolicy('deploy', {
        environment: undefined,
      });

      expect(decision.allow).toBe(false);
      expect(decision.reason).toBeDefined();
    });

    it('denies deploy with an unknown/unlisted environment value', () => {
      // Only staging is explicitly allowed — dev, test, etc. are denied
      const decision: PolicyDecision = evaluatePolicy('deploy', {
        environment: 'development',
      });

      expect(decision.allow).toBe(false);
      expect(decision.reason).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // production_admin tool — always denied regardless of arguments
  // -------------------------------------------------------------------------

  describe('production_admin tool', () => {
    it('denies production_admin with any operation argument', () => {
      const decision: PolicyDecision = evaluatePolicy('production_admin', {
        operation: 'scale-down',
      });

      expect(decision.allow).toBe(false);
      expect(decision.reason).toBeDefined();
      // Reason should reference the identity restriction
      expect(decision.reason).toMatch(/production_admin/i);
    });

    it('denies production_admin with no arguments', () => {
      const decision: PolicyDecision = evaluatePolicy('production_admin', {});

      expect(decision.allow).toBe(false);
      expect(decision.reason).toBeDefined();
    });

    it('denies production_admin regardless of identity hint in arguments', () => {
      // Even if someone smuggles an "identity" argument claiming to be admin,
      // the tool is still denied — policy is not based on self-reported args
      const decision: PolicyDecision = evaluatePolicy('production_admin', {
        identity: 'super-admin',
        operation: 'override',
      });

      expect(decision.allow).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // status tool — safe read-only, always allowed
  // -------------------------------------------------------------------------

  describe('status tool', () => {
    it('allows status with no arguments', () => {
      const decision: PolicyDecision = evaluatePolicy('status', {});

      expect(decision.allow).toBe(true);
    });

    it('allows status with arbitrary arguments', () => {
      const decision: PolicyDecision = evaluatePolicy('status', {
        component: 'api-server',
        verbose: true,
      });

      expect(decision.allow).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown/unrecognised tools — pass-through allowed
  // -------------------------------------------------------------------------

  describe('unknown tools', () => {
    it('allows an unknown tool (pass-through)', () => {
      // The gateway's mcpAuthorization already filtered to the identity's
      // allowlist; any tool reaching this processor is name-approved.
      const decision: PolicyDecision = evaluatePolicy('list-deployments', {});

      expect(decision.allow).toBe(true);
    });

    it('allows another unknown tool with arguments', () => {
      const decision: PolicyDecision = evaluatePolicy('get-logs', {
        service: 'auth',
        lines: 100,
      });

      expect(decision.allow).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // PolicyDecision type contract — verify shape consistency
  // -------------------------------------------------------------------------

  describe('PolicyDecision shape', () => {
    it('returns allow=true with no reason for allowed tools', () => {
      const decision = evaluatePolicy('status', {});

      expect(decision).toHaveProperty('allow', true);
      // reason should not be present for allowed decisions
      expect(decision.reason).toBeUndefined();
    });

    it('returns allow=false with a non-empty reason string for denied tools', () => {
      const decision = evaluatePolicy('production_admin', {});

      expect(decision).toHaveProperty('allow', false);
      expect(typeof decision.reason).toBe('string');
      expect((decision.reason as string).length).toBeGreaterThan(0);
    });
  });
});
