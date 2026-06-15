# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. Read it with `AGENTS.md` before reviewing plugin changes that
touch Data App contract generation, validation, or MCP bridge behavior.

## Current Work

Active cross-repo plan:

- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_SDK_CODEGEN_OWNERSHIP_PLAN.md`

Current phase:

- Phase 5: delete duplicate plugin-local SDK/codegen wrappers and add
  guardrails. Shared SDK/codegen validation, generation, generated-contract
  validation, generated-view/option/input request shaping, and deterministic
  update policy route through `react-semaphor/data-app-codegen` or
  `react-semaphor/data-app-codegen/node`. The plugin remains the
  filesystem/process/MCP wrapper.

## Ownership Rule

- `react-semaphor` owns SDK/codegen semantics: codegen summary validation,
  generation-readiness checks, source identity, SDK builder shapes, table totals
  semantics, records/matrix/metric/analysis spec validation, and generated
  accessor/query-factory behavior.
- `agent-plugin` owns host workflow: filesystem paths, workspace safety, MCP
  bridge transport, structured JSON output, child processes, auth/project token
  guidance, shared codegen package resolution, and generated file writes.
- `semaphor-app` owns planning, semantic grounding, governed execution, hosted
  lifecycle APIs, and MCP server tools.

The plugin must not become a second SDK validator, generator, generated-contract
validator, live request shaper, or deterministic update-policy implementation.

## Phase 5 Scope

In scope:

- delete the temporary wrapper files:
  - `scripts/data-app-codegen-summary-validation.mjs`;
  - `scripts/data-app-contract-update-policy.mjs`;
- keep one plugin-owned `scripts/shared-codegen-loader.mjs` that lazily resolves
  `react-semaphor/data-app-codegen/node` from the target workspace and delegates
  shared SDK/codegen functions;
- keep `scripts/generate-data-app-contract.mjs` as the stable filesystem and
  path-safety wrapper around shared generation;
- keep `scripts/validate-semaphor-data-app.mjs` as the plugin workflow
  validator that delegates SDK/codegen-shaped checks to shared code;
- keep `scripts/semaphor-mcp-remote.mjs` as the MCP bridge that delegates
  generated-contract validation and update policy to shared codegen;
- add package-validation guardrails that fail if deleted wrappers or duplicated
  SDK/codegen semantics reappear;
- preserve script names, MCP tool names, output directory, generated file names,
  and structured JSON issue transport.

Out of scope:

- changing `react-semaphor` SDK/codegen behavior;
- changing generated file names, generated output directory, generated app
  runtime imports, or generated dashboard UI;
- changing `semaphor-app` planning or execution behavior.

## Review Guardrails

Reviewers must evaluate this slice against Phase 5 only.

Raise findings for:

- any top-level import of `react-semaphor/data-app-codegen/node` before a
  workspace is known;
- deleted wrapper files being reintroduced;
- plugin scripts reintroducing SDK builder allow-lists, source identity
  comparison, table totals semantics, records/matrix/metric/analysis spec
  validation, generated contract assembly, query-factory rendering, accessor
  rendering, generated metadata rendering, or deterministic update-policy
  vocabularies;
- generation paths that do not use the target workspace's installed or linked
  `react-semaphor/data-app-codegen/node`;
- generated file writes that escape the requested workspace/output directory;
- wrapper failures that lose structured JSON issue output.

Do not raise findings asking Phase 5 to change app-side planning, governed
execution, semantic relationship repair, hosted runtime behavior, generated UI,
or SDK/codegen contract behavior. Those are not part of this cleanup slice.

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
subpaths during local monorepo tests. If `react-semaphor/src/data-app-codegen/**`
changed, build `react-semaphor` once before running plugin wrapper tests so
`react-semaphor/dist/data-app-codegen-node/index.js` is current. Phase 5 does
not normally require a `react-semaphor` build because it changes plugin wrapper
ownership only.

Also verify the packaged-startup shape when shared loader resolver behavior
changes. The deleted wrappers must not be needed for startup:

```bash
tmpdir=$(mktemp -d)
mkdir -p "$tmpdir/scripts"
cp plugins/semaphor/scripts/shared-codegen-loader.mjs "$tmpdir/scripts/"
node -e "import('$tmpdir/scripts/shared-codegen-loader.mjs').then(() => console.log('loader import ok'))"
```
