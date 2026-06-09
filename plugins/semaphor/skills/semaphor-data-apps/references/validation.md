# Validation

Use validation to prove the app can run and that Semaphor can understand the
analytics contract. Do not treat plugin-local source scanning as proof of
analytics correctness.

## What To Run

Before reporting completion, run the strongest available checks:

- `semaphor_validate_data_app_contract` when the host exposes it;
- `node <plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>`;
- the target app's typecheck script, when present;
- the target app's build script, when present and reasonable;
- a browser smoke check for generated dashboards when practical.

The plugin-local validator is a deterministic preflight. It checks package
setup, public SDK availability, root provider/DevTools wiring, generated
contract completeness, generated contract hygiene, and optional local
typecheck/build. It intentionally does not infer analytics semantics from
React source text.

When browser smoke captures a Semaphor DevTools bridge snapshot, pass it into
validation:

```bash
node <plugin>/scripts/validate-semaphor-data-app.mjs \
  --dir <app> \
  --devtools-snapshot out/devtools-snapshot.json
```

After changing visible filters, pass a filter-effect report too:

```bash
node <plugin>/scripts/validate-semaphor-data-app.mjs \
  --dir <app> \
  --filter-effect-report out/filter-effect-report.json
```

The filter-effect report is browser-smoke evidence. It should include a
`checks` or `filterEffects` array with each generated `inputId` and either
`passed: true` or one of `changedQueryIds`, `reranQueryIds`,
`affectedViewIds`, or `changedViewIds` containing a subscribed generated query
id.

## What Semaphor Owns

Semaphor planner, generated contract, validation route, execution route, and
DevTools/runtime traces own analytics correctness:

- source and field validity;
- metric, records, analysis, matrix, and SQL query validity;
- label field versus option value field versus runtime filter field;
- relationship-aware filter proof;
- which inputs apply to which views;
- grouped/aggregate query shape for categorical charts;
- unsupported analytics gaps and required semantic-model improvements.

If those checks fail, fix the planner output, generated contract, SDK/runtime,
or semantic model at the lowest reusable layer. Do not add plugin regex or
agent prompt rules to guess the correct analytics behavior.

## Browser Smoke

For generated dashboards, verify the behavior that static checks cannot prove:

- the built-in Semaphor DevTools bubble is visible and opens;
- DevTools shows content queries and input option traces;
- every visible filter has options or reports a clear unsupported/modeling gap;
- selecting each filter reruns at least one subscribed query with the active
  input visible in DevTools or trace output;
- affected cards show which active filters apply to them;
- no card hides Semaphor execution errors.

When the selected data happens to produce the same visible value, use the trace
as proof that the filter was applied.

## Completion Rules

Do not report completion when hard validation fails. Do not replace failed
Semaphor analytics with static fixtures, placeholder dashboards, client-side
joins, or hand-written query specs that bypass the accepted generated contract.

If validation cannot run, say exactly why and which proof is missing.
