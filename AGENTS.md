# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin package for
Codex, Claude Code, and future coding-agent hosts.

## Operating Rules

- Keep this package host-neutral. Codex and Claude Code should use the same
  skill, MCP configuration, helper scripts, SDK hooks, validation route, and
  Data App lifecycle APIs.
- Keep customer app support broad. Do not require Vite, a starter scaffold, a
  specific router, a provider filename, or a styling system.
- Use Semaphor MCP for authoring discovery and governed analysis.
- Generate runtime React code with public `react-semaphor/data-app-sdk` hooks.
- Save and publish through Semaphor Data App REST/command APIs, not MCP
  lifecycle wrappers.
- Do not add a host-specific analytics language. Missing analytical behavior
  belongs in Semaphor's shared analytics protocol, MCP, SDK, or app execution
  layers.
- Do not commit tokens, local test artifacts, private run notes, screenshots,
  or Semaphor-maintainer release evidence to this package.

## Validation

Before packaging or distributing this repo, run:

```bash
npm run validate:plugin
npm run validate:claude-plugin
node --check scripts/semaphor-data-app.mjs
```

For customer React apps, prefer the app's own typecheck/build scripts plus:

```bash
npm run validate:data-app -- --dir /path/to/customer-app
```
