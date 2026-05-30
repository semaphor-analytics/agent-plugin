# Installation And Auth

This plugin is intended for customers building Semaphor-backed features inside
their existing React applications. It should work with Vite, Next.js, Remix,
React Router, monorepos, and custom product shells.

## Distribution Status

The current beta shape is a shared Semaphor agent plugin repository:

```text
semaphor-agent-plugin/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  .mcp.json
  skills/
  scripts/
```

The eventual distribution mechanism may be a packaged Agent Plugin, an OpenAI
submission, a Claude Code marketplace entry, or a GitHub repo install. The
usage contract should remain the same:

- install or enable the plugin in Codex, Claude Code, or another supported
  agent host,
- configure Semaphor MCP credentials,
- open the agent in a React app,
- use the public `react-semaphor/data-app-sdk` hooks for runtime analytics.

## Current Beta Limitations

- The plugin is currently packaged as a repository-shaped beta artifact.
- `init:data-app` is optional scaffolding for clean starts; customer apps do
  not need to follow its file layout.
- Runtime token provisioning belongs to the customer app unless the app is
  running inside a Semaphor hosted runtime.
- Save/publish support depends on the Semaphor App lifecycle APIs available in
  the target environment.
- `semaphor publish` means Semaphor-hosted Data App publish through Semaphor
  lifecycle APIs. It is not customer-hosted deployment.
- The beta helper commands are `npm run save:data-app` and
  `npm run publish:data-app`; both use the project token and Semaphor REST
  lifecycle APIs, not MCP lifecycle wrappers.
- Plugin validation is permissive by default. Strict validation is for
  Semaphor package-maintainer checks.

## Required Credentials

The plugin uses a Semaphor project token for MCP authoring. For Vite local
dogfooding, put the token in the target app's ignored `.env.local`:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

The MCP launcher and lifecycle helper read this local file. They also accept
`SEMAPHOR_PROJECT_TOKEN` from shell env or local env for non-Vite workflows.
Agents should not print or search local env files for token values. They may
check for expected variable names and should ask the user to add missing
credentials.

Customers retrieve this token from the Semaphor project page:

```text
https://semaphor.cloud/project
```

The token authorizes the coding agent to inspect Semaphor metadata and run
governed analysis through MCP. It does not give the agent database
credentials.

Store real tokens in a local ignored env file, not in source control.

## MCP URL Resolution

The plugin infers the MCP URL from the project token's `apiServiceUrl` and
connects to that Semaphor host's `/api/mcp` route. Hosted and self-hosted
tokens should both work without a separate MCP env var.

Set `SEMAPHOR_MCP_URL` only for unusual local routing overrides, such as a
developer tunnel or a temporary localhost MCP route that intentionally differs
from the token's `apiServiceUrl`.

## Authoring Token Versus Runtime Token

Keep these concerns separate:

- **Authoring token**: used by the coding agent and MCP while building the
  app.
- **Runtime token**: used by the React app at runtime to execute governed Data
  App SDK queries.

During local development, both may temporarily be the same project token. For a
customer-shipped app, do not commit a long-lived token into frontend source.
The app should receive an appropriate scoped runtime token from the customer's
backend, Semaphor embed/token flow, or Semaphor hosted Data App runtime.

Do not use `allowEdit: false` as the distinction between authoring and
runtime. That flag is deprecated for this work; project tokens currently mint
with `allowEdit: true`. Future runtime-only behavior needs a first-class token
purpose or equivalent Semaphor contract.

## Save And Publish Auth

Save/publish uses the same project token configured for MCP authoring.
When lifecycle APIs are available, the agent should call the Semaphor Data App
REST API/command path, not MCP lifecycle wrappers.

The helper commands read the project token from shell env or the target app's
local env files. They accept `SEMAPHOR_PROJECT_TOKEN` and, for Vite dogfooding,
`VITE_SEMAPHOR_PROJECT_TOKEN`. The Semaphor app URL is inferred from the
token's `apiServiceUrl`. `SEMAPHOR_API_BASE_URL` is optional and should be used
only for unusual local or self-hosted routing where the token URL should not be
used:

```bash
npm run prepare:publish -- --dir /path/to/customer-app
npm run save:data-app -- --dir /path/to/customer-app --project-id <project-id> --title "Operations App"
npm run publish:data-app -- --dir /path/to/customer-app --project-id <project-id> --data-app-id <data-app-id> --title "Operations App"
```

`prepare:publish` is local-only. It runs the app build and prepares
`semaphor.data-app.json` with the hosted runtime asset paths Semaphor needs.
`publish:data-app` runs the same preparation automatically before saving the
draft and starting the Semaphor publish session.

Lifecycle writes must still pass server-side Data App permissions:

- create requires dashboard/Data App create permission in the project,
- save draft requires Data App edit permission,
- publish start/upload/complete/fail requires Data App edit/publish lifecycle
  permission through the same dashboard permission model,
- the token `project_id` must match the Data App project.

Never persist the authoring token into generated source, manifests, source
snapshots, build artifacts, validation output, or screenshots.

## Customer Setup Checklist

1. Install or enable the Semaphor plugin in Codex, Claude Code, or the target
   agent host.
2. Retrieve the project token from `https://semaphor.cloud/project`.
3. Add `VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"` to the target app's
   ignored `.env.local`.
4. Open the agent host in the target React repo.
5. Run detection:

   ```bash
   npm run detect -- --dir /path/to/customer-app
   ```

6. Install `react-semaphor` in the customer app if missing.
7. Ask the agent to inspect Semaphor data and plan the app before editing.
8. Add SDK-hook based components into the app's existing structure.
9. Run the app's own typecheck/build and browser smoke checks.

## External Local App Smoke Test

For a quick test in an arbitrary Vite React app, create or update `.env.local`:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

The generated provider should only need the token:

```tsx
<SemaphorDataAppProvider token={runtimeToken}>{children}</SemaphorDataAppProvider>
```

Do not set or generate a separate Semaphor API base URL for the normal cloud
case. The SDK decodes `apiServiceUrl` from the token.

## Local Runtime Configuration

For local development, pass the project token into `SemaphorDataAppProvider`
using the target app's normal configuration system. The SDK decodes the
Semaphor API URL from the token. Provide `apiBaseUrl` only for unusual local
or self-hosted routing where the token's `apiServiceUrl` should not be used.

Vite-style local env:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN=<project-token>
```

Next.js or custom apps may use different names. The plugin should adapt to the
app's conventions instead of requiring these exact env variables.

## Claude Code Local Install

Claude Code uses `.claude-plugin/plugin.json` and discovers root-level
components such as `skills/` and `.mcp.json`.

For local development:

```bash
claude --plugin-dir /path/to/semaphor-agent-plugin
```

Validate when Claude Code is installed:

```bash
npm run validate:claude-plugin
```

For public/customer distribution, publish this package through a Claude Code
marketplace entry that points at the plugin repository. Do not fork the skill,
MCP config, or helper scripts for Claude; keep Claude Code and Codex on the
same Semaphor MCP, SDK, validation, and lifecycle contracts.

## Failure Diagnostics

Common setup failures should be reported directly:

- missing project token in shell env or local env,
- wrong `SEMAPHOR_MCP_URL` override,
- expired or unauthorized project token,
- no semantic domain access,
- missing `react-semaphor` package,
- runtime app has no token,
- runtime `apiBaseUrl` override points at the wrong Semaphor host,
- app typecheck/build fails.

When a failure comes from Semaphor metadata or governed execution, fix the MCP,
shared analytics protocol, SDK, or `semaphor-app` execution layer rather than
adding plugin-only prompt rules.
