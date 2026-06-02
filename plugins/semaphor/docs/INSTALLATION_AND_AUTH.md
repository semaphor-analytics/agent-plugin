# Installation And Auth

This plugin helps customers build Semaphor-backed features inside existing
React applications. It works with Vite, Next.js, Remix, React Router,
monorepos, and custom product shells.

## Install

Install the Semaphor plugin in Codex or Claude Code from the repository
marketplace documented in the repository README:

```text
https://github.com/semaphor-analytics/agent-plugin
```

Then open your coding agent in the React app repository where you want to build
or modify a Semaphor-backed Data App.

## Required Credentials

The plugin uses a Semaphor project token for MCP authoring, governed analysis,
validation, save, and publish.

Retrieve the token from:

```text
https://semaphor.cloud/project
```

For local app development, store the token in your React app's ignored local
environment file. Vite example:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

For non-Vite apps, use your app's normal local configuration convention. The
plugin also accepts `SEMAPHOR_PROJECT_TOKEN` from shell env or local env files.

Do not commit real tokens. Agents should check for expected variable names, but
should not print, search, or log token values.

## MCP URL Resolution

In normal hosted or self-hosted usage, do not set a separate MCP URL. The plugin
infers the Semaphor host from the project token's `apiServiceUrl` and connects
to that host's `/api/mcp` route.

Set `SEMAPHOR_MCP_URL` only when the MCP route intentionally differs from the
Semaphor host encoded in the token, such as a temporary tunnel or custom
self-hosted routing setup.

## MCP Tool Exposure

After installation, the agent host should expose the Semaphor MCP server as
first-class callable tools. The exact namespace is host-specific, but the
available tools should include:

```text
semaphor_get_access_context
semaphor_get_analysis_context
semaphor_list_semantic_domains
semaphor_list_datasets
semaphor_get_dataset_schema
semaphor_analyze
semaphor_matrix
semaphor_query_sql_advanced
```

The plugin MCP server is named `semaphor`, so hosts that include the server name
in the tool namespace should expose a Semaphor-shaped namespace instead of a
generic bridge name.

If a host does not expose those tools, use the fallback wrapper for debugging or
evals:

```bash
npm run call:mcp -- --list-tools --dir /path/to/react-app
npm run call:mcp -- semaphor_get_analysis_context --dir /path/to/react-app
```

The wrapper handles env loading, MCP startup, token redaction, timeout, and
clean JSON output. It is not the preferred customer authoring loop; direct MCP
tools are.

## Authoring Token Versus Runtime Token

Keep these concerns separate:

- **Authoring token**: used by the coding agent and MCP while building the app.
- **Runtime token**: used by the React app at runtime to execute governed Data
  App SDK queries.

During local development, both may temporarily use the same project token. For
a shipped customer app, do not commit a long-lived token into frontend source.
Provide runtime auth through the customer app backend, Semaphor embed/token
flow, or Semaphor hosted Data App runtime.

Generated app code should normally pass only a token:

```tsx
<SemaphorDataAppProvider token={runtimeToken}>
  {children}
</SemaphorDataAppProvider>
```

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or `apiBaseUrl` for the
normal cloud case. Use `apiBaseUrl` only when the user explicitly needs custom
self-hosted or local routing that intentionally differs from the token's
`apiServiceUrl`.

## Customer Setup Checklist

1. Install or enable the Semaphor plugin in Codex, Claude Code, or the target
   agent host.
2. Retrieve the project token from `https://semaphor.cloud/project`.
3. Add the token to the target app's ignored local env/config file.
4. Open the agent host in the target React repo.
5. Ask the agent what Semaphor data is available.
6. Install `react-semaphor` in the customer app if missing.
7. Ask the agent to plan broad dashboard changes before editing.
8. Run the app's own typecheck/build and a browser smoke check when practical.

## Save And Publish Auth

Save and publish use the same project token configured for MCP authoring. The
helper commands read the token from shell env or the target app's local env
files and infer the Semaphor app URL from the token's `apiServiceUrl`.

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
- stale or incorrect `SEMAPHOR_MCP_URL` override;
- expired or unauthorized project token;
- no semantic domain access;
- missing `react-semaphor` package;
- runtime app has no token;
- runtime `apiBaseUrl` override points at the wrong Semaphor host;
- app typecheck/build fails.

When a failure comes from Semaphor metadata or governed execution, treat it as a
Semaphor platform, MCP, SDK, or execution issue rather than solving it with
plugin-only prompt rules.
