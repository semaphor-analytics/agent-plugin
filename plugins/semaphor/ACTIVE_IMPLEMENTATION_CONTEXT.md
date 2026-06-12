# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. It should be read with `AGENTS.md` before reviewing plugin
changes that touch Data App planning, contract generation, validation, or MCP
bridge behavior.

## Current Hardening Slice

The active cross-repo hardening work is Slice 5: Typed Data App Codegen
Summary from the Semaphor App hardening tracker at
`docs/implementation-plans/data-apps/analytics-spine-public-launch-hardening.md`.

Relevant repos and ownership:

- `react-semaphor` owns the shared
  `react-semaphor/analytics-protocol` Data App `codegenSummary` TypeScript
  contract and validator.
- `semaphor-app` owns MCP planning tools and the canonical hardening tracker.
- This plugin package mirrors the shared codegen summary validation in local
  generator/validator scripts and must not invent a plugin-only codegen
  contract.

## Slice 5 Review Contract

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
- Semantic codegen sources still require `datasetName` under the current
  shared `SemaphorSourceRef` contract. `datasetId` strengthens identity when
  present, but `datasetId` alone is not a valid semantic source in this slice.
  `connectionId` is execution metadata, not semantic identity.

## Reviewer Guidance

Raise findings for:

- accepting or silently migrating old generated manifests without the current
  validator version;
- plugin-only validation rules that contradict the shared
  `react-semaphor/analytics-protocol` codegen summary validator;
- generator code reconstructing source refs, field refs, option queries, or
  filter bindings from prose instead of the typed summary;
- required option-query fields that are not consumed by generated
  `semaphor.inputOptions(...)` or the filter binding contract.

Do not raise findings asking for compatibility with pre-v2 generated manifests
unless the shared hardening plan is explicitly reopened.
