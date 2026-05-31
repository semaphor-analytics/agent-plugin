# Planning Workflow

Planning and editing are separate. If the user asks to plan, do not change
files. For broad dashboard/app requests, large-table requests, or existing-app
changes, produce a visible plan before editing.

The plan should reduce churn by deciding the analytical shape before codegen:
which views are server-backed, which are derived from existing query results,
which are presentation-only, and which cannot be supported by the current data
model.

## Dashboard Planning Response

For broad dashboard or app-building requests, respond with a compact plan
before editing files. Treat this as a required gate, not background reasoning.
In internal eval runs, also persist the plan to the provided planning artifact
before editing. Customer apps do not need a `plan.json`; they need the visible
plan.

Include:

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

## MCP-To-Runtime Parity

Treat MCP answers as authoring evidence, not automatically as dashboard-ready
runtime views. A view is dashboard-ready only when it has all three:

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
Present a change plan with:

- keep;
- modify;
- add;
- remove;
- validation steps.

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
