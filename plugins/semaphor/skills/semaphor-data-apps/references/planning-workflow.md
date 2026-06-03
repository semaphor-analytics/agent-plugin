# Planning Workflow

Planning and editing are separate. If the user asks to plan, do not change
files. For broad Data App requests, large-table requests, or existing-app
changes, produce a visible plan before editing.

Use Semaphor planner tools as the source of truth for broad analytical work:

- New app or broad dashboard/app request:
  call `semaphor_plan_data_app` with `domainId`, `goal`, and any known
  `datasetName`/`datasetNames` or `preferences`.
- Substantial existing-app analytical edit:
  call `semaphor_plan_data_app_change` with `goal`, structured
  `operationIntent`, and current app state such as `currentPlan`,
  `existingViewIds`, and known inputs.

Do not replace planner output with an agent-invented plan. Present the returned
plan or change plan, then build from its `sources`, `inputs`, `views`,
`operations`, `sdkSpec`, assumptions, and unsupported gaps. If the planner
blocks or asks for a domain/operation/current state, ask the user or inspect
the app instead of guessing.

Check `plan.sourceCoverage` before codegen:

- `included`: the planner generated one or more SDK-ready views for this
  source. Build those views from the matching `viewIds`.
- `excluded`: the source was visible/considered but no view was generated for
  it. Tell the user before building if the source looks relevant to their
  stated goal.
- `unsupported`: the source is visible but lacks modeled measures, dates,
  relationships, or SDK capability needed for governed views.
- `not_found`: the caller requested a dataset name/id that was not visible in
  the selected domain.

For broad multi-source requests, do not silently build only the first source.
If `sourceCoverage` is partial, summarize what is included and what is left
out, then either build the included plan with that caveat or ask whether the
user wants to revise the source selection.

Use `plan.inputs` as filter guidance. For a select or multi-select input,
`input.fieldRef` is the filter field, `input.optionQuery` describes the
`semaphor.inputOptions(...)` query to populate choices, and
`input.appliesToViewIds` says which views should receive that handle. Do not
invent separate option queries when the planner supplies one.

The plan should reduce churn by deciding the analytical shape before codegen:
which views are server-backed, which are derived from existing query results,
which are presentation-only, and which cannot be supported by the current data
model.

## Data App Planning Response

For broad Data App-building requests, respond with a compact plan before
editing files. Treat this as a required gate, not background reasoning.

Include:

- app title and purpose;
- selected Semaphor sources and why they were chosen;
- source coverage: included, excluded, unsupported, and not found sources;
- planned filters and which views they affect;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, or unsupported;
- app-local derived fields, why they are needed, and whether they are row-stage
  or aggregate-stage calculations;
- matrix/pivot views with row axes, column axes, values, totals/subtotals, and
  display limits;
- table UX expectations such as sorting and numeric totals;
- table data-volume expectations: bounded result, server-side
  pagination/windowing, or unsupported SDK capability;
- unsupported insights plus the semantic-model improvement needed to support
  them;
- whether the target is a new app or an existing Data App;
- one next step: build the plan, revise the plan, or inspect more data.

## MCP-To-Runtime Parity

Treat MCP answers as authoring evidence, not automatically as Data App-ready
runtime views. A view is Data App-ready only when it has all three:

- shared Semaphor analytics intent;
- public SDK builder/query shape;
- governed runtime execution through `useSemaphorQuery`.

Common mappings:

- semantic BI answer from `semaphor_analyze` -> `semaphor.metric(...)` or
  `semaphor.analysis(...)`;
- semantic records/table view -> `semaphor.records(...)`;
- SQL-first answer validated with `semaphor_query_sql_advanced` ->
  `semaphor.sql(...)`;
- filter option list -> `semaphor.inputOptions(...)` plus
  `semaphor.filter(...)` and `useSemaphorInputs(...)`.
- pivot, hierarchy, subtotal, and grand-total table view ->
  `semaphor_matrix` during authoring and `semaphor.matrix(...)` at runtime.

## Governed-First Planning Gate

For broad Data App requests, do not jump straight to SQL. The visible plan must
show a governed-first attempt for each data-bearing view:

- `metric`: KPI or aggregate view backed by `semaphor_analyze` during
  authoring and `semaphor.metric(...)` or `semaphor.analysis(...)` at runtime;
- `records`: bounded chart/table rows backed by `semaphor.records(...)`;
- `matrix`: pivot, hierarchy, subtotal, or grand-total view backed by
  `semaphor_matrix` and `semaphor.matrix(...)`;
- `derived`: calculation backed by `semaphor.derivedField(...)`;
- `sql_fallback`: SQL-backed view used only after an explicit reason.

When a view is `sql_fallback`, include:

- the governed path attempted or inspected;
- the missing capability, such as latest-snapshot windowing, unsupported join,
  unmodeled field, unsupported ranking/window function, or explicit user SQL
  request;
- the smallest SQL needed for that view, with bounded limits/pagination and
  server-side filters.

Discovery tools are authoring-only unless their result is compiled into a
supported SDK query. If MCP can answer a question but the SDK/runtime cannot
execute it yet, mark the view unsupported and name the missing Semaphor
capability instead of hardcoding MCP output into React.

## Large Table Planning

For large-table plans, the table view entry must explicitly say whether the
table is:

- `bounded`: intentionally limited result set;
- `server_paginated`: server returns pages and pagination metadata;
- `server_windowed`: server returns a bounded window such as latest N rows.

If server-paginated, name the intended `pageSize`, server sort field, filters,
and that page controls will read `result.pagination`. Do not describe a
million-row or complete-dataset table as client-paginated.

## Existing Apps

If the user is working in an existing app, inspect the current source and
manifest first. Preserve existing views unless the user asks to replace them.
For substantial analytical edits, call `semaphor_plan_data_app_change` and
present the returned change operations:

- keep;
- modify;
- add;
- remove;
- validation steps.

V1 change planning implements additive changes and preserve-by-default
blocking for edit/remove/mixed requests. If the planner returns `ask_user`,
do not rewrite the app as a greenfield build.

Do not silently convert an existing app into a greenfield rewrite.

## Unsupported Insights

If an insight cannot be constructed, say so in product terms and identify the
data-model improvement needed. Examples:

- missing date field for period-over-period analysis;
- missing relationship between datasets for joined insight;
- missing semantic measure definition;
- missing categorical dimension for grouping;
- missing governed SQL capability for a requested advanced query.

Do not hide unsupported work by inventing fields, doing ungrounded joins, or
moving analytical correctness into frontend-only logic.
