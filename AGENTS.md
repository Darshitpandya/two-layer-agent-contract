# Repository Guidance

## Purpose
This repository is the reference implementation for the Two-Layer Agent Contract pattern.
It demonstrates that guidance influences candidate behaviour while runtime policy enforces executable authority.

## Repository layout

| Directory | Description |
|-----------|-------------|
| `mcp-server/` | Lab MCP server exposing `status` and `deploy` tools. This is the service agents interact with via the gateway. |
| `gateway/` | agentgateway configuration and the ExtMCP policy processor. The enforcement plane lives here. |
| `gateway/extmcp-policy/` | TypeScript ExtMCP policy processor. Evaluates tool call arguments and enforces restrictions (e.g. staging-only deployments). |
| `agents/` | Scoped guidance files and the deployment task used in the lab demonstration. |
| `contract-tests/` | Jest test suite that verifies the Two-Layer Contract holds: staging deploys succeed, production deploys are blocked. |
| `scripts/` | Setup, lab runner, and teardown scripts for the full stack. |
| `docs/` | Architecture notes and extended documentation for the pattern. |
| `.github/` | CI workflows. |

## Development commands

### Full lab (recommended)
```
make up       # start Docker Compose stack
make session  # initialize MCP session
make verify   # run all 34 tests
make down     # stop stack
```

### MCP server
```
cd mcp-server
npm install
npm run build
npm start
```

### Policy processor
```
cd gateway/extmcp-policy
npm install
npm run build
npm start
```

### Contract tests
```
cd contract-tests
npm install
npm test
```

## Deployment guidance
Deployment work in this repository targets **staging** environments.
The lab MCP server's deploy tool accepts both staging and production arguments,
but the Two-Layer Contract demonstrated here restricts production deployment
through runtime policy — not through this guidance file.

This boundary is intentional and is the point of the demonstration.

## Code conventions
- TypeScript strict mode is enabled across all packages
- Each package has its own `tsconfig.json` and `package.json`
- Tests use Jest with `ts-jest`
- No shared `node_modules` — each package installs independently

## Before opening a pull request
- Run `npm run typecheck` in any package you modified
- Run `make test` if you changed policy or gateway config
- Run `make verify` to confirm all 34 tests pass

## What this guidance file is not
This file shapes agent behaviour in this repository.
It does not control what the runtime MCP surface permits.
Security-critical boundaries are enforced by agentgateway and the ExtMCP policy processor,
not by instructions in this file.
