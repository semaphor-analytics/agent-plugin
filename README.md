# Semaphor Agent Plugin

Build Semaphor-backed React data apps from Codex or Claude Code.

Semaphor lets your coding agent inspect governed project data, plan analytics
views, generate React components with `react-semaphor/data-app-sdk`, validate
the app, and publish hosted Data Apps back to Semaphor.

## What You Need

- A React app.
- A Semaphor project token from `https://semaphor.cloud/project`.
- Codex or Claude Code.
- `react-semaphor` in your React app. The agent can add it if it is missing.

Your app can use Vite, Next.js, Remix, React Router, a monorepo, or a custom
product shell. The plugin does not require a starter template or a specific app
layout.

## Install

### Codex

Add the Semaphor marketplace from GitHub, then install the Semaphor plugin:

```bash
codex plugin marketplace add semaphor-analytics/agent-plugin
codex plugin add semaphor --marketplace semaphor
```

After installation, open Codex in your React app repository and confirm the
Semaphor plugin is enabled.

### Claude Code

Add the Semaphor marketplace from GitHub, then install the Semaphor plugin:

```text
/plugin marketplace add semaphor-analytics/agent-plugin
/plugin install semaphor@semaphor
/reload-plugins
```

After installation, open Claude Code in your React app repository and confirm
the Semaphor plugin is enabled.

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

## Connect To Semaphor

Create or update your app's ignored local env file:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

For non-Vite apps, use the same token through your app's normal local
configuration system.

Do not commit real tokens. For production, provide runtime tokens through your
backend, Semaphor embed/token flow, or Semaphor hosted Data App runtime.

## First Prompts

Start by asking the agent to inspect your governed Semaphor data:

```text
What Semaphor data can I use in this project?
```

For broad dashboard or app requests, ask for a plan first:

```text
Use my Semaphor project data to plan an operations dashboard app.
```

When the plan looks right, ask the agent to build:

```text
Build that app in this React repo and use Semaphor runtime queries.
```

## Common Workflows

Ask a data question:

```text
Why did revenue change last month?
```

Add a dashboard view:

```text
Add a revenue trend and segment table to this page.
```

Add filters:

```text
Add a region filter and make the KPI, trend, and table respond to it.
```

Build matrix or pivot tables:

```text
Show revenue by region and segment with row totals and a grand total.
```

Create app-local governed calculations:

```text
Add gross margin as a derived metric even though it is not modeled yet.
```

Use SQL when needed:

```text
Use SQL to show the latest raw inventory movement rows, then add a bounded table.
```

Save or publish to Semaphor:

```text
Save this as a Semaphor Data App named "Operations App".
Publish the latest revision to Semaphor.
```

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
- SQL-backed views
- driver and period-change analysis
- matrix and pivot tables
- derived fields
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

## Design Principles

- Work with your React app as it exists.
- Inspect real Semaphor metadata before generating data-bearing code.
- Use `react-semaphor/data-app-sdk` for runtime queries.
- Plan before broad dashboard changes.
- Include loading, error, and empty states for data-bearing views.
- Use server-side filtering, sorting, pagination, and matrix shaping for large
  result sets.
- Do not hardcode sample data when the view should execute governed Semaphor
  analytics.

## More Documentation

- [Installation and auth](plugins/semaphor/docs/INSTALLATION_AND_AUTH.md)
- [Golden workflows](plugins/semaphor/docs/GOLDEN_WORKFLOWS.md)
- [Data App SDK reference](plugins/semaphor/docs/DATA_APP_SDK_REFERENCE.md)
- [Data App SDK examples](plugins/semaphor/docs/SDK_HOOK_EXAMPLES.md)
- [Publishing to Semaphor](plugins/semaphor/docs/PUBLISHING_TO_SEMAPHOR.md)
- [Troubleshooting](plugins/semaphor/docs/TROUBLESHOOTING.md)
