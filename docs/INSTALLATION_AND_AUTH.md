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

The plugin uses a Semaphor project token for MCP authoring:

```bash
export SEMAPHOR_PROJECT_TOKEN="<project-token>"
export SEMAPHOR_MCP_URL="https://semaphor.cloud/api/mcp"
```

Customers retrieve this token from the Semaphor project page:

```text
https://semaphor.cloud/project
```

The token authorizes the coding agent to inspect Semaphor metadata and run
governed analysis through MCP. It does not give the agent database
credentials.

Store real tokens in a local ignored env file, not in source control.

## Hosted Or Self-Hosted MCP

Customers should use hosted Semaphor MCP:

```bash
export SEMAPHOR_MCP_URL="https://semaphor.cloud/api/mcp"
```

Self-hosted Semaphor deployments should point at the deployment's MCP route:

```bash
export SEMAPHOR_MCP_URL="https://your-semaphor-host.example.com/api/mcp"
```

Use the MCP URL that matches the Semaphor project token's environment.

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

Alpha save/publish uses the same project token configured for MCP authoring.
When lifecycle APIs are available, the agent should call the Semaphor Data App
REST API/command path, not MCP lifecycle wrappers.

The helper commands read `SEMAPHOR_PROJECT_TOKEN` and optionally
`SEMAPHOR_API_BASE_URL`:

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
3. Set `SEMAPHOR_PROJECT_TOKEN`.
4. Set `SEMAPHOR_MCP_URL=https://semaphor.cloud/api/mcp`.
5. Open the agent host in the target React repo.
6. Run detection:

   ```bash
   npm run detect -- --dir /path/to/customer-app
   ```

7. Install `react-semaphor` in the customer app if missing.
8. Ask the agent to inspect Semaphor data and plan the app before editing.
9. Add SDK-hook based components into the app's existing structure.
10. Run the app's own typecheck/build and browser smoke checks.

## Local Runtime Configuration

For local development, pass a runtime token and API base URL into
`SemaphorDataAppProvider` using the target app's normal configuration system.

Vite-style local env:

```bash
VITE_SEMAPHOR_API_BASE_URL=https://semaphor.cloud
VITE_SEMAPHOR_RUNTIME_TOKEN=<runtime-token>
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

- missing `SEMAPHOR_PROJECT_TOKEN`,
- wrong `SEMAPHOR_MCP_URL`,
- expired or unauthorized project token,
- no semantic domain access,
- missing `react-semaphor` package,
- runtime app has no token,
- runtime API base URL points at the wrong Semaphor host,
- app typecheck/build fails.

When a failure comes from Semaphor metadata or governed execution, fix the MCP,
shared analytics protocol, SDK, or `semaphor-app` execution layer rather than
adding plugin-only prompt rules.
