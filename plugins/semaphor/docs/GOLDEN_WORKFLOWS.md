# Golden Workflows

These workflows describe how customers should use the Semaphor Agent Plugin in
real React repositories. They are not tied to the starter scaffold.

Each workflow should preserve the same spine:

```text
customer request
  -> classify operation
  -> inspect Semaphor metadata through MCP
  -> use governed analysis when needed
  -> define SDK inputs/queries with semaphor.* builders when editing
  -> execute runtime data with useSemaphorQuery
  -> run local validation
  -> save draft or publish through Semaphor lifecycle APIs when requested
```

## 1. Explore Available Data

Customer prompt:

```text
What Semaphor data can I use in this project?
```

Expected agent behavior:

- do not edit files,
- call Semaphor MCP discovery tools,
- prefer semantic domains and datasets over physical tables,
- summarize available domains, datasets, important fields, metrics, and date
  fields,
- call out missing metadata or unclear field roles instead of guessing.

Expected validation:

- no file changes,
- answer cites concrete Semaphor domains/datasets/fields.

## 2. Answer A BI Question

Customer prompt:

```text
Why did inventory movement change last month?
```

Expected agent behavior:

- do not edit files unless the user asks to add the result to the app,
- inspect semantic metadata,
- use `semaphor_analyze` for governed semantic analysis when the question fits,
- use `semaphor_query_sql_advanced` only for SQL-first questions that cannot be
  represented cleanly by semantic analysis,
- explain the answer from governed execution results.

Expected validation:

- no app build required,
- answer includes the dataset and fields used,
- uncertainty is explicit when the data cannot answer the question.

## 2A. Use Advanced SQL When Needed

Customer prompt:

```text
Use SQL to inspect the latest raw inventory movement rows.
```

Expected agent behavior:

- discover the project, domain, dataset, and connection context before writing
  SQL,
- use `semaphor_query_sql_advanced` because the user explicitly requested raw
  SQL/raw rows,
- validate with a small SQL preview such as `LIMIT 5` or `LIMIT 10` unless the
  user explicitly asks to inspect more rows,
- provide `analyzeFallbackReason` and `analyzeFallbackExplanation`,
- explain that `semaphor_analyze` is still preferred for ordinary governed BI
  questions,
- do not request database credentials or bypass Semaphor permissions.

Expected validation:

- returned rows come from governed Semaphor execution,
- if the user asks to add this as a runtime view, generated code uses
  `semaphor.sql` with bounded SQL, `defaultParameters`, `semaphor.filter`
  inputs, and `useSemaphorQuery` rather than static fixture rows,
- no invented connection/table identifiers,
- no token or credential leakage.

## 3. Ask First, Then Add To App

Customer prompt:

```text
Which movement types drove the biggest change? If the answer is useful, add it
to this app.
```

Expected agent behavior:

- answer the data question first,
- wait for explicit productization if the request is ambiguous,
- inspect local React files before editing,
- add a component, route, or panel that fits the existing app structure,
- use Data App SDK builders plus `useSemaphorQuery` for runtime data,
- preserve the customer's styling and routing patterns.

Expected validation:

- run `node scripts/validate-semaphor-data-app.mjs --dir <app>`,
- run the app's typecheck/build scripts when present,
- open the app locally when practical and verify real data renders.

## 3A. Productize A Driver Or Period-Change Insight

Customer prompt:

```text
Why did inventory movement drop last month? Add the driver insight to this app.
```

Expected agent behavior:

- inspect semantic metadata before answering,
- use `semaphor_analyze` with period-change analysis during authoring,
- generate a React view with `semaphor.analysis` plus `useSemaphorQuery`, not static markdown,
  fixture data, or raw SQL output,
- preserve the same semantic source, metric, date field, filters, time window,
  and analysis shape used for the governed answer,
- render loading, error, empty, summary, and detail states.

Expected validation:

- extracted query specs validate through `POST /api/v1/data-app/validate` when
  available,
- `/api/v1/data-app/execute` reaches the shared query-spec service for the
  analysis intent,
- local typecheck/build passes.

## 4. Build From A Goal

Customer prompt:

```text
Use my Semaphor project data to build an operations dashboard app.
```

Expected agent behavior:

- inspect Semaphor data before editing,
- inspect local React app structure,
- call `semaphor_plan_data_app` and produce a visible grounded plan before
  editing if the request is broad,
- generate only after the user accepts the visible plan or gives a narrow
  explicit build instruction for a previously reviewed plan,
- when the user did not name a domain, present relevant domain/app options
  instead of silently choosing one,
- present the next choices as build the plan, revise the plan, choose another
  domain/source, inspect more data, or cancel,
- name the intended visual type for each buildable view in the visible plan,
  such as KPI strip, KPI card, line chart, bar chart, area chart, pie/donut
  chart, table, matrix, filter control, or detail panel,
- state the grouped/aggregate query grain for bar, pie/donut, and category
  comparison charts,
- state the affected views and UI placement for each visible filter, and do
  not present section- or card-scoped controls as dashboard-wide filters,
- include the intended file/component layout before editing,
- generate from the returned `sources`, `inputs`, `views`, `sdkSpec`,
  unsupported gaps, and assumptions instead of improvising query specs,
- create KPI, trend, table, and filter views using `semaphor.*` query/input
  builders plus `useSemaphorQuery`,
- give every runtime query spec a stable explicit `id`,
- include local/dev `<SemaphorDevtools />` with the provider debug bridge gated
  to authoring environments,
- give each data-bearing card its own query by default unless the user asks for
  a shared-query optimization,
- show active subscribed filters on affected cards with compact chips/badges
  or muted text,
- prefer the host app's real date-range picker/calendar control when available,
- render loading, error, and empty states for each visible query result,
- make table views sortable and include totals for displayed numeric columns,
- treat Semaphor data tables as server-backed BI views: keep table queries
  bounded, and use Semaphor server-side sorting, filtering, and
  pagination/windowing for exploratory or large-table requests instead of
  fetching broad rows into React,
- for large tables, state the server table plan before editing: query kind,
  fields, filters, server sort, page size, and `result.pagination` controls,
- use the Semaphor table registry as a reference implementation for server
  pagination, sorting, state, formatting, and totals mechanics; install the
  full component only when it fits the host UI and the user approves, otherwise
  adapt the mechanics into the existing table/grid/design system,
- ask before adding the Semaphor table registry item or table dependencies;
  prefer an existing app table/grid library, or `@tanstack/react-table` plus
  `@tanstack/react-virtual` when richer table state and virtualized rendering
  are needed,
- format numbers, dates, currencies, and percentages for scanning,
- avoid static fixtures and invented datasets.

Expected validation:

- generated hooks use MCP-inspected source and field refs,
- local typecheck/build passes,
- browser smoke check shows governed Semaphor data.

## 4A. Add A Derived Metric

Customer prompt:

```text
Add gross margin to this app even though it is not modeled yet.
```

Expected agent behavior:

- inspect Semaphor metadata and identify the source fields needed for the
  calculation,
- for substantial existing-app analytical edits, call
  `semaphor_plan_data_app_change` and preserve existing views/filters unless
  the user asks to replace them,
- use `semaphor.derivedField(...)` for the app-local calculated field,
- attach the derived field to the query through `derivedFields`,
- use `semaphor.metric`, `semaphor.records`, or another semantic SDK query
  builder so execution remains governed,
- state when the calculation should eventually move into the Semaphor semantic
  model because it is reusable across apps,
- do not compute the metric only from already-returned React rows unless the
  user asked for a presentation-only calculation.

Expected validation:

- expression placeholders match the grounded input field names,
- the derived field name does not collide with a source/catalog field,
- local typecheck/build passes,
- Semaphor validation/execution accepts the derived field when available.

## 4B. Build A Matrix Or Pivot Table

Customer prompt:

```text
Show revenue by region and segment with row totals and a grand total.
```

Expected agent behavior:

- inspect the relevant semantic source, row axes, column axes, value measures,
  date field, and filters through MCP,
- use MCP `semaphor_matrix` during planning or validation when available,
- productize the view with `semaphor.matrix(...)` plus `useSemaphorQuery`,
- define totals, subtotals, display limits, and sorting/windowing explicitly,
- render loading, error, empty, sparse-cell, subtotal, and grand-total states,
- use the Semaphor matrix registry as a reference implementation for payload
  parsing, row hierarchy, pivot columns, sparse cells, subtotals, and grand
  totals; install the full component only when it fits the host UI and the user
  approves,
- do not fetch unbounded detail rows and pivot them only in React.

Expected validation:

- generated code uses source-bearing field refs from MCP,
- matrix display limits are bounded,
- local typecheck/build passes,
- browser smoke check shows a server-shaped matrix result.

## 5. Add A Filter Or Control

Customer prompt:

```text
Add a region filter to this dashboard.
```

Expected agent behavior:

- inspect the existing component and current Semaphor field refs,
- verify the requested filter field through MCP if it is not already grounded,
- use `semaphor.inputOptions` when options should come from data,
- use `semaphor.filter`/`semaphor.control`, bind with `useSemaphorInputs`, and
  pass the handles into downstream `useSemaphorQuery` calls,
- preserve existing app state conventions where possible.

Expected validation:

- selecting the filter changes downstream query results,
- typecheck/build passes,
- no hardcoded option values unless the user explicitly asked for fixed values.

## 6. Fix A Runtime Or Typecheck Error

Customer prompt:

```text
The Semaphor dashboard I added is failing. Fix it.
```

Expected agent behavior:

- inspect the error before editing,
- classify whether it is local React, SDK usage, MCP metadata, auth, or
  governed execution,
- make the smallest reusable fix,
- avoid replacing the app with a generic starter,
- preserve the existing domain, dataset, filters, and app structure.

Expected validation:

- rerun the failed command,
- rerun `validate:data-app`,
- browser smoke test when the issue was runtime-visible.

## 7. Prepare For Save Or Publish

Customer prompt:

```text
Prepare this Semaphor data app for publishing.
```

Expected agent behavior:

- validate local build,
- verify runtime token/API assumptions,
- use `npm run save:data-app` or `npm run publish:data-app` for Semaphor-hosted
  lifecycle writes,
- for save, collect a source snapshot and prepare a structured
  `data-app-source-revision/v1`,
- for hosted publish, run `npm run prepare:publish` or rely on
  `publish:data-app` to infer `runtime.entry` and `runtime.styles` from the
  static build,
- for publish, follow the Semaphor-hosted saved-draft-first lifecycle
  sequence,
- do not require or invent a hidden query-spec sidecar file for publish.

Expected validation:

- source builds locally,
- `semaphor.data-app.json` contains a hashed browser module entry for hosted
  publish,
- no long-lived token is committed into frontend source,
- publish failures are classified by failing stage: auth/API, validation,
  build, upload, or complete/fail session.

## 8. Open Existing Semaphor Data App

Customer prompt:

```text
Open this Semaphor Data App in this repo and continue editing it.
```

Expected agent behavior:

- resolve the Semaphor Data App identity from the user-provided id or URL,
- load editor state from Semaphor when lifecycle APIs are available,
- prefer the mutable version-zero draft,
- compare the saved source snapshot with the current local workspace before
  writing files,
- show conflict diagnostics and ask before overwriting local files,
- treat saved workspace paths as hints only, never as authority,
- continue editing with public SDK builders plus `useSemaphorQuery` after the
  user confirms the local repo should be linked to that Data App.

Expected validation:

- local source is not overwritten without confirmation,
- source revision comparison uses `snapshotHash`, not only git commit or local
  path,
- typecheck/build passes after restore or edits.

## Workflow Rules

- Conversation, exploration, and planning turns should not edit files.
- Data-bearing runtime code should use `react-semaphor/data-app-sdk`.
- Use `skills/semaphor-data-apps/references/sdk-contract.md` before
  inspecting package internals. Customer repos are not expected to contain
  plugin docs, and agents should not browse `node_modules/react-semaphor/dist`
  during normal app authoring.
- Use the same operation vocabulary as hosted App Builder, including
  `plan_app`, `save_draft`, and `publish`.
- Use `columns[].key` for row access and `columns[].label` for display.
- Keep customer app structure intact.
- Treat plugin validation advisories as guidance unless running explicit
  `--strict` quality gates.
