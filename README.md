# Semaphor Agent Plugin

Build data apps and answer business questions, grounded in your data.

The Semaphor Agent Plugin connects Codex or Claude Code to your Semaphor
project. Your agent can inspect governed data, answer business questions, plan
KPIs and charts, generate React data-app code, validate the result, and publish
the finished app back to Semaphor.

## Quick Start

### 1. Install In Codex

Add the Semaphor marketplace from GitHub, then install the plugin:

```bash
codex plugin marketplace add semaphor-analytics/agent-plugin
codex plugin add semaphor@semaphor-analytics
```

### 2. Open Or Create A React App

If you already have a React app, use that app. If you are starting fresh, use
the Semaphor Data App Starter:

```bash
git clone https://github.com/semaphor-analytics/semaphor-data-app-starter.git my-data-app
cd my-data-app
npm install
```

The starter is a simple Vite + shadcn app with the basics in place so the
agent can focus on your data app instead of initial project setup.

### 3. Connect To Semaphor

If you do not have a project token configured, log in with Semaphor from Codex:

```bash
codex mcp login semaphor
```

After login, ask the agent to list your projects and choose the project for
this app. If the app needs to run locally, the agent can mint a scoped
development runtime token for that project and write
`VITE_SEMAPHOR_PROJECT_TOKEN` to the app's ignored `.env.local`. The OAuth
token itself is never written into the app.

If you already know the project and want a deterministic scoped setup, create
or update your app's ignored local env file:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token-from-semaphor-project-page>"
```

Get project tokens from your Semaphor project page:

```text
https://semaphor.cloud/project
```

Do not commit real tokens.

### 4. Open Your App

Start Codex from the app directory and try:

```text
Create a data app from my project.
```

Semaphor should inspect your project data, propose a plan, and then help build
the app once you approve the direction.

## What You Need

- A React app. For a new app, start with
  [semaphor-data-app-starter](https://github.com/semaphor-analytics/semaphor-data-app-starter).
  Existing Vite, Next.js, Remix, React Router, monorepos, and custom product
  shells are all fine too.
- Semaphor login, or a Semaphor project token for deterministic scoped
  development.
- Codex or Claude Code.
- `react-semaphor` in your app. The agent can add it if it is missing.

## Codex Commands

### Install

```bash
codex plugin marketplace add semaphor-analytics/agent-plugin
codex plugin add semaphor@semaphor-analytics
```

### Verify

```bash
codex plugin marketplace list
codex plugin list --marketplace semaphor-analytics
```

After installation, Semaphor MCP tools should be available to Codex as
first-class callable tools. The plugin exposes:

- `semaphor`: hosted OAuth MCP for login and project discovery.
- `semaphor-project`: project-token MCP bridge for scoped/local development.

### Upgrade

```bash
codex plugin marketplace upgrade semaphor-analytics
```

If Codex still shows an older plugin after upgrading the marketplace, remove
and reinstall the plugin:

```bash
codex plugin remove semaphor@semaphor-analytics
codex plugin add semaphor@semaphor-analytics
```

### Remove

Remove only the installed plugin:

```bash
codex plugin remove semaphor@semaphor-analytics
```

Remove the marketplace source as well:

```bash
codex plugin marketplace remove semaphor-analytics
```

`plugin remove` removes the installed plugin. `marketplace remove` removes the
marketplace source.

### Debug MCP Tool Access

Most users should not need this. Use it only when debugging from a local
checkout of this repository and a host does not expose the Semaphor MCP tools
as first-class callable tools:

```bash
npm run call:mcp -- --list-tools --dir /path/to/react-app
npm run call:mcp -- semaphor_get_access_context --dir /path/to/react-app
```

## Claude Code

Add the Semaphor marketplace from GitHub, install the plugin, and reload
plugins:

```text
/plugin marketplace add semaphor-analytics/agent-plugin
/plugin install semaphor@semaphor-analytics
/reload-plugins
```

Then open Claude Code in your React app repository and ask it to inspect your
Semaphor project.

## Connect To Semaphor

The lowest-friction first run is Semaphor login:

```bash
codex mcp login semaphor
```

Then ask the agent:

```text
What Semaphor projects can I use?
```

For deterministic scoped app development, put a project token in `.env.local`:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token-from-semaphor-project-page>"
```

For non-Vite apps, use your app's normal local env system. The plugin helper
scripts can also read:

```bash
SEMAPHOR_PROJECT_TOKEN="<project-token-from-semaphor-project-page>"
```

Hosted Semaphor does not require a separate server URL. Self-hosted or custom
Semaphor deployments may set:

```bash
SEMAPHOR_SERVER_URL="https://your-semaphor-host"
```

When `SEMAPHOR_SERVER_URL` is absent, the plugin uses the Semaphor host encoded
in the project token and falls back to `https://semaphor.cloud`.

For production apps, provide runtime tokens through your backend, Semaphor
embed/token flow, or Semaphor hosted Data App runtime.

When using OAuth for local development, ask the agent to mint or refresh the
local runtime token instead of manually copying one:

```text
Mint a local runtime token for this project.
```

The agent should use `semaphor_get_data_app_runtime_token`, write the returned
project token only to ignored local env, and avoid printing it.

## Good First Prompts

```text
Create a data app from my project.
```

```text
Add a revenue chart with period-over-period change.
```

```text
What's driving the trend in my top KPI?
```

```text
Publish this app to Semaphor.
```

## Common Workflows

### Answer A Business Question

```text
Why did revenue change last month?
```

### Plan A Data App

```text
Plan an operations data app from my Semaphor project.
```

### Add A View

```text
Add a revenue trend and segment table to this page.
```

### Add Filters

```text
Add a region filter and make the KPI, trend, and table respond to it.
```

### Build Matrix Or Pivot Tables

```text
Show revenue by region and segment with row totals and a grand total.
```

### Add Governed Calculations

```text
Add gross margin as a derived metric.
```

### Use SQL When Needed

```text
Use SQL to show the latest raw inventory movement rows, then add a bounded table.
```

### Save Or Publish

```text
Save this as a Semaphor Data App named "Operations App".
Publish the latest revision to Semaphor.
```

## What The Agent Should Do

For broad app-building requests, the agent should:

1. Inspect your Semaphor project metadata.
2. Plan the app before writing code.
3. Explain which views are backed by governed queries and which gaps need model
   improvements.
4. Generate React code using `react-semaphor/data-app-sdk`.
5. Validate loading, empty, error, and data states.
6. Save or publish the app when you approve it.

The agent should not hardcode sample data when a view should execute governed
Semaphor analytics.

## Generated Code Pattern

The plugin generates standard React code using the public Semaphor Data App
SDK:

```tsx
import {
  SemaphorDataAppProvider,
  semaphor,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
```

Typical query pattern:

```tsx
const revenueQuery = semaphor.metric({
  id: "total-revenue",
  source,
  metrics: [revenue],
  primaryMetric: revenue,
});

function RevenueKpi() {
  const result = useSemaphorQuery(revenueQuery);

  if (result.isLoading) return <span>Loading...</span>;
  if (result.error) return <span>{result.error.message}</span>;

  return <strong>{formatNumber(result.value)}</strong>;
}
```

The plugin supports:

- metrics
- records and tables
- filters and controls
- driver and period-change analysis
- matrix and pivot tables
- derived fields
- SQL-backed views when governed builders cannot express the question
- save and publish to Semaphor

## Validate Your App

Ask the agent to validate the app before you review or publish it:

```text
Validate this Semaphor data app and run the app's normal typecheck/build.
```

The agent should use your app's existing package manager and scripts, then run
Semaphor-specific checks for common SDK and publish issues.

## Publish To Semaphor

Ask the agent to save or publish when the app is ready:

```text
Save this as a Semaphor Data App named "Operations App".
Publish the latest revision to Semaphor.
```

The first save or publish creates a Semaphor-hosted Data App and writes its
identity to `semaphor.data-app.json`. Later saves and publishes update the
same app.

## Repository Layout

This GitHub repo is the marketplace root for both Codex and Claude Code:

```text
agent-plugin/
  .agents/plugins/marketplace.json      # Codex marketplace catalog
  .claude-plugin/marketplace.json       # Claude Code marketplace catalog
  plugins/semaphor/                     # Shared installable plugin package
```

Codex and Claude Code use different marketplace file locations, but both
marketplaces point to the same `plugins/semaphor` package.

## More Documentation

- [Installation and auth](plugins/semaphor/docs/INSTALLATION_AND_AUTH.md)
- [Golden workflows](plugins/semaphor/docs/GOLDEN_WORKFLOWS.md)
- [Data App SDK reference](plugins/semaphor/docs/DATA_APP_SDK_REFERENCE.md)
- [Data App SDK examples](plugins/semaphor/docs/SDK_HOOK_EXAMPLES.md)
- [Publishing to Semaphor](plugins/semaphor/docs/PUBLISHING_TO_SEMAPHOR.md)
- [Troubleshooting](plugins/semaphor/docs/TROUBLESHOOTING.md)
