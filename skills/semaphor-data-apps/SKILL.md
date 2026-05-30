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
as the customer app is React, uses the public SDK builder/query pattern for
Semaphor-backed data, and passes its own build/runtime checks, the plugin
should work with the app instead of forcing it into a Semaphor-preferred
structure.

Plugin guidance must stay broadly applicable. Do not encode eval fixture
datasets, field names, dashboard examples, local ports, or customer-specific
workarounds as required behavior. Concrete examples are illustrative only; the
agent should always re-ground against the customer's Semaphor MCP metadata and
the customer's React app. If an eval reveals a failure, turn it into a general
rule, SDK example, validator advisory, or shared Semaphor contract improvement
that would help Codex, Claude Code, App Builder, and future agent hosts.

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
For broad dashboard-like requests, plan first even when the user did not say
`/plan`. The plan should name the proposed visuals and classify each one as
server-backed, derived, presentation-only, or unsupported before codegen starts.
Unsupported insights should include the concrete data-model improvement needed
to support them.

For broad dashboard, app-building, or large-table requests, the visible plan is
a hard pre-edit gate. Do not touch source files, install dependencies, or run
formatters that write files until the user-facing plan has been produced. If
the user already clearly asked to build, produce the plan first, then continue
from that accepted instruction unless the plan reveals ambiguous, unsupported,
or risky work that needs confirmation. When running inside an internal eval
folder that provides `plan.json`, write the same visible plan there before the
first file edit and update it after implementation to show the code consumed
the plan. Customer apps do not need a `plan.json`; they need the visible plan.

## Required Semaphor Rules

- Use Semaphor MCP tools to discover real projects, domains, datasets, fields,
  and relationships before generating data-bearing code.
- Do not invent dataset names, field names, joins, or metrics.
- Data-bearing views must use shared Semaphor analytics semantics through
  `react-semaphor/data-app-sdk`.
- Do not call dashboard-internal APIs, dashboard card internals, raw database
  credentials, or Semaphor connection configs from generated app code.
- Do not inspect, print, or search `.env*` files for token values. It is fine
  to detect whether expected env variable names exist, but do not emit secrets
  into logs or generated source. Ask the user to provide missing credentials
  instead of reading them into the transcript.
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
  Do not use MCP lifecycle wrappers for publish.
- First save/publish creates the Semaphor-hosted Data App and persists
  `semaphor.projectId` plus `semaphor.dataAppId` in `semaphor.data-app.json`.
  Later saves/publishes update that same app unless the user explicitly asks
  for a new copy.
- Publish starts from a saved draft id and `sourceRevision.snapshotHash`, then
  uploads/completes or fails the same server-owned publish session.
- Do not use `allowEdit: false` as an auth or runtime boundary.

## SDK Contract

This section is the compact public SDK reference for ordinary app authoring.
Use it before looking anywhere else when a task needs concrete imports, result
types, provider setup, SQL-backed tables, filters, or row/column access.

Do not search for `docs/DATA_APP_SDK_REFERENCE.md` in the customer repo, and
do not inspect `node_modules/react-semaphor/dist`, bundled implementation
files, SDK source files, or SDK validator internals during ordinary app
authoring. The customer repo is not expected to contain plugin docs. Longer
plugin docs may exist for humans and maintainers, but the code-generation
contract needed by builders is embedded here.

Do not inspect package declarations just to confirm the basic provider, query,
or result shapes below; treat the signatures in this section as the public
contract for code generation. If this skill is missing a public contract detail
and the app cannot be completed without it, inspect only the public
`react-semaphor/data-app-sdk` exported type declarations narrowly, record the
docs gap, and continue with the public contract rather than implementation
internals.

Generated React should import SDK values from:

```tsx
import {
  SemaphorDataAppProvider,
  defineSemaphorDataApp,
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
```

Reusable helper components can import SDK result types as needed:

```tsx
import type {
  SemaphorQueryResult,
  SemaphorRecordsField,
  SemaphorRecordsQueryResult,
  SemaphorResultColumn,
  SemaphorRowsQueryResult,
  SemaphorSqlQueryResult,
} from "react-semaphor/data-app-sdk";
```

Useful public shapes:

```ts
type SemaphorResultColumn = {
  key: string; // stable row accessor: row[column.key]
  name: string; // semantic/source field name
  label: string; // display label
  role?: "dimension" | "measure" | "date" | string;
  dataType?: "string" | "number" | "date" | "boolean" | string;
  aggregate?: string;
  source?: unknown;
};

type SemaphorQueryState = {
  status: "idle" | "loading" | "success" | "error";
  isLoading: boolean;
  error: Error | null;
};

type SemaphorSqlQueryResult<TRecord extends Record<string, unknown>> =
  SemaphorQueryState & {
    id?: string;
    intent?: unknown;
    records: TRecord[];
    columns?: SemaphorResultColumn[];
    rowCount?: number;
    pagination?: unknown;
    output?: string;
    rowLimitExceeded?: boolean;
    executionResult?: unknown;
  };

type SemaphorRecordsQueryResult<TRecord extends Record<string, unknown>> =
  SemaphorQueryState & {
    id?: string;
    intent?: unknown;
    records: TRecord[];
    columns?: SemaphorResultColumn[];
    rowCount?: number;
    pagination?: unknown;
    executionResult?: unknown;
  };
```

Use source-bearing field refs when the source is known. Define inputs and
queries as typed module-level specs with `semaphor.*`, then execute those specs
with `useSemaphorQuery`. Validation, save, and publish use the canonical
`useSemaphorQuery` contract; do not generate any alternate query execution
pattern.

Provider setup should be project-token-only by default:

```tsx
<SemaphorDataAppProvider token={runtimeToken}>{children}</SemaphorDataAppProvider>
```

For ordinary local React apps, `runtimeToken` normally comes from the app's
local env:

```tsx
const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;
```

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or an `apiBaseUrl`
prop for normal customer apps. Use `apiBaseUrl` only when the user explicitly
needs self-hosted or local routing that intentionally differs from the token's
`apiServiceUrl`.

`SemaphorDataAppProvider` accepts `token?: string`, `apiBaseUrl?: string`, an
optional executor override, and `children`. The provider internally reads
Semaphor hosted runtime auth when present, so generated app code normally does
not need to call runtime helpers itself.

Do not import `readWindowRuntime` or generate extra token fallback variables
such as `VITE_SEMAPHOR_TOKEN` for normal customer apps. Use hosted runtime
helpers only when the target app is explicitly being authored as a
Semaphor-hosted runtime entrypoint and the user asks for direct runtime access.

Query builder selection:

- `semaphor.metric` for single-number KPIs.
- `semaphor.records` for rows, tables, and charts, including bounded windows
  ("last 6 months") via `dateField` + `timeWindow`; gives `columns[].key`.
- `semaphor.analysis` for insight, driver, spike/drop, and period-change
  views; also exposes `columns`/`resultSets` for typed row access.
- `semaphor.sql` for advanced SQL-backed runtime views when semantic queries
  cannot express the product requirement or the user explicitly asks for raw
  SQL. Inline SQL is supported, but execution must still go through Semaphor
  SDK and governed server-side execution.
- `semaphor.filter`, `semaphor.sqlParam`, and `semaphor.control` for filters
  and controls.

Public SQL spec shape for `semaphor.sql`:

```ts
type SqlQuerySpecShape = {
  id?: string;
  label?: string;
  source: {
    kind: "sql";
    connectionId: string;
    dialect?: string;
    label?: string;
  };
  sql: string;
  inputs?: unknown[]; // Semaphor filter/control/sqlParam specs
  defaultParameters?: Record<
    string,
    string | number | boolean | null | Array<string | number | boolean | null>
  >;
  limit?: number;
  pagination?: { page?: number; pageSize?: number };
  rationale?: string;
};
```

Execute query specs with:

```tsx
const inputs = useSemaphorInputs([someFilterOrParam]);
const result = useSemaphorQuery<RowType>(someQuery, { inputs });
```

The `inputs` option accepts the handles returned by `useSemaphorInputs`.

When typing reusable helper components, use the public SDK result types. Do not
use `ReturnType<typeof useSemaphorQuery>`; TypeScript collapses overloaded hook
signatures in a way that can produce the wrong result shape.

- Use `SemaphorQueryResult` for generic query status/error helper components.
- Use `SemaphorRecordsQueryResult` for `semaphor.records(...)` results.
- Use `SemaphorSqlQueryResult` for `semaphor.sql(...)` results.
- Use `SemaphorRowsQueryResult` for table helpers that intentionally accept
  either records-backed or SQL-backed row results.
- Use `SemaphorRecordsField` for source-bearing fields passed to
  `semaphor.records(...)`. `SemaphorFieldRef` is too loose for records queries
  because the records contract requires every selected field to have a definite
  `role`.

For filter inputs, `operator` accepts canonical SDK symbols (`"="`, `"!="`,
`"in"`, `"not_in"`, `"between"`, `">"`, `">="`, `"<"`, `"<="`) and common MCP
aliases (`"equals"`, `"not_equals"`); the SDK normalizes them. Use `"in"` with
multi-select values.

For SQL-backed views, keep SQL bounded and parameterized with Semaphor template
helpers. Do not concatenate SQL strings in React. Use `inputs` for runtime
filter/control values, and use `defaultParameters` only for static SQL
`param(...)` fallback values.

Canonical SQL table fast path:

1. Use MCP to identify the connection/table/columns and validate the SQL with
   `semaphor_query_sql_advanced`.
2. Define runtime controls with `semaphor.sqlParam` and filters with
   `semaphor.filter`.
3. Define one bounded `semaphor.sql` spec with `inputs`,
   `defaultParameters`, and `limit`.
4. Execute it with `useSemaphorInputs` + `useSemaphorQuery`.
5. Render loading, error, empty, and table states from `result.records` and
   `result.columns`; use `column.key` for row access.

```tsx
const limitParam = semaphor.sqlParam({
  id: "limit",
  label: "Rows",
  defaultValue: 100,
});

const latestRowsQuery = semaphor.sql({
  id: "latest-rows",
  label: "Latest rows",
  source: { kind: "sql", connectionId: "conn_123", dialect: "clickhouse" },
  sql: `
    select movement_date, quantity_tons
    from inventory_movements
    order by movement_date desc
    limit {{ param("limit") }}
  `,
  inputs: [limitParam],
  defaultParameters: { limit: 100 },
  limit: 100,
});

function LatestRowsTable() {
  const inputs = useSemaphorInputs([limitParam]);
  const result = useSemaphorQuery(latestRowsQuery, { inputs });

  if (result.isLoading) return <TableSkeleton />;
  if (result.error) return <ErrorState message={result.error.message} />;
  if ((result.records ?? []).length === 0) return <EmptyState />;

  return (
    <table>
      <thead>
        <tr>
          {(result.columns ?? []).map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {(result.columns ?? []).map((column) => (
              <td key={column.key}>{formatCell(row[column.key], column)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
const region = semaphor.filter({
  id: "region",
  label: "Region",
  field: { name: "region", role: "dimension", dataType: "string" },
  operator: "in",
});

const limit = semaphor.sqlParam({
  id: "limit",
  label: "Limit",
  defaultValue: 100,
});

const rowsQuery = semaphor.sql({
  source: { kind: "sql", connectionId: "conn_123", dialect: "clickhouse" },
  sql: `
    select movement_date, quantity_tons
    from inventory_movements
    where 1 = 1
      {{ filter("region").sql }}
    order by movement_date desc
    limit {{ param("limit") }}
  `,
  inputs: [region, limit],
  defaultParameters: { limit: 100 },
  limit: 100,
});

function LatestRows() {
  const inputs = useSemaphorInputs([region, limit]);
  const rows = useSemaphorQuery(rowsQuery, { inputs });
  return <DataTable rows={rows.records} columns={rows.columns ?? []} />;
}
```

For record/table rendering, treat `column.key` as the stable code accessor and
`column.label` as display text:

```tsx
{
  result.records.map((row) => (
    <tr>
      {result.columns.map((column) => (
        <td key={column.key}>{row[column.key]}</td>
      ))}
    </tr>
  ));
}
```

Do not access records with display labels such as `row[column.label]` or
`row["Movement Date"]`. For `semaphor.analysis` query results, prefer
`insight.resultSets.<name>.columns` and `row[column.key]` over top-level
analysis arrays when rendering tables or charts. For simple insight views, the
SDK also exposes the default row-bearing analysis result as `insight.records`
and `insight.columns`; use those columns rather than `Object.keys(...)`.

## Data App UX Baseline

Generated Semaphor-backed views should feel like real data apps, not raw API
proofs of concept. Match the target app's existing design system, but include
these baseline behaviors unless the user asks for a deliberately minimal view:

- Every `useSemaphorQuery` result rendered on screen needs loading, error, and
  empty states. Do not leave cards stuck at `0`, blank charts, or empty tables
  while a query is loading or has failed.
- Each data-bearing card should normally own its own query. Shared-query
  derivation is valid when it is an intentional optimization, but for dashboard
  apps a KPI, chart, table, and insight panel should generally have distinct
  query specs and distinct loading/error states.
- Shared filters are input handles. Bind the input once, then pass it into
  every card query that should respond to it.
- Table views should render from `result.columns` for stable order and labels,
  support user sorting, and show an empty state when no rows are returned.
- Tables with numeric columns should include a total row for the rows being
  displayed. If the product needs a true total across all filtered data rather
  than the current page/window, create a separate aggregate query for that
  total instead of summing a paginated or truncated table client-side.
- Large or complete-dataset tables must be server-side tables. Do not fetch a
  million rows into React and then filter, sort, paginate, or virtualize only
  on the client. Represent filtering and ordering in the Semaphor query spec,
  and represent server pages with `pagination: { page, pageSize }` on
  `semaphor.records(...)` or `semaphor.sql(...)`. Use `result.pagination` for
  page controls and `result.rowCount` for the server-reported total count.
  If a needed table behavior cannot be expressed yet, call that out as a
  `react-semaphor/data-app-sdk` or Semaphor execution gap and build a bounded
  table instead of pretending the frontend has the full dataset.
- For rich table UX, inspect the target app first. Use its existing table/grid
  library when one is already installed. If the app does not have one, ask the
  user before adding dependencies; recommend `@tanstack/react-table` for
  table state such as columns, sorting, row models, and pagination controls,
  and add `@tanstack/react-virtual` only when virtualized row rendering is
  needed. These libraries are rendering/state helpers, not a substitute for
  Semaphor server-side query limits.
- Numeric, currency, percentage, and date values should be formatted for human
  scanning. Preserve raw values only when the user needs exact IDs, codes, or
  machine-readable output.
- Loading skeletons or compact placeholders are preferred over large explanatory
  text. Errors should be specific enough to debug but not expose secrets.
- For controls that trigger multiple queries, preserve the previous layout
  while queries refresh; show per-card loading state rather than replacing the
  whole app with one global spinner unless the whole app truly cannot render.

Sorting may be client-side for small, bounded result sets. For large,
paginated, or "complete dataset" tables, sorting should be represented in the
Semaphor query/order contract so the server owns the sorted result.

### Dashboard planning response shape

For broad dashboard or app-building requests, respond with a compact plan
before editing files. Treat this as a required gate, not background reasoning.
The plan should be visible to the user in the conversation; in internal eval
runs, also persist it to the provided planning artifact before editing. Include:

- app/dashboard title and purpose;
- selected Semaphor sources and why they were chosen;
- planned filters and which views they affect;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, or unsupported;
- table UX expectations such as sorting and numeric totals;
- table data-volume expectations: bounded result, server-side
  pagination/windowing, or unsupported SDK capability;
- unsupported insights plus the semantic-model improvement needed to support
  them;
- whether the target is a new app, an existing Data App, or an existing
  Semaphor dashboard;
- one next step: build the plan, revise the plan, or inspect more data.

For large-table plans, the table view entry must explicitly say whether the
table is `bounded`, `server_paginated`, or `server_windowed`. If it is
server-paginated, name the intended `pageSize`, server sort field, filters,
and that page controls will read `result.pagination`. Do not describe a
million-row or complete-dataset table as client-paginated.

If the user is working in an existing app, inspect the current source and
manifest first. Preserve existing views unless the user asks to replace them,
and present a change plan with keep, modify, add, and remove sections. Do not
silently convert an existing app into a greenfield rewrite.

### Shared and top-level filters (opt-in subscription)

A dashboard-wide filter is built by composition, not a global setting. Define
one input spec, bind it once with `useSemaphorInputs` in a shared parent (or a
small React context you own), then pass that same handle array into each query
that should respond to it:

```tsx
const region = semaphor.filter({
  id: "region",
  field: regionField,
  operator: "=",
});

const revenueQuery = semaphor.metric({
  source,
  metrics: [revenue],
  inputs: [region],
});
const recordsQuery = semaphor.records({
  source,
  fields: [regionField, revenue],
  inputs: [region],
});

function Dashboard() {
  const inputs = useSemaphorInputs([region]);
  const revenueResult = useSemaphorQuery(revenueQuery, { inputs });
  const recordsResult = useSemaphorQuery(recordsQuery, { inputs });
}
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
npm run publish:data-app -- --dir <app> --project-id <project-id> --title "<title>"
```

The helper reads the project token from shell env or the target app's local env
files. It accepts `SEMAPHOR_PROJECT_TOKEN` and, for Vite dogfooding,
`VITE_SEMAPHOR_PROJECT_TOKEN`. It infers the Semaphor app URL from the token's
`apiServiceUrl`. Use `SEMAPHOR_API_BASE_URL` or `--api-base-url` only for
unusual local or self-hosted routing where the token URL should not be used.
Use `--validation-status <path>` only for a precomputed Semaphor validation
result.

After the first successful save or publish, the helper writes
`semaphor.projectId` and `semaphor.dataAppId` to `semaphor.data-app.json`.
Subsequent `load`, `save-draft`, and `publish` commands may omit
`--data-app-id`; they update the manifest-bound Data App. Use `--new` only when
the user wants a separate hosted Data App copy.

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
- Semaphor MCP query checks for data-bearing analytics when credentials are
  available

The validator is a compatibility smoke check by default. Treat its Semaphor
advisories as guidance, not customer-facing blockers. Use `--strict` only for
Semaphor package-maintainer quality gates.

Do not reimplement source/field validation in plugin prompts or scripts once
the Semaphor validation route is available. Plugin-local scans are package and
build preflight; Semaphor owns catalog-aware SDK hook validation.

`POST /api/v1/data-app/validate` and `/api/v1/data-app/execute` support
`semaphor.analysis(...)` query specs executed through `useSemaphorQuery` and
the same governed analytics query-spec service used by MCP
`semaphor_analyze`. Treat failures there as shared analytics/SDK/app execution
issues, not as host-specific prompt issues.

If validation cannot run, say exactly why.
