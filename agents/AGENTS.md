# Deployment Task Guidance

## Scope
This guidance applies to deployment tasks executed in this repository's lab environment.

## Deployment target
Deployment work targets **staging**.

The lab exposes a `deploy(environment, version)` MCP tool.
When executing deployment tasks, use `environment: "staging"`.

## Available tools through the gateway
The following tools are available through the MCP gateway for the `lab-agent` identity:
- `status` — check current deployment status
- `deploy` — deploy a version to an environment

## Task
See demo-task.md in this directory for the current deployment task.

## Important
This guidance informs tool selection. The runtime MCP surface independently enforces
which operations are executable. A staging instruction here and a staging-only policy
in the enforcement plane should agree — that agreement is what the contract tests verify.
