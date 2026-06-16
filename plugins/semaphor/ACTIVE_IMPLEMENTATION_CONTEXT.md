# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. Read it with `AGENTS.md` before reviewing plugin changes that
touch Data App contract generation, validation, or MCP bridge behavior.

## Current Work

Active cross-repo plan:

- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_SDK_CODEGEN_OWNERSHIP_PLAN.md`

Current phase:

- Data App generator fixture ownership cleanup. Deep SDK/codegen behavior
  tests live in `react-semaphor`; the Agent Plugin generator suite now covers
  plugin-owned wrapper behavior only: shared module resolution, path safety,
  file writes, structured JSON output, validation CLI workflow, live validation
  transport failures, and package distribution guardrails.

## Ownership Rule

- `react-semaphor` owns SDK/codegen semantics: codegen summary validation,
  generation-readiness checks, source identity, SDK builder shapes, table totals
  semantics, records/matrix/metric/analysis spec validation, and generated
  accessor/query-factory behavior.
- `agent-plugin` owns host workflow: filesystem paths, workspace safety, MCP
  bridge transport, structured JSON output, child processes, auth/project token
  guidance, shared codegen package resolution, and generated file writes.
- `semaphor-app` owns planning, semantic grounding, governed execution, hosted
  lifecycle APIs, and MCP server tool schemas/handlers.

The plugin must not become a second SDK validator, generator, generated-contract
validator, live request shaper, or deterministic update-policy implementation.

## Current Slice Scope

In scope:

- remove duplicated SDK/codegen behavior fixtures from
  `scripts/test-generate-data-app-contract.mjs` when equivalent owner-layer
  coverage exists in `react-semaphor`;
- keep plugin wrapper fixtures for shared codegen loader resolution,
  generated-file path safety, deterministic file writing, structured
  generator/validator JSON, malformed manifest handling, filter-effect report
  validation, live validation token/fetch failures, and verbose build output;
- preserve public plugin script names, MCP tool names, JSON issue transport,
  and generated output paths.

Out of scope:

- changing `react-semaphor` SDK/codegen behavior;
- changing server-owned MCP schemas in `semaphor-app`;
- changing generated file names, generated output directory, generated app
  runtime imports, generated contract contents, or generated dashboard UI;
- changing `semaphor-app` planning or execution behavior.

## Review Guardrails

Reviewers must evaluate this slice against Data App generator fixture ownership
only.

Raise findings for:

- plugin generator/validator tests no longer covering plugin-owned wrapper
  concerns such as path safety, shared codegen resolution, structured JSON
  output, validation CLI failures, or live validation transport errors;
- reintroduced plugin-side SDK builder allow-lists, source identity matching,
  table totals semantics, generated query/accessor behavior, or update-policy
  vocabularies;
- removal of public plugin workflow compatibility: script names, MCP tool names,
  generated output paths, or stable structured issue transport.

Do not raise findings asking this slice to change app-side planning, governed
execution, semantic relationship repair, hosted runtime behavior, generated UI,
or SDK/codegen contract behavior. Those belong in `react-semaphor` or
`semaphor-app`, not in this fixture cleanup.

## Hard Migration Policy

Data App SDK/codegen contracts are still under development. Do not request
legacy or backward compatibility shims for old generated Data App shapes.
Workflow compatibility is still required: script names, MCP tool names,
generated output locations, and structured issue codes remain stable unless the
cross-repo plan explicitly changes them.

## Required Checks

For this phase, run:

```bash
cd <agent-plugin-repo>
npm --prefix plugins/semaphor run test:generator
npm --prefix plugins/semaphor run validate:plugin
git diff --check
```

The plugin wrapper tests depend on the built shared `react-semaphor` codegen
subpaths during local monorepo tests. This slice should not change
`react-semaphor`; if it does, run the focused `react-semaphor` codegen tests and
refresh package build output only when the local dist is stale.

Also verify the packaged-startup shape when shared loader resolver behavior
changes. The deleted wrappers must not be needed for startup:

```bash
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/scripts"
cp plugins/semaphor/scripts/shared-codegen-loader.mjs "$tmpdir/scripts/"
node -e "import('$tmpdir/scripts/shared-codegen-loader.mjs').then(() => console.log('loader import ok'))"
```
