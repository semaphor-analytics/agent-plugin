# Validation

Before reporting completion, run the strongest available checks:

- `node <plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>`;
- package typecheck script, if present;
- package build script, if present and reasonable;
- Semaphor MCP query checks for data-bearing analytics when credentials are
  available.

Before reporting completion, inspect the generated structure and fix SDK-shape
issues that would make Semaphor DevTools or reviewer agents misread the app:

- visible filters and controls are defined with `semaphor.filter(...)`,
  `semaphor.control(...)`, or `semaphor.sqlParam(...)`;
- every `semaphor.metric`, `semaphor.records`, `semaphor.analysis`,
  `semaphor.matrix`, `semaphor.sql`, and `semaphor.inputOptions` query spec
  has a stable explicit `id`;
- one root `<SemaphorDevtools />` is mounted for local/dev authoring and
  `SemaphorDataAppProvider` exposes the window bridge only behind a local/dev
  gate;
- shared filter handles are created with `useSemaphorInputs(...)` in a shared
  parent and passed to every query that should respond;
- every visible filter has an explicit affected-view list in the plan or code
  review notes, and the UI placement/label matches that scope. Do not report
  completion when a top-level filter affects only a hidden subset of cards
  without saying so in the UI or final response;
- cards with active subscribed filters show a compact applied-filter
  affordance, such as chips/badges or muted text, so users can tell which
  filters affected each card's query;
- changing each visible filter would change at least one visible data-bearing
  query. Remove filters that are not passed to any visible query, or report why
  they are planned but currently unsupported;
- query-specific field differences use `semaphor.bindInput(...)`;
- remote option lists use `semaphor.inputOptions(...)` plus
  `useSemaphorQuery(...)`;
- scalar KPI cards and planner `queryKind: "metric"` views use
  `semaphor.metric(...)` unless the visual is row-shaped or the SDK cannot
  express it;
- generated components preserve the accepted plan's visual types. A planned
  KPI strip should not silently become a table, a planned trend should not
  silently become a scalar card, a planned stacked bar should not silently
  become a single-series bar, and a planned table should not silently become a
  short client-only list;
- `semaphor.records(...)` is reserved for app content rows, charts, tables,
  trends, breakdowns, grouped KPI support, or details, not hidden dropdown
  option derivation or scalar KPI shortcuts;
- bar, stacked bar, pie/donut, and categorical comparison charts are backed by
  grouped or aggregate-shaped Semaphor queries rather than bounded raw-row
  detail results;
- Semaphor DevTools shows content queries under Cards/Data traces and option
  queries under Inputs;
- unsupported SDK cases are explicitly reported with the workaround used.

For every visible filter, inspect the generated `useSemaphorQuery(..., {
inputs: [...] })` calls and verify that subscribed queries use same-source
fields or modeled relationship-aware `semaphor.bindInput(...)` bindings. A
filter with populated options but no meaningful subscribed query is not a
working filter.

For filter-effect QA, select at least one non-default option and confirm a
subscribed query re-runs with the input applied in DevTools or trace output.
When the data should differ, compare the visible metric/chart/table before and
after the selection. If values happen to be equivalent for the chosen option,
report that the trace proves application of the filter.

Do not call the implementation done if a records query exists only to populate
a select, combobox, multi-select, or filter menu and the same behavior can be
expressed with `semaphor.inputOptions(...)`.

Treat the build as the authoritative app check when typecheck/build disagree.
Some repos have a loose root `tsc --noEmit` that under-checks app sources, so a
green typecheck plus a failing build means the build is right. Do not report
completion on a passing typecheck alone.

The validator is a compatibility smoke check by default. Treat its Semaphor
advisories as guidance, not customer-facing blockers. Use `--strict` only for
explicit quality gates.

Do not reimplement source/field validation in plugin prompts or scripts once
the Semaphor validation route is available. Plugin-local scans are package and
build preflight; Semaphor owns catalog-aware SDK hook validation.

`POST /api/v1/data-app/validate` and `/api/v1/data-app/execute` support
`semaphor.analysis(...)` query specs executed through `useSemaphorQuery` and
the same governed analytics query-spec service used by MCP
`semaphor_analyze`. Treat failures there as shared analytics/SDK/app execution
issues, not as host-specific prompt issues.

If validation cannot run, say exactly why.
