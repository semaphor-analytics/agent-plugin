# Distribution Model

This repository is the Semaphor agent plugin package. The package should work
across agent hosts by sharing the same Semaphor-owned contracts:

```text
agent plugin
  -> Semaphor MCP for authoring discovery and governed analysis
  -> react-semaphor/data-app-sdk builders plus useSemaphorQuery for runtime data
  -> Semaphor Data App lifecycle REST APIs for save and publish
```

The plugin must not fork the analytics language by host. Codex, Claude Code,
Cursor, and future agents should all exercise the same MCP tools, SDK
builder/query contracts, validation route, and lifecycle APIs.

## Current Package Shape

```text
semaphor-agent-plugin/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  .mcp.json
  skills/
  scripts/
  docs/
```

`skills/semaphor-data-apps/SKILL.md` is the shared agent behavior contract.
`.mcp.json` is the shared Semaphor MCP configuration. The Codex and Claude
manifests are thin host adapters over those shared files.

## Codex Distribution

Current beta shape:

1. Install or enable the Semaphor Agent Plugin package.
2. Add the project token to the target Vite app's ignored `.env.local`:

   ```bash
   VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
   ```

3. Open Codex in the target React repository.
4. Ask Codex to inspect Semaphor data, plan changes, generate React with
   `react-semaphor/data-app-sdk`, validate, and optionally save or publish.

Validation:

```bash
npm run validate:codex-plugin
```

## Claude Code Distribution

Claude Code plugins are directories with `.claude-plugin/plugin.json`.
Semaphor's Claude plugin manifest points at the same shared `skills/` and
`.mcp.json` files used by Codex.

Local development install:

```bash
claude --plugin-dir /path/to/semaphor-agent-plugin
```

Local validation:

```bash
npm run validate:claude-plugin
```

Customer marketplace install should eventually use a Semaphor marketplace
entry that points at this plugin repository. The customer setup remains the
same:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

Then the user opens Claude Code in a React repo and invokes the Semaphor plugin
or asks naturally for Semaphor-backed app work. Claude Code should use the
namespaced Semaphor skill and MCP server instead of project-local one-off
instructions.

The plugin infers the MCP URL from the project token's `apiServiceUrl`. Use
`SEMAPHOR_MCP_URL` only for unusual local routing overrides.

## Shared Customer Contract

For both Codex and Claude Code:

- Customer app shape is arbitrary React.
- `init:data-app` is optional starter scaffolding, not a required layout.
- Runtime app code uses public `react-semaphor/data-app-sdk` builders and
  canonical query execution:
  - `semaphor.metric`
  - `semaphor.records`
  - `semaphor.analysis`
  - `semaphor.sql`
  - `semaphor.matrix`
  - `semaphor.derivedField`
  - `semaphor.filter`
  - `semaphor.sqlParam`
  - `semaphor.inputOptions`
  - `useSemaphorInputs`
  - `useSemaphorQuery`
- Authoring questions use MCP:
  - discovery and grounding tools first,
  - `semaphor_analyze` for governed BI,
  - `semaphor_matrix` for pivot, hierarchy, subtotal, and grand-total table
    authoring,
  - `semaphor_query_sql_advanced` for SQL-first or unsupported analysis.
- Save/publish uses Semaphor Data App lifecycle APIs through the helper
  command path, not MCP lifecycle wrappers.
- Semaphor-hosted publish requires a static browser bundle and a prepared
  `semaphor.data-app.json` with `runtime.entry` and `runtime.styles`.

## Package Validation

Before sharing a package build, run:

```bash
npm run validate:plugin
npm run validate:claude-plugin
node --check scripts/semaphor-data-app.mjs
```

`validate:plugin` checks the shared package shape and Codex manifest metadata.
`validate:claude-plugin` uses Claude Code's validator when Claude Code is
installed.

## Source References

Claude Code plugin docs describe plugins as directories with
`.claude-plugin/plugin.json`, root-level components such as `skills/`, and
optional MCP server config. Claude Code marketplaces install plugins from
catalog entries that can point at GitHub, Git URLs, local paths, or other
supported sources. Keep the Semaphor package aligned with those conventions
instead of maintaining a separate Claude-only implementation.
