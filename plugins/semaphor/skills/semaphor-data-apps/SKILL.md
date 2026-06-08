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
4. Broad build: after project/domain confirmation, present a visible plan and
   stop for user approval before editing.
5. Existing app: inspect current source, use `semaphor_plan_data_app_change`,
   and preserve existing views by default.
6. Dependencies: ask before installing registry items, TanStack, chart
   libraries, or starter scaffolds unless already approved.
7. SQL: use governed metric, records, analysis, matrix, and derived-field paths
   before SQL unless the user explicitly asks for SQL.
8. Completion: run typecheck/build, Semaphor validation, and browser smoke when
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
analytics, generic integration points, or token-missing UI. The correct next
action is one of:

- Hosted OAuth: ask the user to run `codex mcp login semaphor`, then say
  "try again". If the host requires a fresh session before exposing refreshed
  OAuth tools, say that explicitly as a host limitation.
- Project-token mode: ask the user to add `VITE_SEMAPHOR_PROJECT_TOKEN` to the
  target React app's ignored `.env.local`, then retry with `workspaceDir` set
  to that app root.
- Local Semaphor development: ask the user to add both
  `VITE_SEMAPHOR_PROJECT_TOKEN` and `SEMAPHOR_SERVER_URL=http://localhost:3000`
  to the target app's ignored `.env.local`.

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

Broad app creation is selection-gated and approval-gated. A user saying
"build an app", "create a dashboard", or similar is permission to inspect
Semaphor access, projects, and domains; it is not permission to choose a
project/domain silently, call the planner, or edit files. Resolve the project,
then confirm the domain before `semaphor_plan_data_app`. After planner output,
present the visible plan and ask whether to build, revise, choose another
domain/source, inspect more data, or cancel.

If the user already supplied a precise app plan or says to proceed with a
specific previously presented plan, then edit. If the request is a narrow edit
such as "add this already specified chart", proceed after confirming the local
target and Semaphor source are unambiguous.

For broad new Data App requests, use `semaphor_plan_data_app` as the planning
source of truth before codegen. For substantial existing-app edits, use
`semaphor_plan_data_app_change` with the current app state before codegen.
Present the returned plan/change plan to the user, then generate React from
the returned `sources`, `inputs`, `views`, `operations`, `sdkSpec`, and
unsupported gaps. Do not replace this with an improvised prose plan or jump
straight to SQL unless the planner returns a justified SQL fallback or the
user explicitly requests SQL.

The visible planning response must include:

- the selected domain/source and any reasonable alternatives considered;
- planned views with visual type, query kind, source fields, and whether each
  view is server-backed, derived, presentation-only, unsupported, or SQL
  fallback. Use clear visual labels such as KPI strip, KPI card, line chart,
  bar chart, area chart, pie/donut chart, table, matrix, filter control, or
  detail panel so the user knows what will appear before codegen;
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
  `relationshipsUsed`, and `appliesToViewIds`. Use those bindings for
  server-side filters/cascading option lists; do not recreate the relationship
  with client-side joins, client-side filtering, or raw SQL.
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

Use this plugin's helper when useful:

```bash
node scripts/init-semaphor-data-app.mjs --dir <app>
```

`init:data-app` is optional scaffolding for clean starts. It is not a required
customer app shape.

When opening an existing Semaphor Data App, resolve the app identity, load the
mutable draft when available, compare the saved source snapshot with the local
workspace, and ask before writing saved files into the repo. Treat saved local
paths as hints only.

## Code Organization Defaults

Follow the target app's existing folder and naming conventions first. If the
app has a clear route/component/query organization, extend that convention
instead of imposing a new scaffold.

For generated apps with more than two data-bearing views, do not put all
queries, inputs, card rendering, formatting, and layout in one giant `App.tsx`
or one giant dashboard component. Unless the host app already has an equivalent
query/spec module convention, put Semaphor sources, field refs, shared filters,
input option specs, and query specs under `src/semaphor/*`; view/card
components should import those specs and own hook wiring, UI state, formatting,
and rendering. Use `references/planning-workflow.md` for the default file
layout before broad codegen.

For tiny one-view apps, a compact structure is fine, but keep Semaphor query
specs and row-access helpers readable enough that a future edit can identify
which query backs which visual.

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
  import.meta.env.DEV || window.location.hostname === "localhost";

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

This is the default generated-app wiring. `SemaphorDevtools` is the
TanStack-style one-line root integration. It opens as a right dock by default
so vertical analytics space remains available and the app stays visible beside
the inspector; use `panelPosition="bottom"` only when the user asks for a
bottom dock. Do not wrap every card in DevTools
boilerplate. Stable query ids and labels are enough for the global inspector.
For broad generated dashboards, use the TanStack-style root DevTools
integration only. If source traceability needs help, pass hook-level debug
metadata/source hints to `useSemaphorQuery` instead of adding per-card DevTools
wrapper boilerplate.

When debugging in a local browser, inspect structured traces through:

```js
window.__SEMAPHOR_DEVTOOLS__?.snapshot()
```

The window bridge must stay development-only. Do not enable
`exposeWindowBridge` for production embeds, published tenant/end-user views, or
normal customer runtime code.

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or `apiBaseUrl` for
normal customer apps. For Next.js, Remix, React Router, or custom shells,
follow the app's existing runtime configuration convention instead of forcing
Vite env names. Use `apiBaseUrl` only when the user explicitly needs self-hosted
or local routing that intentionally differs from the token's `apiServiceUrl`.

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

Before saying an implementation is done, also inspect the generated app
structure against the SDK contract:

- every visible filter/control is backed by `semaphor.filter(...)`,
  `semaphor.control(...)`, or `semaphor.sqlParam(...)`;
- shared filters are bound once with `useSemaphorInputs(...)` and passed into
  each subscribed `useSemaphorQuery(...)` call;
- source-specific subscriptions use `semaphor.bindInput(...)` instead of
  duplicate visible controls;
- remote dropdown/search choices use `semaphor.inputOptions(...)` and appear as
  input traces in Semaphor DevTools;
- app content queries use `semaphor.metric`, `semaphor.records`,
  `semaphor.analysis`, `semaphor.matrix`, or documented SQL fallbacks and
  appear as card/data traces in Semaphor DevTools;
- planner metric views and scalar KPI cards use `semaphor.metric(...)` unless
  the visual is row-shaped or the SDK cannot express it; multiple scalar KPIs
  in one card can use one `semaphor.metric(...)` query with multiple measures;
- metric result rendering reads scalar KPIs from `result.value` and
  `result.measures`; do not switch a scalar KPI to `semaphor.records(...)`
  merely because the runtime also exposes aggregate rows;
- no `semaphor.records(...)` query is used only to derive filter option lists
  in React unless an explicit SDK gap is reported to the user;
- every input handle is passed only to same-source queries, planner-listed
  `appliesToViewIds`, or queries with an explicit `relationshipHint`; no query
  is left with a runtime "could not prove a modeled relationship" failure;
- any unsupported analytics or SDK fallback is named plainly, including the
  user-visible behavior and the workaround used.

For lifecycle details, read [publish-lifecycle.md](references/publish-lifecycle.md).
For validation details, read [validation.md](references/validation.md).
