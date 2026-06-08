# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin package for
Codex, Claude Code, and future coding-agent hosts.

## Operating Rules

- Keep this package host-neutral. Codex and Claude Code should use the same
  skill, MCP configuration, helper scripts, SDK query hooks, validation route,
  and Data App lifecycle APIs.
- Keep customer app support focused on Vite React. Do not require the starter
  scaffold, a specific router, a provider filename, a styling system, or a
  table library.
- Use Semaphor MCP for authoring discovery and governed analysis.
- Generate runtime React code with public `react-semaphor/data-app-sdk` hooks.
- Save and publish through Semaphor Data App lifecycle APIs when requested.
- Infer server-backed table needs from user intent and the planned UX, not only
  literal wording. Ask before installing registry items or table dependencies
  unless the user has already approved them; adapt server-backed table mechanics
  into the host app when the planned experience needs pagination, sorting,
  drill-through, or large/complete result sets.
- Do not add a host-specific analytics language. Missing analytical behavior
  belongs in Semaphor's shared MCP, SDK, validation, or execution contracts.
- Use the current public Semaphor MCP, SDK, validation, and lifecycle
  contracts. If examples or guidance are stale, update them to the current
  public contract instead of generating compatibility aliases or host-specific
  workarounds.
- Do not commit tokens, local env files, generated run artifacts, screenshots,
  private notes, or release evidence to this package or to customer app repos.
  Keep local evidence in ignored output directories.

## Customer App Validation

For customer React apps, prefer the app's own typecheck/build scripts plus:

```bash
npm run validate:data-app -- --dir /path/to/customer-app
```

Use the target app's package manager and scripts when they differ. The
Semaphor validator is a preflight for common SDK and publish issues; the app's
own build remains the authoritative local app check.
