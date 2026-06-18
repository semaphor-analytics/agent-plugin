# Validation

Use validation to prove the generated contract is intact, the target app builds,
and the rendered experience actually applies Semaphor inputs. Do not treat
plugin-local source scanning as proof of analytics correctness.

## What To Run

Before reporting completion, run the strongest available checks:

- `semaphor_validate_data_app_contract` with the full
  `generatedContractPayload` returned by `semaphor_generate_data_app_contract`
  immediately after generation;
- for final validation after files are written, call
  `semaphor_validate_data_app_contract` with both `manifest` from
  `src/semaphor/generated/contract.manifest.json` and `generatedFiles` read
  from every generated TypeScript file in `src/semaphor/generated`;
- the target app's typecheck script, when present;
- the target app's build script, when present and reasonable;
- a browser smoke check for generated dashboards when practical.

`semaphor_validate_data_app_contract` is the MCP contract validator. It requires
generated file contents, not only `contract.manifest.json`, so Semaphor can
compare the manifest hash against the generated TypeScript files and catch
hand-edited or stale generated output. It does not run local npm scripts,
inspect arbitrary React source, or prove browser interactions.

## What Semaphor Owns

Semaphor planner, generated contract, validation tool, execution route, and
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
