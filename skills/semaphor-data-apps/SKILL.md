---
name: semaphor-data-apps
description: Build, modify, inspect, validate, save, and publish Semaphor-backed React data apps using react-semaphor/data-app-sdk, Semaphor MCP metadata, governed analytics, and Data App lifecycle APIs.
---

# Semaphor Data Apps

Use this skill when a user asks the coding agent to build, plan, modify,
inspect, validate, save, or publish a Semaphor-backed React data app.

## Core Mental Model

A Semaphor data app is any React application that uses
`react-semaphor/data-app-sdk` to execute governed Semaphor analytics. It does
not need to be a Vite app, a Semaphor starter, or a specific router/layout.

This plugin is for customers building many shapes of React apps. Work with the
customer repo as it exists. Do not force a prescribed scaffold, provider file,
styling system, route structure, or table library.

The coding agent owns local source inspection and edits. Semaphor owns auth,
metadata, analytics grounding, permissions, governed execution, row limits,
validation, save, and publish lifecycle.

Normal loop:

```text
user request
  -> classify operation
  -> inspect Semaphor MCP metadata and local React source
  -> visibly plan when the request is broad or data-bearing
  -> edit with public react-semaphor/data-app-sdk builders and hooks
  -> validate locally and through Semaphor when credentials are available
  -> save or publish through Semaphor lifecycle APIs when requested
```

## Operation Types

Classify the turn before editing:

- `answer_question`: answer without file edits.
- `inspect_data`: inspect Semaphor project metadata without file edits.
- `inspect_files`: inspect the React app without file edits.
- `plan_app`: inspect data and propose a structured plan; no file edits.
- `create_app`: add a Semaphor-backed app surface or route.
- `add_view`, `modify_view`, `remove_view`: change analytical views.
- `add_input`, `modify_input`, `remove_input`: change filters or controls.
- `change_layout`, `change_style`: change UI without changing analytics meaning.
- `fix_error`: fix runtime, typecheck, build, or data execution errors.
- `save_draft`: save to Semaphor when lifecycle APIs are available.
- `publish`: publish through Semaphor when lifecycle APIs are available.

Planning and editing are separate. If the user asks to plan, do not change
files. For broad dashboard/app requests, large-table requests, or existing-app
changes, produce a visible plan before editing. If the user already clearly
asked to build, continue after the visible plan unless the plan exposes
unsupported, risky, or ambiguous work.

For planning details, read [planning-workflow.md](references/planning-workflow.md).

## Hard Rules

- Use Semaphor MCP to discover real projects, domains, datasets, fields,
  relationships, SQL connections, and permissioned capabilities before
  generating data-bearing code.
- Do not invent dataset names, field names, joins, metrics, IDs, or raw
  database credentials.
- Generated runtime analytics code must use public
  `react-semaphor/data-app-sdk` builders and `useSemaphorQuery`.
- Do not create a host-specific query language as the source of truth. Missing
  analytical behavior belongs in the shared analytics protocol, SDK, MCP, or
  Semaphor App execution adapter.
- Do not call dashboard-internal APIs, dashboard card internals, connection
  configs, or raw database credentials from generated app code.
- Do not inspect, print, search, or log `.env*` token values. Detect expected
  variable names only; ask the user to add missing credentials.
- Do not inspect `node_modules/react-semaphor/dist`, bundled SDK
  implementation files, SDK source files, or SDK validator internals during
  ordinary app authoring. Use the public SDK contract reference instead.
- Do not use `ReturnType<typeof useSemaphorQuery>` for helper props. Use
  public SDK result types.
- Use `columns[].key` for row access and `columns[].label` for display. Never
  use display labels as row keys.
- Prefer `semaphor_analyze` for governed semantic BI checks. Use
  `semaphor_query_sql_advanced` for SQL-first or unsupported analysis.
- If MCP can answer a governed analytical question, make the dashboard version
  durable through a shared analytics intent and SDK query spec. If no SDK
  runtime path exists, explain the gap instead of rendering static MCP output.
- When validating SQL through MCP during authoring, start with a tiny preview
  such as `LIMIT 5` or `LIMIT 10` unless the user explicitly needs more rows.
  Runtime app queries can use their own bounded `limit`, pagination, or
  server-side table contract.
- `connectionId` is execution metadata, not semantic identity. Semantic source
  identity is domain plus dataset id/name.
- `semaphor publish` means Semaphor-hosted Data App publish, not customer
  deployment.
- Save/publish goes through Semaphor Data App lifecycle REST/command APIs, not
  MCP lifecycle wrappers.
- Do not use `allowEdit: false` as an auth or runtime boundary.

## Reference Routing

Load the narrow reference needed for the task:

- SDK imports, provider setup, public result types, query builders, row access:
  [sdk-contract.md](references/sdk-contract.md)
- Dashboard planning, existing-app planning, unsupported insights:
  [planning-workflow.md](references/planning-workflow.md)
- SQL-backed runtime views, SQL validation, bounded raw SQL:
  [sql.md](references/sql.md)
- Filters, controls, SQL params, shared/top-level filter subscriptions:
  [filters-and-inputs.md](references/filters-and-inputs.md)
- Data-app UX baseline, loading/error/empty states, tables, totals,
  pagination, large result sets, table libraries:
  [tables.md](references/tables.md)
- Save, draft, hosted publish, manifest identity, source snapshots, assets:
  [publish-lifecycle.md](references/publish-lifecycle.md)
- Local package validation and Semaphor validation:
  [validation.md](references/validation.md)

## Local App Integration

Before editing, inspect the target repo:

1. Locate `package.json`.
2. Detect package manager from lockfiles.
3. Confirm React is installed.
4. Confirm whether `react-semaphor` is installed.
5. Detect likely framework from dependencies and files.
6. Locate sensible component, route, or page insertion points.

Use this plugin's helpers when useful:

```bash
node scripts/detect-react-app.mjs --dir <app>
node scripts/init-semaphor-data-app.mjs --dir <app>
```

`init:data-app` is optional scaffolding for clean starts. It is not a required
customer app shape.

When opening an existing Semaphor Data App, resolve the app identity, load the
mutable draft when available, compare the saved source snapshot with the local
workspace, and ask before writing saved files into the repo. Treat saved local
paths as hints only.

## SDK Fast Path

Use the public SDK contract as the codegen source of truth:

```tsx
import {
  SemaphorDataAppProvider,
  defineSemaphorDataApp,
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
```

Provider setup should be project-token-only by default:

```tsx
const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;

<SemaphorDataAppProvider token={runtimeToken}>
  {children}
</SemaphorDataAppProvider>
```

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or `apiBaseUrl` for
normal customer apps. Use `apiBaseUrl` only when the user explicitly needs
self-hosted or local routing that intentionally differs from the token's
`apiServiceUrl`.

For the full SDK contract, read [sdk-contract.md](references/sdk-contract.md).

## Data App UX Baseline

Generated Semaphor-backed views should feel like real data apps, not raw API
proofs of concept. Match the target app's design system, and include loading,
error, and empty states for every rendered `useSemaphorQuery` result.

Each data-bearing card should normally own its own query. Shared-query
derivation is valid only when intentional and explained.

Shared filters are opt-in input handles. Bind once, then pass the handle only
to the queries that should respond.

`useSemaphorInputs` returns runtime handles, not raw specs. Read
`handle.value` for the current value, call `handle.setValue(nextValue)` from UI
controls, and pass the same handles to `useSemaphorQuery(query, { inputs })`.

Tables should render from `result.columns`, support sorting, show a useful
empty state, and include totals for displayed numeric columns. Large tables
must be server-side tables; do not fetch a million rows and then paginate,
sort, or filter only in React.

For full UX and table guidance, read [tables.md](references/tables.md). For
filter composition, read [filters-and-inputs.md](references/filters-and-inputs.md).

## Save, Publish, And Validation

Use the plugin helper for Semaphor-hosted lifecycle writes:

```bash
npm run load:data-app -- --data-app-id <data-app-id>
npm run save:data-app -- --dir <app> --project-id <project-id> --title "<title>"
npm run prepare:publish -- --dir <app>
npm run publish:data-app -- --dir <app> --project-id <project-id> --title "<title>"
```

Before reporting completion, run the strongest available checks:

```bash
node <plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>
```

Also run the target app's package typecheck/build scripts when present and
reasonable, plus Semaphor MCP query checks for data-bearing analytics when
credentials are available.

For lifecycle details, read [publish-lifecycle.md](references/publish-lifecycle.md).
For validation details, read [validation.md](references/validation.md).
