# Semaphor Agent Plugin

Answer business questions with governed analytics from your Semaphor
projects.

The Semaphor Agent Plugin connects Claude Code or Codex to Semaphor. Your
agent explores your semantic model, runs governed queries under your
permissions, explains trends, drivers and period-over-period changes, audits
dashboards, and falls back to SQL only when a question needs it.

## Quick start

### 1. Install

Claude Code:

```bash
claude plugin marketplace add semaphor-analytics/agent-plugin
claude plugin install semaphor@semaphor-analytics
```

Codex:

```bash
codex plugin marketplace add semaphor-analytics/agent-plugin
codex plugin add semaphor@semaphor-analytics
```

### 2. Log in

- Claude Code: run `/mcp`, choose `semaphor`, and complete the login.
- Codex: run `codex mcp login semaphor`.

### 3. Ask

```text
What data can I analyze in Semaphor?
How did revenue change last quarter, and what drove it?
Which regions are behind target this month?
Check whether my sales dashboard's numbers are right.
```

## What you need

- A Semaphor account with access to at least one project.
- Claude Code or Codex.
- For automation or an agent inside your own product: an MCP project token
  (see [Installation and auth](plugins/semaphor/docs/INSTALLATION_AND_AUTH.md)).

## What the agent does

- **Grounds every answer in your semantic model:** domains, datasets,
  measures, dimensions and relationships, discovered through the MCP rather
  than guessed.
- **Runs governed queries** (`semaphor_analyze`, `semaphor_matrix`) that apply
  your permissions and security policies, so answers match your dashboards.
- **Explains results** with the dataset, fields and time window that ran.
- **Audits dashboards** by reading a dashboard's cards and filters and
  re-running their questions.
- **Uses SQL only when needed**, through Semaphor's governed execution.
- **Makes changes only when you ask:** creating a dashboard or adding a
  relationship needs write access and an author role, and the agent shows you
  the change first.

What the agent can do depends on who is calling: your role, whether you
logged in or used a token, and the token's settings.

## Claude Code commands

### Verify

```bash
claude plugin marketplace list
claude plugin list
```

In a session, `/mcp` shows the `semaphor` server and its login state.

### Upgrade

```bash
claude plugin marketplace update semaphor-analytics
```

If Claude Code still shows an older plugin, reinstall it:

```bash
claude plugin uninstall semaphor@semaphor-analytics
claude plugin install semaphor@semaphor-analytics
```

### Remove

```bash
claude plugin uninstall semaphor@semaphor-analytics
claude plugin marketplace remove semaphor-analytics
```

## Codex commands

### Verify

```bash
codex plugin marketplace list
codex plugin list --marketplace semaphor-analytics
codex mcp list
```

### Upgrade

```bash
codex plugin marketplace upgrade semaphor-analytics
```

If Codex still shows an older plugin, reinstall it:

```bash
codex plugin remove semaphor@semaphor-analytics
codex plugin add semaphor@semaphor-analytics
```

### Remove

```bash
codex plugin remove semaphor@semaphor-analytics
codex plugin marketplace remove semaphor-analytics
```

## Repository layout

```text
.claude-plugin/marketplace.json   Claude Code marketplace
.agents/plugins/marketplace.json  Codex marketplace
plugins/semaphor/                 the installable plugin
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  .mcp.json                       the hosted Semaphor MCP server
  skills/semaphor-analytics/      the analytics skill
  docs/                           installation, auth and troubleshooting
```

## More documentation

- [Installation and auth](plugins/semaphor/docs/INSTALLATION_AND_AUTH.md)
- [Troubleshooting](plugins/semaphor/docs/TROUBLESHOOTING.md)
- [Semaphor documentation](https://docs.semaphor.cloud)

## License

MIT. See [LICENSE](LICENSE).
