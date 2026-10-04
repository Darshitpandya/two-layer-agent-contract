# Security Policy

## Scope

This repo demonstrates a specific enforcement boundary. The following properties are within scope:

- **MCP discovery filtering**: unauthorized tools are excluded from `tools/list` responses for the configured identity
- **MCP invocation authorization**: `tools/call` requests for unauthorized tools are rejected before reaching the backend
- **Argument-sensitive request policy**: tool calls with specific argument values can be allowed or denied by the ExtMCP policy processor
- **Fail-mode behaviour**: when the policy processor is unavailable, the configured failure mode (`failClosed` or `failOpen`) is applied

This is a reference implementation. The lab MCP server, gateway configuration, and policy processor are provided as a working example of the pattern. They are not production-hardened infrastructure.

## What this repo does not protect

The enforcement plane in this repo addresses one specific path: MCP tool invocations routed through agentgateway. It does not address:

- **Model alignment or instruction-following reliability** — guidance in AGENTS.md influences but does not bind model behaviour; this is the thesis of the talk, not a gap to fill
- **Prompt injection in general** — the enforcement plane addresses one MCP path; other injection vectors (system prompt manipulation, tool output injection, multi-turn steering) are out of scope
- **Credential lifecycle, secrets management, or key rotation** — the lab uses placeholder credentials; production credential management is the responsibility of the deploying team
- **Host sandboxing or subprocess privileges** — the MCP server process runs with whatever privileges the host grants it; this repo does not constrain that
- **MCP server input validation or correctness** — the lab MCP server is intentionally minimal; it does not validate arguments beyond what TypeScript types enforce at compile time
- **Non-MCP paths to the same backend** — shell access, direct API calls, and ambient credentials are all out of scope; if they exist, the enforcement boundary demonstrated here does not cover them
- **The lab MCP server itself** — it is not hardened; it exists to demonstrate the pattern, not to be deployed as infrastructure

The OpenAI Agents SDK [SECURITY.md](https://github.com/openai/openai-agents-python/blob/main/SECURITY.md) assigns applications responsibility for authorizing tools, credentials, and subprocess privileges. The same responsibility applies here — this repo shows one mechanism for tool authorization; the rest remains with the team deploying it.

## Reporting a vulnerability

If you find a bypass of the demonstrated enforcement boundary in this reference implementation:

- Use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository
- Include: the bypass method, which contract test should have caught it, and the expected vs actual gateway/policy response
- **Response commitment**: acknowledgement within 72 hours
- **No bug bounty** — this is a reference implementation, not a product

## Known limitations

**Lab identity**: The lab uses a placeholder identity (`lab-agent`). Do not use lab credentials or configuration in production environments.

**agentgateway argument evaluation**: agentgateway v1.5 `mcpAuthorization` does not evaluate tool arguments. Argument-sensitive enforcement requires ExtMCP, as documented in the talk and in `docs/architecture.md`. Do not assume `mcpAuthorization` alone is sufficient for argument-level policy.

**Fail mode**: `failClosed` is the lab default. Production teams must make an explicit choice based on their availability requirements. See `docs/production-hardening.md` for the tradeoffs.

**Contract test scope**: The contract tests require a running stack. They verify runtime behaviour, not static configuration correctness. A passing typecheck does not mean the enforcement boundary is functioning.

## Dependency security

- All dependencies are pinned to exact versions in `package.json` files
- Dependabot is enabled on this repository
- Run `npm audit` in each package directory before deploying in any environment
- Report dependency vulnerabilities through the package maintainer's security channel, not this repo

## Acknowledgements

agentgateway issue [#3092](https://github.com/agentgateway/agentgateway/issues/3092) surfaced the policy-rule failure case — an accepted rule referencing unavailable tool arguments — that motivates the negative contract tests in this repo. That case is documented in `docs/architecture.md`.
