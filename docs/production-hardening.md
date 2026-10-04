# Production Hardening Guide

This document bridges the lab implementation to a real production deployment. The lab demonstrates the Two-Layer Agent Contract with minimal moving parts: a local MCP server, a local agentgateway instance, and hand-written ExtMCP policy. Production requires replacing each of these with durable, observable, correctly-credentialled equivalents.

Five gaps between the lab and production are addressed here:

1. [Replacing the lab MCP server](#1-replacing-the-lab-mcp-server)
2. [Wiring identity and credentials](#2-wiring-identity-and-credentials)
3. [Deploying agentgateway beyond localhost](#3-deploying-agentgateway-beyond-localhost)
4. [Writing your own AGENTS.md](#4-writing-your-own-agentsmd)
5. [Choosing your failure mode](#5-choosing-your-failure-mode)

---

## 1. Replacing the Lab MCP Server

The lab MCP server in [`mcp-server/`](../mcp-server/) exposes three tools — `status`, `deploy`, and `production_admin` — with simulated behaviour. In production, you will replace this server with one or more MCP servers that wrap your actual backends: deployment pipelines, cloud provider APIs, internal services.

### Step-by-step swap guide

**Step 1: Enumerate your tools.**  
List every action you want the agent to be able to take. For each action, identify:
- The tool name you will expose
- The arguments it accepts and their types
- The backend call it wraps
- The consequence profile (reversible vs. irreversible, blast radius)

**Step 2: Identify the tools that need argument-sensitive enforcement.**  
Any tool where the consequence depends on an argument value — `deploy(environment=...)`, `scale(replicas=...)`, `delete(resource=...)` — needs an ExtMCP policy rule that inspects that argument. Flag these during enumeration.

**Step 3: Implement your MCP server.**  
Your MCP server should expose only the tools enumerated in Step 1. Do not expose backend capabilities that are not in scope for the agent. The server itself is not the enforcement boundary — the gateway is — but a narrower backend surface reduces the blast radius of any policy misconfiguration.

Use the lab server as a template. The implementation pattern is:
```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // validate args, call backend, return result
});
```

**Step 4: Update the contract test fixtures.**  
The contract tests in [`contract-tests/`](../contract-tests/) reference the lab tool names. Update the fixtures to use your production tool names. The test structure stays the same: a positive test for each intended-access path, a negative test for each forbidden-access path.

**Step 5: Run the contract tests against your server.**  
Before connecting the agent, run the tests. Confirm the positive tests pass (intended paths work) and the negative tests pass (forbidden paths are blocked). Do not proceed until both polarities are green.

**When this is done:** the contract tests pass against your MCP server with your tool names in the test fixtures.

---

## 2. Wiring Identity and Credentials

The lab runs locally with no authentication. Production requires every request to carry verifiable identity so that authorization decisions can be made per-identity rather than per-request-origin.

### OIDC example configuration

OIDC (OpenID Connect) is the recommended approach for service-to-service identity. The agent authenticates with an identity provider, receives a JWT, and presents that JWT to agentgateway on each request. agentgateway validates the JWT and extracts the identity claims used in authorization rules.

```yaml
# agentgateway config excerpt — OIDC identity
listeners:
  - name: agent-listener
    protocol: mcp
    auth:
      type: oidc
      issuer: https://your-idp.example.com
      audience: agentgateway
      claims:
        identity: sub          # use the 'sub' claim as the identity
        role: agent_role       # optional: extract a role claim for policy

# Authorization rule referencing the extracted identity
mcpAuthorization:
  rules:
    - identity: "agent:coding-assistant"
      allow:
        - status
        - deploy
      deny:
        - production_admin
```

The agent obtains its JWT through the workload identity mechanism appropriate for its runtime: a Kubernetes ServiceAccount token, an AWS IAM role with OIDC federation, a GitHub Actions OIDC token, or a service account credential from your identity provider.

### API key example configuration

For simpler deployments where OIDC is not available, agentgateway supports API key authentication. Each agent instance or agent class is issued a key, and authorization rules reference the key or a label associated with it.

```yaml
# agentgateway config excerpt — API key identity
listeners:
  - name: agent-listener
    protocol: mcp
    auth:
      type: apikey
      header: X-Agent-Key
      keys:
        - key: "${AGENT_KEY_CODING}"      # resolved from environment
          identity: "agent:coding-assistant"
        - key: "${AGENT_KEY_INFRA}"
          identity: "agent:infra-assistant"
```

API keys must be rotated on a schedule and revoked immediately if compromised. Treat them as passwords.

### What NOT to do

**Do not use a shared key for all agent instances.** If one agent is compromised or behaves badly, a shared key means every agent instance is implicated. Use per-instance or per-class keys.

**Do not embed credentials in AGENTS.md.** AGENTS.md is committed to the repository. Anything in it is in version control history, visible to everyone with repository access, and potentially in model training data. Configuration that belongs in a secrets manager does not belong in AGENTS.md.

**Do not use long-lived static credentials if your platform supports short-lived tokens.** OIDC federation with short-lived JWTs is strictly better than a static API key that never expires. The blast radius of a leaked short-lived token is bounded by its expiry.

**Do not skip credential validation on the MCP server side.** The enforcement plane at the gateway provides the primary authorization boundary. The MCP server should still validate that requests arrive from the gateway rather than from an arbitrary source. Network policy (firewall rules, security groups, VPC controls) is the mechanism for this, not application-level credential checks in the MCP server itself — but those network controls must exist.

**When this is done:** a request with an invalid or missing credential is rejected at the gateway before reaching any policy evaluation.

---

## 3. Deploying agentgateway Beyond Localhost

The lab runs agentgateway as a local process. In production, the gateway must be reachable by the agent, must be highly available, and must be observable.

### Decision table

| Deployment context | Recommended pattern | Key consideration |
|---|---|---|
| **Single VM / bare metal** | Run agentgateway as a systemd service, reverse-proxied by nginx or caddy for TLS termination | Simplest operational model; single point of failure; suitable for low-stakes internal tooling |
| **Kubernetes** | Deploy as a Deployment with a Service; use a NetworkPolicy to restrict which pods can reach the gateway | Native health checks, rolling updates, and RBAC; be aware of issue #3092 regarding argument availability in Kubernetes-mode authorization rules |
| **ECS (AWS)** | Run as a Fargate task in a dedicated task definition; use a security group to restrict inbound access to agent task IPs | Integrates with AWS IAM for credential management; use ALB for TLS and health checking |
| **CI/CD pipeline** | Run agentgateway as a sidecar container in the CI job; tear it down with the job | No persistent infrastructure; gateway config committed with the pipeline definition; suitable for agent-driven CI tasks |

### All environments: common requirements

**TLS.** All communication between agent and gateway must be encrypted in transit. Do not run the gateway on plain HTTP outside localhost.

**Health checks.** Configure liveness and readiness probes. A gateway that is up but not passing requests is worse than a gateway that is clearly down — it will produce confusing error signals.

**Structured logging.** Configure agentgateway to emit structured logs for every request: identity, tool name, arguments (redacted if sensitive), policy decision, outcome. These logs are your audit trail.

**Metrics.** Instrument allow/deny counts per identity per tool. A spike in denials for a specific identity is an operational signal worth investigating.

**Policy config in version control.** The agentgateway config and ExtMCP policy files should be committed to a repository and deployed through a pipeline, not edited in place on a running instance. Changes to policy should be reviewed the same way application code changes are reviewed.

**When this is done:** the gateway is reachable from the agent runtime, protected by TLS, emitting structured logs, and its configuration is deployed from version control.

---

## 4. Writing Your Own AGENTS.md

AGENTS.md is the guidance plane artifact. It should give the agent accurate, repository-specific context that improves the quality of its proposals. It is not a security control, but it is a meaningful quality control.

### Three principles

**Principle 1: Be specific about what exists, not just what is allowed.**  
"Use the `deploy` tool with `environment=staging` for pre-release validation" is more useful than "only deploy to staging". The first version tells the agent what the tool is called and what argument value to use. The second version states a rule without giving the agent the vocabulary to follow it.

**Principle 2: Name the consequences, not just the prohibition.**  
"Do not use `production_admin` — this tool modifies live production infrastructure and all changes are immediately applied without review" is more useful than "do not use production_admin". The consequence statement gives the model a reason that will generalize to analogous situations.

**Principle 3: Keep it current.**  
An AGENTS.md that describes commands that no longer exist, or environments that have been renamed, actively misleads the agent. Treat it as documentation with a maintenance obligation, not a one-time setup artifact. Add AGENTS.md review to your deployment checklist when tool names or environment names change.

### Annotated example

```markdown
# Repository Guidance for [Project Name]

## Environment overview

This project deploys to two environments:
- **staging** (`env=staging`): pre-release validation environment.
  Safe to deploy to at any point during development.
- **production** (`env=production`): live environment serving real users.
  Requires a release ticket and human approval before deployment.

## Available MCP tools

- `status`: Check the current deployment status of an environment.
  Use this before proposing a deployment to confirm the current state.
  Arguments: `environment` (string, required): one of `staging`, `production`

- `deploy`: Deploy the current branch to an environment.
  Arguments: `environment` (string, required): prefer `staging` for development work.
  Note: a `production` deploy will be evaluated against authorization policy
  and may be rejected if a release ticket is not linked.

## What to propose

For feature development and bug fixes:
1. Run the test suite with `npm test`
2. If tests pass, propose `deploy(environment="staging")`
3. Confirm status with `status(environment="staging")`

For production releases:
- Do not propose a production deployment directly.
- Note in your response that a release ticket is required and that
  the human operator should initiate the production deployment process.

## What not to propose

- Do not propose commands that are not in the Available MCP tools section above.
- Do not propose direct modifications to infrastructure configuration files.
- Do not propose changes to CI/CD pipeline definitions without explicit request.
```

**When this is done:** a new team member reading AGENTS.md understands which tools exist, what arguments they accept, and what the expected workflow is — without needing to read additional documentation.

---

## 5. Choosing Your Failure Mode

When a policy evaluation encounters an error — malformed rule, evaluation exception, unexpected input shape — the policy processor must produce a decision without a valid policy result. That decision is governed by the configured failure mode.

### Tradeoff table

| Mode | Behaviour on evaluation error | Appropriate when |
|---|---|---|
| **failClosed** | Deny the request | Security is the primary concern; false negatives (blocking legitimate requests) are acceptable; an alert should fire and a human should investigate |
| **failOpen** | Allow the request | Availability is the primary concern; the backend has its own authorization; this policy layer is advisory rather than the primary gate; evaluation errors are expected to be transient |

### The decision question

Ask this question for each policy point you configure:

> If policy evaluation fails at this point and an unknown request is allowed through, what is the worst-case outcome?

If the worst-case outcome is a production deployment, a data deletion, or any action that is difficult to reverse and has a large blast radius: use failClosed.

If the worst-case outcome is a failed deployment that the operator would have approved anyway, or a blocked status check that can be retried: failOpen may be appropriate.

The failure mode is not a global setting — it can be configured per-rule or per-policy-block. It is reasonable to use failClosed for rules that gate production access and failOpen for rules that gate low-consequence read operations.

### What to never do

Do not leave the failure mode as an implicit default. Read your policy framework's documentation, find the default, and decide whether it matches your intent. If the default is failOpen and your policy is enforcing production access controls, you must explicitly configure failClosed.

Do not fail silently. Regardless of which mode you choose, a policy evaluation error should emit a log event and increment a metric. A failure mode decision is not a decision to ignore the failure.

### Testing your failure mode

Add a test that deliberately triggers a policy evaluation error — pass a malformed request, temporarily corrupt the policy file, inject an argument type the rule does not handle. Verify that the outcome matches your configured failure mode. This test is as important as the allow and deny tests.

**When this is done:** the failure mode for each policy point is explicitly configured, documented in a comment in the policy file, and verified by a test that triggers the error condition.
