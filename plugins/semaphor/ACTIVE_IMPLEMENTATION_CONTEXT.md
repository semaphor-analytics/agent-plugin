# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. Read it with `AGENTS.md` before reviewing plugin changes that
touch Data App contract generation, validation, or MCP bridge behavior.

## Current Work

Active cross-repo plan:

- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_SDK_CODEGEN_OWNERSHIP_PLAN.md`

Current phase:

- Phase 1: move Data App codegen summary validation ownership to
  `react-semaphor/data-app-codegen`.

## Ownership Rule

- `react-semaphor` owns SDK/codegen semantics: codegen summary validation,
  generation-readiness checks, source identity, SDK builder shapes, table totals
  semantics, records/matrix/metric/analysis spec validation, and generated
  accessor/query-factory behavior.
- `agent-plugin` owns host workflow: filesystem paths, workspace safety, MCP
  bridge transport, structured JSON output, child processes, auth/project token
  guidance, and generated file writes until later phases move rendering.
- `semaphor-app` owns planning, semantic grounding, governed execution, hosted
  lifecycle APIs, and MCP server tools.

The plugin must not become a second SDK validator.

## Phase 1 Scope

In scope:

- keep `scripts/data-app-codegen-summary-validation.mjs` as a compatibility
  wrapper with the existing exported names:
  - `CODEGEN_SUMMARY_SCHEMA_VERSION`
  - `CODEGEN_SUMMARY_VALIDATOR_VERSION`
  - `validateCodegenSummary`
  - `assertValidCodegenSummary`
- delegate validation to `react-semaphor/data-app-codegen`;
- resolve the shared codegen module lazily, only when validation is invoked;
- pass `workspaceDir` into validation call sites when known so validation uses
  the target app's installed or linked `react-semaphor`;
- keep MCP startup and `tools/list` safe when a packaged plugin install does
  not itself bundle or declare `react-semaphor`;
- keep local monorepo self-tests working through the sibling
  `react-semaphor/dist/data-app-codegen/index.js` build artifact;
- preserve structured issue output and stable plugin script/MCP tool names.

Out of scope:

- moving generated contract rendering out of `generate-data-app-contract.mjs`;
- moving query factory/accessor rendering;
- moving generated view live validation;
- moving update policy;
- changing generated file names, generated output directory, or generated app
  runtime imports;
- changing `semaphor-app` planning or execution behavior.

## Review Guardrails

Reviewers must evaluate this slice against Phase 1 only.

Raise findings for:

- `data-app-codegen-summary-validation.mjs` resolving
  `react-semaphor/data-app-codegen` at module load;
- packaged plugin startup failing before MCP tools are exposed because
  `react-semaphor` is not installed in the plugin package;
- plugin wrapper logic that reintroduces SDK builder allow-lists, executable SDK
  spec validation, source identity comparison, table totals semantics, or
  relationship repair validation;
- validation call sites that have a known `workspaceDir` but do not pass it into
  the wrapper;
- plugin validation failures that lose structured `{ ok, issues, advisories }`
  output.

Do not raise findings asking Phase 1 to move generator rendering, update
policy, live validation, or app-side planning. Those are later phases in the
cross-repo plan.

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

Also verify the packaged-startup shape:

```bash
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/scripts"
cp plugins/semaphor/scripts/data-app-codegen-summary-validation.mjs "$tmpdir/scripts/"
node -e "import('$tmpdir/scripts/data-app-codegen-summary-validation.mjs').then(() => console.log('wrapper import ok'))"
```
