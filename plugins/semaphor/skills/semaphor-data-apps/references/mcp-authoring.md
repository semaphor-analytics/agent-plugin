# MCP Authoring

Semaphor MCP is the authoring and exploration plane. Use it to inspect the
customer's governed Semaphor project before generating data-bearing React code.

## Primary Path

The agent host should expose Semaphor MCP servers as first-class callable
tools. Use those tools directly. Do not inspect plugin implementation files,
start the MCP bridge manually, or write JSON-RPC glue.

When available, call `semaphor_get_data_app_sdk_guidance` for current Data App
SDK authoring guidance before reading bundled fallback SDK prose. The bundled
plugin SDK reference is offline fallback only.

For Semaphor build, plan, answer, save, and publish workflows, the first
observable step should be MCP auth/project preflight. Call
`semaphor_get_access_context` before inspecting the React workspace, package
files, SDK declarations, helper scripts, or generated app source. Resolve the
project before codegen so every later discovery, plan, and runtime token is
scoped to the correct governed project.

There are two authentication/server modes:

- `semaphor`: hosted OAuth MCP. Use this for first-run login and project
  discovery when no project token is configured.
- `semaphor-project`: project-token MCP bridge. Use this when the target app
  already has `VITE_SEMAPHOR_PROJECT_TOKEN` or `SEMAPHOR_PROJECT_TOKEN`, when
  working against local/self-hosted Semaphor, or when save/publish validation
  needs the project-token scope.

Both modes must expose the same logical Data App authoring surface after auth.
OAuth can additionally list/select projects; project-token mode is already
scoped to one project. Data App contract tools are server-owned Semaphor MCP
tools, not plugin-local generators:
`semaphor_create_data_app_contract`,
`semaphor_generate_data_app_contract`,
`semaphor_update_data_app_contract`,
`semaphor_materialize_data_app_contract`, and
`semaphor_validate_data_app_contract`. If planning tools are visible but these
contract tools are missing, stop before source edits and report server/plugin
MCP surface drift. Do not manually transcribe planner output into
`src/semaphor/*`.

Do not confuse auth mode with local filesystem capability. The remote Semaphor
MCP server does not write local files for OAuth or project-token calls. The
installed bridge is the only local filesystem actor, and only for explicit
bridge-local flows such as materializing a generated-contract artifact into
`src/semaphor/generated` or reading generated files for validation.

Start with one of:

- `semaphor_get_access_context` for auth, scope, and project-token context.
- `semaphor_get_analysis_context` for project scope, recommended path,
  semantic-domain count, fallback connection count, and next discovery tool.

When using `semaphor-project` in Codex or another host that launches plugin MCP
servers from the plugin install directory, prefer launching the agent from the
React app root when the project token lives in that app's `.env.local`. If the
first auth check reports that no project token was found, retry
`semaphor_get_access_context` with `workspaceDir` set to the React app root. In
multi-root Codex sessions, do not let the agent infer a project token from
another open root; either use OAuth or pass `workspaceDir` only to bridge-local
tools that advertise it. The Semaphor bridge uses `workspaceDir` to read local
env files for auth/context calls. Do not pass `workspaceDir` to
`semaphor_create_data_app_contract`, `semaphor_generate_data_app_contract`, or
`semaphor_update_data_app_contract`. For local generated contract writes, call
`semaphor_materialize_data_app_contract` with
the server-returned `generatedContractArtifactId`,
`generatedContractMaterializationToken`, and `workspaceDir`; the
bridge materializes that artifact under `src/semaphor/generated`. If the host
only exposes hosted OAuth materialization and returns
`materialization.status="not_written"`, use the official local command instead:

```bash
npm run data-app -- materialize-contract \
  --dir /path/to/react-app \
  --artifact-id <generatedContractArtifactId> \
  --materialization-token <generatedContractMaterializationToken>
```

When the response includes `localMaterialization.officialCommand`, execute that
typed command shape after resolving its `workspaceDir` and `semaphorPluginRoot`
placeholders. Do not parse `nextAgentAction` prose for command arguments.

For validation calls, the installed bridge reads those files back for
`semaphor_validate_data_app_contract`. It removes `workspaceDir` before
forwarding tool arguments to Semaphor, does not cache workspace roots across
projects, ignores ambiguous multi-root client root lists, and rejects generated
contract paths that escape the workspace or pass through symlinks. If the
current workspace has no active token, use OAuth or ask for a token instead of
relying on a previously used project.

The project-token bridge intentionally keeps unauthenticated fallback
`tools/list` minimal: access-context guidance only. Rich discovery, planning,
contract generation, semantic repair, and runtime-token tools come from live
Semaphor `tools/list` after auth is available. If no project token is found,
resolve auth first by retrying `semaphor_get_access_context` with
`workspaceDir`, using hosted OAuth, or asking the user to add a project token.
Do not use the generic `call:mcp` wrapper for normal app authoring.

When using `semaphor` OAuth, do not pass `workspaceDir` for auth. OAuth is an
interactive hosted session. Start with `semaphor_get_access_context`, then
`semaphor_list_projects`, then pass the chosen `projectId` to project-scoped
tools. If the local React app needs to run SDK queries in the browser and no
project token is configured, call `semaphor_get_data_app_runtime_token` for the
chosen project and write the returned token to the app's ignored `.env.local`
as `VITE_SEMAPHOR_PROJECT_TOKEN`. Do not print the token.

If only the `semaphor-project` diagnostic tool is visible and it reports that
no project token exists, or if hosted OAuth returns `requires
reauthentication`, pause for a recoverable auth step. Do not frame this as
denying the request and do not continue by scaffolding a generic dashboard
shell, mock analytics, or placeholder query registry. A Semaphor data app build
needs a resolved governed project before planning, metadata inspection,
codegen, validation, save, or publish. Ask the user to use the current host's
MCP OAuth login or reauthentication flow for the `semaphor` server.

For Codex, that login command is:

```bash
codex mcp login semaphor
```

For Claude Code or another agent host, use that host's MCP server
authentication UI or command. Then ask them to say "try again". Also say that
this thread may not detect the refreshed MCP login; if "try again" still
reports missing auth, start a new thread after logging in. For project-token
mode, ask them to add
`VITE_SEMAPHOR_PROJECT_TOKEN` to the target app's ignored `.env.local` and
retry with `workspaceDir`.

Then follow the returned recommendation:

- Semantic path:
  1. `semaphor_list_semantic_domains`
  2. `semaphor_list_datasets`
  3. `semaphor_get_dataset_schema`
  4. `semaphor_plan_data_app` for broad new app/dashboard planning, or
     `semaphor_plan_data_app_change` for substantial existing-app analytical
     edits.
  5. `semaphor_analyze` for governed BI analysis, or `semaphor_matrix` for
     pivot, hierarchy, subtotal, and grand-total table shapes.
  6. `semaphor_get_data_app_runtime_token` only when OAuth mode needs a local
     browser runtime token for the target React app.
- Physical/no-domain path:
  1. list connections and required database/schema/table levels
  2. use `semaphor_query_sql_advanced` only when semantic analysis cannot
     express the question or no semantic coverage exists.

## Tool Selection

Use `semaphor_plan_data_app` before broad new Semaphor-backed React app builds.
Use `semaphor_plan_data_app_change` before substantial analytical edits to an
existing app. These tools return plan/change artifacts for codegen; consume
their `sdkSpec`, `inputs`, `views`, `operations`, and unsupported gaps instead
of improvising query specs from prose.

Use `semaphor_analyze` for ordinary governed BI questions: metrics,
dimension breakdowns, top-N, trends, filters, latest-available windows,
previous-period comparisons, same-period-last-year comparisons, period-change
driver analysis, and relationship-aware joins.

Use `semaphor_matrix` when the durable app view is a matrix/pivot table with
row hierarchy, column hierarchy, sparse cells, subtotals, or grand totals.

Use `semaphor_query_sql_advanced` for SQL-first work: custom CTEs, window
functions, raw-row inspection, physical tables with no semantic coverage, or
analysis not expressible through `semaphor_analyze`. When validating SQL during
authoring, start with `LIMIT 5` or `LIMIT 10` unless the user explicitly needs
more rows.

## Runtime Translation

MCP results are authoring evidence, not static app content. Durable
data-bearing React views should translate the grounded source, fields, filters,
comparison, and matrix shape into public `react-semaphor/data-app-sdk` query
specs and `useSemaphorQuery`.

OAuth authoring credentials are not runtime credentials. If OAuth mode needs
local browser runtime, use `semaphor_get_data_app_runtime_token` to mint a
scoped project token. Write only `VITE_SEMAPHOR_PROJECT_TOKEN` to an ignored
local env file. Never write MCP OAuth access tokens to app source or env files.

If MCP can answer a question but no SDK runtime path exists, explain the
capability gap. Do not paste MCP markdown or raw result rows into generated app
source as a static answer.

## Fallback Wrapper

The fallback wrapper is for debugging and evals when the host fails to expose
first-class MCP tools:

```bash
npm run call:mcp -- --list-tools --dir /path/to/react-app
npm run call:mcp -- semaphor_get_analysis_context --dir /path/to/react-app
npm run call:mcp -- semaphor_analyze --dir /path/to/react-app --input-file query.json
```

If `--list-tools` works but first-class MCP tools are unavailable in the agent
session, classify the failure as plugin-host MCP exposure. Do not continue by
manually speaking MCP protocol.

The wrapper uses the packaged local Semaphor MCP bridge. It must not download
or run `mcp-remote` through `npx` at call time, because that would combine
freshly downloaded executable code with the customer's project token.
