# Installation And Auth

This plugin helps customers build Semaphor-backed features inside Vite React
applications, including existing React apps and the Semaphor Data App Starter.

## Install

Install the Semaphor plugin in Codex or Claude Code from the repository
marketplace documented in the repository README:

```text
https://github.com/semaphor-analytics/agent-plugin
```

Then open your coding agent in the React app repository where you want to build
or modify a Semaphor-backed Data App.

## Auth Options

The plugin supports two authoring paths:

- Hosted OAuth login through the MCP server named `semaphor`.
- Project-token authoring through the MCP server named `semaphor-project`.

Use OAuth when no project token is configured and the customer wants the
lowest-friction first run. Use project-token mode when the app already has a
known project scope, when working against local/self-hosted Semaphor, or when
local runtime/publish needs a deterministic project token.

Both paths must expose the same project-scoped Data App authoring capabilities
after auth. OAuth can additionally list/select projects; project-token mode is
already scoped to one project. The hard migration is about removing the old
planner-vs-generator capability split, not about removing OAuth login.

Auth mode must not change MCP semantics. The remote Semaphor MCP server is
metadata/artifact oriented and does not write local files, whether the caller
authenticated with OAuth or a project token. Local filesystem reads/writes are
only performed by the installed Agent Plugin bridge on explicit bridge-local
flows such as generated-contract materialization and validation workspace
reads. Treat `workspaceDir` as a bridge hint, never as a server-side MCP
argument.

## OAuth Login

If the hosted `semaphor` MCP server is not already authenticated, or if an
OAuth tool says the app connection requires reauthentication, use the current
agent host's MCP OAuth login or reauthentication flow for the server named
`semaphor`.

For Codex, that login command is:

```bash
codex mcp login semaphor
```

For Claude Code or another agent host, use that host's MCP server
authentication UI or command for the `semaphor` server. Then tell the agent
"try again". The agent should list Semaphor projects and ask which project to
use. In OAuth mode, project-scoped tools should receive an explicit
`projectId`. If the host does not expose refreshed OAuth tools until a new
session starts, open a fresh agent session after login.

OAuth is an authoring credential. It does not automatically become the React
app's runtime credential. If the local app needs to run Semaphor SDK queries in
the browser, the agent should call `semaphor_get_data_app_runtime_token` for
the selected project and write the minted project token to the app's ignored
local env file as `VITE_SEMAPHOR_PROJECT_TOKEN`.

## Project Token

Retrieve the token from:

```text
https://semaphor.cloud/project
```

For local app development, store the token in your React app's ignored local
environment file. Vite example:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

The plugin helper scripts also accept `SEMAPHOR_PROJECT_TOKEN` from shell env
or local env files for deterministic scoped development.

Do not commit real tokens. Agents should check for expected variable names, but
should not print, search, or log token values.

## Semaphor MCP And API Resolution

In normal hosted usage, do not set a separate server URL. Helper HTTP calls
resolve the Semaphor app API from the project token's `apiServiceUrl`, which is
usually `https://semaphor.cloud`.

MCP routing derives from the same project token. The project-token bridge uses
the token's `apiServiceUrl` plus `/api/mcp`. Tokens without `apiServiceUrl` are
invalid for the plugin bridge and should be re-minted from the target Semaphor
environment. For local or self-hosted Semaphor development, mint or provide a
project token whose `apiServiceUrl` points at that Semaphor app host.

Do not set plugin API-base or MCP URL aliases. Separate routing overrides are
not part of the agent-plugin routing contract.

## MCP Tool Exposure

After installation, the agent host should expose the Semaphor MCP server as
first-class callable tools. The plugin exposes two MCP servers:

```text
semaphor          hosted OAuth MCP for login and project discovery
semaphor-project  project-token MCP bridge for project-scoped token mode
```

The exact namespace is host-specific, but the available tools should include:

```text
semaphor_get_access_context
semaphor_get_analysis_context
semaphor_list_semantic_domains
semaphor_list_datasets
semaphor_get_dataset_schema
semaphor_get_data_app_runtime_token
semaphor_analyze
semaphor_matrix
semaphor_query_sql_advanced
semaphor_plan_data_app
semaphor_generate_data_app_contract
semaphor_update_data_app_contract
semaphor_materialize_data_app_contract
semaphor_validate_data_app_contract
```

Hosts that include the server name in the tool namespace should expose a
Semaphor-shaped namespace instead of a generic bridge name.

For Data App generation, the complete server-owned Semaphor surface is
required. A host that exposes analytics and planning tools but not
`semaphor_create_data_app_contract`,
`semaphor_generate_data_app_contract`,
`semaphor_update_data_app_contract`, or
`semaphor_materialize_data_app_contract`, or
`semaphor_validate_data_app_contract` has server/plugin MCP surface drift.
Agents should stop before editing React source, report the mismatch, and ask
the user to reload, reinstall, upgrade, or retry against the authenticated
Semaphor MCP server. They should not manually transcribe planner output into
generated contract files.

Some agent hosts launch plugin MCP servers from the installed plugin directory
and do not pass workspace roots to the MCP process. In that case, direct
`semaphor-project` MCP calls may not see the React app's `.env.local`
automatically. Agents should retry the project-token tool call with an internal
`workspaceDir` argument set to the current React app repository root. The
bridge strips `workspaceDir` before forwarding the request to Semaphor and does
not cache workspace paths across projects.

`workspaceDir` has two local bridge effects:

- Auth/context/discovery calls use it to read ignored local env files such as
  `.env.local` for the current React app.
- `semaphor_materialize_data_app_contract` calls use it to materialize the
  server-returned generated contract artifact under `src/semaphor/generated`.
- Validation calls use it to read
  `contract.manifest.json + generatedFiles` for
  `semaphor_validate_data_app_contract`.

The bridge rejects generated contract paths that escape `workspaceDir` or pass
through symlinks. If the current workspace has no active token, use the hosted
OAuth path or add a token for that workspace.

Production-ready auth behavior:

- Hosted OAuth server `semaphor` is the first-run/account-level path. Use it to
  log in, list projects, and mint a runtime project token when the user has not
  configured a local token yet.
- Project-token server `semaphor-project` is the deterministic app-local path.
  If the bridge cannot resolve a token during `tools/list`, it exposes only
  access-context guidance. Resolve auth first by retrying
  `semaphor_get_access_context` with `workspaceDir`, using hosted OAuth, or
  adding a project token; rich discovery, planning, and contract tools come
  from live Semaphor `tools/list` after auth is available.
- For local generated-contract writes, use the first-class installed bridge
  materializer when the host exposes it. If the host only exposes hosted OAuth
  materialization with `materialization.status="not_written"`, use the
  official local command:

  ```bash
  npm run data-app -- materialize-contract \
    --dir /path/to/react-app \
    --artifact-id <generatedContractArtifactId> \
    --materialization-token <generatedContractMaterializationToken> \
    --artifact-base-url <generatedContractArtifactBaseUrl>
  ```

  The official materialization command does not require a project token. It
  fetches the generated artifact from the trusted
  `generatedContractArtifactBaseUrl` returned by Semaphor with the short-lived
  `generatedContractMaterializationToken`, then writes files locally. Do not
  read target-app env files to choose the artifact host.

  When the MCP response includes `localMaterialization.officialCommand`, use
  that object as the command shape and resolve only the `workspaceDir` and
  `semaphorPluginRoot` placeholders. Do not parse `nextAgentAction` prose to
  reconstruct command arguments.

- `call:mcp` is a diagnostic fallback for debugging and eval forensics only.
  Do not use it for ordinary customer app authoring.
  It is not the normal app-building path.

If a host does not expose those tools, use the fallback wrapper for debugging or
evals:

```bash
npm run call:mcp -- --list-tools --dir /path/to/react-app
npm run call:mcp -- semaphor_get_analysis_context --dir /path/to/react-app
```

The wrapper handles env loading, the packaged MCP bridge, token redaction,
timeout, and clean JSON output. It does not download bridge code at runtime.
It is not the preferred customer authoring loop; direct MCP tools are.

## Authoring Token Versus Runtime Token

Keep these concerns separate:

- **Authoring token**: used by the coding agent and MCP while building the app.
- **Runtime token**: used by the React app at runtime to execute governed Data
  App SDK queries.

With OAuth, the agent can mint a scoped local development runtime token:

```text
semaphor_get_data_app_runtime_token({ projectId })
```

The tool returns the token in structured MCP content so the agent can update
`.env.local`, while the human-readable tool text redacts it. Agents must write
only:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<minted-runtime-token>"
```

Do not write the MCP OAuth access token into the app. If the local runtime
token expires or becomes invalid, refresh it by calling
`semaphor_get_data_app_runtime_token` again through OAuth and replacing the
ignored env value.

During deterministic project-token development, authoring and runtime may use
the same project token. For a shipped customer app, do not commit a long-lived
token into frontend source. Provide runtime auth through the customer app
backend, Semaphor embed/token flow, or Semaphor hosted Data App runtime.

Generated app code should normally pass only a token for execution routing and
enable SDK DevTools only in local development:

```tsx
const enableDevtools =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && window.location.hostname === "localhost");

<SemaphorDataAppProvider
  token={runtimeToken}
  debug={enableDevtools ? { exposeWindowBridge: true } : false}
>
  {children}
  <SemaphorDevtools
    initialIsOpen={false}
    buttonPosition="bottom-right"
    panelPosition="right"
  />
</SemaphorDataAppProvider>
```

Import `SemaphorDevtools` from `react-semaphor/data-app-sdk`. This root
component gives developers the floating inspector and right dock, and lets
coding agents read structured traces with
`window.__SEMAPHOR_DEVTOOLS__?.snapshot()` in local dev. Use
`panelPosition="bottom"` only when the user asks for a bottom dock. Do not enable
`exposeWindowBridge` for production embeds or normal end-user runtime code.

The SDK decodes the Semaphor API URL from the token. Do not generate extra API
base URL env vars or `apiBaseUrl` for the normal cloud case. Plugin MCP routing
also derives from the project token's `apiServiceUrl`.

## Customer Setup Checklist

1. Install or enable the Semaphor plugin in Codex, Claude Code, or the target
   agent host.
2. Open the agent host in the target React repo, or start from
   `semaphor-analytics/semaphor-data-app-starter` for a clean local app.
3. If no project token is configured, log in with Semaphor OAuth and choose a
   project.
4. If OAuth is used and the local app must run SDK queries, let the agent mint
   a scoped runtime token with `semaphor_get_data_app_runtime_token` and write
   it to ignored `.env.local`.
5. If a deterministic scoped setup is preferred, retrieve the project token
   from `https://semaphor.cloud/project` and add it to the target app's ignored
   local env/config file.
6. Ask the agent what Semaphor data is available.
7. Install `react-semaphor` in the customer app if missing.
8. Ask the agent to plan broad dashboard changes before editing.
9. Run the app's own typecheck/build and a browser smoke check when practical.

## Save And Publish Auth

Save and publish use the same project token configured for MCP authoring. The
helper commands read the token from shell env or the target app's local env
files. They resolve the Semaphor app URL from the token's `apiServiceUrl`.

Common commands:

```bash
npm run prepare:publish -- --dir /path/to/customer-app
npm run save:data-app -- --dir /path/to/customer-app --project-id <project-id> --title "Operations App"
npm run publish:data-app -- --dir /path/to/customer-app --project-id <project-id> --data-app-id <data-app-id> --title "Operations App"
```

`prepare:publish` runs the app build and prepares `semaphor.data-app.json` with
the hosted runtime asset paths Semaphor needs. `publish:data-app` runs the same
preparation automatically before saving the draft and starting the Semaphor
publish session.

The lifecycle helper writes `.semaphor.data-app.local.json` as local conflict
state. It stores non-secret source snapshot hashes for Data App ids this
workspace has loaded or saved. When a later save or publish sees that the
remote draft/current source hash no longer matches the local baseline, it stops
rather than overwriting another workspace's changes. Use `--new` for an
intentional copy, or `--force` only when intentionally overwriting or
recovering.

Lifecycle writes must still pass server-side Data App permissions:

- create requires Data App create permission in the project;
- save draft requires Data App edit permission;
- publish requires Data App publish lifecycle permission;
- the token `project_id` must match the Data App project.

Never persist the authoring token into generated source, manifests, source
snapshots, build artifacts, validation output, or screenshots.

## Failure Diagnostics

Common setup failures:

- missing project token in shell env or local env;
- expired or unauthorized project token;
- OAuth login available but the local app runtime token was not minted or was
  not written to `.env.local`;
- no semantic domain access;
- missing `react-semaphor` package;
- runtime app has no token;
- runtime token's `apiServiceUrl` points at the wrong Semaphor host;
- app typecheck/build fails.

When a failure comes from Semaphor metadata or governed execution, treat it as a
Semaphor platform, MCP, SDK, or execution issue rather than solving it with
plugin-only prompt rules.
