# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin package for
Codex, Claude Code, and future coding-agent hosts.

## Operating Rules

- Keep this package host-neutral. Codex and Claude Code should use the same
  skill, MCP configuration, helper scripts, SDK query hooks, validation route,
  and Data App lifecycle APIs.
- Keep customer app support broad. Do not require Vite, a starter scaffold, a
  specific router, a provider filename, a styling system, or a table library.
- Use Semaphor MCP for authoring discovery and governed analysis.
- Generate runtime React code with public `react-semaphor/data-app-sdk` hooks.
- Save and publish through Semaphor Data App lifecycle APIs when requested.
- Do not add a host-specific analytics language. Missing analytical behavior
  belongs in Semaphor's shared MCP, SDK, validation, or execution contracts.
- Do not commit tokens, local test artifacts, private run notes, screenshots,
  generated app artifacts, or release evidence to this package.

## Customer App Validation

For customer React apps, prefer the app's own typecheck/build scripts plus:

```bash
npm run validate:data-app -- --dir /path/to/customer-app
```

Use the target app's package manager and scripts when they differ. The
Semaphor validator is a preflight for common SDK and publish issues; the app's
own build remains the authoritative local app check.
