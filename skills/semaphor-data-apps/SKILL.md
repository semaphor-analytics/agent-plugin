---
name: semaphor-data-apps
description: Build, modify, inspect, validate, and prepare Semaphor-backed React data apps using react-semaphor/data-app-sdk and Semaphor MCP metadata.
---

# Semaphor Data Apps

Use this skill when a user asks the coding agent to build, plan, modify,
validate, or publish a Semaphor-backed React data app.

## Core Mental Model

A Semaphor data app is any React application that uses
`react-semaphor/data-app-sdk` hooks to execute governed Semaphor analytics. It
does not need to be a Vite app.

This plugin is intended for distribution to customers building all kinds of
React apps. Do not assume the plugin scaffold, a specific framework, a specific
router, a specific provider filename, or a specific component layout. As long
as the customer app is React, uses the public SDK hooks for Semaphor-backed
data, and passes its own build/runtime checks, the plugin should work with the
app instead of forcing it into a Semaphor-preferred structure.

The coding agent owns local source inspection and edits. Semaphor remains the
source of truth for auth, metadata, analytics grounding, execution,
permissions, row limits, and publish lifecycle.

The normal loop is:

```text
user request
  -> operation intent
  -> Semaphor project/data inspection
  -> plan or edit
  -> React source using react-semaphor/data-app-sdk
  -> validation
  -> save/publish through Semaphor-owned APIs when requested
```

## Operation Types

Classify each user turn before editing:

- `answer_question`: answer without file edits.
- `inspect_data`: inspect Semaphor project metadata without file edits.
- `inspect_files`: inspect the local React app without file edits.
- `plan_app`: inspect data and propose a structured plan; no file edits.
- `create_app`: add a new Semaphor-backed app surface or route.
- `add_view`: add a KPI, chart, table, panel, or analytical component.
- `modify_view`: change an existing view's data, labels, chart, or styling.
- `remove_view`: remove a user-facing view.
- `add_input`: add a filter or control.
- `modify_input`: change an existing filter or control.
- `remove_input`: remove a filter or control.
- `change_layout`: rearrange UI without changing analytics meaning.
- `change_style`: change visual styling.
- `fix_error`: fix runtime, typecheck, build, or data execution errors.
- `save_draft`: save to Semaphor when lifecycle APIs are available.
- `publish`: publish through Semaphor when lifecycle APIs are available.

Planning and editing are separate. If the user asks to plan, do not change
files. Build only after the user explicitly asks to build or accepts the plan.

## Required Semaphor Rules

- Use Semaphor MCP tools to discover real projects, domains, datasets, fields,
  and relationships before generating data-bearing code.
- Do not invent dataset names, field names, joins, or metrics.
- Data-bearing views must use shared Semaphor analytics semantics through
  `react-semaphor/data-app-sdk`.
- Do not call dashboard-internal APIs, dashboard card internals, raw database
  credentials, or Semaphor connection configs from generated app code.
- Prefer `semaphor_analyze` for governed semantic BI checks. Use
  `semaphor_query_sql_advanced` only for advanced SQL-first analysis that
  cannot be represented by `semaphor_analyze`.
- Preserve semantic source identity by domain plus dataset id/name.
  `connectionId` is execution metadata, not semantic identity.
- Never create a host-specific query shape as the source of truth. If an
  operation needs new analytical behavior, the missing capability belongs in
  the shared analytics protocol or Semaphor App execution adapter.
- `semaphor publish` means Semaphor-hosted Data App publish, not
  customer-hosted deployment.
- Save/publish must go through Semaphor Data App lifecycle REST/command APIs.
  Do not use MCP lifecycle wrappers for alpha publish.
- Publish starts from a saved draft id and `sourceRevision.snapshotHash`, then
  uploads/completes or fails the same server-owned publish session.
- Do not use `allowEdit: false` as an auth or runtime boundary.

## SDK Contract

Generated React should import from:

```tsx
import {
  SemaphorDataAppProvider,
  useSemaphorAnalysis,
  useSemaphorMetric,
  useSemaphorRecords,
  useSemaphorInput,
  useSemaphorInputOptions,
} from "react-semaphor/data-app-sdk";
```

Use source-bearing field refs when the source is known. Keep hook specs small,
explicit, and tied to real inspected metadata.

Hook selection (which hook for which question):

- `useSemaphorMetric` for single-number KPIs.
- `useSemaphorRecords` for rows, tables, and charts, including bounded windows
  ("last 6 months") via `dateField` + `timeWindow`; gives `columns[].key`.
- `useSemaphorAnalysis` for insight, driver, spike/drop, and period-change
  views; also exposes `columns`/`resultSets` for typed row access.
- `useSemaphorInput` + `useSemaphorInputOptions` for filters and controls.

For `useSemaphorInput`, the `operator` accepts canonical SDK symbols (`"="`,
`"!="`, `"in"`, `"not_in"`, `"between"`, `">"`, `">="`, `"<"`, `"<="`) and the
common MCP aliases (`"equals"`, `"not_equals"`); the SDK normalizes them. Use
`"in"` with `multi: true` for multi-select.

Both data hooks accept source-bearing refs and shared analytics fields such as
`dateField`, `timeWindow`, and `filters` where the SDK contract exposes them.
Represent period-change ranking with `analysis: { kind: "period_change",
orderBy }`, not a separate agent-only field.

For record/table rendering, treat `column.key` as the stable code accessor and
`column.label` as display text:

```tsx
{result.records.map((row) => (
  <tr>
    {result.columns.map((column) => (
      <td key={column.key}>{row[column.key]}</td>
    ))}
  </tr>
))}
```

Do not access records with display labels such as `row[column.label]` or
`row["Movement Date"]`. For `useSemaphorAnalysis`, prefer
`insight.resultSets.<name>.columns` and `row[column.key]` over top-level
analysis arrays when rendering tables or charts. For simple insight views, the
SDK also exposes the default row-bearing analysis result as `insight.records`
and `insight.columns`; use those columns rather than `Object.keys(...)`.

### Shared and top-level filters (opt-in subscription)

A dashboard-wide filter is built by composition, not a global setting. Create
one `useSemaphorInput` in a shared parent (or a small React context you own),
then pass that same handle into the `inputs` array of each hook that should
respond to it:

```tsx
// Parent owns the shared control.
const region = useSemaphorInput<string>({
  id: "region",
  kind: "filter",
  field: regionField,
  operator: "=",
});

// Each card opts in by including the handle in its inputs.
useSemaphorMetric({ source, metrics: [revenue], inputs: [region] });
useSemaphorRecords({ source, fields: [region, revenue], inputs: [region] });
```

This per-hook subscription is intentional, not a limitation. Not every filter
is meaningful for every visual: an unfiltered "company total" KPI, a benchmark
panel, or a control that only some cards care about should be left out. A card
subscribes by listing the input; it stays unfiltered by omitting it. This gives
precise control over which visuals a filter touches, and it mirrors Semaphor's
dashboard model, where filter subscription is opt-in per card rather than
applied to everything. Do not force a global "apply to all queries" filter or
assume every card inherits a control; thread the handle only into the cards that
should respond.

## Local App Integration

Before editing, inspect the target repo:

1. Locate `package.json`.
2. Detect package manager from lockfiles.
3. Confirm React is installed.
4. Confirm whether `react-semaphor` is installed.
5. Detect likely framework from dependencies and files.
6. Locate sensible component, route, or page insertion points.

Use `scripts/detect-react-app.mjs` and
`scripts/init-semaphor-data-app.mjs` from this plugin when helpful.

When opening an existing Semaphor Data App, resolve the app identity, load the
mutable draft when available, compare the saved source snapshot with the local
workspace, and ask before writing saved files into the repo. Treat saved local
paths as hints only.

## Save And Publish Helpers

Use the plugin helper for Semaphor-hosted lifecycle writes:

```bash
npm run load:data-app -- --data-app-id <data-app-id>
npm run save:data-app -- --dir <app> --project-id <project-id> --title "<title>"
npm run prepare:publish -- --dir <app>
npm run publish:data-app -- --dir <app> --project-id <project-id> --data-app-id <data-app-id> --title "<title>"
```

The helper reads `SEMAPHOR_PROJECT_TOKEN` and defaults to
`SEMAPHOR_API_BASE_URL=https://semaphor.cloud`. Use `--api-base-url` for local
or self-hosted Semaphor. If SDK hook specs are available as JSON, pass
`--hook-specs <path>` so the helper validates through
`POST /api/v1/data-app/validate` before saving or publishing. Use
`--validation-status <path>` only for a precomputed Semaphor validation result.

Publish always saves a draft first, starts publish from that draft id plus
`sourceRevision.snapshotHash`, builds locally, prepares `semaphor.data-app.json`
with `runtime.entry` and `runtime.styles`, uploads generated hashed assets, and
completes or fails the same server-owned publish session.

Semaphor-hosted publish requires a static browser bundle that mounts into
`#root`. If a server-rendered app does not produce that bundle, add a small
static Data App entrypoint for publish instead of reshaping the whole customer
app.

Source snapshots must respect `.gitignore` in git repos and must not include
ignored local files, dotfiles, env files, registry config, service-account JSON,
or common credential JSON files.
Publish uploads must exclude source maps unless Semaphor later defines an
explicit debug artifact contract.

## Validation

Before reporting completion, run the strongest available checks:

- `node <plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>`
- package typecheck script, if present
- package build script, if present and reasonable. Treat the build as the
  authoritative typecheck: some repos have a loose root `tsc --noEmit` that
  under-checks app sources, so a green typecheck plus a failing build means the
  build is right. Do not report completion on a passing typecheck alone.
- when SDK hook specs can be extracted, call Semaphor
  `POST /api/v1/data-app/validate` with the project token and use the returned
  typed diagnostics for repair
- Semaphor MCP query checks for data-bearing analytics when credentials are
  available

The validator is a compatibility smoke check by default. Treat its Semaphor
advisories as guidance, not customer-facing blockers. Use `--strict` only for
Semaphor package-maintainer quality gates.

Do not reimplement source/field validation in plugin prompts or scripts once
the Semaphor validation route is available. Plugin-local scans are package and
build preflight; Semaphor owns catalog-aware SDK hook validation.

`POST /api/v1/data-app/validate` and `/api/v1/data-app/execute` support
`useSemaphorAnalysis` specs through the same governed analytics query-spec
service used by MCP `semaphor_analyze`. Treat failures there as shared
analytics/SDK/app execution issues, not as host-specific prompt issues.

If validation cannot run, say exactly why.
