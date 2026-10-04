# Semaphor

Answer business questions with governed analytics from your Semaphor
projects, in Claude Code or Codex.

This is the installable Semaphor plugin package. It provides:

- the `semaphor` MCP server (`https://semaphor.cloud/api/mcp`): your semantic
  model, governed queries, dashboards and a SQL escape hatch, all under your
  Semaphor permissions;
- the `semaphor-analytics` skill, which teaches the agent to ground answers in
  the semantic model and explain them from governed results.

For installation, see the marketplace README at the repository root:
`https://github.com/semaphor-analytics/agent-plugin`.

## Quick start

1. Install the plugin and log in (`/mcp` in Claude Code, or
   `codex mcp login semaphor` in Codex).
2. Ask:

   ```text
   What data can I analyze in Semaphor?
   How did revenue change last quarter, and what drove it?
   Check whether my sales dashboard's numbers are right.
   ```

## What this plugin connects to and sends

- It runs no local code, hooks or package installs. Its only component
  besides the skill is one remote MCP server, `https://semaphor.cloud/api/mcp`
  (Streamable HTTP).
- Your client logs in to Semaphor with OAuth. The login grants read access
  (`mcp:read`); changes also need write access (`mcp:write`) and an author
  role.
- The agent sends the tool calls it makes (semantic queries, dashboard ids,
  change proposals) to that server, which returns governed results from your
  own Semaphor data under your permissions and security policies.
- Nothing deletes, publishes, schedules or sends anything. Changes (creating
  a dashboard, adding a relationship) start with a preview and apply only
  through `semaphor_apply_change`.

## Documentation

- [Installation and auth](docs/INSTALLATION_AND_AUTH.md): OAuth, and MCP
  project tokens for headless and embedded use
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [The analytics skill](skills/semaphor-analytics/SKILL.md)
