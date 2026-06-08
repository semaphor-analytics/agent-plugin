# Planning Workflow

Planning and editing are separate. If the user asks to plan, do not change
files. For broad Data App requests, large-table requests, or existing-app
changes, produce a visible plan before editing. Treat broad app creation as a
review-first workflow: inspect, propose, ask, then build only after the user
accepts a plan or gives a narrow explicit implementation instruction.

Use Semaphor planner tools as the source of truth for broad analytical work:

- New app or broad dashboard/app request:
  call `semaphor_plan_data_app` with `domainId`, `goal`, and any known
  `datasetName`/`datasetNames` or `preferences`.
- Substantial existing-app analytical edit:
  call `semaphor_plan_data_app_change` with `goal`, structured
  `operationIntent`, and current app state such as `currentPlan`,
  `existingViewIds`, and known inputs.

Do not replace planner output with an agent-invented plan. Present the returned
plan or change plan, then wait for the user's decision before editing files.
Build from its `sources`, `inputs`, `views`, `operations`, `sdkSpec`,
assumptions, and unsupported gaps. If the planner blocks or asks for a
domain/operation/current state, ask the user or inspect the app instead of
guessing.

## Project And Domain Selection Gate

`semaphor_plan_data_app` requires a resolved project and domain. Do not call it
with a domain selected only by the agent when the user gave a broad request
such as "create an app" or "build a dashboard".

Resolve the project first:

- Project-token mode fixes the project. State that fixed project scope.
- OAuth mode with one visible project may use that project after stating the
  assumption.
- OAuth mode with multiple visible projects requires a user choice before
  domain discovery or planning unless the user named the project.

Resolve the domain next:

- If the user named a domain/source, use it.
- If the selected project has one usable semantic domain, state the assumption
  and continue to planning.
- If the selected project has multiple usable domains and the user did not
  name one, present a short list of domain options and ask which domain to use.
- If the goal clearly implies a domain, present that as the recommended domain
  and ask the user to confirm it before planning.

Only after the domain is selected or confirmed should the agent call
`semaphor_plan_data_app`. Domain confirmation and plan acceptance are separate
checkpoints: first choose the domain, then present the planner output, then
ask whether to build it.

## Domain And Source Choice

Do not silently choose a domain for a broad app request when the user did not
name one. After `semaphor_get_analysis_context` and
`semaphor_list_semantic_domains`, present a short set of relevant domain/app
options and ask which domain to use before planning.

If one domain is clearly implied by the user's words or there is only one
usable domain, state the assumption and still ask for confirmation before
planning when multiple domains are visible:

```text
I can build this from Talent Ops. I also found Finance and Product Usage, but
they do not match the request as closely. Should I use Talent Ops for the app
plan?
```

If the user already named a domain/source, use it, but still present the
planned views and wait for acceptance before codegen.

Treat the accepted planner response as the codegen contract:

- every buildable `plan.views[*]` should become either a visible component or
  an explicitly documented omission;
- every data-bearing component should use the corresponding planner-returned
  `sdkSpec` query kind, source, fields, filters, pagination/windowing, and
  derived-field definitions;
- every shared filter/control should come from `plan.inputs` or a clearly
  explained user-requested addition;
- every substantial deviation should be shown to the user before codegen or
  captured as a limitation after validation.

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

Use `plan.sources` modeled semantics before reaching for raw SQL:

- `source.datasetShape` tells whether the dataset behaves like event data,
  a daily/latest snapshot, a dimension, a bridge, entity state, or unknown.
- `source.dateSemantics.primaryDateField` is the planner-approved date field.
  If `primaryDateFieldSource` is `ambiguous`, `missing`, or
  `authored_missing`, do not guess a trend date in React or SQL; surface the
  unsupported gap or ask for modeling help.
- `source.dateSemantics.defaultTimeGrain` and `defaultTimeWindow` are advisory
  defaults for trend and date filter choices. Prefer them over hardcoded month
  windows when the planner provides them.
- `source.dateSemantics.snapshot` explains whether latest-snapshot behavior is
  modeled. If the selector is unsupported, mark the view unsupported or use a
  planner-returned fallback; do not build KPI, breakdown, or table SDK specs
  over all snapshot rows, and do not write SQL only because latest snapshot is
  convenient to express in SQL.
- `source.modeledMeasureCount` and `source.tableOnlyNumericFieldCount` explain
  why some numeric fields are available for detail tables but not safe as KPIs,
  trends, or breakdown measures.

Use `plan.inputs` as filter guidance. For a select or multi-select input,
`input.fieldRef` is the filter field, `input.optionQuery` describes the
`semaphor.inputOptions(...)` query to populate choices, and
`input.appliesToViewIds` says which views should receive that handle. Do not
invent separate option queries when the planner supplies one.

Relationship-aware filters are executable planner output, not suggestions to
recreate manually. Preserve `input.relationshipHint`,
`input.relationshipsUsed`, `input.optionQuery.population`, and
`input.optionQuery.dependencies` when translating planned inputs into
`semaphor.filter(...)` and `semaphor.inputOptions(...)`. A related population
means the option list should be narrowed through the base fact/source on the
server. A missing or unsupported relationship should remain an unsupported gap
or modeling fix; do not replace it with a client-side join, client-side filter,
or raw SQL join unless the planner returns an explicit SQL fallback or the user
asks for SQL.

The plan should reduce churn by deciding the analytical shape before codegen:
which views are server-backed, which are derived from existing query results,
which are presentation-only, and which cannot be supported by the current data
model.

The visible plan must also decide the user-facing visual type for every
buildable view. Do not present only "planned views" or metric/source names and
leave the UI shape implicit. If the planner returns a visual spec, use it. If
the planner returns only the analytical shape, infer the conventional visual
from the query shape and state the choice explicitly:

- scalar totals or a small set of current values -> KPI strip or KPI card;
- time-series values -> line chart or area chart;
- ranked categories or category comparison -> bar chart;
- composition/share of whole -> donut or stacked bar only when the denominator
  is clear;
- row-level records, operational queues, drill-through, or large result sets ->
  table, with server-side behavior noted when needed;
- pivoted or hierarchical comparisons -> matrix.

Preserve the accepted visual type during implementation unless the user
revises the plan or validation proves the visual cannot be supported. Report
any fallback as a plan deviation, not as an invisible codegen choice.

When building from an accepted plan, keep the implementation traceable:

- map each buildable `plan.views[*]` to an obvious card/insight component;
- keep Semaphor sources, field refs, shared filters, input option specs, and
  query specs in `src/semaphor/*` modules instead of burying them inside
  `App.tsx` or one large dashboard component;
- keep `App.tsx` focused on composition, app shell, filters, and layout;
- preserve view-owned query ownership unless the plan explicitly declares a
  shared-query optimization.

Before editing, include the intended file/component layout in the visible
plan. If the host app has no stronger convention and the plan has more than
two data-bearing views, use a small inspectable structure such as:

```text
src/semaphor/queries.ts
src/semaphor/inputs.ts
src/semaphor/sources.ts
src/semaphor/fields.ts
src/components/layout/FilterBar.tsx
src/components/cards/<ViewName>Card.tsx
src/utils/formatting.ts
```

If the implementation later needs to deviate from the accepted file layout,
say why before making the deviation or report it as a limitation after
validation.

## Data App Planning Response

For broad Data App-building requests, respond with a compact plan before
editing files. Treat this as a required gate, not background reasoning.

Include:

- app title and purpose;
- selected domain/source plus any reasonable alternatives considered;
- selected Semaphor sources and why they were chosen;
- source coverage: included, excluded, unsupported, and not found sources;
- planned filters, which views they affect, whether each filter is placed
  dashboard-wide, section-wide, or card-local, and how affected cards will show
  active applied-filter state;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, unsupported, or SQL
  fallback. Use concrete labels such as KPI strip, KPI card, line chart, bar
  chart, area chart, pie/donut chart, table, matrix, filter control, or detail
  panel;
- app-local derived fields, why they are needed, and whether they are row-stage
  or aggregate-stage calculations;
- matrix/pivot views with row axes, column axes, values, totals/subtotals, and
  display limits;
- table UX expectations such as sorting and numeric totals;
- table data-volume expectations: bounded result, server-side
  pagination/windowing, or unsupported SDK capability;
- dependency and registry recommendations, including whether a shadcn
  registry table, TanStack Table, TanStack Virtual, chart package, or starter
  app is recommended and whether user approval is needed;
- expected files/components to create or modify;
- unsupported insights plus the semantic-model improvement needed to support
  them;
- whether the target is a new app or an existing Data App;
- one next step with explicit choices: build the plan, revise the plan, choose
  another domain/source, inspect more data, or cancel.

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
- matrix/pivot/hierarchy view from `semaphor_plan_data_app` or
  `semaphor_matrix` -> `semaphor.matrix(...)`;
- SQL-first answer validated with `semaphor_query_sql_advanced` ->
  `semaphor.sql(...)`;
- filter option list -> `semaphor.inputOptions(...)` plus
  `semaphor.filter(...)` and `useSemaphorInputs(...)`.

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

When the planner returns `visualSpec.tableBehavior`, treat it as the UI
implementation contract for that table. It carries:

- `tableMode`: bounded, server-paginated, or server-windowed;
- `height`: max pixel height, sticky-header requirement, and scroll behavior;
- `pagination`: client/server mode, page size, and whether controls read
  `result.pagination`;
- `sorting`: server or bounded-client sorting plus the default sort field;
- `totals`: displayed-row totals and whether all-filtered-row totals require a
  separate aggregate query;
- `serverSideRequired`: whether pagination/sorting/filtering must stay in the
  Semaphor query instead of only React state.

Do not ignore `visualSpec.tableBehavior` and then invent a table layout from
scratch. Use it to build the shadcn/TanStack table component.

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
