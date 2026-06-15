# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. Read it with `AGENTS.md` before reviewing plugin changes that
touch Data App contract generation, validation, or MCP bridge behavior.

## Current Work

Active cross-repo plan:

- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_SDK_CODEGEN_OWNERSHIP_PLAN.md`

Current phase:

- Phase 2: move generated Data App contract rendering ownership to
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

## Phase 2 Scope

In scope:

- keep `scripts/generate-data-app-contract.mjs` as the stable CLI/MCP wrapper
  path;
- resolve `react-semaphor/data-app-codegen` from the target workspace before
  generation;
- call shared `generateSemaphorDataAppContract(summary, options)`;
- keep path safety, workspace/output directory resolution, JSON formatting,
  package-version attribution, and file writes plugin-owned;
- preserve generated file names, output location, manifest path, script names,
  MCP tool names, and structured issue output;
- keep wrapper fixtures proving the shared generator can be invoked and files
  are written.

Out of scope:

- moving generated view live validation;
- moving update policy;
- changing generated file names, generated output directory, or generated app
  runtime imports;
- changing `semaphor-app` planning or execution behavior.

## Review Guardrails

Reviewers must evaluate this slice against Phase 2 only.

Raise findings for:

- `generate-data-app-contract.mjs` resolving
  `react-semaphor/data-app-codegen` at module load;
- plugin wrapper logic that reintroduces generated contract assembly, query
  factory rendering, accessor rendering, source identity helpers, table totals
  semantics, or generated metadata rendering;
- generation paths that do not use the target workspace's installed or linked
  `react-semaphor/data-app-codegen`;
- generated file writes that escape the requested workspace/output directory;
- plugin generation failures that lose structured JSON issue output.

Do not raise findings asking Phase 2 to move update policy, live validation, or
app-side planning. Those are later phases in the cross-repo plan.

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

The plugin generator depends on the built shared `react-semaphor` subpath during
local monorepo tests. If `react-semaphor/src/data-app-codegen/**` changed, build
`react-semaphor` once before running plugin wrapper tests so
`react-semaphor/dist/data-app-codegen/index.js` is current.

Also verify the packaged-startup shape when validation resolver behavior
changes:

```bash
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/scripts"
cp plugins/semaphor/scripts/data-app-codegen-summary-validation.mjs "$tmpdir/scripts/"
node -e "import('$tmpdir/scripts/data-app-codegen-summary-validation.mjs').then(() => console.log('wrapper import ok'))"
```
