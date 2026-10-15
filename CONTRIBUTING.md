# Contributing

The Two-Layer Agent Contract gets sharper through real-world application. Contributions that extend the proof — new enforcement cases, auth provider configurations, policy language examples — are the most valuable.

## What to contribute

**Contract tests** — new enforcement properties with runtime proof
- Hidden tools staying hidden after gateway filtering
- Denied calls rejected at the gateway with backend non-arrival confirmed
- Argument-sensitive policy differentiating calls of the same tool name

**Auth provider examples** — in `gateway/config.yaml`
- OIDC providers, API key schemes, service account identities
- Each demonstrating the same enforcement boundary with a different identity mechanism

**Alternative policy language examples** — in `gateway/extmcp-policy/`
- OPA Rego, Cedar policy documents alongside the TypeScript processor
- Not replacements — additions that show the pattern holds across policy languages

**Real-world AGENTS.md examples** — anonymised where necessary
- How teams describe intent in practice, as guidance plane examples

**Documentation fixes** — if anything in `docs/` is ambiguous or wrong, fix it

## What this repo will not accept

- **Anything that collapses guidance and enforcement into one layer** — the separation is the thesis
- **A REST API alongside the MCP server** — it introduces the bypass path the architecture warns about
- **Dependency upgrades without a test or documented rationale**
- **Dashboards, GUIs, or managed infrastructure** — this is a pattern reference, not a product

## How to contribute

```bash
# 1. Fork and branch
git checkout -b your-contribution-name

# 2. Make changes, then verify
make verify   # full suite: topology + unit + contract + fail-closed

# 3. Open a PR
```

**PR description must answer:** what enforcement property does this prove or improve, and which test covers it?

## Issue labels

| Label | Use |
|---|---|
| `good first issue` | Docs, test fixtures, config examples |
| `architecture` | Changes to the pattern itself — open an issue first |
| `question` | Adapting the pattern to a specific situation |
| `bug` | Enforcement boundary not behaving as contract tests specify |

## Code of conduct

[Contributor Covenant](https://www.contributor-covenant.org/)
