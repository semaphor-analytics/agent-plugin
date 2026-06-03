# MCP Authoring

Semaphor MCP is the authoring and exploration plane. Use it to inspect the
customer's governed Semaphor project before generating data-bearing React code.

## Primary Path

The agent host should expose Semaphor MCP servers as first-class callable
tools. Use those tools directly. Do not inspect plugin implementation files,
start the MCP bridge manually, or write JSON-RPC glue.

There are two server names:

- `semaphor`: hosted OAuth MCP. Use this for first-run login and project
  discovery when no project token is configured.
- `semaphor-project`: project-token MCP bridge. Use this when the target app
  already has `VITE_SEMAPHOR_PROJECT_TOKEN` or `SEMAPHOR_PROJECT_TOKEN`, when
  working against local/self-hosted Semaphor, or when save/publish validation
  needs the project-token scope.

Start with one of:

- `semaphor_get_access_context` for auth, scope, and project-token context.
- `semaphor_get_analysis_context` for project scope, recommended path,
  semantic-domain count, fallback connection count, and next discovery tool.

When using `semaphor-project` in Codex or another host that launches plugin MCP
servers from the plugin install directory, pass `workspaceDir` as the current
React app repository root if the project token lives in that app's
`.env.local`. If a first call reports that no project token was found, retry
the same call with `workspaceDir`. The Semaphor bridge uses `workspaceDir` only
to read local env files, removes it before forwarding the tool arguments to
Semaphor, and does not cache workspace roots across projects. If the current
workspace has no active token, use OAuth or ask for a token instead of relying
on a previously used project.

When using `semaphor` OAuth, do not pass `workspaceDir` for auth. OAuth is an
interactive hosted session. Start with `semaphor_get_access_context`, then
`semaphor_list_projects`, then pass the chosen `projectId` to project-scoped
tools. If the local React app needs to run SDK queries in the browser and no
project token is configured, call `semaphor_get_data_app_runtime_token` for the
chosen project and write the returned token to the app's ignored `.env.local`
as `VITE_SEMAPHOR_PROJECT_TOKEN`. Do not print the token.

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
