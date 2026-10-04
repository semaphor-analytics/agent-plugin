# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin for Claude Code,
Codex and future coding-agent hosts. The installable package is
`plugins/semaphor`.

## Operating Rules

- Read `ACTIVE_IMPLEMENTATION_CONTEXT.md` (repo root) before changing or
  reviewing this package. It holds the active scope and reviewer guardrails.
- The plugin is analytics-first: it connects an agent to the hosted Semaphor
  MCP (`https://semaphor.cloud/api/mcp`) and ships one skill,
  `skills/semaphor-analytics`, that teaches governed analytics.
- Keep the package host-neutral. Claude Code and Codex use the same skill and
  the same `.mcp.json`.
- Analytical behavior belongs in Semaphor's MCP server, not in this package.
  If guidance needs a workaround, fix the server contract instead.
- Never promise that a tool exists. The tool list depends on who is calling
  (role, OAuth or token, scopes). The skill says so.
- Use camelCase tool arguments in examples (`responseFormat`). The server
  rejects any other spelling.
- Do not add scripts that call the MCP outside the agent host. Headless and
  embedded use is a client header setup with an MCP project token from the
  environment variable `SEMAPHOR_MCP_TOKEN`.
- Before publishing marketplace-visible plugin changes, follow the release
  versioning SOP in the Semaphor app internal docs:
  `docs/engineering/agent-plugin/RELEASE_VERSIONING.md`.
  Keep versioning details out of customer-facing README content.
- Do not commit tokens, local env files, generated run artifacts,
  screenshots, private notes or release evidence.

## Checks

From the repository root:

```bash
npm run version:plugin:check
npm run validate:plugin
npm run validate:codex-plugin
npm run validate:marketplaces
```

`validate:marketplaces` includes `claude plugin validate --strict`.
