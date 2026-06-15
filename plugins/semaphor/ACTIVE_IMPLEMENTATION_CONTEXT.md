# Active Implementation Context

This file captures temporary implementation/review context for the Semaphor
Agent Plugin. Read it with `AGENTS.md` before reviewing plugin changes that
touch Data App contract generation, validation, or MCP bridge behavior.

## Current Work

Active cross-repo plan:

- `semaphor-app/docs/system-architecture/data-apps/DATA_APP_SDK_CODEGEN_OWNERSHIP_PLAN.md`

Current phase:

- MCP fallback schema ownership cleanup. Rich Semaphor MCP schemas must come
  from live `semaphor-app` MCP `tools/list`. The plugin fallback may expose
  only operational auth/access-context guidance plus plugin-owned local
  workflow tools. In no-token project-token sessions, fallback `tools/list`
  intentionally does not advertise server-owned discovery/planning tools;
  agents must resolve auth first by passing `workspaceDir` to
  `semaphor_get_access_context`, using hosted OAuth, or adding a project token.

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

- remove server-owned semantic/data/planning MCP tools from fallback
  `tools/list` in `scripts/semaphor-mcp-remote.mjs`;
- delete plugin fallback schemas for relationship candidates, semantic repair
  diagnostics, and semantic model patches;
- keep authenticated live `tools/list` pass-through behavior unchanged;
- keep plugin-owned local workflow tools:
  - `semaphor_create_data_app_contract`;
  - `semaphor_generate_data_app_contract`;
  - `semaphor_update_data_app_contract`;
  - `semaphor_validate_data_app_contract`;
- add package-validation guardrails that fail if rich Semaphor MCP fallback
  schemas reappear.

Out of scope:

- changing `react-semaphor` SDK/codegen behavior;
- changing server-owned MCP schemas in `semaphor-app`;
- changing generated file names, generated output directory, generated app
  runtime imports, or generated dashboard UI;
- changing `semaphor-app` planning or execution behavior.

## Review Guardrails

Reviewers must evaluate this slice against MCP fallback schema ownership only.

Raise findings for:

- plugin fallback `tools/list` advertising server-owned semantic/data/planning
  tools such as `semaphor_propose_semantic_model_change`,
  `semaphor_plan_data_app`, `semaphor_list_datasets`, or
  `semaphor_get_dataset_schema`;
- plugin bridge code containing fallback schemas for semantic relationship
  candidates, semantic repair diagnostics, or semantic model patches;
- authenticated live `tools/list` no longer passing server tools through;
- missing local plugin workflow tools for generate/update/validate contract
  workflows.

Do not raise findings asking this slice to change app-side planning, governed
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
`react-semaphor/dist/data-app-codegen-node/index.js` is current. This slice does
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
