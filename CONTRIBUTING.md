# Contributing to guidance-is-not-policy

## Why contributions matter

The Two-Layer Agent Contract pattern gets sharper through real-world application. The reference implementation here is deliberately minimal — a proof, not a product — and the most valuable contributions are the ones that extend that proof: new enforcement examples tested against the contract, additional auth provider configurations, and alternative policy language implementations that show teams how the pattern holds across different technology choices. If you've applied this pattern in a real system and found an edge case the tests don't cover, or an auth integration path the gateway config doesn't show, that's exactly what this repo needs.

## What makes a good contribution

- **New contract test cases** that prove additional enforcement properties — hidden tools staying hidden, denied calls being rejected at the gateway, argument-sensitive policy correctly differentiating calls
- **Additional auth provider examples** for the gateway configuration: OIDC providers, API key schemes, service account identities — each demonstrating the same enforcement boundary with a different identity mechanism
- **Alternative policy language examples** alongside the TypeScript processor — OPA Rego policies, Cedar policy documents — placed in `gateway/extmcp-policy/` as additional files, not replacements for the existing processor
- **Real-world AGENTS.md examples** from actual repositories, anonymised where necessary, showing how teams describe intent in practice
- **Documentation corrections and clarifications** — if something in `docs/` is ambiguous or incorrect, fix it
- **Scripts improvements** for additional platforms: Windows (PowerShell), different Linux distributions, alternative container runtimes

## What this repo will not accept

**Additions that blur the guidance/enforcement boundary.** The thesis of this repo is that guidance and enforcement are separate layers with distinct authority. A contribution that requires treating them as the same thing — or that collapses one into the other — contradicts what the repo is demonstrating.

**A REST API alongside the MCP server.** Adding a direct REST API to the backend would introduce exactly the bypass path that the architecture section warns about. The lab MCP server must remain the only path to the backend to keep the proof valid. If a contribution requires a REST API, it's demonstrating a different architecture than this repo documents.

**Dependency upgrades without a corresponding contract test change or documented rationale.** Upgrades that change behaviour need a test that proves the enforcement boundary is unaffected. Upgrades that don't change behaviour need a comment explaining why they were made. Neither should be a standalone commit.

**Features that make this repo a product.** No dashboards, GUIs, cloud deployment services, or managed infrastructure. This is a pattern reference. The moment it acquires operational surface area, it stops being useful as a pattern reference.

## How to contribute

1. Fork the repository
2. Create a branch: `git checkout -b your-contribution-name`
3. Make your changes
4. Run the contract tests: `cd contract-tests && npm test` (requires the full stack running via `./scripts/run-lab.sh`)
5. Run typechecks: `npm run typecheck` in any package you modified
6. Open a pull request

**Your PR description must answer two questions:** what enforcement property does this prove or improve, and which test covers it? If your contribution doesn't touch the enforcement boundary directly (documentation, scripts, config examples), explain what it enables.

## Issue labels

| Label | Use |
|---|---|
| `good first issue` | Documentation improvements, test fixture additions, config examples — good starting points that don't require running the full stack |
| `architecture` | Changes to the Two-Layer Contract pattern itself; open an issue for discussion before implementing |
| `question` | Adapting the pattern to a specific situation; answers may become documentation |
| `bug` | Enforcement boundary not behaving as the contract tests specify |

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/).
