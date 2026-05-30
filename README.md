# Semaphor Agent Plugin

Agent plugin package for building Semaphor-backed React data apps in customer
repositories. The current package supports Codex and Claude Code.

This plugin is intentionally thin. The agent host owns local editing,
validation, and developer workflow. Semaphor owns authentication, project
metadata, semantic grounding, analytics intent validation, governed execution,
and Data App lifecycle APIs.

Distribution principle: this plugin must work with customer React apps as they
exist. It should not require Vite, the starter scaffold, a prescribed router,
provider filename, styling system, or component structure. The customer-facing
contract is React plus the canonical `react-semaphor/data-app-sdk` builder and
`useSemaphorQuery` runtime pattern, backed by Semaphor MCP/governed execution.

This repository stays focused on plugin packaging and operational usage across
agent hosts. Semaphor product, protocol, and lifecycle internals are maintained
in Semaphor-owned architecture docs and APIs rather than duplicated here.

Customer-facing setup and examples:

- [Installation and auth](docs/INSTALLATION_AND_AUTH.md)
- [Distribution model](docs/DISTRIBUTION.md)
- [Golden workflows](docs/GOLDEN_WORKFLOWS.md)
- [Data App SDK examples](docs/SDK_HOOK_EXAMPLES.md)
- [Publishing to Semaphor](docs/PUBLISHING_TO_SEMAPHOR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Quick Start

Use this path for customer or design-partner beta installs.

1. Configure the project token:

   Customers can retrieve the project token from Semaphor at
   `https://semaphor.cloud/project`.

   ```bash
   # In the target Vite app's ignored .env.local
   VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
   ```

   The plugin reads the target app's local env file for MCP authoring and
   save/publish. It also infers the Semaphor MCP URL from the token's
   `apiServiceUrl`.
   Set `SEMAPHOR_MCP_URL` only for unusual local routing overrides.

2. Open Codex, Claude Code, or another supported coding agent in the target
   React repository.

3. Detect the app shape:

   ```bash
   npm run detect -- --dir /path/to/customer-app
   ```

4. Install `react-semaphor` in the customer app if needed.

5. Ask the agent to inspect Semaphor data before editing:

   ```text
   What Semaphor data can I use in this project?
   ```

6. Build or modify the app using the public SDK builder/query pattern:

   ```text
   Use my Semaphor project data to add an inventory movement dashboard to this app.
   ```

7. Validate with the customer app's own checks:

   ```bash
   npm run validate:data-app -- --dir /path/to/customer-app
   ```

8. Save or publish through the shared Semaphor Data App lifecycle:

   ```bash
   npm run save:data-app -- --dir /path/to/customer-app --project-id <project-id> --title "Operations App"
   npm run publish:data-app -- --dir /path/to/customer-app --project-id <project-id> --data-app-id <data-app-id> --title "Operations App"
   ```

## Current Beta Notes

- This is the shared Semaphor Agent Plugin repo for Codex, Claude Code, and
  future coding-agent hosts. It is distinct from Semaphor's custom
  visualization plugin system.
- `init:data-app` is an optional starter scaffold, not a required customer app
  shape.
- Runtime token provisioning is app-owned unless the app is running inside a
  Semaphor hosted runtime.
- Save/publish flows call the Semaphor App lifecycle APIs directly with the
  project token. They do not use MCP lifecycle wrappers.
- When save/publish is available, `semaphor publish` means Semaphor-hosted
  Data App publish through Semaphor lifecycle APIs. It does not mean
  customer-hosted deployment.
- `validate:data-app` is permissive by default; `--strict` is for Semaphor
  package-maintainer quality gates.
- The plugin does not own analytics semantics, query compilation, permissions,
  or persistence. Those belong to Semaphor MCP, `semaphor-app`, and
  `react-semaphor`.

## Repository Role

Keep this plugin outside `semaphor-app`. It is a customer-facing agent-plugin
distribution artifact, not application server code.

Current ownership split:

- `react-semaphor` owns `react-semaphor/data-app-sdk` and
  `react-semaphor/analytics-protocol`.
- `semaphor-app` owns MCP, auth, data grounding, governed execution, draft
  persistence, and publish lifecycle.
- This plugin owns agent-host instructions, MCP configuration, local
  integration scripts, Codex and Claude Code manifests/configuration, and
  validation workflow.

## Claude Code

Claude Code uses `.claude-plugin/plugin.json`. This repo includes a Claude
manifest that points to the same shared `skills/` and `.mcp.json` used by
Codex.

Local Claude Code development:

```bash
claude --plugin-dir /path/to/semaphor-agent-plugin
```

Validate the Claude package when Claude Code is installed:

```bash
npm run validate:claude-plugin
```

The customer setup stays the same: retrieve a project token from
`https://semaphor.cloud/project`, add it to the target app's ignored local env
file, and open the agent in the target React repo. The MCP URL is inferred
from the token; set `SEMAPHOR_MCP_URL` only for unusual local routing
overrides.

Do not commit project tokens. For shipped React apps, pass runtime tokens to
`SemaphorDataAppProvider` through the customer app's normal backend, embed
token, or hosted runtime path.

## Helper Scripts

Detect the current React app:

```bash
node scripts/detect-react-app.mjs --dir /path/to/customer-app
```

Add Semaphor integration files:

```bash
node scripts/init-semaphor-data-app.mjs --dir /path/to/customer-app
```

Validate a Semaphor data app workspace:

```bash
node scripts/validate-semaphor-data-app.mjs --dir /path/to/customer-app
```

The validator is intentionally permissive by default. It checks basic package
compatibility and runs the app's own typecheck/build scripts when present, then
prints Semaphor-specific advisories without constraining the customer's React
architecture. Use `--strict` only for Semaphor package-maintainer quality
gates.

Prepare a Semaphor-hosted publish bundle:

```bash
node scripts/semaphor-data-app.mjs prepare-publish --dir /path/to/customer-app
```

This runs the app build, detects hashed browser assets, and writes the
`runtime.entry` and `runtime.styles` fields in `semaphor.data-app.json`.

Load, save, or publish a Semaphor-hosted Data App:

```bash
node scripts/semaphor-data-app.mjs load --data-app-id <data-app-id>
node scripts/semaphor-data-app.mjs save-draft --dir /path/to/customer-app --project-id <project-id> --title "Operations App"
node scripts/semaphor-data-app.mjs publish --dir /path/to/customer-app --project-id <project-id> --title "Operations App"
```

The helper reads the project token from shell env or the target app's local env
files. It accepts `SEMAPHOR_PROJECT_TOKEN` and, for Vite dogfooding,
`VITE_SEMAPHOR_PROJECT_TOKEN`. It infers the Semaphor app URL from the token's
`apiServiceUrl`. Use `SEMAPHOR_API_BASE_URL` or `--api-base-url` only for
unusual local or self-hosted routing where the token URL should not be used.
Publishing always saves a draft first, starts publish from that draft id and
`sourceRevision.snapshotHash`, prepares the hosted runtime manifest, uploads
hashed built assets, and completes or fails the same server publish session.

The first save or publish creates the Semaphor-hosted Data App and writes its
identity to `semaphor.data-app.json` under `semaphor.projectId` and
`semaphor.dataAppId`. Later saves and publishes read that identity and update
the same app. Use `--new` only when intentionally creating a separate copy.

## Product Mental Model

The plugin should help Codex, Claude Code, and future coding agents follow
this loop:

```text
customer request
  -> classify operation
  -> inspect Semaphor metadata through MCP
  -> answer exploratory data questions with semaphor_analyze
  -> use semaphor.analysis plus useSemaphorQuery for productized insight/driver views
  -> plan app without editing files
  -> generate React with react-semaphor/data-app-sdk builders and useSemaphorQuery
  -> validate with typecheck/build and Semaphor execution diagnostics
  -> save draft or publish through Semaphor Data App lifecycle APIs
```

The plugin must not create a host-specific analytics language. Data-bearing React
views should use the public SDK and shared analytics protocol.

For table-heavy apps, keep data volume explicit. Small tables can use bounded
Semaphor result sets with client-side interaction over returned rows. Large
or complete-dataset tables should use Semaphor server-side filtering, sorting,
and pagination/windowing; table UI libraries such as `@tanstack/react-table`
or `@tanstack/react-virtual` are optional rendering/state helpers, not a reason
to pull unbounded rows into the browser.
