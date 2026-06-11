# Planning Workflow

Planning and editing are separate. If the user asks to plan, do not change
files. For broad Data App requests, large-table requests, or existing-app
changes, produce a visible plan before editing. Treat broad app creation as a
review-first workflow: inspect, propose, ask, then build only after the user
accepts a plan or gives a narrow explicit implementation instruction.

Use Semaphor planner tools as the source of truth for broad analytical work:

- New app or broad dashboard/app request:
  after domain approval, call `semaphor_plan_data_app` with `workspaceDir`,
  `domainId`, `goal`, `responseFormat: "codegen_summary"`, and any known
  `datasetName`/`datasetNames` or `preferences`. Present the returned plan and
  stop. Generate files only after the user accepts the visible plan.
- Substantial existing-app analytical edit:
  for generated apps, call `semaphor_update_data_app_contract` with `goal`,
  structured `operationIntent`, and `workspaceDir`; it reads the generated
  manifest as current state. Use `semaphor_plan_data_app_change` directly only
  for preview/debug workflows that must not write files.

Do not replace planner output with an agent-invented plan. Present the returned
plan or change plan, then wait for the user's decision before editing files.
Build from its `sources`, `inputs`, `views`, `operations`, `sdkSpec`,
assumptions, and unsupported gaps. If the planner blocks or asks for a
domain/operation/current state, ask the user or inspect the app instead of
guessing.

For broad dashboard-style creation, pass a view budget large enough for a
balanced first proposal. Use `preferences.maxViews: 15` by default, or up to
20 for wider coverage. The default 8-view single-source plan is not a hard cap.
For broad dashboard planning, pass `responseFormat: "codegen_summary"` exactly.
Do not pass `responseFormat: "compact_summary"` or another invented compact
format; the supported planner response formats are `full` and
`codegen_summary`. If an invalid response format is rejected, retry once with
`codegen_summary` instead of falling back to a full raw plan because chat output
looks truncated. Never shrink `maxViews` just because the returned planner JSON
is verbose; keep the artifact bounded by using the codegen summary or
summarizing fields and bindings, not by throwing away planned visual coverage.

## Project And Domain Selection Gate

`semaphor_plan_data_app` requires a resolved project and semantic domain. The
normal path is to discover domains and pass the selected `domainId`. In a
project-token or otherwise scoped session with exactly one accessible semantic
domain, the planning tool may accept omitted `domainId` or `domainId: "auto"`.
If multiple domains are available, do not guess; ask the user to choose.

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
  explained user-requested addition, with an explicit list of subscribed
  `viewIds` before codegen;
- every substantial deviation should be shown to the user before codegen or
  captured as a limitation after validation.

For accepted greenfield/broad plans, materialize the accepted planner artifact
before UI edits:

```text
semaphor_plan_data_app(responseFormat: "codegen_summary")
-> present visible plan with views, visual types, filters, file layout, and DevTools setup
-> user/eval accepts the visible plan
-> semaphor_generate_data_app_contract(workspaceDir, planArtifactPath)
-> build UI from src/semaphor/generated imports
-> semaphor_validate_data_app_contract(workspaceDir)
```

After browser smoke captures a Semaphor DevTools bridge snapshot, pass it to
`semaphor_validate_data_app_contract` as `devtoolsSnapshotPath`. This requires
generated query ids and generated input option query ids to appear in DevTools
traces. It proves registration/execution visibility; still compare traces or
values after changing filters to prove filter effect.

`planArtifactPath` must point at the canonical
top-level `semaphor-data-app-codegen-summary/v1` JSON object. Do not pass a
full plan, eval `plan.json`, `{ codegenSummary }`, or `{ summary }` wrapper.

The generated files own Semaphor source refs, fields, visible input specs,
input option queries, view query specs, and per-view filter binding helpers.
The React UI owns layout, controls, cards, charts, tables, formatting, applied
filter affordances, and loading/error/empty states. Do not manually recreate
generated analytics wiring in `App.tsx`.
The generated directory also includes `contract.manifest.json`. Treat that
manifest as the durable accepted analytics contract for future change
planning. Do not edit generated files by hand; validation checks that the
manifest hash still matches the generated TypeScript files.
For iterative analytics changes to a generated app, call:

```text
semaphor_update_data_app_contract(workspaceDir, goal, operationIntent)
-> reads src/semaphor/generated/contract.manifest.json
-> calls semaphor_plan_data_app_change with the manifest codegenSummary
-> rejects diagnostic warning fixes that add/remove views, inputs, or filter scopes
-> regenerates src/semaphor/generated from the updated summary
```

For Inspector/runtime warning cleanup, pass
`operationIntent: { kind: "fix_warnings", targetViewIds: [...] }`. The update
tool allows only targeted `fields`/`sdkSpec` corrections and fails before
writing files if the planner proposes unrelated views, inputs, or filter
contract changes. For user-requested edits such as visual title changes, use
`operationIntent.kind: "edit"` with the target view ids so the normal iterative
update path remains available.

Do not inspect `App.tsx` to reconstruct query specs, filter bindings, source
refs, or option queries. Inspect UI files only to decide where the changed
views/controls should render.
If the generated metadata includes
`semaphorGeneratedContractMetadata.presentationViews`, render those planned
text/commentary blocks in the dashboard instead of ignoring them because they
do not have query specs.
Do not hand-condense a full plan into generator input; that can drop `sdkSpec`,
relationship-aware bindings, input option fields, and presentation-only views.
The combined create-contract tool manages any intermediate planner JSON
internally. If contract generation fails twice before writing files, stop and
report a planner/generator/tooling failure instead of manually creating
`src/semaphor/generated`.

If the accepted plan has zero executable views, stop before codegen unless the
user explicitly asked for a model-readiness or semantic-gap report. A blocked
plan is not a dashboard implementation plan. Ask for a different domain, a
clearer business goal, or semantic-model improvements. The generator rejects
zero-executable-view plans by default so agents do not accidentally ship empty
generated contracts.

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

Before writing code, resolve filter scope as an implementation map:

- each visible filter/control id and field ref;
- for data-backed option filters, the visible label field, option value field,
  and runtime filter field for each subscribed source;
- whether it is dashboard-wide, section-wide, or card-local;
- each subscribed `plan.views[*].id` and query id that will receive the bound
  handle;
- any view that does not receive the filter and why, such as unrelated source,
  missing relationship, unsupported model, or intentionally local control;
- how affected cards will show active applied-filter state;
- the input option query id, if choices are fetched from Semaphor.

Do not infer filter scope later while wiring JSX. If the planner omits
`appliesToViewIds`, resolve it from source identity and relationships before
editing, or mark the ambiguity and ask instead of passing the handle into every
query.

Relationship-aware filters are executable planner output, not suggestions to
recreate manually. Preserve `input.relationshipHint`,
`input.relationshipsUsed`, `input.optionQuery.population`, and
`input.optionQuery.dependencies` when translating planned inputs into generated
contract metadata and SDK specs. Emit `relationshipHint` into runtime
`semaphor.bindInput(...)`; keep `relationshipsUsed` as evidence, not a runtime
SDK property. A related population means the option list should be narrowed
through the base fact/source on the
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
- composition/share of whole -> donut or pie chart only when the denominator
  is clear;
- two-dimension category composition -> stacked bar chart when the query grain
  includes both the x-axis category and stack/color category;
- row-level records, operational queues, drill-through, or large result sets ->
  table, with server-side behavior noted when needed;
- pivoted or hierarchical comparisons -> matrix.
- section introductions or explanatory separators -> text/commentary blocks,
  but do not write factual findings before query results exist.

Preserve the accepted visual type during implementation unless the user
revises the plan or validation proves the visual cannot be supported. Report
any fallback as a plan deviation, not as an invisible codegen choice.

When building from an accepted plan, keep the implementation traceable:

- map each buildable `plan.views[*]` to an obvious card/insight component;
- keep Semaphor sources, field refs, shared filters, input option specs, and
  query specs in `src/semaphor/*` modules instead of burying them inside
  `App.tsx` or one large dashboard component;
- keep `App.tsx` focused on the provider, app shell, layout composition, and
  imported sections; it should not own repeated query specs, many query hooks,
  chart/table implementations, or formatting helpers;
- preserve view-owned query ownership unless the plan explicitly declares a
  shared-query optimization.

Before editing, include the intended file/component layout, filter-scope map,
and DevTools setup in the visible plan. This is a required pre-codegen
checkpoint for broad apps, not optional commentary. If the host app has no
stronger convention and the plan has more than two data-bearing views, use a
small inspectable structure such as:

```text
src/semaphor/queries.ts
src/semaphor/inputs.ts
src/semaphor/sources.ts
src/semaphor/fields.ts
src/components/layout/FilterBar.tsx
src/components/cards/<ViewName>Card.tsx
src/utils/formatting.ts
```

Do not replace one huge `App.tsx` with one huge `Dashboard.tsx`; repeated
planned views should become separate card/view components, while shared query
definitions and input specs remain in `src/semaphor/*`.

DevTools setup should be planned before edits too: mount one root
`<SemaphorDevtools />`, enable provider debug only for local/authoring
environments, use stable explicit query ids, and pass `debug.sourceHint` or
`sourceHints` only when useful for mapping a trace back to a generated
component. Do not add per-card inspector wrappers for broad dashboards.

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
- planned filters, which views/query ids they affect, which views they do not
  affect and why, whether each filter is dashboard-wide, section-wide, or
  card-local, and how affected cards will show active applied-filter state;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, unsupported, or SQL
  fallback. Use concrete labels such as KPI strip, KPI card, line chart, bar
  chart, stacked bar chart, area chart, pie/donut chart, text/commentary block,
  table, matrix, filter control, or detail panel;
- for bar, stacked bar, pie/donut, and category comparison charts, the
  grouped/aggregate query grain that will back the visual;
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
For substantial analytical edits in generated apps, call
`semaphor_update_data_app_contract` and present the returned migration report
plus any change operations:

- keep;
- modify;
- add;
- remove;
- validation steps.

Generated-contract change planning supports additive, edit, and remove
requests while preserving non-target views by default. If the planner returns
`ask_user` or a blocked status, do not rewrite the app as a greenfield build;
ask for the missing decision or report the unsupported model gap.

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
