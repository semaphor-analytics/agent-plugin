---
name: semaphor-data-apps
description: Build, modify, inspect, validate, save, and publish Semaphor-backed React data apps using react-semaphor/data-app-sdk, Semaphor MCP metadata, governed analytics, and Data App lifecycle APIs.
---

# Semaphor Data Apps

Use this skill when a user asks the coding agent to build, plan, modify,
inspect, validate, save, or publish a Semaphor-backed React data app.

## Core Mental Model

A Semaphor data app is a React application that uses
`react-semaphor/data-app-sdk` to execute governed Semaphor analytics. Generated
local apps should follow the Vite React runtime convention unless the target
repo already has an equivalent React setup.

Work with the customer repo as it exists. Do not force the starter scaffold, a
prescribed provider filename, styling system, route structure, or table library.

The coding agent owns local source inspection and edits. Semaphor owns auth,
metadata, analytics grounding, permissions, governed execution, row limits,
validation, save, and publish lifecycle.

Normal loop: classify the request, resolve Semaphor auth/project context,
inspect governed metadata and local source, visibly plan when broad, edit with
public SDK builders/hooks, validate, then save or publish when requested.

## Workflow Gates

1. Auth: call `semaphor_get_access_context` before local source inspection.
2. Project: if OAuth exposes multiple projects and the user did not name one,
   ask the user to select the project before domain discovery or planning.
3. Domain: if a broad build has no explicit domain and the selected project
   has multiple usable domains, ask the user to choose one. If the goal clearly
   implies a domain, state the recommended domain and ask for confirmation
   before calling `semaphor_plan_data_app`.
4. Implementation map: before the first source edit for a broad app, decide
   the file/component layout, which filters apply to which cards/views, and
   how SDK DevTools will be enabled. Do not start by dumping the dashboard into
   `src/App.tsx`.
5. Contract generation: for greenfield/broad builds, call
   `semaphor_create_data_app_contract` before UI edits so planning and contract
   materialization happen through the Semaphor tools. Import the generated
   `src/semaphor/generated` sources, fields, inputs, queries, and bindings.
   Do not hand-roll analytics wiring from prose or local guesses.
6. Broad build: after project/domain confirmation, present a visible plan and
   stop for user approval before editing.
7. Existing app: inspect current source, use `semaphor_plan_data_app_change`,
   and preserve existing views by default.
8. Dependencies: ask before installing registry items, TanStack, chart
   libraries, or starter scaffolds unless already approved.
9. SQL: use governed metric, records, analysis, matrix, and derived-field paths
   before SQL unless the user explicitly asks for SQL.
10. Completion: run typecheck/build, Semaphor validation, and browser smoke when
   practical.

Auth preflight is step zero for Semaphor work. Before reading package files,
searching source, checking SDK declarations, running helper scripts, or editing
code, call `semaphor_get_access_context` through the host-exposed Semaphor MCP
tools. If the current auth is OAuth and no project is fixed, call
`semaphor_list_projects` and resolve the project before local app inspection.
If the local browser runtime needs a project token, call
`semaphor_get_data_app_runtime_token` after the project is chosen and write only
`VITE_SEMAPHOR_PROJECT_TOKEN` to an ignored local env file.

Auth unavailable is a recoverable setup step, not a refusal. If
`semaphor_get_access_context` reports that no project token was found, if
hosted OAuth returns `requires reauthentication`, or if project-token calls
return `401 Unauthorized`, pause the data-bearing work and ask the user to
reauthenticate or provide a project token. Keep the current task context and
tell the user to say "try again" after auth is fixed. Do not generate fake
analytics while waiting for auth: no placeholder dashboard shell, static mock
analytics, generic integration points, or token-missing UI. For hosted OAuth,
ask the user to use the host MCP OAuth flow for `semaphor` and then say "try
again" (Codex example: `codex mcp login semaphor`; Claude Code uses its MCP
server auth UI/command). For project-token mode, ask for
`VITE_SEMAPHOR_PROJECT_TOKEN` in the app's ignored `.env.local`; for local
Semaphor, also ask for `SEMAPHOR_SERVER_URL=http://localhost:3000`.

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
changes, produce a visible plan before editing.

Broad app creation is selection-gated and approval-gated. It permits inspecting
Semaphor access, projects, and domains, not silently choosing a project/domain,
planning, or editing files. Resolve the project, then confirm the domain when
more than one is accessible. In one-domain scoped sessions, state the assumption
and call the planner with that id or `domainId: "auto"`. After planner output,
present the plan and ask whether to build, revise, choose another domain/source,
inspect more data, or cancel.

If the user already supplied a precise app plan or says to proceed with a
specific previously presented plan, then edit. If the request is a narrow edit
such as "add this already specified chart", proceed after confirming the local
target and Semaphor source are unambiguous.

For broad new Data App requests, use Semaphor planning as the source of truth
before codegen. Present the visible plan/change plan to the user when the
workflow requires approval. After approval, use the combined greenfield tool:
`semaphor_create_data_app_contract({ workspaceDir, domainId, goal,
preferences })`. It calls the planner with `responseFormat: "codegen_summary"`
and writes `src/semaphor/generated` in one step. Use the separate
`semaphor_plan_data_app` -> `semaphor_generate_data_app_contract` sequence only
for explicit preview/debug/eval artifact workflows. For substantial
existing-app edits, use `semaphor_plan_data_app_change` with the current app
state before codegen. Build React from the generated
`src/semaphor/generated` contract plus the returned visual specs and
unsupported gaps. Do not recreate Semaphor sources, fields, inputs, input
option queries, or filter bindings manually unless the generator reports a
clear unsupported analytics gap. If contract generation fails twice before
producing files, stop and report a planner/generator/tooling failure instead
of hand-writing `src/semaphor/generated`.

A blocked plan with zero executable views is not an implementation plan. Do
not turn it into a placeholder or "model gap" app unless the user explicitly
asked for a model-readiness report. Ask the user to choose a better domain,
provide a concrete business goal, or improve the semantic model. The contract
generator intentionally rejects zero-executable-view plans by default.

For broad dashboard-style app creation, prefer `preferences.maxViews` around
15, or 20 for wide coverage. Do not treat the 8-view default as a cap or shrink
`maxViews`; pass `responseFormat: "codegen_summary"` exactly so the planner
returns a bounded implementation summary instead of an oversized plan. Do not
use invented response formats such as `"compact_summary"`; valid planner
formats are `full` and `codegen_summary`.

The visible planning response must include:

- the selected domain/source and any reasonable alternatives considered;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, unsupported, or SQL
  fallback. Use clear visual labels such as KPI strip, KPI card, line chart,
  bar chart, stacked bar chart, area chart, pie/donut chart,
  text/commentary block, table, matrix, filter control, or detail panel so the
  user knows what will appear before codegen;
- planned filters and which views they affect;
- table behavior and dependency recommendations, including whether a Semaphor
  registry table or TanStack dependency would be useful;
- files/components the agent expects to create or modify;
- unsupported gaps and the semantic-model improvement needed;
- a clear decision prompt: build, revise, choose another domain/source, inspect
  more data, or cancel.

When MCP tool discovery is needed, expose the specific Semaphor tools you need
instead of inspecting plugin files or manually speaking MCP. The normal first
calls for data-app work are:

- `semaphor_get_access_context`
- `semaphor_list_semantic_domains`
- `semaphor_list_datasets`
- `semaphor_get_dataset_schema`
- `semaphor_get_domain_relationships`
- `semaphor_create_data_app_contract`
- `semaphor_plan_data_app`
- `semaphor_plan_data_app_change`

If these first-class tools are not exposed in the host session, say that the
host did not expose Semaphor MCP tools and ask the user to reinstall/reload the
plugin or authenticate. The fallback wrapper is for plugin debugging and evals;
ordinary app authoring should not inspect plugin internals to find it.

For planning details, read [planning-workflow.md](references/planning-workflow.md).

For any operation that creates or changes visible UI (`create_app`, `add_view`,
`modify_view`, `add_input`, `modify_input`, `change_layout`, `change_style`,
or a UI-bearing `fix_error`), read
[shadcn-dashboard.md](references/shadcn-dashboard.md) before editing. Treat it
as a required dashboard quality checklist, not optional inspiration.

## Hard Rules

- Start Semaphor auth/project preflight before local repo inspection for
  build, plan, answer, save, and publish workflows. Do not inspect React files,
  SDK internals, helper scripts, or package metadata until auth and project
  context are known, unless the user explicitly asks only about local setup.
- If auth/project preflight cannot resolve a Semaphor project because OAuth
  needs reauthentication or the project token is missing/invalid, pause and ask
  for the exact login or token action. This is a resumable setup step, not a
  denial of the user's request. Do not scaffold fallback dashboards, static
  shells, fake query files, or "ready once token exists" placeholders for a
  data-bearing request.
- Use Semaphor MCP to discover real projects, domains, datasets, fields,
  relationships, SQL connections, and permissioned capabilities before
  generating data-bearing code.
- Treat host-exposed Semaphor MCP tools as the primary authoring interface. If
  they are unavailable, use the fallback wrapper only for debugging/evals and
  classify the run as plugin-host MCP exposure. Never manually speak MCP
  protocol.
- Do not invent dataset names, field names, joins, metrics, IDs, or raw
  database credentials.
- Generated runtime analytics code must use public
  `react-semaphor/data-app-sdk` builders and `useSemaphorQuery`.
- Generated runtime filter option loading must use `semaphor.inputOptions(...)`
  when choices come from Semaphor data. Do not use `semaphor.records(...)` to
  fetch broad lookup rows and derive dropdown/select options in React unless
  `inputOptions` cannot express the case. When that fallback is necessary,
  state the SDK gap and the workaround before reporting completion.
- When the Data App planner returns inputs, preserve the planner-emitted
  `fieldRef`, `optionQuery`, `population`, `relationshipHint`,
  `relationshipsUsed`, and `appliesToViewIds`. Use `relationshipHint` in
  runtime `semaphor.bindInput(...)` calls; keep `relationshipsUsed` as
  generated metadata/evidence for review and DevTools context, not as an SDK
  runtime option. Do not recreate the relationship with client-side joins,
  client-side filtering, or raw SQL.
- Treat visible filter scope as part of the app contract: top bar for
  dashboard-wide filters; place or label scoped filters by affected view.
- Do not make a visible input globally active by default. Pass an input handle
  only to queries listed in planner `appliesToViewIds`, queries on the same
  source-bearing field, or queries with an explicit modeled relationship path.
  If Semaphor cannot prove the relationship, remove that query from the input
  subscription and report the semantic-model gap instead of shipping a broken
  filter.
- For data-bearing dashboards, use the governed path before SQL: discover
  semantic domains/datasets/schema, validate with `semaphor_analyze` or
  `semaphor_matrix`, then productize with `semaphor.metric`,
  `semaphor.records`, `semaphor.analysis`, `semaphor.matrix`, and
  `semaphor.derivedField` where possible. Use `semaphor.sql` only after naming
  the specific governed capability gap or explicit user SQL request.
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
- Prefer `semaphor_analyze` for governed semantic BI checks,
  `semaphor_matrix` for pivot/matrix checks, and
  `semaphor_query_sql_advanced` only for SQL-first or unsupported analysis.
- Do not use SQL merely because it is faster for the agent to express joins,
  latest-snapshot logic, labels, ranked top-N, or grouped rollups. First try
  semantic metrics/records/analysis plus relationships and derived fields; then
  fall back to SQL only for the remaining unsupported pieces.
- Use `semaphor.derivedField(...)` for app-local calculations that should run
  through governed Semaphor execution. Do not make analytically meaningful
  derived metrics frontend-only when the shared SDK supports them.
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

- First-run auth, project selection, existing app vs starter app:
  [onboarding.md](references/onboarding.md)
- MCP tool selection, direct tool exposure, and fallback wrapper:
  [mcp-authoring.md](references/mcp-authoring.md)
- SDK imports, provider setup, public result types, query builders, row access:
  [sdk-contract.md](references/sdk-contract.md)
- App-local derived metrics, groups, and calculated fields:
  [derived-fields.md](references/derived-fields.md)
- Pivot, hierarchy, subtotal, and matrix table views:
  [matrix.md](references/matrix.md)
- Dashboard planning, existing-app planning, unsupported insights:
  [planning-workflow.md](references/planning-workflow.md)
- SQL-backed runtime views, SQL validation, bounded raw SQL:
  [sql.md](references/sql.md)
- Filters, controls, SQL params, shared/top-level filter subscriptions:
  [filters-and-inputs.md](references/filters-and-inputs.md)
- Data-app UX baseline, loading/error/empty states, tables, totals,
  pagination, large result sets, Semaphor table registry item, table libraries:
  [tables.md](references/tables.md)
- Required shadcn dashboard checklist, component choices, layout, charts,
  tables, states, and host design-system adaptation:
  [shadcn-dashboard.md](references/shadcn-dashboard.md)
- Save, draft, hosted publish, manifest identity, source snapshots, assets:
  [publish-lifecycle.md](references/publish-lifecycle.md)
- Local package validation and Semaphor validation:
  [validation.md](references/validation.md)

## Local App Integration

After Semaphor auth and project context are resolved, inspect the target repo:

1. Locate `package.json`.
2. Detect package manager from lockfiles.
3. Confirm React is installed.
4. Confirm whether `react-semaphor` is installed.
5. Detect likely framework from dependencies and files.
6. Locate sensible component, route, or page insertion points.

Keep source discovery narrow. Prefer `package.json`, lockfiles, `src/`, app
route/component folders, and existing docs. Avoid broad repo scans that dump
`node_modules`, build output, or generated artifacts into context. Do not
search `node_modules/react-semaphor` for SDK implementation details during
ordinary authoring; use this skill's public SDK references first.

`init:data-app` is optional scaffolding for clean starts, not a required
customer app shape.

When opening an existing Semaphor Data App, resolve the app identity, load the
mutable draft when available, compare the saved source snapshot with the local
workspace, and ask before writing saved files into the repo. Treat saved local
paths as hints only.

## Code Organization Defaults

Follow the target app's existing folder and naming conventions first. If the
app has a clear route/component/query organization, extend that convention
instead of imposing a new scaffold.

Before editing a broad generated app, write down the intended implementation
map in the visible plan: file layout, card/view components, query ids, filter
handles, each filter's subscribed views, and the root SDK DevTools wiring.
Treat this as part of the implementation contract. `App.tsx` should stay a
provider/page-shell/composition file, not a home for repeated `semaphor.*`
specs, many `useSemaphorQuery` calls, chart/table implementations, or
row-formatting helpers. Unless the host app has an equivalent convention, put
Semaphor sources, field refs, shared filters, input option specs, and query
specs under `src/semaphor/*`, and put repeated data-bearing views in separate
card/view components. Use `references/planning-workflow.md` for the default
file layout and filter-scope map before broad codegen.

For tiny one-view apps, a compact structure is fine, but keep query ownership
obvious for future edits.

## SDK Fast Path

Use the public SDK contract as the codegen source of truth:

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
  defineSemaphorDataApp,
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
```

Provider setup should be token-only for execution routing, with SDK DevTools
enabled in local development so the human and agent can inspect generated app
behavior. Vite example:

```tsx
const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;
const enableDevtools =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && window.location.hostname === "localhost");

<SemaphorDataAppProvider
  token={runtimeToken}
  debug={enableDevtools ? { exposeWindowBridge: true } : false}
>
  {children}
  <SemaphorDevtools
    initialIsOpen={false}
    buttonPosition="bottom-right"
    panelPosition="right"
  />
</SemaphorDataAppProvider>
```

This is the default generated-app wiring. Use the one-line root DevTools
integration, with right dock by default. Do not wrap every card in DevTools
boilerplate; stable query ids plus optional hook-level source hints are enough
for the global inspector.

When debugging in a local browser, inspect structured traces through:

```js
window.__SEMAPHOR_DEVTOOLS__?.snapshot()
```

The window bridge must stay development-only. Do not enable
`exposeWindowBridge` for production embeds, published tenant/end-user views, or
normal customer runtime code.

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or `apiBaseUrl` for
normal Vite React apps. Use `apiBaseUrl` only when the user explicitly needs
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
empty state, and include totals for displayed numeric columns. Semaphor data
tables are server-backed BI views. Do not fetch broad or complete table data
and then paginate, sort, filter, pivot, or group it only in React.

Infer server-backed table needs from the planned experience, not only literal
user wording. Operational tables, queues, drill-through/detail tables,
exploratory tables, paginated/sortable tables, and complete or large result
tables are server-side table candidates even if the user only says "show a
table." After presenting the plan, ask to install, use, or adapt the Semaphor
shadcn server table registry mechanics unless the target app already has an
equivalent server-backed table abstraction. Do not downgrade to a client-only
table because the registry requires an install step.

Do not add user-facing implementation badges such as "Governed SDK queries",
"Token configured", "MCP connected", "SQL fallback", or domain/debug chips
unless the user explicitly asks for a developer/debug view. Show business
labels, filter state, data freshness, query errors, and unsupported modeling
gaps when they help the user understand the app.

For full UX and table guidance, read [tables.md](references/tables.md). For
filter composition, read [filters-and-inputs.md](references/filters-and-inputs.md).

## Design Baseline

Generated dashboards must follow the shadcn dashboard practices in
[shadcn-dashboard.md](references/shadcn-dashboard.md). Use the host app's
components and theme tokens first, then compose analytical UI with clear
hierarchy, restrained cards, useful loading/error/empty states, readable
charts, sortable tables, numeric alignment, and responsive layouts.

When the host uses shadcn, prefer its installed components instead of building
custom markup. Override class names only when a primitive's default treatment
hurts analytical usability, such as oversized card radius, heavy shadows, weak
numeric alignment, missing states, or decorative icons competing with metrics.
When the host uses another design system, preserve that system while applying
the same dashboard usability rules.

Before generating dashboard UI, check whether the host app has a `samples/`,
`src/samples/`, or `examples/` directory containing a reference dashboard
(the Semaphor starter ships one at `src/samples/` routed under `/samples`).
If one exists, read its layout, component composition, filter-chip placement
on affected cards, sortable-table affordances, totals-row pattern,
loading/error/empty handling, and density choices, and match them in the
generated app. Reference samples use static fixtures for self-contained
viewing; the data-loading pattern there must not be copied — production code
uses `useSemaphorQuery` per [sdk-contract.md](references/sdk-contract.md).

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
