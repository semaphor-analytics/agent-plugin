# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin package for
Codex, Claude Code, and future coding-agent hosts.

## Active Implementation Context

Temporary scope for the current implementation: Data Apps dual-authoring
across the bridge reference path and Agent Plugin contract. The active work is
the shared Data App SDK SQL/analysis contract and Agent Plugin authoring path
needed to keep generated apps on Semaphor's shared analytics spine.

Before implementing or reviewing Data App SDK hook examples, Agent Plugin
skills, golden workflows, helper scripts, save/publish behavior, validation
guidance, SQL-backed runtime examples, or MCP-driven authoring guidance, read
the source-of-truth plan and mental model:

- `semaphor-app/docs/system-architecture/data-apps/DUAL_AUTHORING_EXPERIENCE_PLAN.md`
- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_AGENT_MENTAL_MODEL.md`

Treat those documents as the source of truth for scope, assumptions, accepted
decisions, and constraints. Do not reopen settled tradeoffs during review:
publish means Semaphor-hosted Data App publish; Agent Plugin save/publish uses
the Semaphor REST/command lifecycle rather than MCP lifecycle wrappers; Data
Apps share dashboard permission semantics; and these development-only Data App
pieces may use hard migrations without legacy shims.

Read-only review rule for subagents: reviewer agents must not edit files,
stage files, run formatters that write files, or attempt opportunistic fixes.
They should return concise findings only, grounded in changed files and the
plan. The parent implementer owns all fixes after evaluating whether a finding
strengthens the shared analytics spine. If a reviewer believes a fix is needed,
it should describe the strategic fix and reusable owner rather than patching
locally.

Current SQL/Data App contract decision: `inputs` are the public runtime
abstraction for user-driven filters and SQL parameter controls. Static SQL
`param(...)` fallback values are named `defaultParameters` on
`semaphor.sql` / `SemaphorSqlIntent`; do not reintroduce a public `parameters`
alias or compatibility shim. Existing Semaphor SQL template
filter expressions such as `{{ filters | where }}`, `{{ filters | and }}`,
and `filter("name")` remain valid first-class syntax.

Current SDK authoring decision: generated Data Apps should use the canonical
builder/query pattern from `react-semaphor/data-app-sdk`: define inputs and
queries with `semaphor.filter`, `semaphor.sqlParam`, `semaphor.metric`,
`semaphor.records`, `semaphor.analysis`, `semaphor.sql`, and execute them with
`useSemaphorQuery`. Use `useSemaphorInputs` or explicit `useSemaphorInput`
calls for runtime values, then pass those handles to `useSemaphorQuery`.
Data App validation, save, and publish contracts should accept the canonical
`useSemaphorQuery` envelope only, keyed by `spec.queryKind`. Do not add
compatibility validation for any non-canonical query envelope.

Current product-entry decision: Data App creation is plugin-first. The
Semaphor Console lists, opens, shares, and permission-controls hosted Data
Apps, but the in-console App Builder is not the customer creation/edit path in
this slice. The helper should persist Semaphor identity in the existing
`semaphor.data-app.json` under `semaphor.projectId` and `semaphor.dataAppId`.
First save/publish creates the hosted app, later saves/publishes update that
identity, and `--new` intentionally creates a separate copy.

## Operating Rules

- Keep this package host-neutral. Codex and Claude Code should use the same
  skill, MCP configuration, helper scripts, SDK query hooks, validation route, and
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
