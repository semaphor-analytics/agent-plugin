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
- shared filter handles are created with `useSemaphorInputs(...)` in a shared
  parent and passed to every query that should respond;
- query-specific field differences use `semaphor.bindInput(...)`;
- remote option lists use `semaphor.inputOptions(...)` plus
  `useSemaphorQuery(...)`;
- scalar KPI cards and planner `queryKind: "metric"` views use
  `semaphor.metric(...)` unless the visual is row-shaped or the SDK cannot
  express it;
- `semaphor.records(...)` is reserved for app content rows, charts, tables,
  trends, breakdowns, grouped KPI support, or details, not hidden dropdown
  option derivation or scalar KPI shortcuts;
- Semaphor DevTools shows content queries under Cards/Data traces and option
  queries under Inputs;
- unsupported SDK cases are explicitly reported with the workaround used.

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
