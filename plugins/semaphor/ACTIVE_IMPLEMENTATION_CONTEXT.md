# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. It should be read with `AGENTS.md` before reviewing plugin
changes that touch Data App planning, contract generation, validation, or MCP
bridge behavior.

## Current Hardening Slice

The active cross-repo hardening work is Slice 8: Structured Agent Plugin
Validation from the Semaphor App hardening tracker at
`docs/implementation-plans/data-apps/analytics-spine-public-launch-hardening.md`.

Relevant repos and ownership:

- `react-semaphor` owns the shared
  `react-semaphor/analytics-protocol` Data App `codegenSummary` TypeScript
  contract and validator.
- `semaphor-app` owns MCP planning tools and the canonical hardening tracker.
- This plugin package mirrors the shared codegen summary validation in local
  generator/validator scripts and must not invent a plugin-only codegen
  contract.
- This plugin package owns the local app preflight transport contract for agent
  hosts. `validate-semaphor-data-app.mjs --json` and
  `semaphor_validate_data_app_contract` must return machine-repairable
  `{ ok, issues, advisories }` objects with stable issue codes.

## Slice 8 Review Contract

- `validate-semaphor-data-app.mjs --json` is the machine contract for local
  Data App preflight. Human stdout is secondary and must not be the only way to
  detect or classify validation failures.
- `semaphor_validate_data_app_contract` must parse the validator JSON and
  return the parsed `issues` and `advisories` in MCP `structuredContent`.
- Structured issues must include stable `code`, `severity`, `message`, and,
  when useful, `filePath`, `path`, `repairHint`, or diagnostic `details`.
- Required issue codes include `missing_provider`, `missing_devtools_bridge`,
  `missing_generated_contract`, `generated_contract_not_imported`,
  `invalid_contract_manifest`, `missing_option_traces`,
  `filter_effect_failed`, `typecheck_failed`, and `build_failed`.
- All validation failures that can occur before, during, or after generated
  contract inspection must preserve structured JSON in `--json` mode. Do not
  allow early exits, JSON parse failures, manifest reads, DevTools validation,
  static filter-effect reports, live filter-effect checks, typecheck, or build
  failures to fall back to plain stderr as the only contract. Manifest parse
  failures must surface as `invalid_contract_manifest`. Static and live
  filter-effect failures must surface as `filter_effect_failed` with useful
  `path`, `repairHint`, or redacted `details` when available.
- Any bridge or fixture that invokes the validator or generator in JSON mode
  must set an explicit child-process output budget large enough for structured
  diagnostics. Tests that claim to cover build/typecheck JSON behavior must run
  the validator with builds enabled rather than implicitly passing `--no-run`.
- The validator may preserve human-readable terminal output, but agents and
  evals should key off structured issue codes.

## Slice 5 Codegen Summary Contract Still Applies

- Data App `codegenSummary` is a typed shared public contract. Plugin scripts
  should validate the accepted planner artifact before writing generated files
  and before iterative updates.
- `contract.manifest.json` persists `codegenSummary`,
  `codegenSummaryHash`, and `codegenSummaryValidatorVersion`.
- `semaphor_update_data_app_contract` intentionally rejects generated
  manifests that lack the current `codegenSummaryValidatorVersion`. Do not add
  an upgrade shim for pre-v2 generated manifests; Data Apps and the Analytics
  Spine are still development surfaces. Regenerate old contracts with
  `semaphor_generate_data_app_contract`.
- A codegen `optionQuery` must include `builder: "semaphor.inputOptions"` plus
  `source` or `sourceKey`, `valueFieldRef`, and `labelFieldRef`.
  `filterFieldRef` is optional because generated
  `semaphor.inputOptions(...)` uses source/value/label. Active filter
  application is modeled by `input.fieldRef`, `filterContracts[].fieldRef`,
  and per-view bindings.
- Executable views must carry a matching `queryKind`, `sdkBuilder`, and
  discriminated `sdkSpec`. Derived, presentation-only, and unsupported views
  are non-executable and must not carry executable-only fields such as
  `queryKind`, `sdkBuilder`, or `sdkSpec`.
- All source-bearing SDK refs, including optional metric/records dimensions,
  date fields, order fields, matrix axes/values/sort refs, SQL fields, and
  option-query refs, must include `source` or `sourceKey`. SDK sort directions
  are hard-limited to `asc` or `desc`.
- `codegenSummary.views[].sdkSpec.spec` is the exact object emitted into the
  generated `semaphor.*(...)` SDK builder call. It is not a broad analytics
  protocol intent. Plugin validation intentionally rejects unsupported builder
  keys, runtime-only `inputs`, analysis-only metric intent fields such as
  `timeWindow` or `analysis` on `semaphor.metric(...)`, non-canonical matrix
  sort shorthands, SQL sources for matrix specs, and filters whose `field`
  lacks `source` or `sourceKey`. `semaphor.metric(...)` supports `filters`;
  generated/plugin summaries must preserve source-bearing metric filters so the
  SDK can pass them to `SemaphorMetricIntent.filters`.
- Semantic codegen sources still require `datasetName` under the current
  shared `SemaphorSourceRef` contract. `datasetId` strengthens identity when
  present, but `datasetId` alone is not a valid semantic source in this slice.
  `connectionId` is execution metadata, not semantic identity.

## Reviewer Guidance

Raise findings for:

- validator or MCP bridge changes that require agents to parse stdout/stderr
  instead of structured issue codes;
- missing stable issue codes for provider, DevTools, generated-contract,
  manifest, option-trace, filter-effect, typecheck, or build failures;
- accepting or silently migrating old generated manifests without the current
  validator version;
- plugin-only validation rules that contradict the shared
  `react-semaphor/analytics-protocol` codegen summary validator;
- generator code reconstructing source refs, field refs, option queries, or
  filter bindings from prose instead of the typed summary;
- required option-query fields that are not consumed by generated
  `semaphor.inputOptions(...)` or the filter binding contract.
- non-executable views accepting executable fields, executable specs accepting
  mismatched query kind/builder pairs, or SDK refs accepting missing
  `source`/`sourceKey`.

Do not raise findings asking for compatibility with pre-v2 generated manifests
unless the shared hardening plan is explicitly reopened.
